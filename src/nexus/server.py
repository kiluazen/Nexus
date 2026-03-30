from __future__ import annotations

import argparse
from typing import Any

from fastmcp import FastMCP
from fastmcp.server.dependencies import get_access_token
from starlette.requests import Request
from starlette.responses import JSONResponse, PlainTextResponse, Response
from starlette.routing import Route
import uvicorn

from nexus.app import NexusApp, UserContext, handle_validation_error
from nexus.auth import NexusOAuthProvider
from nexus.config import Settings
from nexus.models import ValidationError
from nexus.storage import Store

settings = Settings.from_env()
auth = None
if settings.base_url and settings.supabase_url and settings.supabase_publishable_key:
    auth = NexusOAuthProvider(settings)

mcp = FastMCP("Nexus – Workout and Nutrition Tracker", auth=auth)
_store: Store | None = None
_app: NexusApp | None = None


def get_store() -> Store:
    global _store
    if _store is None:
        _store = Store(settings)
    return _store


def get_app() -> NexusApp:
    global _app
    if _app is None:
        _app = NexusApp(get_store())
    return _app


@mcp.custom_route("/.well-known/openai-apps-challenge", methods=["GET"])
async def openai_domain_verify(_: Request) -> PlainTextResponse:
    return PlainTextResponse("p7WC1Y8Ev8u7vcTTDqzMy7RAZo5YtbfLifniIRJKXe8")


@mcp.custom_route("/health", methods=["GET"])
async def health(_: Request) -> PlainTextResponse:
    try:
        settings.validate()
    except Exception as exc:
        return PlainTextResponse(str(exc), status_code=503)
    return PlainTextResponse("ok")


@mcp.custom_route("/", methods=["GET"])
async def root(_: Request) -> JSONResponse:
    return JSONResponse(
        {
            "name": "Nexus",
            "version": "2.0",
            "mcp_path": settings.mcp_path,
            "auth_enabled": auth is not None,
            "tools": ["log", "history", "update", "friends"],
        }
    )


# -------------------------------------------------------------------- Tools


@mcp.tool
def log(
    entries: list[dict],
    date: str | None = None,
) -> dict:
    """Store workout and/or meal entries for the authenticated user.

    Log immediately when the user tells you about a workout or meal.
    If you already fetched history() for this date in this conversation
    and an exercise is already logged, use update() instead of duplicating.

    Workout shape:
      {"type": "workout", "exercise": "Dumbbell Bench Press",
       "exercise_key": "dumbbell_bench_press",
       "sets": [{"weight_kg": 25, "reps": 8}]}
    Cardio shape:
      {"type": "workout", "exercise": "Jiu Jitsu",
       "exercise_key": "jiu_jitsu", "duration_min": 60,
       "notes": "Trained how to go from half control to side control or mount"}
    Meal shape:
      {"type": "meal", "meal_type": "lunch",
       "items": [{"name": "chapati", "quantity": 2, "calories": 220,
                  "protein_g": 6, "carbs_g": 40, "fat_g": 4}, ...]}
    Weight shape:
      {"type": "weight", "weight_kg": 72.5, "notes": "morning, fasted"}

    exercise_key: lowercase_with_underscores, shortest unambiguous name.
    MUST reuse keys from your_exercises in history(). For new exercises,
    just pick a sensible key and log it immediately — do NOT ask for
    confirmation. The user can correct later with update().

    Meals: estimate macros PER ITEM, not for the whole meal. Every item
    must have name, quantity, calories, protein_g, carbs_g, fat_g. The
    server computes totals. You need to think deeply for example if its a leg piece how big is that piece, its smaller than the usual portions i serach on web, maybe i shoudl half the protein value from what i found on web etc..  
    ask clarifying questions to the user about the food cause this must be as accurate as possible.

    Args:
        entries: List of entries to log.
        date: YYYY-MM-DD, defaults to today.
    """
    user = require_mcp_user()
    try:
        return get_app().log_entries(
            user=user,
            entries=entries,
            date=date,
        )
    except ValidationError as exc:
        return handle_validation_error(exc)


