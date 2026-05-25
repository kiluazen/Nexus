# Migrating Nexus to Cloudflare Workers

Target: replace the Cloud Run + Python (FastMCP) + Supabase Postgres stack
with Cloudflare Workers + TypeScript + workers-oauth-provider + McpAgent +
Hyperdrive→Supabase Postgres + Workers KV.

This is the architecture-of-record. If you change a primitive (drop KV
for D1, swap McpAgent for raw `createMcpHandler`, route through a
different IdP), update this file.

## Why Workers

See `decision-cloudrun-vs-workers.md` (or the conversation that produced
it). Short version: edge isolates beat single-region Cloud Run on tail
latency and cold starts, `workers-oauth-provider` is what the MCP spec
authors actually use, and Durable Objects are the right substrate for
MCP session state when we eventually need elicitation/sampling.

## Target architecture

```
                ┌───────────────────────────────────────────────────────┐
                │  Cloudflare edge (global)                             │
                │                                                       │
   client ──▶   │  ┌─────────────────────────────────────────────────┐  │
  (Claude,      │  │  Worker: nexus-mcp                              │  │
   ChatGPT,     │  │                                                 │  │
   Codex,       │  │   workers-oauth-provider   (OAuth surface)      │  │
   nexus CLI)   │  │       │                                         │  │
                │  │       ▼                                         │  │
                │  │   McpAgent (Durable Object)                     │  │
                │  │       │                                         │  │
                │  │       ├── log_fitness_entries                   │  │
                │  │       ├── get_fitness_history                   │  │
                │  │       ├── update_fitness_entry                  │  │
                │  │       └── manage_friend_connections             │  │
                │  └────────────┬───────────────────┬─────────────────┘  │
                │               │                   │                    │
                │     ┌─────────▼─────────┐   ┌─────▼──────────┐         │
                │     │  Workers KV       │   │  Hyperdrive    │         │
                │     │  ── OAuth state:  │   │   pool         │         │
                │     │     codes,        │   │       │        │         │
                │     │     access toks,  │   │       │        │         │
                │     │     refresh toks, │   │       ▼        │         │
                │     │     clients,      │   │  Supabase      │         │
                │     │     pending       │   │  Postgres      │         │
                │     │  ── JWKS cache    │   │  (users,       │         │
                │     └───────────────────┘   │   entries,     │         │
                │                             │   friendships) │         │
                └─────────────────────────────────────────────────────────┘

                                Upstream IdP (unchanged):
                                   Supabase Auth  ──  Google OAuth
                                                  ──  email/password
```

Three primitives, clean separation:

- **KV** — short-lived OAuth state (authz codes, access tokens, refresh
  tokens, pending consents, registered DCR clients). All have natural
  TTLs (5min – 30 days). Edge-local reads, ~5ms.
- **Hyperdrive** — connection pool fronting the existing Supabase
  Postgres. Fitness data (`users`, `entries`, `friendships`) stays
  there; we don't migrate rows. Hyperdrive caches the connection so
  every `/mcp` call doesn't re-handshake to Supabase from a fresh PoP.
- **Durable Object** — the `NexusMcpAgent` class, one DO per MCP
  session. Holds the authenticated user context for the lifetime of
  the SSE/streamable-HTTP session.

Supabase Auth stays as the upstream IdP. We do NOT rewrite Google
login — the consent screen at `/oauth/consent` still drops the user
into Supabase's Google flow, and we still verify the Supabase JWT
before minting our own access token. The only thing that changes is
where our own tokens live (Postgres → KV).

## File layout

