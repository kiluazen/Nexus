export default {
  async fetch(request, env) {
    // Static assets are served directly by Cloudflare (see public/_headers
    // for security headers) so Range requests on video/audio work natively.
    // This Worker only runs as a fallback for paths that don't match any asset.
    return new Response("Not found", { status: 404 });
  }
};