@mcp.tool
def history(
    date: str | None = None,
    from_date: str | None = None,
    to_date: str | None = None,
    type: str | None = None,
    friend_id: str | None = None,
) -> dict:
    """Fetch entries for the authenticated user. Call before log() to
    avoid duplicates. Response includes your_exercises: all exercise_keys
    ever used — reuse these when logging.

    With no arguments: returns the last 7 days.
    With friend_id: returns that friend's entries (must be connected).
    Get friend IDs from friends(action="list").

    Args:
        date: Single date YYYY-MM-DD (shortcut for from_date=to_date).
        from_date: Range start (inclusive).
        to_date: Range end (inclusive).
        type: "workout", "meal", or "weight". Omit for all.
        friend_id: User ID of a friend. Omit for own data.
    """
    user = require_mcp_user()
    try:
        return get_app().get_history(
            user=user,
            date=date,
            from_date=from_date,
            to_date=to_date,
            entry_type=type,
            friend_id=friend_id,
        )
    except ValidationError as exc:
        return handle_validation_error(exc)


@mcp.tool
def update(
    entry_id: int,
    data: dict,
) -> dict:
    """Replace the data of an existing entry. Send the COMPLETE data
    object — not a partial patch. For meals the server recomputes totals.

    Args:
        entry_id: Row ID from history().
        data: Full replacement data (same shape as log entries).
    """
    user = require_mcp_user()
    try:
        return get_app().update_entry(
            user=user,
            entry_id=entry_id,
            data=data,
        )
    except ValidationError as exc:
        return handle_validation_error(exc)


@mcp.tool
def friends(
    action: str,
    code: str | None = None,
    display_name: str | None = None,
) -> dict:
    """Manage friend connections. Friends can see each other's data
    through history(friend_id=...).

    Actions:
    - "list": Your friend code, active friends, and pending requests.
    - "add": Send request using their code (e.g. "NEXUS-R3M8").
    - "accept": Accept a pending request by display name.
    - "reject": Reject a pending request by display name.
    - "remove": Remove an active friend.

    Args:
        action: "list", "add", "accept", "reject", or "remove".
        code: Friend code, required for "add".
        display_name: Required for "accept", "reject", and "remove".
    """
    user = require_mcp_user()
    try:
        return get_app().manage_friends(
            user=user,
            action=action,
            code=code,
            display_name=display_name,
        )
    except ValidationError as exc:
        return handle_validation_error(exc)


# -------------------------------------------------------------- Auth helper


def require_mcp_user() -> UserContext:
    access_token = get_access_token()
    if access_token is None:
        # For local dev without auth, use a default test user
        return UserContext(user_id="test-user-1", display_name="Local Test User")

    user_id = str(access_token.claims.get("sub", "")).strip()
    if not user_id:
        raise PermissionError("Authenticated token is missing the subject claim.")

    return UserContext(
        user_id=user_id,
        display_name=_display_name_from_claims(access_token.claims),
    )


async def api_me(request: Request) -> JSONResponse:
    try:
        user = await require_http_user(request)
    except PermissionError as exc:
        return JSONResponse({"error": str(exc)}, status_code=401)
    return JSONResponse(
        {
            "user_id": user.user_id,
            "display_name": user.display_name,
            "auth_enabled": auth is not None,
        }
    )


async def api_auth_config(_: Request) -> JSONResponse:
    return JSONResponse(
        {
            "auth_enabled": auth is not None,
            "supabase_url": settings.supabase_url,
            "supabase_publishable_key": settings.supabase_publishable_key,
        }
    )


