# legacy/

The pre-Workers Nexus stack — Python + FastMCP + psycopg + Supabase, deployed
to Cloud Run. Kept in-tree as a historical reference and a fallback in case
we ever need to redeploy the Cloud Run path (e.g. while migrating users
between Cloudflare accounts, or for local-only development without Workers).

Nothing in this directory is wired into the active build. `pyproject.toml`
no longer references `nexus.server`, the `[server]` extra is gone, and the
`Dockerfile` here is not consumed by the CI/deploy path.

## Layout

```
legacy/
├── README.md                      # this file
├── Dockerfile                     # python:3.12-slim → CMD nexus-mcp
├── python-server/
│   ├── nexus/                     # the Python package as it existed pre-cutover
│   │   ├── server.py              # FastMCP entrypoint, custom Starlette routes,
│   │   │                          #   the protected-resource alias logic, the
│   │   │                          #   four tools wired to NexusApp.
│   │   ├── auth.py                # NexusOAuthProvider — hand-rolled OAuth 2.1
│   │   │                          #   AS implemented against the oauth_* tables.
│   │   ├── app.py                 # NexusApp dispatcher (thin layer over Store).
│   │   ├── storage.py             # Store — every Postgres query in plain SQL.
│   │   ├── db.py                  # psycopg connection pool.
│   │   ├── models.py              # validate_workout / validate_meal / validate_weight.
│   │   └── config.py              # Settings.from_env().
│   └── tests/
│       ├── test_server.py         # endpoint + slash-invariant regression suite
│       ├── test_app.py
│       └── test_models.py
└── supabase-migrations/
    └── 20260513172000_add_oauth_tables.sql
                                   # five oauth_* tables Workers no longer needs
                                   # (OAUTH_KV stores everything now). Run
                                   # `DROP TABLE oauth_clients, oauth_pending_authorizations,
                                   #  oauth_authorization_codes, oauth_access_tokens,
                                   #  oauth_refresh_tokens;` after a week of clean Workers traffic.
```

## How the new and old stacks relate

| Old (`legacy/python-server/nexus/`)              | New (`workers/src/`)                                        |
|---|---|
| `server.py` — FastMCP + Starlette + custom routes | `index.ts` + handlers + McpAgent in `mcp.ts`                |
| `auth.py` — NexusOAuthProvider against Postgres   | `@cloudflare/workers-oauth-provider` + KV (`OAUTH_KV`)      |
| `app.py` — NexusApp dispatcher                    | gone — tools call data functions directly                   |
| `storage.py` — Store class, plain SQL             | `data/entries.ts` + `data/friends.ts` via `pg` + Hyperdrive |
| `db.py` — psycopg pool                            | `data/db.ts` (`pg.Client`, ssl:false, session pooler)       |
| `models.py` — Python validators                   | `schema/entry-shapes.ts` + `schema/tool-inputs.ts` (zod)    |
| `config.py` — Settings.from_env                   | bindings via `wrangler.jsonc` + `env`                       |
| `Dockerfile`                                      | `wrangler.jsonc`                                            |
| `oauth_*` Supabase tables                         | KV namespace `OAUTH_KV`                                     |

## When to read this

- If you're debugging a behavior difference between Cloud Run and Workers
  ("did the old server compute meal totals the same way?") — diff the
  Python validators against the zod schemas.
- If you're writing the followup migration that retires the `oauth_*`
  Supabase tables — the schema is here.
- If something on Workers breaks and you need to fall back fast. The
  Cloud Run service may still exist; the Dockerfile and code here are
  what built it.

## When to delete this

After Workers has been live for 30 days with no fallback-to-Cloud Run
events, delete this directory and drop the Supabase `oauth_*` tables. Git
history retains the code.
