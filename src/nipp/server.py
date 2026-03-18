from __future__ import annotations

import argparse
from urllib.parse import urlsplit

from fastmcp import FastMCP
from fastmcp.server.dependencies import get_access_token
from fastmcp.tools.tool import ToolResult
from starlette.requests import Request
from starlette.responses import JSONResponse, PlainTextResponse, Response
from starlette.routing import Route
import uvicorn

from nipp.auth import NippOAuthProvider
from nipp.config import Settings
from nipp.storage import PostgresWorkoutStore

settings = Settings.from_env()
auth = None
if settings.base_url and settings.supabase_url and settings.supabase_publishable_key:
    auth = NippOAuthProvider(settings)

mcp = FastMCP("Nipp", auth=auth)
_store: PostgresWorkoutStore | None = None


def get_store() -> PostgresWorkoutStore:
    global _store
    if _store is None:
        _store = PostgresWorkoutStore(settings)
    return _store


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
            "name": "Nipp",
            "mcp_path": settings.mcp_path,
            "table_name": settings.table_name,
            "generic_events_table_name": settings.generic_events_table_name,
            "auth_enabled": auth is not None,
            "tools": ["log_workout_entry", "get_workout_history", "log_generic_event"],
        }
    )


@mcp.resource(
    "ui://widget/workout-history.html",
    mime_type="text/html",
    meta={
        "openai/widgetDescription": "Workout analytics view with summary cards, highlights, and a workout timeline.",
    },
)
def workout_history_widget() -> str:
    return """<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Nipp Workout Analytics</title>
    <style>
      :root {
        --page: #DFD7CF;
        --panel: #E9E0D7;
        --panel-strong: #F1E9E2;
        --text: #525051;
        --muted: #9B9692;
        --pink: #DA95DE;
        --lavender: #845EC2;
        --line: rgba(132, 94, 194, 0.22);
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        padding: 24px;
        background:
          radial-gradient(circle at top left, rgba(218,149,222,0.18), transparent 32%),
          radial-gradient(circle at top right, rgba(132,94,194,0.16), transparent 30%),
          var(--page);
        color: var(--text);
        font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      .shell {
        max-width: 1080px;
        margin: 0 auto;
        display: grid;
        gap: 18px;
      }
      .hero {
        display: grid;
        grid-template-columns: 1.4fr .9fr;
        gap: 18px;
      }
      .card {
        background: rgba(241, 233, 226, 0.9);
        border: 1px solid var(--line);
        border-radius: 24px;
        box-shadow: 0 18px 50px rgba(82, 80, 81, 0.07);
      }
      .intro {
        padding: 28px;
      }
      .eyebrow {
        color: var(--lavender);
        font-size: 12px;
        font-weight: 700;
        letter-spacing: .14em;
        text-transform: uppercase;
      }
      h1 {
        margin: 10px 0 10px;
        font-size: 36px;
        line-height: 1.05;
      }
      .muted {
        color: var(--muted);
        line-height: 1.6;
      }
      .filters {
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
        margin-top: 18px;
      }
      .pill {
        padding: 10px 14px;
        border-radius: 999px;
        background: rgba(218,149,222,0.14);
        color: var(--text);
        border: 1px solid rgba(218,149,222,0.28);
        font-size: 13px;
        font-weight: 600;
      }
      .pill.active {
        background: linear-gradient(135deg, var(--pink), var(--lavender));
        color: #fff;
        border-color: transparent;
      }
      .summary {
        padding: 22px;
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 12px;
      }
      .metric {
        padding: 16px;
        border-radius: 18px;
        background: var(--panel);
        border: 1px solid rgba(132, 94, 194, 0.14);
      }
      .metric-label {
        color: var(--muted);
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: .08em;
      }
      .metric-value {
        margin-top: 8px;
        font-size: 28px;
        font-weight: 700;
      }
      .body {
        display: grid;
        grid-template-columns: 1.2fr .8fr;
        gap: 18px;
      }
      .timeline, .highlights {
        padding: 22px;
      }
      .section-title {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 16px;
      }
      .section-title h2 {
        margin: 0;
        font-size: 20px;
      }
      .section-title span {
        color: var(--lavender);
        font-size: 12px;
        font-weight: 700;
        text-transform: uppercase;
      }
      .day {
        padding: 16px 0;
        border-top: 1px solid rgba(132, 94, 194, 0.16);
      }
      .day:first-of-type { border-top: 0; padding-top: 0; }
      .day-label {
        margin-bottom: 10px;
        color: var(--muted);
        font-size: 12px;
        font-weight: 700;
        letter-spacing: .08em;
        text-transform: uppercase;
      }
      .entry {
        display: grid;
        grid-template-columns: 1fr auto;
        gap: 12px;
        padding: 12px 14px;
        border-radius: 16px;
        background: rgba(223,215,207,0.45);
        margin-bottom: 10px;
      }
      .entry-main strong {
        display: block;
        margin-bottom: 4px;
      }
      .entry-meta {
        color: var(--muted);
        font-size: 13px;
      }
      .entry-badge {
        align-self: center;
        padding: 8px 12px;
        border-radius: 999px;
        background: rgba(132,94,194,0.12);
        color: var(--lavender);
        font-size: 12px;
        font-weight: 700;
      }
      .highlight {
        padding: 16px;
        border-radius: 18px;
        background: linear-gradient(180deg, rgba(218,149,222,0.15), rgba(132,94,194,0.08));
        border: 1px solid rgba(218,149,222,0.24);
        margin-bottom: 12px;
      }
      .highlight strong {
        display: block;
        margin-bottom: 6px;
      }
      @media (max-width: 900px) {
        .hero, .body { grid-template-columns: 1fr; }
        body { padding: 16px; }
      }
    </style>
  </head>
  <body>
    <main class="shell">
      <section class="hero">
        <article class="card intro">
          <div class="eyebrow">Nipp Analytics</div>
          <h1>Workout history, without the spreadsheet feeling.</h1>
          <p class="muted">
            This widget is designed to show a date-filtered workout timeline, quick
            progress signals, and the most useful highlights at a glance.
          </p>
          <div class="filters">
            <div class="pill active">Last 30 days</div>
            <div class="pill">Bench press</div>
            <div class="pill">Volume trend</div>
          </div>
        </article>
        <aside class="card summary">
          <div class="metric">
            <div class="metric-label">Workouts</div>
            <div class="metric-value">12</div>
          </div>
          <div class="metric">
            <div class="metric-label">Unique Exercises</div>
            <div class="metric-value">5</div>
          </div>
          <div class="metric">
            <div class="metric-label">Total Sets</div>
            <div class="metric-value">42</div>
          </div>
          <div class="metric">
            <div class="metric-label">Heaviest Set</div>
            <div class="metric-value">100 kg</div>
          </div>
        </aside>
      </section>
      <section class="body">
        <article class="card timeline">
          <div class="section-title">
            <h2>Workout Timeline</h2>
            <span>Grouped by day</span>
          </div>
          <div class="day">
            <div class="day-label">Mar 18, 2026</div>
            <div class="entry">
              <div class="entry-main">
                <strong>Bench press</strong>
                <div class="entry-meta">3 sets x 8 reps · 50 kg</div>
              </div>
              <div class="entry-badge">Strength</div>
            </div>
            <div class="entry">
              <div class="entry-main">
                <strong>Incline dumbbell press</strong>
                <div class="entry-meta">3 sets x 10 reps · 22.5 kg</div>
              </div>
              <div class="entry-badge">Accessory</div>
            </div>
          </div>
          <div class="day">
            <div class="day-label">Mar 16, 2026</div>
            <div class="entry">
              <div class="entry-main">
                <strong>Back squat</strong>
                <div class="entry-meta">3 sets x 5 reps · 100 kg</div>
              </div>
              <div class="entry-badge">Strength</div>
            </div>
          </div>
        </article>
        <aside class="card highlights">
          <div class="section-title">
            <h2>Highlights</h2>
            <span>Useful first</span>
          </div>
          <div class="highlight">
            <strong>Heaviest logged set</strong>
            <div class="muted">Back squat · 100 kg on Mar 16</div>
          </div>
          <div class="highlight">
            <strong>Latest workout</strong>
            <div class="muted">Bench press session · 2 exercises logged</div>
          </div>
          <div class="highlight">
            <strong>Why this layout</strong>
            <div class="muted">Summary first, then timeline, then highlights. It reads like an analytics tool, not a row dump.</div>
          </div>
        </aside>
      </section>
    </main>
  </body>
</html>"""


