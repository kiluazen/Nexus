# Migrating Nexus to Cloudflare Workers

Target stack: Cloudflare Workers + TypeScript + `@cloudflare/workers-oauth-provider` + Cloudflare Agents (`McpAgent` Durable Object) + Hyperdrive → Supabase Postgres + Workers KV.

This document is the architecture of record. Every API surface and binding name below is verified against the actual lib README, not sketched from memory — earlier drafts hallucinated three different shapes of `completeAuthorization` and got the KV binding name wrong. If you change a primitive, update this file the same day; a stale doc is more dangerous than no doc.

The companion file `mcp-path-trailing-slash.md` is non-negotiable and carries over verbatim. Read it before touching path config.

---

## 1. Why this shape

Three forces drive the architecture:

1. **Edge over region.** Cloud Run pinned to `asia-south1` means every `/mcp` call from a US user pays ~250ms before our code runs. Workers isolates spawn at the nearest PoP in ~5ms. For tools an LLM fires off four times per turn, that delta is the difference between snappy and laggy.
2. **Spec-native primitives.** `workers-oauth-provider` is the OAuth 2.1 AS that the MCP-on-Workers examples (Anthropic, Cloudflare, Stytch) all use. Every endpoint the MCP spec requires — `/.well-known/oauth-authorization-server`, `/.well-known/oauth-protected-resource`, `/register`, `/token`, `WWW-Authenticate: ... resource_metadata=...` — is the lib's job, not ours. We had to maintain all of these by hand on FastMCP, and got bitten twice by spec drift (the 307 loop, the trailing-slash strict match).
3. **Durable Object as session boundary.** MCP's evolving feature set (elicitation, sampling, multi-turn cancellation) all assume server-held session state. `McpAgent` is a DO subclass — one DO per MCP session, addressable by ID, with native storage. Cloud Run sessions only exist in `psycopg_pool` connections we manage. The DO is the right substrate before we need it, not after.

Cost, rewrite duration, and "is the existing code fine" are not part of the decision and are not discussed in this doc.

---

## 2. Architecture

```
┌───────────────────────────────────────────────────────────────────────────────┐
│  Cloudflare edge (every PoP)                                                  │
│                                                                               │
│   Client ──HTTPS──▶  OAuthProvider (entrypoint)                               │
│                          │                                                    │
│                          │  routes by path:                                   │
│                          │                                                    │
│        ┌─────────────────┼────────────────────┬─────────────────────────┐     │
│        ▼                 ▼                    ▼                         ▼     │
│   /token, /register,   /authorize,         /mcp, /mcp/,                / *    │
│   /.well-known/*       /oauth/decision,    /sse  ──▶  NexusMcpAgent    misc  │
│   (lib-owned)          /auth/callback,                (Durable Object)  (defaultHandler)
│                        REST /api/v1/*       │                                 │
│                        (defaultHandler)     │                                 │
│                                             ▼                                 │
│                                       four MCP tools                          │
│                                             │                                 │
│             ┌───────────────────────────────┴────────────────────┐            │
│             ▼                                                    ▼            │
│      Hyperdrive (NEXUS_DB)                              Workers KV            │
│             │                                            ── OAUTH_KV          │
│             ▼                                              (lib-owned:        │
│      Supabase Postgres                                      clients, codes,   │
│      (users, entries, friendships)                          access tokens,    │
│             ▲                                               refresh tokens,   │
│             │                                               grants)           │
│             │                                            ── NEXUS_CACHE       │
│             │                                              (Supabase JWKS,    │
│             │                                               pending consent   │
│             │                                               state by nonce)   │
│             │                                                                 │
└─────────────┼─────────────────────────────────────────────────────────────────┘
              │
              ▼
   Supabase Auth (upstream IdP — unchanged)
   ── Google OAuth
   ── Email/password
```

Three storage primitives with non-overlapping responsibilities:

| Store | Owner | Lifetime | Contents |
|---|---|---|---|
| **`OAUTH_KV`** (KV namespace) | the lib | TTLs from 5min (auth code) to 90 days (DCR client) | Registered DCR clients, authorization codes, access tokens, refresh tokens, grants |
| **`NEXUS_CACHE`** (KV namespace) | our code | 24h (JWKS), 10min (consent state) | Cached Supabase JWKS document; the in-flight `parseAuthRequest` result during browser sign-in |
| **`NEXUS_DB`** (Hyperdrive binding) | our code | persistent | `users`, `entries`, `friendships`. Existing Supabase tables — no schema migration, no row migration |

