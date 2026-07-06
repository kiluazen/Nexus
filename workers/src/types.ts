import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";

// INSTANT_APP_ID (var) and INSTANT_ADMIN_TOKEN (secret) come from the
// generated Cloudflare.Env — see wrangler.jsonc and .dev.vars.
export interface NexusEnv extends Cloudflare.Env {
  OAUTH_PROVIDER: OAuthHelpers;
  // "Sign in with Google" client, set as Worker secrets (so they're absent
  // from the generated types). When either is unset, the Google button simply
  // doesn't appear on the consent page — email+password still works.
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
}

export interface NexusProps extends Record<string, unknown> {
  /** InstantDB $users id — the single identity across ChatGPT, CLI, Codex. */
  userId: string;
  email: string;
  displayName: string;
}