@mcp.tool
def log_workout_entry(
    event_at: str,
    exercise: str,
    request_id: str,
    sets: int | None = None,
    reps: int | None = None,
    weight: float | None = None,
    duration_min: int | None = None,
    notes: str | None = None,
) -> dict:
    """Log one workout entry into Postgres as raw JSON.

    Args:
        event_at: Workout time in RFC3339 or ISO 8601 format.
        exercise: Exercise name, for example "Barbell squat".
        request_id: Unique caller-generated ID used for idempotency.
        sets: Number of sets.
        reps: Number of reps per set.
        weight: Weight used for the exercise.
        duration_min: Optional total duration in minutes.
        notes: Optional free-text notes.
    """
    return get_store().log_workout_entry(
        user_id=require_user_id(),
        event_at=event_at,
        exercise=exercise,
        request_id=request_id,
        sets=sets,
        reps=reps,
        weight=weight,
        duration_min=duration_min,
        notes=notes,
    )


@mcp.tool(
    meta={
        "openai/outputTemplate": "ui://widget/workout-history.html",
    }
)
def get_workout_history(
    from_date: str | None = None,
    to_date: str | None = None,
    exercise: str | None = None,
    limit: int = 50,
) -> dict:
    """Fetch workout history for the authenticated user.

    Use this when the user asks about past workouts, workout history, or a date-based
    workout query. Supports date range filtering plus optional exercise filtering.
    """
    result = get_store().get_workout_history(
        user_id=require_user_id(),
        from_date=from_date,
        to_date=to_date,
        exercise=exercise,
        limit=limit,
    )
    return ToolResult(
        content="Workout history ready.",
        structured_content=result,
    )


