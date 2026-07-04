from __future__ import annotations

import argparse
import json
import os
import stat
import sys
from pathlib import Path
from typing import Any
from urllib import error, parse, request

DEFAULT_BASE_URL = "https://mcp.nexus.kushalsm.com"
CONFIG_DIR = Path.home() / ".config" / "nexus"
CREDENTIALS_PATH = CONFIG_DIR / "credentials.json"
VERSION = "3.0.0"


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
    parser.add_argument("--version", action="version", version=f"nexus-fitness {VERSION}")
    subparsers = parser.add_subparsers(dest="command")

    auth_parser = subparsers.add_parser("auth", help="Manage authentication")
    auth_subparsers = auth_parser.add_subparsers(dest="auth_command")

    auth_login = auth_subparsers.add_parser(
        "login", help="Sign in with an email code (no browser needed)"
    )
    auth_login.add_argument("--email", help="Email to sign in with")
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
    history_parser.add_argument("--type", choices=["workout", "meal", "weight"])
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
    update_parser.add_argument("--entry-id", required=True, help="Entry id from history/log output")
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
    friends_accept.add_argument("--email", required=True)
    friends_accept.set_defaults(handler=handle_friends_accept)

    friends_reject = friends_subparsers.add_parser("reject", help="Reject a pending request")
    friends_reject.add_argument("--email", required=True)
    friends_reject.set_defaults(handler=handle_friends_reject)

    friends_remove = friends_subparsers.add_parser("remove", help="Remove an active friend")
    friends_remove.add_argument("--email", required=True)
    friends_remove.set_defaults(handler=handle_friends_remove)

    return parser


# ------------------------------------------------------------------ auth
#
# Login is an email magic code, end to end in the terminal:
#   1. POST /api/v1/auth/request_code {email}
#   2. user types the 6-digit code from their inbox
#   3. POST /api/v1/auth/verify_code {email, code} -> long-lived token
# The token is an InstantDB refresh token; the server resolves it to the same
# identity ChatGPT gets through OAuth. No browser, no PKCE, no token refresh.


def handle_auth_login(args: argparse.Namespace) -> None:
    base_url = resolve_base_url(explicit=getattr(args, "base_url", None), allow_saved=False)

    email = (getattr(args, "email", None) or "").strip()
    if not email:
        email = input("Email: ").strip()
    if "@" not in email:
        raise CliError("Enter a valid email address.")

    _http_json("POST", f"{base_url}/api/v1/auth/request_code", body={"email": email})
    print(f"Code sent to {email}.")

    code = input("6-digit code: ").strip()
    if len(code) != 6 or not code.isdigit():
        raise CliError("The code is 6 digits.")

    payload = _http_json(
        "POST",
        f"{base_url}/api/v1/auth/verify_code",
        body={"email": email, "code": code},
    )
    token = payload.get("token")
    if not isinstance(token, str) or not token.strip():
        raise CliError("Server returned no token.")

    save_credentials(
        {
            "base_url": base_url,
            "token": token.strip(),
            "email": payload.get("email", email),
            "user_id": payload.get("user_id"),
        }
    )
    print(f"Logged in as {payload.get('email', email)}")


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
    _friends_action("accept", email=args.email)


def handle_friends_reject(args: argparse.Namespace) -> None:
    _friends_action("reject", email=args.email)


def handle_friends_remove(args: argparse.Namespace) -> None:
    _friends_action("remove", email=args.email)


def _friends_action(
    action: str,
    *,
    code: str | None = None,
    email: str | None = None,
) -> None:
    client = NexusApiClient.from_saved()
    print_json(
        client.request_json(
            "POST",
            "/api/v1/friends",
            body={"action": action, "code": code, "email": email},
        )
    )


# -------------------------------------------------------------- API client


class NexusApiClient:
    def __init__(self, *, base_url: str, token: str) -> None:
        self._base_url = base_url.rstrip("/")
        self._token = token

    @classmethod
    def from_saved(cls) -> "NexusApiClient":
        creds = load_saved_credentials()
        if creds is None:
            raise CliError("Not logged in. Run `nexus auth login` first.")

        base_url = _cred_str(creds, "base_url")
        token = _cred_str(creds, "token")
        if not base_url or not token:
            raise CliError("Credentials are incomplete. Run `nexus auth login` again.")

        return cls(base_url=base_url, token=token)

    def request_json(
        self,
        method: str,
        path: str,
        *,
        query: dict[str, Any] | None = None,
        body: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        try:
            return _http_json(
                method,
                f"{self._base_url}{path}",
                token=self._token,
                query=query,
                body=body,
            )
        except CliError as exc:
            if "HTTP 401" in str(exc):
                raise CliError("Session expired. Run `nexus auth login` again.") from exc
            raise


# ----------------------------------------------------------- HTTP helpers


def _http_json(
    method: str,
    url: str,
    *,
    token: str | None = None,
    query: dict[str, Any] | None = None,
    body: dict[str, Any] | None = None,
) -> dict[str, Any]:
    if query:
        clean = {k: v for k, v in query.items() if v is not None}
        if clean:
            url = f"{url}?{parse.urlencode(clean)}"

    # Identify as nexus-cli rather than the default Python-urllib UA, which
    # Cloudflare's bot filter (Error 1010) blocks on protected origins.
    headers: dict[str, str] = {
        "Accept": "application/json",
        "User-Agent": f"nexus-cli/{VERSION}",
    }
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if body is not None:
        headers["Content-Type"] = "application/json"

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


# --------------------------------------------------------- input helpers


def resolve_base_url(*, explicit: str | None = None, allow_saved: bool = True) -> str:
    base_url = explicit or os.getenv("NEXUS_API_BASE_URL") or os.getenv("NEXUS_BASE_URL")
    if not base_url and allow_saved:
        base_url = _cred_str(load_saved_credentials(), "base_url")
    if not base_url:
        base_url = DEFAULT_BASE_URL
    return base_url.rstrip("/")


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


def print_json(payload: dict[str, Any]) -> None:
    print(json.dumps(payload, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