async def api_log(request: Request) -> JSONResponse:
    body = await _parse_json_body(request)
    if isinstance(body, JSONResponse):
        return body
    try:
        user = await require_http_user(request)
        payload = get_app().log_entries(
            user=user,
            entries=_expect_list(body.get("entries"), field_name="entries"),
            date=_optional_str(body.get("date")),
        )
        return JSONResponse(payload)
    except PermissionError as exc:
        return JSONResponse({"error": str(exc)}, status_code=401)
    except ValidationError as exc:
        return JSONResponse(handle_validation_error(exc), status_code=400)


async def api_history(request: Request) -> JSONResponse:
    try:
        user = await require_http_user(request)
        payload = get_app().get_history(
            user=user,
            date=_query_param(request, "date"),
            from_date=_query_param(request, "from_date"),
            to_date=_query_param(request, "to_date"),
            entry_type=_query_param(request, "type"),
            friend_id=_query_param(request, "friend_id"),
        )
        return JSONResponse(payload)
    except PermissionError as exc:
        return JSONResponse({"error": str(exc)}, status_code=401)
    except ValidationError as exc:
        return JSONResponse(handle_validation_error(exc), status_code=400)


async def api_update(request: Request) -> JSONResponse:
    body = await _parse_json_body(request)
    if isinstance(body, JSONResponse):
        return body
    try:
        user = await require_http_user(request)
        payload = get_app().update_entry(
            user=user,
            entry_id=_expect_int(body.get("entry_id"), field_name="entry_id"),
            data=_expect_dict(body.get("data"), field_name="data"),
        )
        return JSONResponse(payload)
    except PermissionError as exc:
        return JSONResponse({"error": str(exc)}, status_code=401)
    except ValidationError as exc:
        return JSONResponse(handle_validation_error(exc), status_code=400)


async def api_friends(request: Request) -> JSONResponse:
    body = await _parse_json_body(request)
    if isinstance(body, JSONResponse):
        return body
    try:
        user = await require_http_user(request)
        payload = get_app().manage_friends(
            user=user,
            action=_expect_str(body.get("action"), field_name="action"),
            code=_optional_str(body.get("code")),
            display_name=_optional_str(body.get("display_name")),
        )
        return JSONResponse(payload)
    except PermissionError as exc:
        return JSONResponse({"error": str(exc)}, status_code=401)
    except ValidationError as exc:
        return JSONResponse(handle_validation_error(exc), status_code=400)


async def require_http_user(request: Request) -> UserContext:
    if auth is None:
        return UserContext(user_id="test-user-1", display_name="Local Test User")

    bearer = request.headers.get("authorization", "")
    if not bearer.lower().startswith("bearer "):
        raise PermissionError("Missing bearer token.")

    token = bearer.split(" ", 1)[1].strip()
    if not token:
        raise PermissionError("Missing bearer token.")

    verified = await auth.verify_bearer_token(token)
    if verified is None:
        raise PermissionError("Bearer token is invalid.")

    claims, _issuer = verified
    user_id = str(claims.get("sub", "")).strip()
    if not user_id:
        raise PermissionError("Authenticated token is missing the subject claim.")

    return UserContext(
        user_id=user_id,
        display_name=_display_name_from_claims(claims),
    )


def _display_name_from_claims(claims: dict[str, Any]) -> str:
    return str(
        claims.get("name")
        or claims.get("preferred_username")
        or claims.get("email")
        or "Unknown"
    )


async def _parse_json_body(request: Request) -> dict[str, Any] | JSONResponse:
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"error": "Request body must be valid JSON."}, status_code=400)

    if not isinstance(body, dict):
        return JSONResponse({"error": "Request body must be a JSON object."}, status_code=400)
    return body


def _query_param(request: Request, name: str) -> str | None:
    value = request.query_params.get(name)
    return value.strip() if value and value.strip() else None


def _optional_str(value: Any) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValidationError("Expected a string value.")
    cleaned = value.strip()
    return cleaned or None


