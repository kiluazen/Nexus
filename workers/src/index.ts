import { OAuthProvider } from "@cloudflare/workers-oauth-provider";
import defaultHandler from "./handlers/default";
import restApi from "./handlers/rest-api";
import { NexusMcpAgent } from "./mcp";
import { verifySupabaseJwt, displayNameFromClaims } from "./auth/supabase-jwt";
import type { NexusEnv } from "./types";

export { NexusMcpAgent };

// Base URL is read at request time from env.BASE_URL inside handlers; the lib
// only needs path-relative endpoint config.
export default new OAuthProvider({
  apiHandlers: {
    "/mcp":  NexusMcpAgent.serve("/mcp"),
    "/mcp/": NexusMcpAgent.serve("/mcp/"),
    "/sse":  NexusMcpAgent.serveSSE("/sse"),
    "/api/v1/me":      restApi,
    "/api/v1/log":     restApi,
    "/api/v1/history": restApi,
    "/api/v1/update":  restApi,
    "/api/v1/friends": restApi,
  },
  defaultHandler,
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/token",
  clientRegistrationEndpoint: "/register",
  scopesSupported: ["openid", "profile", "email"],
  resourceMetadata: {
    // Canonical resource identifier, advertised to all clients regardless of
    // which protected-resource URL variant they fetch. See
    // docs/mcp-path-trailing-slash.md — must remain the no-slash form.
    resource: "https://mcp.nexus.kushalsm.com/mcp",
    authorization_servers: ["https://mcp.nexus.kushalsm.com"],
    scopes_supported: ["openid", "profile", "email"],
    bearer_methods_supported: ["header"],
    resource_name: "Nexus",
  },
  // Allows the access tokens we issue (resource = ".../mcp") to be presented
  // when clients hit ".../mcp/" — origin-only matching mode handles the
  // trailing-slash edge case cleanly.
  resourceMatchOriginOnly: true,

  // The nexus CLI does its OWN PKCE flow against Supabase Auth (skipping
  // our OAuth surface entirely) and presents the resulting Supabase JWT as
  // a bearer. This callback lets those tokens through after JWKS verify.
  async resolveExternalToken({ token, env }) {
    const claims = await verifySupabaseJwt(token, env as NexusEnv);
    if (!claims) return null;
    return {
      props: {
        userId: claims.sub,
        email: claims.email ?? "",
        displayName: displayNameFromClaims(claims),
      },
    };
  },
});
