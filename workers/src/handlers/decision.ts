import type { NexusEnv } from "../types";
import { displayNameFromEmail } from "../instant";
import {
  signInWithPassword,
  startPasswordSignup,
  completePasswordSignup,
  AuthError,
} from "../auth/password";
import { isCodeLocked, recordCodeFailure, clearCodeFailures } from "../lib/attempts";
import { loadParsedAuthRequest } from "./authorize";

// The consent page signs in with email + password (or Google, in auth/google.ts).
// Sign-IN is one code-free step — the path we hand OpenAI reviewers. Sign-UP is
// two steps (email a code, then verify it + set the password) so a password can
// only ever be attached to an email the person controls.
interface DecisionBody {
  nonce: string;
  action: "signin" | "signup_start" | "signup_verify" | "deny";
  email?: string;
  password?: string;
  code?: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ACTIONS = ["signin", "signup_start", "signup_verify", "deny"];

export async function handleDecision(req: Request, env: NexusEnv): Promise<Response> {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  let body: DecisionBody;
  try {
    body = await req.json<DecisionBody>();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!body.nonce || !ACTIONS.includes(body.action)) {
    return Response.json({ error: "missing_nonce_or_action" }, { status: 400 });
  }

  // Peek (don't consume): a wrong password/code must not burn the consent stash,
  // so the user can retry. It's deleted only on deny or a successful sign-in.
  const parsed = await loadParsedAuthRequest(env, body.nonce, { consume: false });
  if (!parsed) {
    return Response.json({ error: "This sign-in expired. Go back and reconnect." }, { status: 410 });
  }

  if (body.action === "deny") {
    await env.NEXUS_CACHE.delete(`consent:${body.nonce}`);
    const u = new URL(parsed.redirectUri);
    u.searchParams.set("error", "access_denied");
    if (parsed.state) u.searchParams.set("state", parsed.state);
    return Response.json({ redirect_to: u.toString() });
  }

  const email = (body.email ?? "").trim().toLowerCase();
  if (!EMAIL_RE.test(email)) {
    return Response.json({ error: "Enter a valid email address." }, { status: 400 });
  }
  const password = body.password ?? "";
  if (!password) {
    return Response.json({ error: "Enter a password." }, { status: 400 });
  }

  // --- Signup step 1: email a verification code (no account created yet) ------
  if (body.action === "signup_start") {
    const rlKey = `rl:code:${email}`;
    if (await env.NEXUS_CACHE.get(rlKey)) {
      return Response.json({ error: "Hang on a moment before requesting another code." }, { status: 429 });
    }
    try {
      await startPasswordSignup(env, email, password);
    } catch (e) {
      if (e instanceof AuthError) {
        const status = e.code === "exists" ? 409 : 400;
        return Response.json({ error: e.message, code: e.code }, { status });
      }
      console.error("startPasswordSignup failed", e);
      return Response.json({ error: "Could not send the code. Try again." }, { status: 502 });
    }
    await env.NEXUS_CACHE.put(rlKey, "1", { expirationTtl: 60 });
    return Response.json({ code_sent: true });
  }

  // --- Sign-in and signup step 2 both verify a credential, then complete ------
  if (await isCodeLocked(env, email)) {
    return Response.json(
      { error: "Too many attempts. Wait about 10 minutes and try again." },
      { status: 429 },
    );
  }

  let login;
  try {
    if (body.action === "signin") {
      login = await signInWithPassword(env, email, password);
    } else {
      const code = (body.code ?? "").trim();
      if (!/^\d{6}$/.test(code)) {
        return Response.json({ error: "Enter the 6-digit code from your email." }, { status: 400 });
      }
      login = await completePasswordSignup(env, email, password, code);
    }
  } catch (e) {
    if (e instanceof AuthError) {
      // Only a wrong password or wrong code (a real guess) counts toward the
      // lock; no_account/no_password/exists/weak are mistakes, not guesses.
      if (e.code === "bad_password" || e.code === "bad_code") {
        await recordCodeFailure(env, email);
      }
      const status = e.code === "exists" ? 409 : e.code === "weak" ? 400 : 401;
      return Response.json({ error: e.message, code: e.code }, { status });
    }
    console.error("password auth failed", e);
    return Response.json({ error: "Something went wrong. Try again." }, { status: 500 });
  }

  await clearCodeFailures(env, email);
  await env.NEXUS_CACHE.delete(`consent:${body.nonce}`);

  const props = {
    userId: login.userId,
    email: login.email,
    displayName: displayNameFromEmail(login.email),
  };
  const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
    request: parsed,
    userId: login.userId,
    scope: parsed.scope,
    props,
    metadata: { signed_in_via: `password_${body.action}`, issued_at: Date.now() },
  });
  return Response.json({ redirect_to: redirectTo });
}