Supabase Auth stays the upstream IdP. Google OAuth and email/password flows live in Supabase, unchanged. The Worker only verifies the Supabase JWT and re-issues our own MCP access token.

---

## 3. File layout

```
nexus/
  workers/                                  # new — the Worker
    package.json
    tsconfig.json
    wrangler.jsonc
    src/
      index.ts                              # OAuthProvider entry, exports NexusMcpAgent
      mcp.ts                                # NexusMcpAgent (McpAgent subclass), 4 tools
      handlers/
        default.ts                          # all non-MCP, non-lib routes (defaultHandler)
        authorize.ts                        # GET /authorize — parseAuthRequest + render consent
        decision.ts                         # POST /oauth/decision — verify Supabase, completeAuthorization
        callback.ts                         # GET /auth/callback — Supabase OAuth landing
        protected-resource.ts               # path-suffixed /.well-known/oauth-protected-resource/mcp[/]
        rest-api.ts                         # /api/v1/* for the PyPI CLI
        well-known-static.ts                # /.well-known/openai-apps-challenge (apex)
      auth/
        supabase-jwt.ts                     # JWKS-cached Supabase JWT verifier
        consent-html.ts                     # Supabase-JS sign-in page (same as today's)
        callback-html.ts                    # Supabase OAuth callback page (same as today's)
      data/
        db.ts                               # postgres.js client over Hyperdrive (prepare: false)
        entries.ts                          # log / history / update_entry queries
        friends.ts                          # friendships CRUD + friend codes
      schema/
        entry-shapes.ts                     # zod: workout / meal / weight discriminated union
        tool-inputs.ts                      # zod: per-tool input shape
      lib/
        macros.ts                           # meal-item totals computation
        exercise-keys.ts                    # snake_case normalization rules
        friend-codes.ts                     # NEXUS-XXXX gen/lookup
    static/
      openai-apps-challenge                 # plain-text token, served verbatim at apex
    test/
      tools.spec.ts                         # vitest + @cloudflare/vitest-pool-workers
      oauth.spec.ts                         # parseAuthRequest → consent → decision → token flow
      protected-resource.spec.ts            # trailing-slash invariant carries over
  src/                                      # unchanged — the PyPI CLI
    nexus/
      cli.py
      auth.py                               # local OAuth client only
  docs/
    migrate-to-workers.md                   # this file
    mcp-path-trailing-slash.md              # rule applies to Workers too
  supabase/
    migrations/
      20260601000000_drop_oauth_tables.sql  # post-cutover, drops the five oauth_* tables
```

Post-cutover deletions: `src/nexus/server.py`, `src/nexus/auth.py`, `src/nexus/db.py`, `src/nexus/storage.py`, `Dockerfile`, and the five `oauth_*` Postgres tables. The PyPI `nexus-fitness` package keeps only the CLI surface.

---

## 4. The OAuth flow, end to end

This is the section where the previous draft fell apart. The corrected flow uses the actual library API.

### 4.1 What the library owns

`OAuthProvider` is itself the Worker entrypoint. When a request comes in, it dispatches by path:

| Path | Owner | Notes |
|---|---|---|
| `/.well-known/oauth-authorization-server` | lib | Built from constructor args |
| `/.well-known/oauth-protected-resource` (bare) | lib | Built from `resourceMetadata` |
| `/register` | lib | RFC 7591 DCR; persists to `OAUTH_KV` |
| `/token` | lib | Code exchange + refresh; persists to `OAUTH_KV` |
| `/mcp`, `/mcp/`, `/sse` | `apiHandlers[path]` | Lib validates bearer first, then dispatches with `ctx.props` populated |
| everything else | `defaultHandler` | Our code |

The OAuth 2.1 surface is the lib's. We don't write `/token`. We don't write client registration. We don't write 401 + `WWW-Authenticate` emission on the protected paths.

### 4.2 What we own

Exactly three things:

- **The authorize endpoint** (`GET /authorize`). Parses the incoming OAuth request, stashes it, redirects the browser to a sign-in page.
- **The decision endpoint** (`POST /oauth/decision`). Verifies the Supabase JWT the browser collected, retrieves the stashed request, asks the lib to complete authorization, returns the redirect URL.
- **The Supabase callback page** (`GET /auth/callback`). Browser-side: exchanges the Supabase OAuth code for a session, then POSTs to `/oauth/decision`.

### 4.3 Sequence

```
Client                  /authorize         consent.html        Supabase Auth      /oauth/decision      /token
  │                         │                  │                    │                  │                 │
  │   GET /authorize?...    │                  │                    │                  │                 │
  ├────────────────────────▶│                  │                    │                  │                 │
  │                         │ parseAuthRequest │                    │                  │                 │
  │                         │ → save in KV     │                    │                  │                 │
  │                         │   nonce N (10min)│                    │                  │                 │
  │                         │                  │                    │                  │                 │
  │  302 → /authorize/N     │                  │                    │                  │                 │
  │◀────────────────────────┤                  │                    │                  │                 │
  │                                            │                    │                  │                 │
  │   GET /authorize/N                         │                    │                  │                 │
  ├───────────────────────────────────────────▶│                    │                  │                 │
  │                                            │                    │                  │                 │
  │   render Supabase-JS sign-in form          │                    │                  │                 │
  │◀───────────────────────────────────────────┤                    │                  │                 │
  │                                            │                    │                  │                 │
  │   ── existing session in localStorage ──▶  ├────  getSession ──▶│                  │                 │
  │                                            │◀─── access_token ──┤                  │                 │
  │                                            │                                                          │
  │   ── no session ── click "Continue with Google" ──▶ Supabase /authorize ──▶ Google ──▶ /auth/callback│
  │                                            │                                                          │
  │                                            │   exchange code → access_token                           │
  │                                            │                                                          │
  │                                            │   POST /oauth/decision  { nonce: N, token: <supabase_jwt> }
  │                                            ├──────────────────────────────────────▶│                 │
  │                                            │                                       │ verify JWT       │
  │                                            │                                       │ load N from KV   │
  │                                            │                                       │ completeAuthz    │
  │                                            │                                       │ → { redirectTo } │
  │                                            │                       { redirectTo }  │                  │
  │                                            │◀──────────────────────────────────────┤                  │
  │   window.location = redirectTo                                                                        │
  │                                                                                                       │
  │   ── follows redirect with ?code=<authz_code>&state=... ───▶ Claude/ChatGPT exchanges at /token  ────▶│
  │                                                                                                       │
  │   ← access_token + refresh_token (Nexus-issued, stored in OAUTH_KV)                                   │
  │                                                                                                       │
  │   ── subsequent /mcp calls carry Authorization: Bearer <access_token> ──▶                             │
```

The nonce indirection (`/authorize` → `/authorize/N`) is so the consent page never sees raw OAuth params in its URL — they live server-side in KV under nonce `N` with a 10-minute TTL. The browser only carries `N`.

### 4.4 Code shape

#### `index.ts`

```ts
import { OAuthProvider } from "@cloudflare/workers-oauth-provider";
import defaultHandler from "./handlers/default";
import { NexusMcpAgent } from "./mcp";

export { NexusMcpAgent };

export default new OAuthProvider({
  apiHandlers: {
    "/mcp":  NexusMcpAgent.serve("/mcp"),
    "/mcp/": NexusMcpAgent.serve("/mcp/"),       // trailing-slash invariant
    "/sse":  NexusMcpAgent.serveSSE("/sse"),
  },
  defaultHandler,
  authorizeEndpoint:          "/authorize",
  tokenEndpoint:               "/token",
  clientRegistrationEndpoint:  "/register",
  scopesSupported: ["openid", "profile", "email"],
  resourceMetadata: {
    resource: "https://nexus.kushalsm.com/mcp",  // canonical, no trailing slash
    authorization_servers: ["https://nexus.kushalsm.com"],
    scopes_supported:       ["openid", "profile", "email"],
    bearer_methods_supported: ["header"],
    resource_name: "Nexus",
  },
});
```

Notes:
- KV binding **must** be named `OAUTH_KV`. The lib hardcodes the name; the constructor has no override.
- `resourceMetadata.resource` is set explicitly. If we omit it, the lib defaults to the origin, and Claude's strict matcher might accept it as "origin match" but might not — this is exactly the kind of "rely on undocumented default" trap we hit last time.
- The library only serves the bare `/.well-known/oauth-protected-resource`. Path-suffixed variants (`.../oauth-protected-resource/mcp` and `.../mcp/`) must be served by `defaultHandler` — see §6.