```
nexus/
  workers/                          # new — the Worker
    package.json
    tsconfig.json
    wrangler.jsonc
    src/
      index.ts                      # entry — wires OAuthProvider + McpAgent
      mcp.ts                        # McpAgent subclass with the 4 tools
      handlers/
        consent.ts                  # GET /oauth/consent (HTML)
        callback.ts                 # GET /auth/callback (HTML, exchanges Supabase code)
        decision.ts                 # POST /oauth/decision (approve/deny → mint MCP code)
        well-known.ts               # apex + path-suffixed protected-resource docs
      auth/
        supabase-verifier.ts        # JWKS-cached Supabase JWT verifier
        upstream-handler.ts         # workers-oauth-provider upstream handler shape
      data/
        db.ts                       # Hyperdrive client + query helpers
        entries.ts                  # log_entries / history / update_entry
        friends.ts                  # friendships CRUD
      schema/
        entry-shapes.ts             # zod schemas for workout/meal/weight
        tool-inputs.ts              # zod input schemas per tool
      lib/
        macros.ts                   # meal totals computation (port from Python)
        exercise-keys.ts            # snake_case normalization
        friend-codes.ts             # NEXUS-XXXX generation/lookup
      well-known/
        openai-apps-challenge.txt   # static — served at apex
        privacy-policy.md
    test/
      tools.spec.ts                 # vitest + miniflare
      oauth.spec.ts
  src/                              # unchanged — the PyPI CLI
    nexus/
      cli.py                        # `pip install nexus-fitness`
      auth.py                       # CLI's local OAuth client only (no server bits)
  docs/
    migrate-to-workers.md           # this file
    mcp-path-trailing-slash.md      # rule carries over verbatim — Workers must honor it
  supabase/
    migrations/                     # fitness schema stays; we delete oauth_* tables
                                    # in a new migration after cutover
```

`src/nexus/server.py`, `src/nexus/auth.py` (the server-side OAuth
provider), and `Dockerfile` are deleted post-cutover. The PyPI CLI
package (`nexus-fitness`) keeps its CLI-only auth code and just points
at the Workers domain.

## OAuth surface — what workers-oauth-provider gives us vs what we write

The Cloudflare lib is the OAuth 2.1 Authorization Server. It owns:

- `/.well-known/oauth-authorization-server` (metadata)
- `/.well-known/oauth-protected-resource` and the path-suffixed
  variants (per RFC 9728, see `mcp-path-trailing-slash.md`)
- `/register` (RFC 7591 dynamic client registration)
- `/authorize` (start an authz request)
- `/token` (code exchange, refresh)
- KV storage of clients, codes, access tokens, refresh tokens
- 401 responses on the protected MCP endpoint, including the
  `WWW-Authenticate: ... resource_metadata="..."` hint

We provide one thing: the **upstream handler**. That's a fetch handler
the lib calls when a user lands on `/authorize` and we need to identify
them. Shape:

```ts
// auth/upstream-handler.ts
export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(req.url);

    if (url.pathname === "/oauth/consent") {
      // Render the Supabase-JS sign-in page (same HTML we serve today).
      // After Supabase login succeeds, POST to /oauth/decision.
      return renderConsentPage(url.searchParams.get("oauthReqId")!, env);
    }

    if (url.pathname === "/auth/callback") {
      // Supabase OAuth callback — exchange `code` for a Supabase session,
      // then POST /oauth/decision with that session's access_token.
      return renderCallbackPage(url.searchParams.get("oauthReqId")!, env);
    }

    if (url.pathname === "/oauth/decision" && req.method === "POST") {
      const body = await req.json<{ oauthReqId: string; action: "approve" | "deny" }>();
      if (body.action === "deny") {
        return env.OAUTH_PROVIDER.completeAuthorization({
          request: { oauthReqId: body.oauthReqId },
          deniedReason: "user_denied",
        });
      }

      // Verify the Supabase JWT presented by the browser, extract user.
      const bearer = req.headers.get("authorization")?.replace(/^Bearer /, "");
      const claims = await verifySupabaseJwt(bearer, env);
      if (!claims) return new Response("Unauthorized", { status: 401 });

      // Hand control back to the OAuth provider — it stores the auth code
      // in KV bound to this user and redirects the MCP client.
      return env.OAUTH_PROVIDER.completeAuthorization({
        request: { oauthReqId: body.oauthReqId },
        userId: claims.sub,
        metadata: {
          email: claims.email,
          name: claims.name,
          preferred_username: claims.preferred_username,
        },
        scope: ["openid", "profile", "email"],
      });
    }

    return new Response("Not found", { status: 404 });
  },
};
```

