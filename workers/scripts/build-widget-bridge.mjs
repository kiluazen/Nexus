import { build } from "esbuild";

const shared = {
  bundle: true,
  format: "iife",
  platform: "browser",
  target: ["safari16"],
  minify: true,
  legalComments: "none",
};

await Promise.all([
  build({
    ...shared,
    entryPoints: [new URL("../widget-build/mcp-app-bridge.ts", import.meta.url).pathname],
    outfile: new URL("../vendor/mcp-app-bridge.iife.txt", import.meta.url).pathname,
  }),
  build({
    ...shared,
    entryPoints: [new URL("../widget-build/mcp-app-bridge-claude.ts", import.meta.url).pathname],
    outfile: new URL("../vendor/mcp-app-bridge-claude.iife.txt", import.meta.url).pathname,
  }),
]);
