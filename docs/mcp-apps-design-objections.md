# Objections to the current Nexus MCP Apps design

> Historical review snapshot. The bridge fork, lifecycle gaps, silent hydration, and single-host assumptions described below were inputs to the current implementation and are not current-state claims. See `docs/cross-host-architecture.md` and `docs/chatgpt-experience-plan.md` for the active design.

2026-07-14. Review of the standard-only rewrite (uncommitted working tree, deployed to prod at 10:43 UTC). The rewrite's direction is right — ChatGPT renders pure MCP Apps, verified live — but the execution has holes. Each objection below has a severity and a concrete ask.

## Where things stand (evidence, not opinion)

| Host | Result |
|---|---|
| ChatGPT web | Renders (after the 873-byte shim replaced the official runtime) |
| ChatGPT iOS | Untested since the rewrite |
| Claude web (desktop) | **Renders fully** — verified live today: handshake, tool-result, hydration, autoResize all work |
| Claude iOS | HTML shell loads (statues) but data never paints — tool result never reaches the widget handler |
| Local spec-correct mock host | Renders fully, sends `size-changed` correctly |

The local mock + Claude desktop results prove the Claude widget code is correct under a spec-following host. The iOS blank is a host-delivery or handshake-completion problem on the phone, not a widget bug. Diagnosis path exists (see end).

---

## 1. Two hand-picked bridges for one "standard" — and the reason is unexplained

The whole point of going standard-only was one protocol, no forks. We now ship two different bridge implementations: the official `@modelcontextprotocol/ext-apps` runtime for Claude (393 KB) and a hand-rolled 873-byte shim for ChatGPT — because the official runtime "crashed" in ChatGPT and nobody root-caused why. That unexplained crash is load-bearing. If it's a bundling artifact (IIFE wrapping, inline-script size, a CSP interaction), the fix might be one line and both targets could share the official client. If it's a real ChatGPT bug, it should be filed upstream so it stops being our permanent fork.

**Severity: high (architectural drift). Ask: root-cause the ext-apps crash in ChatGPT before the fork calcifies.**

## 2. The ChatGPT shim is off-spec in three ways ChatGPT happens to tolerate

Against the ext-apps 2026-01-26 spec:

- `ui/initialize` sends a made-up `appInfo` field instead of the required `clientInfo` + `capabilities`.
- Host-initiated *requests* are silently ignored. `ui/resource-teardown` requires a response; a host that blocks on it will consider the app hung.
- No `ui/notifications/size-changed`, ever. The Claude bridge gets this via `autoResize`; the ChatGPT shim doesn't. Given the July-12 iOS renderer episode, an unsized widget on ChatGPT iOS is exactly the kind of thing that breaks silently.

"Standard-only" that doesn't implement the standard is the worst of both: we gave up the compatibility layer and didn't gain conformance.

**Severity: high. Ask: fix init params, answer teardown, send size-changed — or use the official client (see 1).**

## 3. Failure is silent by design

Two compounding behaviors:

- `hydrateToolResult(null)` returns without painting. A tool-result missing `structuredContent` produces a blank card with no message.
- `connect()` has no timeout. A host that never answers `ui/initialize` leaves the promise pending forever — `showBridgeError` only fires on *rejection*. Result: empty statues, no error, nothing to report. That is precisely the Claude iOS symptom, and we can't distinguish "no tool result" from "handshake hung" without plugging the phone into a Mac.

