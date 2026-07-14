# Nexus widget smoke checklist

Run after ANY change to the widget document, bridge, or tool/resource metadata.
Test both a direct mutation and a read-then-mutate sequence. Correctness is
never constrained to work around a host's card-placement or rendering bug.

Direct prompt: "I just drank one glass of water; log it in Nexus as a
zero-calorie snack."

Sequenced prompt: "First check today's Nexus history for duplicates, then log
one glass of water as a zero-calorie snack if it is not already there."

| # | Surface | What to verify |
|---|---------|----------------|
| 1 | Local harness (`npm run harness` in workers/) | mounts · handshake logs · tool-result paints · `size-changed` grows AND shrinks · theme buttons flip the card |
| 2 | ChatGPT web | direct card renders · sequenced mutation is truthful · editor save round-trips with state_version |
| 3 | ChatGPT iOS | direct card renders · sequenced mutation succeeds even if the host mishandles its card |
| 4 | Claude web | direct + sequenced mutations succeed · theme matches · stale editor is rejected |
| 5 | Claude iOS | direct + sequenced mutations succeed · widget hydrates when host presents it |

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