That's the whole upstream surface. Compared to `src/nexus/auth.py`
(~470 LOC implementing every authorization-server endpoint by hand
against Postgres), this is the actual scope of work — the rest is
the lib's job.

`verifySupabaseJwt` caches the JWKS in KV with a 24h TTL so we don't
re-fetch Supabase's keys on every consent submission.

## MCP server — McpAgent

```ts
// mcp.ts
import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  logEntries,
  getHistory,
  updateEntry,
  manageFriends,
} from "./data/entries";
import { LogInput, HistoryInput, UpdateInput, FriendsInput } from "./schema/tool-inputs";

type Props = {
  userId: string;
  email?: string;
  displayName?: string;
};

export class NexusMcpAgent extends McpAgent<Env, Props> {
  server = new McpServer({
    name: "Nexus – Workout and Nutrition Tracker",
    version: "3.0",
  });

  async init() {
    this.server.tool(
      "log_fitness_entries",
      "Store workout, meal, or body-weight entries for the authenticated Nexus user.",
      LogInput.shape,
      { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      async (args) => {
        const result = await logEntries(this.env, this.props.userId, args);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      },
    );

    this.server.tool(
      "get_fitness_history",
      "Fetch workouts, meals, body-weight entries, exercise keys, and friend-shared history.",
      HistoryInput.shape,
      { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      async (args) => {
        const result = await getHistory(this.env, this.props.userId, args);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      },
    );

    this.server.tool(
      "update_fitness_entry",
      "Replace one existing entry owned by the authenticated user.",
      UpdateInput.shape,
      { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
      async (args) => {
        const result = await updateEntry(this.env, this.props.userId, args);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      },
    );

    this.server.tool(
      "manage_friend_connections",
      "List, add, accept, reject, or remove Nexus friend connections.",
      FriendsInput.shape,
      { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
      async (args) => {
        const result = await manageFriends(this.env, this.props.userId, args);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      },
    );
  }
}
```

`McpAgent` is a Durable Object — one instance per MCP session, lifetime
tied to the SSE/streamable-HTTP connection. `this.props` is populated
by the OAuth provider from the metadata we set in `completeAuthorization`.
There is no `require_mcp_user()` dance; if the request reaches `init()`
the user is authenticated.

## Wiring it together

```ts
// index.ts
import { OAuthProvider } from "@cloudflare/workers-oauth-provider";
import upstreamHandler from "./auth/upstream-handler";
import { NexusMcpAgent } from "./mcp";

export { NexusMcpAgent };

export default new OAuthProvider({
  apiHandlers: {
    "/mcp": NexusMcpAgent.serve("/mcp"),
    "/mcp/": NexusMcpAgent.serve("/mcp/"),  // trailing-slash alias, see RCA doc
    "/sse": NexusMcpAgent.serveSSE("/sse"), // optional legacy SSE transport
  },
  defaultHandler: upstreamHandler,
  authorizeEndpoint: "/oauth/consent",
  tokenEndpoint: "/token",
  clientRegistrationEndpoint: "/register",
  scopesSupported: ["openid", "profile", "email"],
  resourceName: "Nexus – Workout and Nutrition Tracker",
  resourceDocumentation: "https://nexus.kushalsm.com/",
});
```

`OAuthProvider` is itself a `fetch` handler. It dispatches:
- protected paths (`/mcp`, `/mcp/`, `/sse`) → validates the bearer
  token, hands off to the `apiHandlers` map with `props` populated.
- everything else → `defaultHandler` (our upstream handler + static
  routes).
- the well-known and OAuth endpoints → its own internal handlers.

