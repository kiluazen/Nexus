# nexus-widget-skybridge

A **trial** port of the Nexus "today" card to the [Skybridge](https://github.com/alpic-ai/skybridge)
React framework — to compare the dev experience against the raw HTML widget in
`../workers/src/widget/today-html.ts` (and against the raw Vite+TS `loupe` app).

This is a spike, not production. It renders from a **mock day** returned by the
server (front-loaded into `structuredContent`), so it runs standalone with no
InstantDB / auth wiring.

## Run

```bash
npm install
npm run dev        # DevTools UI at http://localhost:3000/ , MCP at /mcp
```

Click **Run** on `nexus_view_today` in the DevTools sidebar to render the card.

## What's here

| File | Role |
|---|---|
| `src/server.ts` | MCP server: `nexus_view_today` (returns mock day) + `nexus_update_entry` (stub). `registerTool({ view: { component: "nexus-today" }})` links tool → view. |
| `src/views/nexus-today.tsx` | The React card. Hooks: `useToolInfo` (front-loaded data), `useViewState` (persisted Food/Workout toggle + selection), `useCallTool` (save), `useLayout` (host theme). |
| `src/helpers.ts` | `generateHelpers<AppType>()` → typed `useToolInfo` / `useCallTool`. |
| `src/index.css` | Ported Nexus styles (cobalt accent, rings, bars). Theming keyed on `data-theme` (host) with `prefers-color-scheme` fallback. |

## Two changes made in this trial

1. **Food/Workout toggle → icons** — `Flame` (calories) + `Dumbbell` (workout)
   from `lucide-react`, replacing the old text segmented control.
2. **Editor × close** — a pressable `X` icon on the editor box that dismisses it
   (`useViewState.editorOpen = false`).

## Mapping to production (when we cut over)

The submission pins tool metadata, CSP domains, and the base MCP URL — NOT the
widget implementation (read live at runtime). So this migration is
submission-safe **if**:

- tool names/schemas stay identical to `../workers`,
- CSP `connectDomains` stays `api.instantdb.com` (+wss),
- assets are **self-bundled** (no new resource domains / CDN),
- the base MCP URL stays `https://mcp.nexus.kushalsm.com`.

Production still needs: InstantDB live-sync (`useToolInfo` output is the initial
paint; the live query hydrates on top), the widget token in `_meta`, and the
real tool handlers.
