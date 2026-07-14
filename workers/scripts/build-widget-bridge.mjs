import { build } from "esbuild";

// One bridge for every host — see widget-build/mcp-app-bridge.ts.
await build({
  entryPoints: [new URL("../widget-build/mcp-app-bridge.ts", import.meta.url).pathname],
  outfile: new URL("../vendor/mcp-app-bridge.iife.txt", import.meta.url).pathname,
  bundle: true,
  format: "iife",
  platform: "browser",
  target: ["safari16"],
  minify: true,
  legalComments: "none",
});
