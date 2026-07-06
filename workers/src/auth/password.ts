// Email + password sign-in on top of InstantDB.
//
// InstantDB has no native passwords, so we store a PBKDF2 hash on the managed
// $users row (a custom optional attr) and mint an InstantDB session token via
// the admin API once the password checks out. This is the path we hand OpenAI
// reviewers: a plain email + password that logs in immediately, no code, no
// verification — exactly what the submission guidelines require.
import { adminDb, ensureFriendCode } from "../instant";
import type { NexusEnv } from "../types";

// The consent flow only needs the identity — the OAuth provider issues its own
// access/refresh tokens, and the widget's InstantDB token is minted per MCP
// session. So we never mint an InstantDB token on the sign-in path.
export interface PasswordLogin {
  userId: string;
  email: string;
}

export class AuthError extends Error {
  constructor(
    public code: "exists" | "no_account" | "no_password" | "bad_password" | "weak",
    message: string,
  ) {
    super(message);
    this.name = "AuthError";
  }
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

async function userByEmail(env: NexusEnv, email: string) {
  const res = await adminDb(env).query({ $users: { $: { where: { email } } } });
  return res.$users[0] as { id: string; email?: string; password_hash?: string } | undefined;
}

/**
 * Create a NEW account with a password. Refuses any email that already has a
 * $users row — even a passwordless (magic-code / Google) one. Signup proves
 * nothing about email ownership, so letting it attach a password to an
 * existing account would be an account takeover. Existing passwordless users
 * prove ownership via Google or the CLI's magic-code flow instead.
 */
export async function signUpWithPassword(
  env: NexusEnv,
  email: string,
  password: string,
): Promise<PasswordLogin> {
  if (password.length < 8) throw new AuthError("weak", "Password must be at least 8 characters.");
  const existing = await userByEmail(env, email);
  if (existing) {
    throw new AuthError("exists", "An account with this email already exists. Sign in instead.");
  }
  const db = adminDb(env);
  const hash = await hashPassword(password);
  // createToken auto-provisions the $users row for a new email (we don't keep
  // the token — the OAuth provider issues its own).
  await db.auth.createToken({ email });
  const user = await userByEmail(env, email);
  if (!user) throw new AuthError("no_account", "Could not create the account. Try again.");
  await db.transact([db.tx.$users[user.id]!.update({ password_hash: hash, created_at: Date.now() })]);
  await ensureFriendCode(db, user.id);
  return { userId: user.id, email: user.email ?? email };
}

/** Sign in with an existing password account. */
export async function signInWithPassword(
  env: NexusEnv,
  email: string,
  password: string,
): Promise<PasswordLogin> {
  const user = await userByEmail(env, email);
  if (!user) {
    throw new AuthError("no_account", "No account for this email. Create one below.");
  }
  if (!user.password_hash) {
    // Existing magic-code/Google account without a password. Don't nudge to
    // signup (it would be refused — see signUpWithPassword) and don't leak
    // which method they used; point at the ownership-proving path.
    throw new AuthError(
      "no_password",
      "This account has no password. Continue with Google instead.",
    );
  }
  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) throw new AuthError("bad_password", "Wrong email or password.");
  // No token mint and no friend-code touch here: the OAuth provider issues its
  // own tokens, the widget token is minted per MCP session, and friend codes
  // are assigned lazily on first friends-tool use. That leaves sign-in at a
  // single InstantDB round-trip (the lookup above) plus the PBKDF2 verify.
  return { userId: user.id, email: user.email ?? email };
}

/** True if this email already has a password set (drives signup-vs-signin UX). */
export async function hasPasswordAccount(env: NexusEnv, email: string): Promise<boolean> {
  const user = await userByEmail(env, email);
  return Boolean(user?.password_hash);
}
