import type { NexusEnv } from "../types";
import { displayNameFromEmail } from "../instant";
import { signInWithPassword, signUpWithPassword, AuthError } from "../auth/password";
import { isCodeLocked, recordCodeFailure, clearCodeFailures } from "../lib/attempts";
import { loadParsedAuthRequest } from "./authorize";

// The consent page signs in with email + password (or Google, handled in
// auth/google.ts). Password is the credential we hand OpenAI reviewers: it
// logs in immediately with no email code, no verification step. Magic codes
// still exist for the CLI on /api/v1/auth/* — just not on this page.
interface DecisionBody {
  nonce: string;
  action: "signin" | "signup" | "deny";
  email?: string;
  password?: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ACTIONS = ["signin", "signup", "deny"];

export async function handleDecision(req: Request, env: NexusEnv): Promise<Response> {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }
  let body: DecisionBody;
  try {
    body = await req.json<DecisionBody>();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  if (!body.nonce || !ACTIONS.includes(body.action)) {
    return Response.json({ error: "missing_nonce_or_action" }, { status: 400 });
  }

  // Peek (don't consume): a wrong password must not burn the consent stash, so
  // the user can retry. It's deleted only on deny or a successful sign-in.
  const parsed = await loadParsedAuthRequest(env, body.nonce, { consume: false });
  if (!parsed) {
    return Response.json(
      { error: "This sign-in expired. Go back and reconnect." },
      { status: 410 },
    );
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
    return Response.json({ error: "Enter your password." }, { status: 400 });
  }

  // Reuse the magic-code brute-force lock (keyed by email) for password tries.
  if (await isCodeLocked(env, email)) {
    return Response.json(
      { error: "Too many attempts. Wait a minute and try again." },
      { status: 429 },
    );
  }

  let login;
  try {
    login =
      body.action === "signup"
        ? await signUpWithPassword(env, email, password)
        : await signInWithPassword(env, email, password);
  } catch (e) {
    if (e instanceof AuthError) {
      // Only credential failures count toward the lock; "exists"/"weak" are
      // user-fixable form errors, not guessing attempts.
      if (e.code === "bad_password" || e.code === "no_account" || e.code === "no_password") {
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
    metadata: {
      signed_in_via: `password_${body.action}`,
      issued_at: Date.now(),
    },
  });
  return Response.json({ redirect_to: redirectTo });
}
