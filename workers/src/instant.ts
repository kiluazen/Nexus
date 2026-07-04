// InstantDB layer for Nexus. Admin SDK only — the Worker is the sole holder of
// the admin token. Two access modes, on purpose:
//
//  - userDb(env, email): permission-scoped via asUser(). Reads run under the
//    CEL rules in instant.perms.ts, so a forgotten filter can never leak
//    another user's rows. Default for anything answering "show me my data".
//  - adminDb(env): bypasses permissions. Reserved for writes where the Worker
//    itself sets the owner link from authenticated props, and for
//    friendship-checked reads of a friend's history.
import { init, id } from "@instantdb/admin";
import schema from "../../instant.schema";
import type { NexusEnv } from "./types";

export function adminDb(env: NexusEnv) {
  return init({ appId: env.INSTANT_APP_ID, adminToken: env.INSTANT_ADMIN_TOKEN, schema });
}

export function userDb(env: NexusEnv, email: string) {
  return adminDb(env).asUser({ email });
}

export type AdminDb = ReturnType<typeof adminDb>;

/**
 * InstaQL's generated types can't express or/and combinators with link
 * dot-paths yet; the few queries that need them go through this untyped door
 * and cast rows at the edge.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function rawQuery(
  db: { query: (q: never) => Promise<unknown> },
  query: unknown,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  return db.query(query as never);
}

// --- email OTP (magic code) --------------------------------------------------
// The flow every surface shares: we email a 6-digit code, the caller types it
// back. ChatGPT goes through the OAuth consent page; the CLI and coding agents
// hit /api/v1/auth/{request_code,verify_code} with their own inbox.

export async function sendLoginCode(env: NexusEnv, email: string): Promise<void> {
  await adminDb(env).auth.sendMagicCode(email);
}

export interface VerifiedLogin {
  userId: string;
  email: string;
  /** Long-lived InstantDB refresh token — the CLI persists this as its bearer. */
  refreshToken: string;
}

export async function verifyLoginCode(
  env: NexusEnv,
  email: string,
  code: string,
): Promise<VerifiedLogin> {
  const db = adminDb(env);
  const { user } = await db.auth.checkMagicCode(email, code);
  await ensureFriendCode(db, user.id);
  return { userId: user.id, email: user.email ?? email, refreshToken: user.refresh_token };
}

/** Resolve a stored InstantDB refresh token back to a user (CLI bearer path). */
export async function userFromRefreshToken(env: NexusEnv, token: string) {
  try {
    return await adminDb(env).auth.verifyToken(token);
  } catch {
    return null;
  }
}

/** Invalidate a single refresh token (server-side logout). */
export async function revokeToken(env: NexusEnv, refreshToken: string): Promise<void> {
  await adminDb(env).auth.signOut({ refresh_token: refreshToken });
}

/** Mint a short-use token the ChatGPT widget can hand to signInWithToken(). */
export async function mintWidgetToken(env: NexusEnv, email: string): Promise<string> {
  return adminDb(env).auth.createToken({ email });
}

// --- friend codes ------------------------------------------------------------

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export async function ensureFriendCode(db: AdminDb, userId: string): Promise<string> {
  const res = await db.query({ $users: { $: { where: { id: userId } } } });
  const me = res.$users[0];
  if (me?.friend_code) return me.friend_code;

  for (let attempt = 0; attempt < 10; attempt++) {
    let suffix = "";
    for (let i = 0; i < 4; i++) {
      suffix += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]!;
    }
    const code = `NEXUS-${suffix}`;
    const clash = await db.query({ $users: { $: { where: { friend_code: code } } } });
    if (clash.$users.length === 0) {
      await db.transact([
        db.tx.$users[userId]!.update({ friend_code: code, created_at: Date.now() }),
      ]);
      return code;
    }
  }
  throw new Error("Failed to generate a unique friend code.");
}

export function displayNameFromEmail(email: string): string {
  const local = email.split("@")[0] ?? email;
  return local.length > 0 ? local : email;
}

export { id };