**Trailing-slash invariant carries over.** Both `/mcp` and `/mcp/`
must reach the MCP agent; the protected-resource doc must advertise
`resource: ".../mcp"` (no trailing slash); the WWW-Authenticate must
point to `.../oauth-protected-resource/mcp` (no trailing slash). The
`apiHandlers` map above plus serving the protected-resource doc at
both `/mcp` and `/mcp/` suffix paths covers this. Workers OAuth
Provider lets us override the metadata URL builder if needed.

## Data layer

### KV — OAuth state

One KV namespace, `NEXUS_OAUTH`, owned by `workers-oauth-provider`.
Keys it manages (we don't touch them directly):

| Prefix | TTL | Purpose |
|---|---|---|
| `client:<client_id>` | none | DCR-registered clients |
| `code:<code>` | 5 min | Authorization codes |
| `token:<access_token>` | 1 hour | Active access tokens |
| `refresh:<refresh_token>` | 30 days | Refresh tokens |
| `grant:<grant_id>` | session-bound | Active user grants |

The five existing `oauth_*` Postgres tables are deleted post-cutover.

A second KV namespace, `NEXUS_JWKS`, caches the Supabase JWKS document
with `expirationTtl: 86400`. Single key: `supabase:jwks`.

### Hyperdrive — fitness data

Hyperdrive binding `NEXUS_DB` pointing at the existing Supabase
Postgres pooler URL. Worker code uses `postgres` (the `postgres.js`
client, which works on Workers via `connect()`) over the Hyperdrive
binding:

```ts
// data/db.ts
import postgres from "postgres";

export function sql(env: Env) {
  return postgres(env.NEXUS_DB.connectionString, {
    // Hyperdrive multiplexes; one connection per worker is fine.
    max: 1,
    fetch_types: false,
  });
}
```

Tables (unchanged): `users`, `entries`, `friendships`.

Hyperdrive's value here is connection pooling at the edge — Supabase
Postgres connection setup costs ~100ms; Hyperdrive amortizes it across
isolates in the same PoP.

## Routes

| Path | Method | Handled by | Notes |
|---|---|---|---|
| `/mcp` | GET, POST, DELETE | `NexusMcpAgent.serve` | Streamable HTTP, canonical |
| `/mcp/` | GET, POST, DELETE | `NexusMcpAgent.serve` | Alias — RCA doc |
| `/sse` | GET, POST | `NexusMcpAgent.serveSSE` | Legacy SSE transport (optional) |
| `/authorize` | GET | OAuthProvider → `/oauth/consent` | 302 |
| `/token` | POST | OAuthProvider | RFC 8707 `resource` echoed into `aud` |
| `/register` | POST | OAuthProvider | DCR |
| `/oauth/consent` | GET | upstream-handler | Supabase sign-in UI |
| `/oauth/decision` | POST | upstream-handler | Approve/deny |
| `/auth/callback` | GET | upstream-handler | Supabase OAuth callback |
| `/.well-known/oauth-authorization-server` | GET | OAuthProvider | |
| `/.well-known/openid-configuration` | GET | OAuthProvider (mirror of above) | |
| `/.well-known/oauth-protected-resource` | GET | OAuthProvider | bare |
| `/.well-known/oauth-protected-resource/mcp` | GET | OAuthProvider | path-suffixed |
| `/.well-known/oauth-protected-resource/mcp/` | GET | OAuthProvider | trailing-slash variant |
| `/.well-known/openai-apps-challenge` | GET | static binding | Apex (required by OpenAI submission) |
| `/health` | GET | upstream-handler | DB ping via Hyperdrive |
| `/` | GET | upstream-handler | JSON `name`/`version`/`tools` |

REST `/api/v1/*` (used by the PyPI CLI today) — keep all five
endpoints, port the Python handlers as small fetch handlers in
`upstream-handler.ts`. CLI flow stays: login via browser → CLI
exchanges code → CLI calls `/api/v1/*` with bearer.

## wrangler.jsonc

```jsonc
{
  "name": "nexus-mcp",
  "main": "src/index.ts",
  "compatibility_date": "2026-05-01",
  "compatibility_flags": ["nodejs_compat"],
  "kv_namespaces": [
    { "binding": "NEXUS_OAUTH", "id": "<created via wrangler kv:namespace create>" },
    { "binding": "NEXUS_JWKS",  "id": "<created via wrangler kv:namespace create>" }
  ],
  "hyperdrive": [
    { "binding": "NEXUS_DB", "id": "<created via wrangler hyperdrive create>" }
  ],
  "durable_objects": {
    "bindings": [
      { "name": "MCP_AGENT", "class_name": "NexusMcpAgent" }
    ]
  },
  "migrations": [
    { "tag": "v1", "new_sqlite_classes": ["NexusMcpAgent"] }
  ],
  "routes": [
    { "pattern": "nexus.kushalsm.com/*", "custom_domain": true }
  ],
  "vars": {
    "SUPABASE_URL": "https://<project>.supabase.co",
    "SUPABASE_PUBLISHABLE_KEY": "<anon key>",
    "BASE_URL": "https://nexus.kushalsm.com"
  }
}
```

Secrets (`wrangler secret put`):
- `SUPABASE_SERVICE_ROLE_KEY` — for the DB user side, not auth verification

The Supabase Postgres URL is configured at Hyperdrive create time, not
in wrangler.jsonc, so the password never lives in the Worker bundle.

## Domain

Move `nexus.kushalsm.com` from whatever it currently resolves to onto
a Cloudflare custom domain bound to the Worker. The existing Cloud Run
URL (`nexus-tad5z6m6za-el.a.run.app`) keeps working until we delete
the Cloud Run service — DO NOT delete it until at least one Claude/
ChatGPT submission cycle has settled, because Anthropic stores the
discovered metadata URLs and we want a fallback.

DNS plan:
1. Add `nexus.kushalsm.com` as a Workers custom domain.
2. Update `BASE_URL` env var on the Worker to `https://nexus.kushalsm.com`.
3. Update the PyPI CLI's `DEFAULT_BASE_URL` in a new release.
4. Update `nexus.kushalsm.com`'s landing page to point connector links
   at `https://nexus.kushalsm.com/mcp`.

## Cutover

Run both stacks in parallel. The Worker is a new domain; old tokens
issued by the Cloud Run server are not portable to the Worker (different
KV vs Postgres storage, different signing). That's fine — users
re-authenticate once.

Order:
1. Stand up the Worker on a `nexus-mcp.kushalsm.workers.dev` subdomain
   (workers.dev hostname is automatic). Run the full curl checklist
   from `mcp-path-trailing-slash.md` against it.
2. Add `nexus.kushalsm.com` as a custom domain on the Worker.
3. Add Nexus to Claude / ChatGPT pointing at `https://nexus.kushalsm.com/mcp`.
   Walk OAuth, log a workout, fetch history. Verify against curl.
4. Update PyPI CLI default base URL → publish `nexus-fitness` patch.
5. Once a week of traffic confirms the Worker is healthy, delete the
   Cloud Run service and the `oauth_*` Postgres tables.

## What stays Python

The PyPI CLI (`pip install nexus-fitness`) is unchanged conceptually:
- Local OAuth browser flow — pops a localhost callback, exchanges
  the code at `/token`, stores `~/.config/nexus/credentials.json`.
- HTTP calls to `/api/v1/*`.

Drop `[server]` extras from `pyproject.toml` — no more FastMCP /
psycopg dependency. CLI becomes a stdlib-only package.

## Things this doc deliberately doesn't decide

- **D1 vs continuing with Supabase Postgres long-term.** D1 + R2 is a
  pure-Cloudflare future where we drop Supabase entirely. Not part of
  this migration — that's a separate technical decision once the
  Workers stack is stable.
- **Session state beyond authentication.** McpAgent gives us DO storage
  per session; we're not using it yet. When elicitation / sampling
  matter, that's where they go.
- **Rate limiting / abuse.** Cloudflare's WAF + Workers Rate Limiting
  binding. Bolt on after launch.
