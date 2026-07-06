// Email + password sign-in on top of InstantDB.
//
// Two security properties this file enforces:
//  1. The PBKDF2 hash lives in `passwordCredentials`, a namespace denied to
//     every client token (instant.perms.ts). $users is client-readable, so the
//     hash must never sit there. Only the admin client (here) touches it.
//  2. Creating a password account REQUIRES proving email ownership: signup is
//     two steps — send a magic code, then verify it — and the password is only
//     stored after the code checks out. This blocks pre-account-hijacking (you
//     can't set a password on an email you don't control). Sign-IN stays a
//     single code-free step, which is the path we hand OpenAI reviewers.
import { adminDb, ensureFriendCode, sendLoginCode, verifyLoginCode, id as newId } from "../instant";
import type { NexusEnv } from "../types";

export class AuthError extends Error {
  constructor(
    public code: "exists" | "no_account" | "no_password" | "bad_password" | "bad_code" | "weak",
    message: string,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

// The consent flow only needs the identity — the OAuth provider issues its own
// access/refresh tokens, and the widget's InstantDB token is minted per MCP
// session. So we never mint an InstantDB token on the sign-in path.
export interface PasswordLogin {
  userId: string;
  email: string;
}

// Cloudflare Workers' WebCrypto caps PBKDF2 at 100k iterations (higher throws
// NotSupportedError). That's the platform max, so we use it. The count is
// stored in each hash, so verify honors whatever a hash was created with.
const PBKDF2_ITERS = 100_000;

function b64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
function fromB64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password) as BufferSource,
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt as BufferSource, iterations, hash: "SHA-256" },
    key,
    256,
  );
  return new Uint8Array(bits);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(password, salt, PBKDF2_ITERS);
  return `pbkdf2$${PBKDF2_ITERS}$${b64(salt)}$${b64(hash)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
  const iterations = parseInt(parts[1]!, 10);
  const salt = fromB64(parts[2]!);
  const expected = fromB64(parts[3]!);
  const actual = await derive(password, salt, iterations);
  // constant-time compare
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual[i]! ^ expected[i]!;
  return diff === 0;
}

interface UserCred {
  id: string;
  email?: string;
  credId?: string;
  hash?: string;
}

/** Look up a user by email and the hash from their locked-down credential row. */
async function userWithCred(env: NexusEnv, email: string): Promise<UserCred | undefined> {
  const res = await adminDb(env).query({
    $users: { $: { where: { email } }, passwordCredential: {} },
  });
  const u = res.$users[0] as
    | { id: string; email?: string; passwordCredential?: unknown }
    | undefined;
  if (!u) return undefined;
  const link = u.passwordCredential;
  const cred = (Array.isArray(link) ? link[0] : link) as
    | { id: string; hash?: string }
    | undefined;
  return { id: u.id, email: u.email, credId: cred?.id, hash: cred?.hash };
}

/** Sign in with an existing password account (single, code-free step). */
export async function signInWithPassword(
  env: NexusEnv,
  email: string,
  password: string,
): Promise<PasswordLogin> {
  const u = await userWithCred(env, email);
  if (!u) {
    throw new AuthError("no_account", "No account for this email. Create one below.");
  }
  if (!u.hash) {
    // Existing magic-code/Google account with no password. Don't leak which
    // method they used; point at the ownership-proving paths.
    throw new AuthError(
      "no_password",
      "This account has no password yet. Continue with Google, or create a password below.",
    );
  }
  const ok = await verifyPassword(password, u.hash);
  if (!ok) throw new AuthError("bad_password", "Wrong email or password.");
  return { userId: u.id, email: u.email ?? email };
}

/**
 * Signup step 1: validate and email a verification code. Nothing is created or
 * stored yet — the code is what proves the person controls the address, so no
 * password can be attached to an email you don't own.
 */
export async function startPasswordSignup(
  env: NexusEnv,
  email: string,
  password: string,
): Promise<void> {
  if (password.length < 8) throw new AuthError("weak", "Password must be at least 8 characters.");
  const u = await userWithCred(env, email);
  if (u?.hash) {
    throw new AuthError("exists", "An account with this email already exists. Sign in instead.");
  }
  await sendLoginCode(env, email);
}

/**
 * Signup step 2: verify the code (proves ownership and provisions/returns the
 * $users row), then store the password in the admin-only credential namespace.
 * Works for a brand-new email and for a legacy passwordless account setting a
 * password for the first time.
 */
export async function completePasswordSignup(
  env: NexusEnv,
  email: string,
  password: string,
  code: string,
): Promise<PasswordLogin> {
  if (password.length < 8) throw new AuthError("weak", "Password must be at least 8 characters.");
  let login;
  try {
    login = await verifyLoginCode(env, email, code); // checkMagicCode: throws on bad code
  } catch {
    throw new AuthError("bad_code", "That code didn't match. Check your email and try again.");
  }
  const existing = await userWithCred(env, email);
  if (existing?.hash) {
    // Raced another signup, or already had a password — don't clobber it.
    throw new AuthError("exists", "An account with this email already exists. Sign in instead.");
  }
  const db = adminDb(env);
  const hash = await hashPassword(password);
  const credId = existing?.credId ?? newId();
  await db.transact([
    db.tx.passwordCredentials[credId]!
      .update({ hash, updated_at: Date.now() })
      .link({ user: login.userId }),
  ]);
  await ensureFriendCode(db, login.userId);
  return { userId: login.userId, email: login.email };
}