**Severity: high (it's why the iOS bug is undiagnosable from a screenshot). Ask: paint the empty-day default after a short timeout, and surface a one-line status when the bridge never connects or data never arrives.**

## 4. Dropping the `openai/*` extras was a product regression, not protocol hygiene

`openai/toolInvocation/invoking|invoked` ("Logging to Nexus…") and `openai/widgetDescription` have **no standard equivalent**. OpenAI's docs keep both namespaces by design — standard keys where equivalents exist, `openai/*` for ChatGPT-specific features, explicitly not deprecated. Removing them bought no purity and cost visible polish right before resubmission: the status line during tool calls and the widget description in the submission metadata.

**Severity: medium. Ask: reinstate the two `toolInvocation` strings and `widgetDescription`. This is not a fallback path — there is nothing they fall back *from*.**

## 5. The tests validate the code against itself

The lifecycle test's mock host mirrors the shim's own message shapes — it would pass even if ChatGPT rejected every one of them (it can't catch the `appInfo` bug because the mock accepts `appInfo`). And `widget-host-compat.regression-1.test.ts` asserts `not.toContain('"openai/')`, hard-coding a design ideology into CI: the moment we want a ChatGPT-specific key back (see 4), a test named "regression" fights us. Nothing in the suite encodes a *real host's* observed behavior, which is the only thing that has actually broken this week.

**Severity: medium. Ask: delete the `openai/` ban assertion; keep lifecycle tests but derive the mock host's shapes from the spec schema (`ext-apps` ships one), not from the shim.**

## 6. The `.replace()` injection is safe by luck

`fullWidgetHtml()` splices the bridge in with `String.replace(placeholder, MCP_APP_BRIDGE)`. Replacement strings treat `$&`, `$'`, `` $` `` specially; today's 873-byte shim happens to contain no `$`, so it works. The first bundler upgrade that emits one corrupts the widget script silently. The old code used concatenation for exactly this reason.

**Severity: low, one-line fix. Ask: `.replace(ph, () => MCP_APP_BRIDGE)`.**

## 7. The Claude build's no-InstantDB widget has an unverified edit path

Stripping the InstantDB runtime from the Claude document is a good call for boot weight. But in ChatGPT the post-edit repaint comes from the live subscription; on Claude an edit goes `callTool` → server write → …and the repaint depends on whatever the widget does with the call's return value. That path is untested on a real Claude host (today's desktop test only exercised initial hydration).

**Severity: medium, contained. Ask: one manual pass on Claude desktop — edit a meal from the card, confirm the card reflects it.**

## 8. Bridge request-id hygiene

The shim uses bare integer ids from 0 and treats *any* incoming message whose id is in its pending map as a response. A host-initiated request that happens to carry id `0` gets consumed as a reply. The old code prefixed ids (`nexus-1`). Trivial now, confusing forever when it bites.

**Severity: low. Ask: prefix the ids or (again) use the official client.**

## 9. Process: prod is running uncommitted code

Three deploys went out today from a dirty tree; nothing is committed or pushed. If this laptop dies, prod is unreproducible. Also the widget URI stayed `nexus-today-v13` across several behaviorally different deploys today — the cache-bust rule exists because stale widget HTML is one of Nexus's known failure modes.

**Severity: medium, zero-cost fix. Ask: commit + push the verified state now; bump the URI on the next behavioral change.**

---

## Claude iOS: what we know and the next step

Known-good: widget code (mock host + Claude desktop both render), `ui.domain` hash (verified: `9b68940b…` is the correct SHA-256 prefix for `https://claude-mcp.nexus.kushalsm.com/mcp`), OAuth, tool execution (the log succeeded; the text reply was right).

Unknown: whether the iOS host never completes `ui/initialize`, or completes it but never sends `ui/notifications/tool-result`. Objection 3 is why we can't tell from the outside.

Next step, per Anthropic's own troubleshooting doc: the iOS app renders the widget in a WKWebView that's inspectable from a Mac via Safari's Develop menu (Settings → Safari → Advanced → Web Inspector on the phone, then cable to the Mac). One inspection session answers which leg fails. Cheap insurance in parallel: the objection-3 fix (default paint + visible status) would make the card degrade gracefully on iOS instead of showing two statues and silence — worth shipping regardless of what the inspection finds. Claude's MCP Apps support on mobile is flagged Beta; if inspection shows the host simply never delivers the result, that's a bug report to Anthropic, not a Nexus fix.
