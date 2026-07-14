# Primitives frozen. Next: the ChatGPT experience layer

**Status:** implementation roadmap after the 2026-07-14 cross-host primitive freeze  
**Scope:** optional ChatGPT experience work that may now be layered on without changing Nexus correctness semantics.

* * *
## 1 · Where we stand — the primitive boundary
One codebase, one protocol skeleton, two host-tuned deployments. As of tonight, all four live surfaces render on it: **ChatGPT web, ChatGPT iOS, Claude web, Claude iOS**, plus the local harness.

| Primitive | State |
| --- | --- |
| Bridge | One bundle, official `ext-apps` App class (pinned 1.7.4). No hand-rolled protocol code. 6s connect timeout, default paint on silent hosts. |
| Theme | Host-declared theme → `data-theme` → tokens. Media query is fallback only. |
| Sizing | The widget measures `#nexus-root`, reports standard `size-changed`, and reapplies layout when host context changes. Hosts still own the outer frame. |
| Per-host config | Build-time `__MCP_HOST_TARGET__`, per-target widget URI + previous URI kept registered (host caches), per-target `ui.domain`. |
| The seam | Widget code talks only to `NexusMcpBridge` (`connect / callTool / hostContext / sendSize`). Host quirks live inside the bridge, never in widget code. |
| Mutation identity | Every log, goal change, and entry edit carries a caller-generated `mutation_id`. Durable receipts replay the original result for an exact retry and reject reuse with different arguments. |
| Concurrency | Every entry snapshot carries `state_version`; edits require `expected_state_version`. Old cards are rejected and refreshed before the user retries. |
| Truthfulness | Tool instructions permit read-then-write sequences and forbid claiming a mutation succeeded unless its mutation tool returned success. |
| Data transport | ChatGPT may receive a scoped InstantDB live token. Claude receives only the tool snapshot and MCP mutation results—no unused browser credential or InstantDB CSP allowance. |
| Lifecycle | The bridge initializes through the official protocol, acknowledges teardown, listens for host-context changes, and reports root size. |

**The rule that made this stable, and governs everything below:**

> Shared primitives own correctness. Host adapters own metadata, transport optimizations, and presentation. Nothing host-specific may be load-bearing for mutation truth, idempotency, or stale-write protection.

MCP does not provide a mechanism for a server to limit an assistant turn to one tool call. Any “single-call rule” is merely model instruction text, and Nexus deliberately has no such rule. Multi-tool widget failures on a native client are host bugs to report, not application semantics to encode.

July's pain was never _using_ `openai/*` — it was the widget's boot path _depending_ on it. That mistake doesn't come back.

* * *
## 2 · Sorting the "ChatGPT features" honestly
Half of what looks ChatGPT-only now has a standard spelling in ext-apps. We use the standard form wherever it exists (works on Claude too, for free), and `openai/*` only for the rest.

