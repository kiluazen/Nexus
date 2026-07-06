import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";

// INSTANT_APP_ID (var) and INSTANT_ADMIN_TOKEN (secret) come from the
// generated Cloudflare.Env — see wrangler.jsonc and .dev.vars.
export interface NexusEnv extends Cloudflare.Env {
  INSTANT_APP_ID: string;
  INSTANT_ADMIN_TOKEN: string;
  OAUTH_PROVIDER: OAuthHelpers;
  REVIEWER_LOGIN_EMAIL?: string;
  REVIEWER_LOGIN_PASSWORD?: string;
}

export interface NexusProps extends Record<string, unknown> {
  /** InstantDB $users id — the single identity across ChatGPT, CLI, Codex. */
  userId: string;
  email: string;
  displayName: string;
}
