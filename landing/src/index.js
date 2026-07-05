const securityHeaders = {
  "content-security-policy":
    "default-src 'self'; img-src 'self' data:; style-src 'self'; font-src 'self'; script-src 'self'; base-uri 'self'; form-action 'none'; frame-ancestors 'none'",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=()"
};

export default {
  async fetch(request, env) {
    const response = await env.ASSETS.fetch(request);
    const headers = new Headers(response.headers);

    for (const [key, value] of Object.entries(securityHeaders)) {
      headers.set(key, value);
    }

    if (response.headers.get("content-type")?.includes("text/html")) {
      headers.set("cache-control", "public, max-age=300");
    }

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers
    });
  }
};