@mcp.tool
def log_generic_event(event_type: str, payload: dict) -> dict:
    """Log a flexible user event into the generic events table.

    Use this when the event is not a workout entry. Keep `event_type` short and stable.
    Prefer values like `FOOD`, `RUN`, `SLEEP`, `MEASUREMENT`, or another concise category.
    Put the actual details inside `payload` as a JSON object.
    """
    return get_store().log_generic_event(
        user_id=require_user_id(),
        event_type=event_type,
        payload=payload,
    )


def require_user_id() -> str:
    access_token = get_access_token()
    if access_token is None:
        raise PermissionError("Authentication is required.")

    user_id = str(access_token.claims.get("sub", "")).strip()
    if not user_id:
        raise PermissionError("Authenticated token is missing the subject claim.")
    return user_id


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run the Nipp MCP server.")
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

    seen = {getattr(route, "path", None) for route in app.routes}
    for alias_path in alias_paths:
        if not alias_path or alias_path in seen:
            continue
        app.router.routes.append(
            Route(alias_path, endpoint=handler, methods=["GET"], include_in_schema=False)
        )
        app.router.routes.append(
            Route(alias_path, endpoint=options_handler, methods=["OPTIONS"], include_in_schema=False)
        )


def _normalize_path(path: str) -> str:
    parsed = urlsplit(path)
    clean_path = parsed.path or "/"
    if not clean_path.startswith("/"):
        clean_path = f"/{clean_path}"
    if not clean_path.endswith("/"):
        clean_path = f"{clean_path}/"
    return clean_path


def main() -> None:
    args = parse_args()
    app = build_http_app(args.path)
    uvicorn.run(app, host=args.host, port=args.port)


if __name__ == "__main__":
    main()
