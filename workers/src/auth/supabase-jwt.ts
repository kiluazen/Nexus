import { jwtVerify, createRemoteJWKSet, type JWTPayload } from "jose";
import type { NexusEnv } from "../types";

const JWKS_CACHE_KEY = "supabase:jwks";
const JWKS_TTL_SECONDS = 60 * 60 * 24; // 24h

interface CachedJwks {
  keys: { kid: string; kty: string; alg?: string; [k: string]: unknown }[];
  fetched_at: number;
}

let _remote: ReturnType<typeof createRemoteJWKSet> | null = null;

function remoteJwks(env: NexusEnv) {
  if (_remote) return _remote;
  _remote = createRemoteJWKSet(new URL(`${env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`));
  return _remote;
}

export interface SupabaseClaims extends JWTPayload {
  sub: string;
  email?: string;
  name?: string;
  preferred_username?: string;
  app_metadata?: { provider?: string };
  user_metadata?: { name?: string; full_name?: string; avatar_url?: string };
}

export async function verifySupabaseJwt(
  token: string | undefined | null,
  env: NexusEnv,
): Promise<SupabaseClaims | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, remoteJwks(env), {
      issuer: `${env.SUPABASE_URL}/auth/v1`,
    });
    if (typeof payload.sub !== "string" || payload.sub.length === 0) return null;
    return payload as SupabaseClaims;
  } catch {
    return null;
  }
}

export function displayNameFromClaims(claims: SupabaseClaims): string {
  return (
    claims.user_metadata?.full_name ||
    claims.user_metadata?.name ||
    claims.name ||
    claims.preferred_username ||
    claims.email ||
    "Nexus user"
  );
}