#### `handlers/authorize.ts`

```ts
import { uuid } from "../lib/uuid";

const CONSENT_TTL = 60 * 10;

export async function authorize(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const parts = url.pathname.split("/");

  if (parts.length === 2) {
    // GET /authorize?response_type=code&client_id=...&redirect_uri=...&...
    const parsed = await env.OAUTH_PROVIDER.parseAuthRequest(req);
    const nonce = uuid();
    await env.NEXUS_CACHE.put(
      `consent:${nonce}`,
      JSON.stringify(parsed),
      { expirationTtl: CONSENT_TTL },
    );
    return Response.redirect(`${url.origin}/authorize/${nonce}`, 302);
  }

  // GET /authorize/<nonce> — render the sign-in HTML
  const nonce = parts[2];
  const raw = await env.NEXUS_CACHE.get(`consent:${nonce}`);
  if (!raw) return new Response("Authorization request expired", { status: 410 });

  return new Response(consentHtml({ nonce, env }), {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}
```

The parsed request from `parseAuthRequest()` has shape `{ responseType, clientId, redirectUri, scope, state }` (camelCase per the README). It's stored as-is in KV under the nonce.

#### `handlers/decision.ts`

```ts
import { verifySupabaseJwt } from "../auth/supabase-jwt";

export async function decision(req: Request, env: Env): Promise<Response> {
  const body = await req.json<{ nonce: string; action: "approve" | "deny"; supabase_token?: string }>();

  const raw = await env.NEXUS_CACHE.get(`consent:${body.nonce}`);
  if (!raw) return Response.json({ error: "expired" }, { status: 410 });
  const parsed = JSON.parse(raw) as ParsedAuthRequest;
  await env.NEXUS_CACHE.delete(`consent:${body.nonce}`);

  if (body.action === "deny") {
    return Response.json({
      redirect_to: `${parsed.redirectUri}?error=access_denied&state=${encodeURIComponent(parsed.state)}`,
    });
  }

  const claims = await verifySupabaseJwt(body.supabase_token, env);
  if (!claims) return Response.json({ error: "invalid_supabase_token" }, { status: 401 });

  const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
    request: parsed,
    userId: claims.sub,
    scope: parsed.scope,
    props: {
      userId:      claims.sub,
      email:       claims.email ?? "",
      displayName: claims.name ?? claims.preferred_username ?? claims.email ?? "Nexus user",
    },
    metadata: {
      signed_in_via: claims.app_metadata?.provider ?? "supabase",
      issued_at: Date.now(),
    },
  });

  return Response.json({ redirect_to: redirectTo });
}
```

Two things to notice:
- `props` is the live payload — what `NexusMcpAgent` reads as `this.props` on every tool call. **Must** contain `userId` or the tools see `undefined` and write to a phantom user.
- `metadata` is opaque to runtime — just persisted with the grant for audit/debugging. Don't put live-path data there.

`completeAuthorization` returns `{ redirectTo: string }` (verified against README). We pass it back as JSON to the consent page, which `window.location`s to it.

---

## 5. The MCP server

```ts
// mcp.ts
import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { LogInput, HistoryInput, UpdateInput, FriendsInput } from "./schema/tool-inputs";
import { logEntries, getHistory, updateEntry } from "./data/entries";
import { manageFriends } from "./data/friends";

interface Props {
  userId: string;
  email: string;
  displayName: string;
}

export class NexusMcpAgent extends McpAgent<Env, unknown, Props> {
  server = new McpServer({
    name: "Nexus – Workout and Nutrition Tracker",
    version: "3.0",
  });

  async init() {
    const u = () => this.props.userId;

    this.server.tool(
      "log_fitness_entries",
      "Store workout, meal, or body-weight entries for the authenticated Nexus user.",
      LogInput.shape,
      { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      async (args) => textResult(await logEntries(this.env, u(), args)),
    );

    this.server.tool(
      "get_fitness_history",
      "Fetch workouts, meals, body-weight entries, exercise keys, and friend-shared history.",
      HistoryInput.shape,
      { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      async (args) => textResult(await getHistory(this.env, u(), args)),
    );

    this.server.tool(
      "update_fitness_entry",
      "Replace one existing entry owned by the authenticated user.",
      UpdateInput.shape,
      { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
      async (args) => textResult(await updateEntry(this.env, u(), args)),
    );

    this.server.tool(
      "manage_friend_connections",
      "List, add, accept, reject, or remove Nexus friend connections.",
      FriendsInput.shape,
      { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
      async (args) => textResult(await manageFriends(this.env, u(), args)),
    );
  }
}

function textResult(payload: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(payload) }] };
}
```

