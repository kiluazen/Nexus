import { OAuthProvider } from "@cloudflare/workers-oauth-provider";
import defaultHandler from "./handlers/default";
import restApi from "./handlers/rest-api";
import { NexusMcpAgent } from "./mcp";
import { userFromRefreshToken, displayNameFromEmail } from "./instant";
import type { NexusEnv } from "./types";

export { NexusMcpAgent };

// The OAuthProvider config is built at module load, before env is available,
// so the canonical host comes from a build-time define (`__BASE_URL__`, set
// per-environment in wrangler.jsonc). Prod and staging each advertise their
// own resource identifier. Fallback keeps tests and bare runs working.
declare const __BASE_URL__: string | undefined;
const BASE = typeof __BASE_URL__ !== "undefined" ? __BASE_URL__ : "https://mcp.nexus.kushalsm.com";

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
  allowPlainPKCE: false,
  resourceMetadata: {
    // Canonical resource identifier, advertised to all clients regardless of
    // which protected-resource URL variant they fetch. See
    // docs/mcp-path-trailing-slash.md — must remain the no-slash form.
    resource: `${BASE}/mcp`,
    authorization_servers: [BASE],
    scopes_supported: ["openid", "profile", "email"],
    bearer_methods_supported: ["header"],
    resource_name: "Nexus",
  },
  // Allows the access tokens we issue (resource = ".../mcp") to be presented
  // when clients hit ".../mcp/" — origin-only matching mode handles the
  // trailing-slash edge case cleanly.
  resourceMatchOriginOnly: true,

  // The nexus CLI logs in with an email magic code against
  // /api/v1/auth/{request_code,verify_code} and stores the InstantDB refresh
  // token it gets back. That token is presented as a bearer on API calls;
  // this callback resolves it to the same identity the OAuth flow issues.
  async resolveExternalToken({ token, env }) {
    const user = await userFromRefreshToken(env as NexusEnv, token);
    if (!user) return null;
    const email = user.email ?? "";
    return {
      props: {
        userId: user.id,
        email,
        displayName: displayNameFromEmail(email),
      },
    };
  },
});
