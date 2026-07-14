# Nexus on Claude: isolated deployment, shared modern MCP Apps contract

> Current architecture reference: `docs/cross-host-architecture.md`. This file records the Claude deployment decision; where implementation details differ, the cross-host architecture and executable contract tests are authoritative.

Status: implemented and deployed.

Last updated: 2026-07-14

## Decision

Run the same Nexus application code as two isolated remote MCP deployments:

```text
ChatGPT production
https://mcp.nexus.kushalsm.com/mcp

Claude
https://claude-mcp.nexus.kushalsm.com/mcp
```

Both targets use only the current open MCP Apps protocol:

- `_meta.ui.resourceUri` on the widget-bearing tool;
- a `ui://` resource with `text/html;profile=mcp-app`;
- `_meta.ui.csp`, `_meta.ui.domain`, and `_meta.ui.prefersBorder` on the resource;
- `ui/initialize` followed by `ui/notifications/initialized`;
- `ui/notifications/tool-result` for initial and subsequent results;
- standard `tools/call` for widget actions.

There is no legacy OpenAI adapter, `window.openai` path, `openai/*` metadata alias, snake-case CSP alias, runtime host detection, or bridge fallback in either target. Each build contains exactly one host-specific implementation of the current MCP Apps lifecycle.

The endpoints remain separate because ChatGPT and Claude impose different policies on `ui.domain`, OAuth resource identity, caching, and deployment review. Separation is operational isolation, not protocol fallback and not a code fork.

## Why two deployments are still necessary

Nexus already proved that ordinary MCP functionality works in Claude:

```text
Claude -> OAuth -> Nexus tool -> database write -> tool result -> success
```

The widget failed before rendering because Claude rejected this value:

```text
Invalid ui.domain format: expected "{hash}.claudemcpcontent.com",
got "https://mcp.nexus.kushalsm.com".
```

The current host requirements differ:

| Host | `ui.domain` |
|---|---|
| ChatGPT | App-owned HTTPS origin, currently `https://mcp.nexus.kushalsm.com` |
| Claude | Deterministic `{hash}.claudemcpcontent.com` hostname, or omission if accepted and a stable origin is unnecessary |

Trying to make one metadata object and one deployed OAuth resource identity satisfy both hosts is unnecessary risk. The shared protocol stays identical; configuration and deployment identity differ.

## Architecture

### Shared source

Both Workers are built from `workers/src/`. Tool handlers, schemas, InstantDB integration, authentication code, and widget UI remain shared.

Host-specific behavior is selected by a build-time target:

```ts
type McpHostTarget = "openai" | "claude";
```

The target controls only:

- public MCP base URL;
- OAuth protected-resource identity;
- Worker/custom-domain deployment configuration;
- `ui.domain`;
- versioned `ui://` resource URI when cache isolation is useful.

It must not duplicate tool registration or application logic.

### Separate Cloudflare deployments

```text
Worker: nexus-mcp
Host:   mcp.nexus.kushalsm.com
Target: openai
```

```text
Worker: nexus-mcp-claude
Host:   claude-mcp.nexus.kushalsm.com
Target: claude
```

The Claude deployment receives its own Worker, custom hostname, base URL, MCP OAuth resource identifier, Durable Object namespace, and widget cache identity. It may share the existing InstantDB application and OAuth user store.

Deploying Claude must require:

```bash
npx wrangler deploy --env claude
```

It must not implicitly deploy or modify the default OpenAI production Worker.

## Standard metadata contract

The widget-bearing tool uses:

```ts
{
  _meta: {
    ui: {
      resourceUri: WIDGET_URI
    }
  }
}
```

The linked resource uses:

```ts
{
  uri: WIDGET_URI,
  mimeType: "text/html;profile=mcp-app",
  text: widgetHtml,
  _meta: {
    ui: {
      domain: HOST_WIDGET_DOMAIN,
      prefersBorder: true,
      csp: {
        connectDomains: [
          "https://api.instantdb.com",
          "wss://api.instantdb.com"
        ],
        resourceDomains: []
      }
    }
  }
}
```

Forbidden in both targets:

- `openai/outputTemplate`;
- `openai/widgetDomain`;
- `openai/widgetCSP`;
- `openai/widgetPrefersBorder`;
- `openai:set_globals`;
- `window.openai`;
- `ui/resourceUri` compatibility aliases;
- `connect_domains` or `resource_domains` casing.

Do not use a helper that silently adds deprecated compatibility aliases. Verify the serialized `tools/list` and `resources/read` output, not just the source object.

## Widget runtime

The shared Nexus UI owns `hydrateToolResult`, render state, editors, and tool-driven mutations. Each deployed bridge owns only handshake, result delivery, dimensions, lifecycle acknowledgements, and `tools/call`.

The first Claude implementation bundled `@modelcontextprotocol/ext-apps` 1.7.4 and called `App.connect()` exactly as documented. Live testing on Claude web and iOS proved a host/view deadlock: Claude loaded the resource and CSS, but withheld the initial tool result while the SDK waited for an initialize response before sending `ui/notifications/initialized`. The visible symptom was a correctly sized card containing only the statue background.

The production Claude bridge therefore implements the ratified 2026-01-26 messages directly and in one deterministic order:

1. register the `ui/notifications/tool-result` listener;
2. send `ui/initialize`;
3. immediately send `ui/notifications/initialized`, which Claude currently uses as its visibility/data-delivery gate;
4. send numeric `ui/notifications/size-changed` values;
5. hydrate the initial tool result;
6. route widget edits through standard `tools/call`;
7. acknowledge `ping` and `ui/resource-teardown`.

