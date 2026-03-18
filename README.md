# Nipp

Minimal remote MCP server for workout logging, using `FastMCP` and local Postgres.

## What this does

- exposes a `log_workout_entry` MCP tool
- exposes a `get_workout_history` MCP tool
- exposes a `log_generic_event` MCP tool
- stores each logged event as raw JSON in Postgres
- keeps the tables intentionally loose: workout rows stay JSON-heavy, and generic events use `user_id`, `event_type`, and `raw_json`

## Project layout

- `src/nipp/server.py`: FastMCP server and tools
- `src/nipp/storage.py`: Postgres adapter
- `src/nipp/models.py`: row schema and timestamp helpers
- `tests/test_models.py`: basic tests for pure helper logic

## Setup

1. Create and activate a virtualenv.
2. Install dependencies:

```bash
uv pip install --python .venv/bin/python -e .
```

3. Copy `.env.example` values into your environment.
4. Point `NIPP_DATABASE_URL` at your local Postgres.

## Run locally

```bash
PYTHONPATH=src .venv/bin/python -m nipp.server --host 127.0.0.1 --port 8000 --path /mcp/
```

The MCP endpoint defaults to [http://localhost:8000/mcp/](http://localhost:8000/mcp/).

Health endpoint:

```bash
curl http://localhost:8000/health
```

## Environment variables

- `NIPP_DATABASE_URL`: required
- `NIPP_TABLE_NAME`: optional, defaults to `workout_events`
- `NIPP_GENERIC_EVENTS_TABLE_NAME`: optional, defaults to `generic_events`
- `NIPP_MCP_PATH`: optional, defaults to `/mcp/`
- `PORT`: optional, defaults to `8000`
- `NIPP_BASE_URL`: required for OAuth-enabled deployments
- `SUPABASE_URL`: required for OAuth-enabled deployments
- `SUPABASE_PUBLISHABLE_KEY`: required for OAuth-enabled deployments

## Deploy

Example container build:

```bash
docker build -t nipp-mcp .
docker run --rm -p 8000:8000 --env-file .env nipp-mcp
```

For the local Claude Code path, the important part is just having a reachable `NIPP_DATABASE_URL` and a running local HTTP MCP server.

## Claude Code

Add the running local MCP server explicitly:

```bash
claude mcp add -s project --transport http nipp http://127.0.0.1:8000/mcp/
```