`McpAgent` is a Durable Object. The provider lib validates the bearer, looks up the grant in `OAUTH_KV`, copies `props` into the DO context, and dispatches the call. By the time `init()` runs, `this.props.userId` is always present — if it weren't, the lib would have returned 401 before getting here.

There is no `require_mcp_user()`, no "anonymous test user" fallback. Anonymous requests don't reach the agent.

---

## 6. Trailing-slash invariant on Workers

The library serves only the bare `/.well-known/oauth-protected-resource`. The MCP client discovery logic prefers the URL in the `WWW-Authenticate` header (which the lib emits with `resource_metadata="<base>/.well-known/oauth-protected-resource"`), so the bare endpoint is enough for compliant clients.

But the discovery spec defines two fallbacks, and the docs at `mcp-path-trailing-slash.md` say we serve all three variants for belt-and-suspenders. We do the same on Workers, in `handlers/protected-resource.ts`:

```ts
const PAYLOAD = {
  resource: "https://nexus.kushalsm.com/mcp",
  authorization_servers: ["https://nexus.kushalsm.com"],
  scopes_supported: ["openid", "profile", "email"],
  bearer_methods_supported: ["header"],
  resource_name: "Nexus",
};

export function protectedResource(req: Request): Response | null {
  const { pathname } = new URL(req.url);
  if (
    pathname === "/.well-known/oauth-protected-resource/mcp" ||
    pathname === "/.well-known/oauth-protected-resource/mcp/"
  ) {
    return Response.json(PAYLOAD, { headers: { "cache-control": "public, max-age=3600" } });
  }
  return null;
}
```

Hook this into `defaultHandler` before any other routing. The lib's bare-endpoint handler already returns the same payload (built from `resourceMetadata`), so the three responses agree.

The actual `/mcp` and `/mcp/` endpoints are both in `apiHandlers`, so requests to either form land at the MCP agent without 307s. This is the same rule as the FastMCP fix — the surface is different, but the invariant is identical.

---

## 7. Data layer

### 7.1 Hyperdrive + Supabase Postgres

Hyperdrive points at Supabase's transaction-mode pooler URL (port 6543). Transaction mode is the only mode Hyperdrive officially supports, and it's the right choice for short-lived edge requests.

**Transaction mode does not support prepared statements.** `postgres.js` prepares by default, so we must opt out. Single rule, written down so nobody re-enables it:

```ts
// data/db.ts
import postgres from "postgres";

let _sql: ReturnType<typeof postgres> | null = null;

export function sql(env: Env) {
  if (_sql) return _sql;
  _sql = postgres(env.NEXUS_DB.connectionString, {
    // Supabase transaction pooler — required, not optional.
    prepare: false,
    max: 5,
    fetch_types: false,
  });
  return _sql;
}
```

If you find yourself wanting prepared statements (`postgres.js` warns on a missing `prepare: false`), don't enable them — switch the Hyperdrive backing URL to Supabase's session pooler (port 5432), document that here, and accept the connection-pool cost.

Tables stay where they are: `users`, `entries`, `friendships`. Queries are direct SQL via `postgres.js`. No ORM, same shape as the Python `Store` class but in TS.

### 7.2 OAuth state in `OAUTH_KV`

Owned by `workers-oauth-provider`. Key layout (informational — we never touch these directly):

| Prefix | TTL | Purpose |
|---|---|---|
| `client:<id>` | 90 days (`clientRegistrationTTL`) | RFC 7591 dynamically registered clients |
| `code:<code>` | ~5 min | Authorization codes |
| `token:<token>` | 1 hour (`accessTokenTTL`) | Access tokens |
| `refresh:<token>` | 30 days (`refreshTokenTTL`) | Refresh tokens |
| `grant:<id>` | until revoked | Active user grants (props + scope) |

