// Failed-magic-code attempt guard. A 6-digit code is only ~1M values, so
// without a cap an attacker could brute-force it inside the code's lifetime.
// We count failures per email in KV and lock further attempts after MAX until
// the window expires; a fresh code request is then required.
import type { NexusEnv } from "../types";

const MAX_ATTEMPTS = 5;
const WINDOW_TTL = 60 * 10; // matches the ~10-minute code lifetime

function key(email: string): string {
  return `fail:code:${email}`;
}

/** True if this email is locked out right now. */
export async function isCodeLocked(env: NexusEnv, email: string): Promise<boolean> {
  const raw = await env.NEXUS_CACHE.get(key(email));
  return raw != null && Number(raw) >= MAX_ATTEMPTS;
}

/** Record a failed verify. */
export async function recordCodeFailure(env: NexusEnv, email: string): Promise<void> {
  const raw = await env.NEXUS_CACHE.get(key(email));
  const next = (raw ? Number(raw) : 0) + 1;
  await env.NEXUS_CACHE.put(key(email), String(next), { expirationTtl: WINDOW_TTL });
}

/** Clear the counter after a successful sign-in. */
export async function clearCodeFailures(env: NexusEnv, email: string): Promise<void> {
  await env.NEXUS_CACHE.delete(key(email));
}