| Capability | Standard way (works both hosts) | ChatGPT-only way | Verdict |
|---|---|---|---|
| Status line during tool call ("Logging to Nexus…") | — | `openai/toolInvocation/invoking·invoked` | openai/* |
| Widget description (directory, review) | — | `openai/widgetDescription` | openai/* |
| CSP enforcement (kill the orange "CSP off" chip) | `ui.csp` (declared, apparently unenforced in dev mode) | `openai/widgetCSP` | both, cheap |
| Shrink the frame on editor close | `size-changed` (sent; both hosts ratchet) | `window.openai.notifyIntrinsicHeight` (already wired, self-activates) | openai/*, gated |
| Fullscreen / expanded day view | `ui/request-display-mode` (in ext-apps SDK) | `window.openai.requestDisplayMode` | **standard first** |
| Widget → conversation message ("suggest dinner from remaining macros") | `App.sendMessage` | `window.openai.sendFollowUpMessage` | **standard first** |
| Feed state to the model silently (today's totals as context) | `App.updateModelContext` | — | standard |
| Remember UI state across remounts (open editor, tab) | — (`toolInfo.id` + localStorage pattern from Anthropic's docs) | `window.openai.widgetState` | hybrid |
| Open external link | `ui/open-link` | `window.openai.openExternal` | standard first |

* * *
## 3 · The backlog, ranked
### E1 — Status strings + description _(risk: none)_
Two meta keys on the tool, one on the resource, **openai worker only**. Zero widget change. Immediately visible polish during every log.
### E2 — ChatGPT extension experiment _(risk: gated — this is the gate for E3/E4)_
Unknown to resolve: which optional `openai/*` experience keys are useful on top of the standard MCP Apps lifecycle. Protocol and hydration remain standard-only; staging worker only:

1. Add the E1 keys + `openai/widgetCSP` to staging's target-gated meta.
  
2. Point a dev-mode ChatGPT app at staging.
  
3. Check, in order: widget still boots on the App class · handshake intact · status strings visible · CSP chip state · optional extension availability · **does editor-close now shrink**.
  
4. All green → promote the keys to prod meta. Anything red → we know precisely which key flips the pipeline, and we keep it out.
  
### E3 — Shrink-on-close _(risk: none once E2 is green)_
No code change — the bridge already calls `notifyIntrinsicHeight` best-effort. E2 decides whether it activates.
### E4 — Widget state persistence _(risk: low)_
Card remembers the open editor/row/tab when ChatGPT remounts it. `window.openai.widgetState` where present; `toolInfo.id`-keyed localStorage as the standard-side fallback (Anthropic's own documented pattern — skip cache on iOS where `toolInfo.id` is undefined).
### E5 — Fullscreen day view _(risk: low, standard)_
`ui/request-display-mode` through the SDK — an expand affordance on the card. Standard method, so Claude may get it free; hosts that refuse just say no.
### E6 — Follow-up affordances _(risk: low, standard, product-y)_
Buttons on the card that speak back into the conversation via `App.sendMessage` — "suggest dinner from remaining macros", "what's my protein gap". This is where living-inside-chat starts beating a standalone app. Needs product taste more than engineering.
### E7 — Model context feed _(risk: low, standard)_
`App.updateModelContext` with the day's totals after every edit, so the next user message is answered with current numbers without a tool call.

* * *
## 4 · What actually changes in the code
`workers/src/mcp.ts` **— one new const, two spread sites.** The only structural change:

```ts
// ChatGPT extension skin. Never load-bearing: the widget boots and hydrates
// on the standard path with or without these.
const OPENAI_TOOL_EXTRAS = MCP_HOST_TARGET === "openai" ? {
  "openai/toolInvocation/invoking": "Logging to Nexus…",
  "openai/toolInvocation/invoked": "Logged to Nexus",
} : {};

const OPENAI_RESOURCE_EXTRAS = MCP_HOST_TARGET === "openai" ? {
  "openai/widgetDescription": "…",
  "openai/widgetCSP": { connect_domains: [...], resource_domains: [] },
} : {};
```

spread into the existing tool `_meta` and `WIDGET_META`. Claude's build compiles these to `{}` — it structurally cannot ship them.

`workers/widget-build/mcp-app-bridge.ts` **— facade grows three host-agnostic methods**, all thin wrappers over the SDK: `requestDisplayMode()`, `sendMessage(text)`, `updateModelContext(ctx)`. Any OpenAI-only enhancement stays _inside_ the bridge and is feature-detected; the facade API never says “openai”.

`workers/src/widget/today-html.ts` — consumes new facade methods only. Hard rule stays: no host checks, no `window.openai` references in widget code.

`wrangler.jsonc` — nothing. The target define already exists.

**Harness** — two buttons (`request display mode` echo, `message` event log) so E5/E6 are testable offline; contract test asserting the extras exist iff target is openai.

**Rollout, every time:** staging → dev-mode app → E2 checklist → prod → smoke checklist. Claude is not deployed when only the OpenAI adapter changes. Shared primitive changes always run both host suites and both host canaries.

* * *
## 5 · Explicitly not doing
- No `window.openai` in the boot/hydration path — ever again.
  
- No runtime host-detection forks in widget code — host identity stays in the bridge and the build.
  
- No v2 SDK / 2026-07-28 spec work — watchlist only.
  
- No second codebase. The Claude widget and the ChatGPT widget remain the same application with different skins.