### 7.3 Auxiliary state in `NEXUS_CACHE`

Our own KV namespace for things the OAuth lib doesn't own.

| Key | TTL | Purpose |
|---|---|---|
| `supabase:jwks` | 24h | Cached Supabase JWKS — avoids a fetch on every consent submission |
| `consent:<nonce>` | 10 min | Stashed `parseAuthRequest` result during sign-in (§4.3) |

---

## 8. The PyPI CLI's six REST endpoints

The `nexus` CLI (`pip install nexus-fitness`) talks to six routes today. All six need to exist on the Worker — missing `/api/v1/auth/config` would break `nexus login` at the first step.

| Path | Method | Purpose | Auth |
|---|---|---|---|
| `/api/v1/auth/config` | GET | Returns `{ auth_enabled, supabase_url, supabase_publishable_key }` so the CLI can drive its local browser-OAuth flow | none |
| `/api/v1/me` | GET | Echoes the authenticated user from the bearer | bearer |
| `/api/v1/log` | POST | Same shape as `log_fitness_entries` tool | bearer |
| `/api/v1/history` | GET | Same shape as `get_fitness_history` tool | bearer |
| `/api/v1/update` | POST | Same shape as `update_fitness_entry` tool | bearer |
| `/api/v1/friends` | POST | Same shape as `manage_friend_connections` tool | bearer |

Bearer tokens for the REST path are the same OAuth access tokens the MCP path uses — same `OAUTH_KV` lookup, same `props`. Implemented in `handlers/rest-api.ts`; the bearer validation goes through the same lib middleware applied via `apiHandlers` (so the REST routes go in `apiHandlers` too, not `defaultHandler`):

```ts
apiHandlers: {
  "/mcp": NexusMcpAgent.serve("/mcp"),
  "/mcp/": NexusMcpAgent.serve("/mcp/"),
  "/sse": NexusMcpAgent.serveSSE("/sse"),
  "/api/v1/log":      { fetch: restLog },
  "/api/v1/history":  { fetch: restHistory },
  "/api/v1/update":   { fetch: restUpdate },
  "/api/v1/friends":  { fetch: restFriends },
  "/api/v1/me":       { fetch: restMe },
},
```

`/api/v1/auth/config` is **unauthenticated** so it goes in `defaultHandler`, not `apiHandlers`.

---

## 9. `wrangler.jsonc`

```jsonc
{
  "name": "nexus-mcp",
  "main": "src/index.ts",
  "compatibility_date": "2026-05-01",
  "compatibility_flags": ["nodejs_compat"],

  "kv_namespaces": [
    { "binding": "OAUTH_KV",     "id": "<wrangler kv namespace create OAUTH_KV>" },
    { "binding": "NEXUS_CACHE",  "id": "<wrangler kv namespace create NEXUS_CACHE>" }
  ],

  "hyperdrive": [
    { "binding": "NEXUS_DB", "id": "<wrangler hyperdrive create nexus-db --connection-string ...>" }
  ],

  "durable_objects": {
    "bindings": [{ "name": "MCP_AGENT", "class_name": "NexusMcpAgent" }]
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
  },

  "assets": {
    "directory": "./static",
    "binding": "ASSETS"
  }
}
```

Secrets (`wrangler secret put`):

- No Postgres credentials — Hyperdrive stores the connection string at create time. The bundle never sees the password.
- No Supabase service-role key needed at the Worker layer; we only verify JWTs against JWKS.

Bindings used by the code:

- `env.OAUTH_KV` — required by the lib, hardcoded name.
- `env.NEXUS_CACHE` — our auxiliary KV.
- `env.NEXUS_DB` — Hyperdrive.
- `env.MCP_AGENT` — Durable Object namespace (used internally by `McpAgent.serve`).
- `env.OAUTH_PROVIDER` — injected by the lib into the defaultHandler's env, exposes `parseAuthRequest` and `completeAuthorization`.

---

## 10. Static assets