This is not an SDK-first path with a compatibility fallback. The Claude artifact contains only the Claude bridge, and the OpenAI artifact contains only the already-proven OpenAI bridge. Both use the current protocol and neither contains `window.openai` or legacy OpenAI metadata.

## Claude sandbox domain

Finalize the Claude MCP URL first, then derive the Claude sandbox hostname from this exact value using Claude's documented algorithm:

```text
https://claude-mcp.nexus.kushalsm.com/mcp
```

The configured value is this bare hostname:

```text
9b68940b7971ea72dbbd8bcad6a73a79.claudemcpcontent.com
```

It must not include `https://`. A hash computed for the OpenAI MCP URL cannot be reused because the MCP URL is an input to the hash.

Do not omit this field and do not put the OpenAI HTTPS origin into Claude metadata. Claude live testing confirmed that the hash-based value is accepted and used as the iframe origin.

## OAuth behavior

The Claude endpoint is a distinct protected resource:

```text
https://claude-mcp.nexus.kushalsm.com/mcp
```

Before widget testing, verify:

1. Claude discovers protected-resource metadata from the Claude hostname.
2. Dynamic Client Registration succeeds.
3. The authorization redirect returns to Claude's registered callback.
4. The issued token is accepted at the Claude MCP URL.
5. MCP `initialize`, `tools/list`, and a data-only call succeed.
6. Disconnecting and reconnecting creates a clean session.

Successful authentication against the OpenAI endpoint is not proof that the Claude audience is correct.

## InstantDB and first paint

The initial card must render from `structuredContent`. InstantDB provides later live updates and must not be required for first paint.

Verify whether Claude forwards tool-result `_meta` to the iframe:

- if present, start the InstantDB subscription;
- if absent, keep the complete static card usable;
- render the initial card from the standard tool result rather than waiting for InstantDB.

CSP permission and InstantDB CORS/network acceptance are separate checks.

## Implemented sequence

1. Kept the OpenAI endpoint on its standard-only metadata and proven direct MCP Apps bridge.
2. Added the `claude` Wrangler environment and `claude-mcp.nexus.kushalsm.com` custom domain.
3. Added compile-time-only target selection for host URL, OAuth identity, `ui.domain`, widget URI, and bridge artifact.
4. Computed and configured the Claude sandbox hostname from the exact connector URL.
5. Verified Claude DCR, password OAuth, token exchange, MCP initialize, tools/list, resources/read, and a widget-bearing log call.
6. Added and ran the widget contract and deployment-isolation tests.
7. Deployed only with `wrangler deploy --env claude`.
8. Added `Nexus Claude` as a fresh custom connector and verified the full card renders from a direct logging call on Claude web; Claude iOS also loaded the widget resource during diagnosis.
9. Re-ran the OpenAI production smoke test to prove the isolated Claude deployment changed nothing there.

## Required tests

### Static contract

- No source or serialized MCP response contains `openai/*`, `window.openai`, `openai:set_globals`, `ui/resourceUri`, or snake-case CSP fields.
- The bundled widget contains `ui/initialize`, `ui/notifications/initialized`, and `ui/notifications/tool-result`.
- The logging tool advertises only `_meta.ui.resourceUri`.
- Registration URI, tool URI, and returned content URI are identical.
- MIME type is `text/html;profile=mcp-app`.
- Each target emits its own valid `ui.domain`.

### Widget lifecycle

- The View completes the standard initialization handshake.
- The first tool result paints the card.
- Repeated equivalent results do not reset the selected Food/Workout view or clobber newer live data.
- A widget edit completes through standard `tools/call`.
- Missing InstantDB metadata still leaves a usable static card.

### Isolation

- Default deploy resolves only to OpenAI production.
- `--env claude` resolves only to the Claude Worker and hostname.
- Tool schemas and handlers are identical across targets.
- Claude deployment cannot change the OpenAI OAuth resource URL or widget domain.

## Manual verification matrix

| Surface | Test | Expected result |
|---|---|---|
| MCP Apps `basic-host` | Call each target's `nexus_log_entries` | Standard handshake completes and card renders |
| MCP Apps `basic-host` | Edit and save a row | Standard `tools/call` completes |
| Claude web | Connect and authenticate | OAuth completes against Claude hostname |
| Claude web/Desktop | Direct logging call | Widget renders current totals |
| Claude web/Desktop | Toggle and edit | Local state and mutation work |
| Claude reconnect | Remove and re-add connector | Fresh connector renders without stale metadata |
| ChatGPT web | Direct logging call | Widget renders through the standard bridge |
| ChatGPT iOS | Direct single logging call | Widget renders through the standard bridge |

## Definition of done

Claude support is complete because:

- the Claude MCP URL authenticates independently;
- the current MCP Apps lifecycle completes in both hosts;
- initial tool data paints without InstantDB;
- widget data renders and edits use standard MCP tool calls;
- the OpenAI endpoint contains no compatibility path;
- deploying Claude does not mutate OpenAI production.

## Production evidence

- Claude Worker: `nexus-mcp-claude`
- Claude endpoint: `https://claude-mcp.nexus.kushalsm.com/mcp`
- Claude widget cache URI: `ui://widget/nexus-today-claude-v3.html`
- Claude deployment version: `13b18529-ae4c-4d76-88bb-d618e9150271`
- Automated suite: 19 tests passed; TypeScript passed.
- Authenticated MCP smoke: five tools discovered, resource read with `text/html;profile=mcp-app`, standard metadata present, legacy metadata absent, widget-bearing tool call passed.
- Host proof: `Nexus Claude` connected through OAuth and rendered the complete day card inline in a real Claude web conversation.
