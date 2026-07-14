// Zero-dependency static server for the harness. `npm run harness` → open
// http://localhost:8788/host.html
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";

const here = (p) => new URL(p, import.meta.url).pathname;
const types = { ".html": "text/html", ".mjs": "text/javascript", ".js": "text/javascript" };

createServer(async (req, res) => {
  const path = (req.url || "/").split("?")[0];
  const file = path === "/" ? "/host.html" : path;
  try {
    const body = await readFile(here("." + file));
    res.writeHead(200, { "content-type": types[extname(file)] || "application/octet-stream", "cache-control": "no-store" });
    res.end(body);
  } catch {
    res.writeHead(404); res.end("not found");
  }
}).listen(8788, () => console.log("harness at http://localhost:8788/host.html"));
