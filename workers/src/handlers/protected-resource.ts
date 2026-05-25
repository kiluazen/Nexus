import type { NexusEnv } from "../types";

export function handleProtectedResource(req: Request, env: NexusEnv): Response | null {
  const { pathname } = new URL(req.url);
  // The library serves /.well-known/oauth-protected-resource itself.
  // We add the path-suffixed variants required by RFC 9728 §3.1 fallback
  // discovery, in lockstep with docs/mcp-path-trailing-slash.md.
  if (
    pathname === "/.well-known/oauth-protected-resource/mcp" ||
    pathname === "/.well-known/oauth-protected-resource/mcp/"
  ) {
    if (req.method === "OPTIONS") return new Response(null, { status: 204 });
    const base = env.BASE_URL.replace(/\/$/, "");
    return Response.json(
      {
        resource: `${base}/mcp`,
        authorization_servers: [base],
        scopes_supported: ["openid", "profile", "email"],
        bearer_methods_supported: ["header"],
        resource_name: "Nexus",
      },
      { headers: { "cache-control": "public, max-age=3600" } },
    );
  }
  return null;
}
