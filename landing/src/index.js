// Most static assets are served directly by Cloudflare (see public/_headers
// for security headers). This Worker runs first only for /assets/*.mp4
// (see wrangler.jsonc `run_worker_first`) so it can honor HTTP Range
// requests — Cloudflare's asset server returns 200 without Accept-Ranges,
// which makes the browser treat the video as non-seekable and disables
// timeline scrubbing. Everything else falls through to a 404.
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (/^\/assets\/[^?]+\.mp4$/.test(url.pathname)) {
      return serveVideoWithRanges(request, env, url);
    }

    return new Response("Not found", { status: 404 });
  },
};

async function serveVideoWithRanges(request, env, url) {
  // Pull the raw bytes from the static-asset binding.
  const asset = await env.ASSETS.fetch(new Request(url.origin + url.pathname));
  if (!asset.ok) return new Response("Not found", { status: 404 });

  const body = await asset.arrayBuffer();
  const total = body.byteLength;
  const contentType = asset.headers.get("content-type") || "video/mp4";

  const headers = {
    "content-type": contentType,
    "accept-ranges": "bytes",
    "cache-control": "public, max-age=31536000, immutable",
    "x-content-type-options": "nosniff",
  };

  const rangeHeader = request.headers.get("Range");
  const match = rangeHeader && /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());

  // No (or unparseable) Range -> full 200 response, but still advertise ranges.
  if (!match || (match[1] === "" && match[2] === "")) {
    return new Response(request.method === "HEAD" ? null : body, {
      status: 200,
      headers: { ...headers, "content-length": String(total) },
    });
  }

  let start = match[1] === "" ? null : parseInt(match[1], 10);
  let end = match[2] === "" ? null : parseInt(match[2], 10);

  if (start === null) {
    // Suffix range: bytes=-N -> final N bytes.
    start = Math.max(0, total - end);
    end = total - 1;
  } else if (end === null || end >= total) {
    end = total - 1;
  }

  if (start > end || start >= total) {
    return new Response("Range Not Satisfiable", {
      status: 416,
      headers: { ...headers, "content-range": `bytes */${total}` },
    });
  }

  const chunk = body.slice(start, end + 1);
  return new Response(request.method === "HEAD" ? null : chunk, {
    status: 206,
    headers: {
      ...headers,
      "content-range": `bytes ${start}-${end}/${total}`,
      "content-length": String(chunk.byteLength),
    },
  });
}
