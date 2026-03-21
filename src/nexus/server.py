from __future__ import annotations

import argparse
from urllib.parse import urlsplit

from fastmcp import FastMCP
from fastmcp.server.dependencies import get_access_token
from starlette.requests import Request
from starlette.responses import JSONResponse, PlainTextResponse, Response
from starlette.routing import Route
import uvicorn

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


def get_store() -> Store:
    global _store
    if _store is None:
        _store = Store(settings)
    return _store


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
    user_id = require_user_id()
    try:
        results = get_store().log_entries(
            user_id=user_id,
            entries=entries,
            date_str=date,
        )
    except ValidationError as exc:
        return {"error": str(exc)}
    return {"logged": results}


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
        type: "workout" or "meal". Omit for both.
        friend_id: User ID of a friend. Omit for own data.
    """
    user_id = require_user_id()
    try:
        return get_store().get_history(
            user_id=user_id,
            date_str=date,
            from_date_str=from_date,
            to_date_str=to_date,
            entry_type=type,
            friend_id=friend_id,
        )
    except ValidationError as exc:
        return {"error": str(exc)}


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
    user_id = require_user_id()
    try:
        return get_store().update_entry(
            user_id=user_id,
            entry_id=entry_id,
            data=data,
        )
    except ValidationError as exc:
        return {"error": str(exc)}


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
    user_id = require_user_id()
    try:
        return get_store().manage_friends(
            user_id=user_id,
            action=action,
            code=code,
            display_name=display_name,
        )
    except ValidationError as exc:
        return {"error": str(exc)}


# -------------------------------------------------------------- Auth helper


def require_user_id() -> str:
    access_token = get_access_token()
    if access_token is None:
        # For local dev without auth, use a default test user
        return "test-user-1"

    user_id = str(access_token.claims.get("sub", "")).strip()
    if not user_id:
        raise PermissionError("Authenticated token is missing the subject claim.")

    # Auto-create user row on first use
    display_name = (
        access_token.claims.get("name")
        or access_token.claims.get("email", "")
        or "Unknown"
    )
    get_store().ensure_user(user_id=user_id, display_name=display_name)

    return user_id


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


def _add_protected_resource_alias_routes(app, path: str) -> None:
    if not settings.base_url:
        return

    canonical = _normalize_path(path)
    resource = f"{settings.base_url}{canonical}"
    path_without_trailing = canonical[:-1] if canonical.endswith("/") else canonical

    payload = {
        "resource": resource,
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