The `/.well-known/openai-apps-challenge` endpoint must serve the verification token as **plain text** from the apex (OpenAI's verifier ignores subpaths). Workers Assets handles this: place the token in `static/.well-known/openai-apps-challenge` and bind via the `assets` block above. The Worker won't even execute for that route — Assets serves it directly.

Privacy policy and usage docs live on the marketing site at `nexus.kushalsm.com` (separate static site), not in the Worker.

---

## 11. Domain plan

`nexus.kushalsm.com` becomes the Worker custom domain. The existing Cloud Run URL keeps working until at least one full Claude/ChatGPT submission review settles — once a partner directory has recorded our URLs, breaking them is expensive.

DNS cutover, in order:

1. Add `nexus.kushalsm.com` as a Workers custom domain.
2. Configure Hyperdrive to point at Supabase.
3. Set Worker `vars.BASE_URL` to `https://nexus.kushalsm.com`.
4. Update PyPI CLI `DEFAULT_BASE_URL` constant → cut a `nexus-fitness` patch release.
5. Update landing page connector links to point at `https://nexus.kushalsm.com/mcp`.
6. Resubmit (or update) Claude and ChatGPT directory entries to the new URL.
7. After one week of healthy traffic, delete the Cloud Run service and the five `oauth_*` Postgres tables.

The Cloud Run URL keeps responding throughout. Users with active sessions issued by Cloud Run keep them; their access tokens expire within an hour and new tokens come from the Worker. No flag day.

---

## 12. Tests

The slash invariant earned a test suite the hard way; the Worker carries that suite forward and adds the OAuth flow.

`test/protected-resource.spec.ts`:

- All three protected-resource URLs return the same payload, with `resource: "https://nexus.kushalsm.com/mcp"` (no trailing slash).
- Both `/mcp` and `/mcp/` return 401 with a `WWW-Authenticate` header whose `resource_metadata` URL has no trailing slash.

`test/oauth.spec.ts`:

- `GET /authorize?...` returns 302 to `/authorize/<nonce>`.
- `GET /authorize/<nonce>` returns the consent HTML and the nonce is in KV.
- `POST /oauth/decision` with a valid Supabase JWT returns `{ redirect_to: "<client_redirect>?code=..." }` and stores a grant in `OAUTH_KV` with `props.userId` set.
- `POST /token` with the resulting code returns an access token; bearer it back to `/api/v1/me` and get `{ user_id, display_name }` matching the Supabase claims.

`test/tools.spec.ts`:

- All four tools, including the friends graph (add → accept → list → remove).
- Hyperdrive is mocked to a Miniflare-managed Postgres via the Cloudflare Vitest pool.

All tests run via `@cloudflare/vitest-pool-workers`, no separate Miniflare config.

---

## 13. Non-decisions

Three things the doc deliberately doesn't resolve, to keep this migration scoped:

- **D1 vs continuing on Supabase Postgres long-term.** A pure-Cloudflare future (D1 for entries, R2 for any blob) is a separate decision, made once the Workers stack is stable.
- **MCP session state beyond authentication.** McpAgent's DO storage exists. We don't write to it yet. When elicitation / sampling matter, that's the place.
- **Rate limiting and abuse controls.** Cloudflare's WAF and Rate Limiting bindings sit at the request layer. Wire them on after launch with real traffic shape data.

---

## 14. Verifications carried forward from the FastMCP version

Anything the FastMCP server got right has to keep working on Workers. The non-negotiable list, checked via curl against the deployed Worker before declaring cutover complete:

```bash
B=https://nexus.kushalsm.com

# Both endpoint forms 401, no 307
curl -sS -i $B/mcp  | grep -E '^(HTTP|www-authenticate)'
curl -sS -i $B/mcp/ | grep -E '^(HTTP|www-authenticate)'

# All three protected-resource URLs return the same no-slash `resource`
curl -sS $B/.well-known/oauth-protected-resource     | jq .resource
curl -sS $B/.well-known/oauth-protected-resource/mcp | jq .resource
curl -sS $B/.well-known/oauth-protected-resource/mcp/ | jq .resource

# OAuth metadata
curl -sS $B/.well-known/oauth-authorization-server | jq

# OpenAI domain verification at apex (not under /mcp)
curl -sS $B/.well-known/openai-apps-challenge

# Health, root
curl -sS $B/health
curl -sS $B/        | jq

# CLI bootstrap
curl -sS $B/api/v1/auth/config | jq
```

Every line must produce the same shape it produces against the current Cloud Run host today. If anything changes — even cosmetic — that's a real regression: the PyPI CLI and the submitted directory entries depend on these shapes.
