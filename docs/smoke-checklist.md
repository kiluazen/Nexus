# Nexus widget smoke checklist

Run after ANY change to the widget document, bridge, or tool/resource metadata.
One prompt per surface; the widget-bearing call must be the only tool call in
its turn (hosts drop or fold the card otherwise — see clarity page, case files).

Test prompt: "I just drank one glass of water, log it in Nexus as a zero-calorie
snack. Do not call any other tool."

| # | Surface | What to verify |
|---|---------|----------------|
| 1 | Local harness (`npm run harness` in workers/) | mounts · handshake logs · tool-result paints · `size-changed` grows AND shrinks · theme buttons flip the card |
| 2 | ChatGPT web | card renders · theme matches ChatGPT's · editor opens/closes · save round-trips |
| 3 | ChatGPT iOS | card renders at all (historically the flakiest surface) |
| 4 | Claude web | card renders · theme matches · editor close leaves statues at card foot (frame ratchet is expected, not a bug) |
| 5 | Claude iOS | card renders + data hydrates (WKWebView; inspect via Mac Safari → Develop if blank) |

## Deploy rules (learned the hard way, 2026-07-14)

1. **Bump `__WIDGET_URI__` on every behavioral change** and move the old value
   to `__WIDGET_URI_PREV__` (both stay registered — hosts cache tool metadata
   and keep requesting the old URI; an unregistered old URI = Claude's
   "Unable to reach Nexus Claude").
2. **Claude caches tool metadata at connector-sync time**, not per chat. After
   a URI bump: Settings → Connectors → Nexus Claude → ⋯ → **Refresh tools
   list**. (ChatGPT's equivalent is delete + recreate the app; its Refresh
   does not rebuild the tool→widget binding.)
3. **Claude web ratchets iframe height** — grows on `size-changed`, never
   shrinks within a turn. The widget still reports true sizes (hosts that
   honor shrink get it); the statues are `position: fixed` to the frame bottom
   so ratchet excess reads as intentional space.
4. Deploy → verify (this list) → commit → push, same hour.
