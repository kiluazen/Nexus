import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";

export interface NexusEnv extends Cloudflare.Env {
  OAUTH_PROVIDER: OAuthHelpers;
  SUPABASE_URL: string;
  SUPABASE_PUBLISHABLE_KEY: string;
}

export interface NexusProps extends Record<string, unknown> {
  userId: string;
  email: string;
  displayName: string;
}
