// Builds the full widget document the workers serve — app fragment + the one
// bridge bundle — into harness/out/widget.html for the local spec host.
// (No InstantDB append: the harness exercises the MCP Apps path, which is the
// only data path on Claude and the boot path everywhere.)
import { build } from "esbuild";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const here = (p) => new URL(p, import.meta.url).pathname;

await build({
  entryPoints: [here("../src/widget/today-html.ts")],
  outfile: here("./out/today-html.bundle.mjs"),
  bundle: true,
  format: "esm",
  platform: "neutral",
  logLevel: "warning",
});

const { widgetHtml } = await import(here("./out/today-html.bundle.mjs"));
const bridge = readFileSync(here("../vendor/mcp-app-bridge.iife.txt"), "utf8");
const html = widgetHtml().replace("/*__NEXUS_MCP_APP_BRIDGE__*/", () => bridge);
mkdirSync(here("./out"), { recursive: true });
writeFileSync(here("./out/widget.html"), html);
console.log(`harness/out/widget.html — ${html.length} bytes`);
