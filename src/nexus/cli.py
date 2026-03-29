from __future__ import annotations

import argparse
import base64
import hashlib
import http.server
import json
import os
import secrets
import socket
import stat
import sys
import threading
import time
import webbrowser
from pathlib import Path
from typing import Any
from urllib import error, parse, request

DEFAULT_BASE_URL = "https://nexus-53227342417.asia-south1.run.app"
CONFIG_DIR = Path.home() / ".config" / "nexus"
CREDENTIALS_PATH = CONFIG_DIR / "credentials.json"


class CliError(RuntimeError):
    pass


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    if not hasattr(args, "handler"):
        parser.print_help()
        return
    try:
        args.handler(args)
    except CliError as exc:
        print(str(exc), file=sys.stderr)
        raise SystemExit(1) from exc


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="nexus",
        description="Nexus – track workouts and nutrition from your terminal.",
    )
    parser.add_argument("--version", action="version", version="nexus-fitness 2.0.4")
    subparsers = parser.add_subparsers(dest="command")

    auth_parser = subparsers.add_parser("auth", help="Manage authentication")
    auth_subparsers = auth_parser.add_subparsers(dest="auth_command")

    auth_login = auth_subparsers.add_parser("login", help="Sign in with Google")
    auth_login.add_argument("--base-url", help="Nexus API base URL")
    auth_login.set_defaults(handler=handle_auth_login)

    auth_status = auth_subparsers.add_parser("status", help="Check current auth status")
    auth_status.set_defaults(handler=handle_auth_status)

    auth_logout = auth_subparsers.add_parser("logout", help="Sign out and remove credentials")
    auth_logout.set_defaults(handler=handle_auth_logout)

    history_parser = subparsers.add_parser("history", help="Fetch workout or meal history")
    history_parser.add_argument("--date")
    history_parser.add_argument("--from-date")
    history_parser.add_argument("--to-date")
    history_parser.add_argument("--type", choices=["workout", "meal"])
    history_parser.add_argument("--friend-id")
    history_parser.set_defaults(handler=handle_history)

    log_parser = subparsers.add_parser("log", help="Log workouts or meals from JSON")
    log_input = log_parser.add_mutually_exclusive_group(required=True)
    log_input.add_argument("--file", help="JSON file containing an array of entries")
    log_input.add_argument("--entries", help="Inline JSON array of entries")
    log_input.add_argument("--stdin", action="store_true", help="Read entries JSON from stdin")
    log_parser.add_argument("--date")
    log_parser.set_defaults(handler=handle_log)

    update_parser = subparsers.add_parser("update", help="Update an existing entry")
    update_parser.add_argument("--entry-id", required=True, type=int)
    update_input = update_parser.add_mutually_exclusive_group(required=True)
    update_input.add_argument("--file", help="JSON file with the full replacement object")
    update_input.add_argument("--data", help="Inline JSON replacement object")
    update_parser.set_defaults(handler=handle_update)

    friends_parser = subparsers.add_parser("friends", help="Manage friend connections")
    friends_subparsers = friends_parser.add_subparsers(dest="friends_command")

    friends_list = friends_subparsers.add_parser("list", help="List friends and pending requests")
    friends_list.set_defaults(handler=handle_friends_list)

    friends_add = friends_subparsers.add_parser("add", help="Send a friend request")
    friends_add.add_argument("--code", required=True)
    friends_add.set_defaults(handler=handle_friends_add)

    friends_accept = friends_subparsers.add_parser("accept", help="Accept a pending request")
    friends_accept.add_argument("--display-name", required=True)
    friends_accept.set_defaults(handler=handle_friends_accept)

    friends_reject = friends_subparsers.add_parser("reject", help="Reject a pending request")
    friends_reject.add_argument("--display-name", required=True)
    friends_reject.set_defaults(handler=handle_friends_reject)

    friends_remove = friends_subparsers.add_parser("remove", help="Remove an active friend")
    friends_remove.add_argument("--display-name", required=True)
    friends_remove.set_defaults(handler=handle_friends_remove)

    return parser


# ------------------------------------------------------------------ auth