def _expect_str(value: Any, *, field_name: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValidationError(f"{field_name} is required and must be a string.")
    return value.strip()


def _expect_int(value: Any, *, field_name: str) -> int:
    if not isinstance(value, int):
        raise ValidationError(f"{field_name} is required and must be an integer.")
    return value


def _expect_dict(value: Any, *, field_name: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValidationError(f"{field_name} is required and must be a JSON object.")
    return value


def _expect_list(value: Any, *, field_name: str) -> list[Any]:
    if not isinstance(value, list):
        raise ValidationError(f"{field_name} is required and must be a JSON array.")
    return value


# ----------------------------------------------------------- HTTP app setup


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run the Nexus MCP server.")
    parser.add_argument("--host", default=settings.host)
    parser.add_argument("--port", type=int, default=settings.port)
    parser.add_argument("--path", default=settings.mcp_path)
    return parser.parse_args()


def build_http_app(path: str):
    app = mcp.http_app(
        path=path,
        transport="http",
        stateless_http=True,
    )
    _add_api_routes(app)
    _add_mcp_alias_route(app, path)
    _add_protected_resource_alias_routes(app, path)
    return app


def _normalize_path(value: str) -> str:
    if not value.startswith("/"):
        value = f"/{value}"
    if not value.endswith("/"):
        value = f"{value}/"
    return value


def _add_mcp_alias_route(app, path: str) -> None:
    canonical = _normalize_path(path)
    alias = canonical[:-1] if canonical.endswith("/") else f"{canonical}/"
    if not alias:
        return

    existing = next((route for route in app.routes if getattr(route, "path", None) == canonical), None)
    if existing is None or any(getattr(route, "path", None) == alias for route in app.routes):
        return

    app.router.routes.append(
        Route(
            alias,
            endpoint=existing.endpoint,
            methods=["GET", "POST", "DELETE"],
            name=f"{existing.name}-alias",
            include_in_schema=False,
        )
    )


def _add_api_routes(app) -> None:
    routes = [
        Route("/api/v1/auth/config", endpoint=api_auth_config, methods=["GET"], include_in_schema=False),
        Route("/api/v1/me", endpoint=api_me, methods=["GET"], include_in_schema=False),
        Route("/api/v1/log", endpoint=api_log, methods=["POST"], include_in_schema=False),
        Route("/api/v1/history", endpoint=api_history, methods=["GET"], include_in_schema=False),
        Route("/api/v1/update", endpoint=api_update, methods=["POST"], include_in_schema=False),
        Route("/api/v1/friends", endpoint=api_friends, methods=["POST"], include_in_schema=False),
    ]
    existing_paths = {getattr(route, "path", None) for route in app.routes}
    for route in routes:
        if route.path not in existing_paths:
            app.router.routes.append(route)


def _add_protected_resource_alias_routes(app, path: str) -> None:
    if not settings.base_url:
        return

    canonical = _normalize_path(path)
    path_without_trailing = canonical[:-1] if canonical.endswith("/") else canonical

    payload = {
        "resource": f"{settings.base_url}{path_without_trailing}",
        "authorization_servers": [settings.base_url],
        "scopes_supported": ["openid", "profile", "email"],
    }

    async def handler(_: Request) -> JSONResponse:
        return JSONResponse(payload)

    async def options_handler(_: Request) -> Response:
        return Response(status_code=204)

    alias_paths = [
        "/.well-known/oauth-protected-resource",
        f"/.well-known/oauth-protected-resource{path_without_trailing}",
    ]
    if canonical.endswith("/"):
        alias_paths.append(f"/.well-known/oauth-protected-resource{canonical}")

    for alias in alias_paths:
        if any(getattr(route, "path", None) == alias for route in app.routes):
            continue
        app.router.routes.append(
            Route(alias, endpoint=handler, methods=["GET"], include_in_schema=False)
        )
        app.router.routes.append(
            Route(alias, endpoint=options_handler, methods=["OPTIONS"], include_in_schema=False)
        )


def main():
    args = parse_args()
    app = build_http_app(args.path)
    uvicorn.run(app, host=args.host, port=args.port)


if __name__ == "__main__":
    main()