def handle_auth_login(args: argparse.Namespace) -> None:
    base_url = resolve_base_url(explicit=getattr(args, "base_url", None), allow_saved=False)

    auth_config = fetch_auth_config(base_url)
    if not auth_config.get("auth_enabled"):
        raise CliError("Auth is not enabled on this Nexus server.")

    supabase_url = auth_config.get("supabase_url")
    publishable_key = auth_config.get("supabase_publishable_key")
    if not supabase_url or not publishable_key:
        raise CliError("Server did not return valid Supabase auth configuration.")

    # PKCE challenge (provides CSRF protection via code_verifier binding)
    code_verifier = secrets.token_urlsafe(64)
    digest = hashlib.sha256(code_verifier.encode("ascii")).digest()
    code_challenge = base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")

    # Find a free port and start a temporary callback server.
    # Use 127.0.0.1 (not localhost) in both the bind address and redirect URL
    # so IPv6-first systems where localhost resolves to ::1 don't miss the listener.
    port = _find_free_port()
    callback_url = f"http://127.0.0.1:{port}/callback"
    auth_code: list[str | None] = [None]

    class _CallbackHandler(http.server.BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            parsed = parse.urlparse(self.path)
            params = parse.parse_qs(parsed.query)
            auth_code[0] = (params.get("code") or [None])[0]

            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            if auth_code[0]:
                self.wfile.write(b"<h1>Signed in. You can close this tab.</h1>")
            else:
                self.wfile.write(b"<h1>Sign-in failed. Check the terminal.</h1>")

        def log_message(self, format: str, *log_args: Any) -> None:
            pass  # silence request logs

    server = http.server.HTTPServer(("127.0.0.1", port), _CallbackHandler)
    server.timeout = 120
    server_thread = threading.Thread(target=server.handle_request, daemon=True)
    server_thread.start()

    authorize_url = (
        f"{supabase_url.rstrip('/')}/auth/v1/authorize?"
        + parse.urlencode(
            {
                "provider": "google",
                "redirect_to": callback_url,
                "code_challenge": code_challenge,
                "code_challenge_method": "S256",
            }
        )
    )

    print("Opening browser to sign in with Google...")
    webbrowser.open(authorize_url)
    print(f"Waiting for sign-in (listening on 127.0.0.1:{port})...")

    server_thread.join(timeout=120)
    server.server_close()

    code = auth_code[0]
    if not code:
        raise CliError("Sign-in timed out or was cancelled.")

    # Exchange the code for tokens via Supabase PKCE flow
    token_response = _http_json(
        "POST",
        f"{supabase_url.rstrip('/')}/auth/v1/token",
        query={"grant_type": "pkce"},
        body={"auth_code": code, "code_verifier": code_verifier},
        extra_headers={"apikey": publishable_key},
    )

    access_token = token_response.get("access_token")
    if not isinstance(access_token, str) or not access_token.strip():
        raise CliError("Supabase returned no access token.")

    expires_at = token_response.get("expires_at")
    if expires_at is None:
        expires_in = token_response.get("expires_in")
        if isinstance(expires_in, (int, float)):
            expires_at = int(time.time() + float(expires_in))

    user_info = token_response.get("user") or {}
    email = user_info.get("email", "unknown")

    save_credentials(
        {
            "base_url": base_url,
            "token": access_token.strip(),
            "refresh_token": token_response.get("refresh_token"),
            "expires_at": expires_at,
            "supabase_url": supabase_url,
            "supabase_publishable_key": publishable_key,
        }
    )

    print(f"Logged in as {email}")


def handle_auth_status(_: argparse.Namespace) -> None:
    client = NexusApiClient.from_saved()
    print_json(client.request_json("GET", "/api/v1/me"))


def handle_auth_logout(_: argparse.Namespace) -> None:
    if CREDENTIALS_PATH.exists():
        CREDENTIALS_PATH.unlink()
    print_json({"logged_out": True})


# ---------------------------------------------------------------- history


def handle_history(args: argparse.Namespace) -> None:
    client = NexusApiClient.from_saved()
    query = {
        "date": args.date,
        "from_date": args.from_date,
        "to_date": args.to_date,
        "type": args.type,
        "friend_id": args.friend_id,
    }
    print_json(client.request_json("GET", "/api/v1/history", query=query))


# -------------------------------------------------------------------- log


def handle_log(args: argparse.Namespace) -> None:
    client = NexusApiClient.from_saved()
    entries = _read_entries(args)
    print_json(
        client.request_json(
            "POST",
            "/api/v1/log",
            body={"entries": entries, "date": args.date},
        )
    )


# ----------------------------------------------------------------- update


def handle_update(args: argparse.Namespace) -> None:
    client = NexusApiClient.from_saved()
    if args.file:
        data = _load_json_file(args.file)
    else:
        try:
            data = json.loads(args.data)
        except json.JSONDecodeError as exc:
            raise CliError(f"Inline --data JSON is invalid: {exc}") from exc
    if not isinstance(data, dict):
        raise CliError("Update payload must be a JSON object.")
    print_json(
        client.request_json(
            "POST",
            "/api/v1/update",
            body={"entry_id": args.entry_id, "data": data},
        )
    )


# --------------------------------------------------------------- friends


def handle_friends_list(_: argparse.Namespace) -> None:
    _friends_action("list")


def handle_friends_add(args: argparse.Namespace) -> None:
    _friends_action("add", code=args.code)


def handle_friends_accept(args: argparse.Namespace) -> None:
    _friends_action("accept", display_name=args.display_name)


def handle_friends_reject(args: argparse.Namespace) -> None:
    _friends_action("reject", display_name=args.display_name)


def handle_friends_remove(args: argparse.Namespace) -> None:
    _friends_action("remove", display_name=args.display_name)


def _friends_action(
    action: str,
    *,
    code: str | None = None,
    display_name: str | None = None,
) -> None:
    client = NexusApiClient.from_saved()
    print_json(
        client.request_json(
            "POST",
            "/api/v1/friends",
            body={"action": action, "code": code, "display_name": display_name},
        )
    )


# -------------------------------------------------------------- API client


class NexusApiClient:
    def __init__(self, *, base_url: str, token: str, credentials: dict[str, Any]) -> None:
        self._base_url = base_url.rstrip("/")
        self._token = token
        self._credentials = credentials

    @classmethod
    def from_saved(cls) -> "NexusApiClient":
        creds = load_saved_credentials()
        if creds is None:
            raise CliError("Not logged in. Run `nexus auth login` first.")

        base_url = _cred_str(creds, "base_url")
        token = _cred_str(creds, "token")
        if not base_url or not token:
            raise CliError("Credentials are incomplete. Run `nexus auth login` again.")

        return cls(base_url=base_url, token=token, credentials=creds)

    def request_json(
        self,
        method: str,
        path: str,
        *,
        query: dict[str, Any] | None = None,
        body: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        self._refresh_if_needed()
        try:
            return _http_json(
                method,
                f"{self._base_url}{path}",
                token=self._token,
                query=query,
                body=body,
            )
        except CliError as exc:
            if "HTTP 401" not in str(exc):
                raise
            if not self._force_refresh():
                raise
            return _http_json(
                method,
                f"{self._base_url}{path}",
                token=self._token,
                query=query,
                body=body,
            )

    def _refresh_if_needed(self) -> None:
        expires_at = _cred_number(self._credentials, "expires_at")
        if expires_at is None:
            return
        if time.time() < expires_at - 60:
            return
        self._force_refresh()

    def _force_refresh(self) -> bool:
        refresh_token = _cred_str(self._credentials, "refresh_token")
        supabase_url = _cred_str(self._credentials, "supabase_url")
        publishable_key = _cred_str(self._credentials, "supabase_publishable_key")
        if not refresh_token or not supabase_url or not publishable_key:
            return False

        try:
            payload = _http_json(
                "POST",
                f"{supabase_url.rstrip('/')}/auth/v1/token",
                query={"grant_type": "refresh_token"},
                body={"refresh_token": refresh_token},
                extra_headers={"apikey": publishable_key},
            )
        except CliError:
            return False

        new_token = payload.get("access_token")
        if not isinstance(new_token, str) or not new_token.strip():
            return False

        expires_at = payload.get("expires_at")
        if expires_at is None:
            expires_in = payload.get("expires_in")
            if isinstance(expires_in, (int, float)):
                expires_at = int(time.time() + float(expires_in))

        self._token = new_token.strip()
        self._credentials["token"] = self._token
        self._credentials["refresh_token"] = payload.get("refresh_token", refresh_token)
        self._credentials["expires_at"] = expires_at
        save_credentials(self._credentials)
        return True


# ----------------------------------------------------------- HTTP helpers


def _http_json(
    method: str,
    url: str,
    *,
    token: str | None = None,
    query: dict[str, Any] | None = None,
    body: dict[str, Any] | None = None,
    extra_headers: dict[str, str] | None = None,
) -> dict[str, Any]:
    if query:
        clean = {k: v for k, v in query.items() if v is not None}
        if clean:
            url = f"{url}?{parse.urlencode(clean)}"

    headers: dict[str, str] = {"Accept": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if body is not None:
        headers["Content-Type"] = "application/json"
    if extra_headers:
        headers.update(extra_headers)

    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = request.Request(url, data=data, headers=headers, method=method)

    try:
        with request.urlopen(req) as resp:
            raw = resp.read().decode("utf-8")
    except error.HTTPError as exc:
        details = exc.read().decode("utf-8", errors="replace")
        raise CliError(f"HTTP {exc.code}: {details}") from exc
    except error.URLError as exc:
        raise CliError(f"Failed to reach server: {exc.reason}") from exc

    try:
        return json.loads(raw)
    except json.JSONDecodeError as exc:
        raise CliError(f"Server returned invalid JSON: {raw[:200]}") from exc


# -------------------------------------------------------- credential store


def load_saved_credentials() -> dict[str, Any] | None:
    if not CREDENTIALS_PATH.exists():
        return None
    with open(CREDENTIALS_PATH, "r", encoding="utf-8") as f:
        payload = json.load(f)
    return payload if isinstance(payload, dict) else None


def save_credentials(payload: dict[str, Any]) -> None:
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    with open(CREDENTIALS_PATH, "w", encoding="utf-8") as f:
        json.dump(payload, f)
    os.chmod(CREDENTIALS_PATH, stat.S_IRUSR | stat.S_IWUSR)


def _cred_str(creds: dict[str, Any] | None, key: str) -> str | None:
    if creds is None:
        return None
    val = creds.get(key)
    return val.strip() if isinstance(val, str) and val.strip() else None


def _cred_number(creds: dict[str, Any] | None, key: str) -> float | None:
    if creds is None:
        return None
    val = creds.get(key)
    return float(val) if isinstance(val, (int, float)) else None


# --------------------------------------------------------- input helpers


def resolve_base_url(*, explicit: str | None = None, allow_saved: bool = True) -> str:
    base_url = explicit or os.getenv("NEXUS_API_BASE_URL") or os.getenv("NEXUS_BASE_URL")
    if not base_url and allow_saved:
        base_url = _cred_str(load_saved_credentials(), "base_url")
    if not base_url:
        base_url = DEFAULT_BASE_URL
    return base_url.rstrip("/")


def fetch_auth_config(base_url: str) -> dict[str, Any]:
    return _http_json("GET", f"{base_url.rstrip('/')}/api/v1/auth/config")


def _read_entries(args: argparse.Namespace) -> list[Any]:
    if args.file:
        payload = _load_json_file(args.file)
    elif args.entries:
        try:
            payload = json.loads(args.entries)
        except json.JSONDecodeError as exc:
            raise CliError(f"Inline --entries JSON is invalid: {exc}") from exc
    elif args.stdin:
        try:
            payload = json.loads(sys.stdin.read())
        except json.JSONDecodeError as exc:
            raise CliError(f"Stdin JSON is invalid: {exc}") from exc
    else:
        raise CliError("Provide --file, --entries, or --stdin.")

    if not isinstance(payload, list):
        raise CliError("Entries payload must be a JSON array.")
    return payload


def _load_json_file(path: str) -> Any:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def _find_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def print_json(payload: dict[str, Any]) -> None:
    print(json.dumps(payload, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
