import type { NexusEnv } from "../types";
import {
  createReviewerLogin,
  displayNameFromEmail,
  sendLoginCode,
  verifyLoginCode,
} from "../instant";
import { isCodeLocked, recordCodeFailure, clearCodeFailures } from "../lib/attempts";
import { loadParsedAuthRequest } from "./authorize";

interface DecisionBody {
  nonce: string;
  action: "request_code" | "approve" | "deny";
  email?: string;
  code?: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

  if (!body.nonce || !["request_code", "approve", "deny"].includes(body.action)) {
    return Response.json({ error: "missing_nonce_or_action" }, { status: 400 });
  }

  // Peek on every action: a mistyped code must NOT burn the consent stash.
  // The stash is deleted only on deny or after the code verifies.
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

  if (body.action === "request_code") {
    // Same 60s-per-email throttle as the CLI path, so a replayed nonce can't
    // email-bomb an address from the consent page.
    const rlKey = `rl:code:${email}`;
    if (await env.NEXUS_CACHE.get(rlKey)) {
      return Response.json({ error: "Hang on a moment before requesting another code." }, { status: 429 });
    }
    await env.NEXUS_CACHE.put(rlKey, "1", { expirationTtl: 60 });
    try {
      await sendLoginCode(env, email);
    } catch (e) {
      console.error("sendMagicCode failed", e);
      return Response.json({ error: "Could not send the code. Try again." }, { status: 502 });
    }
    return Response.json({ sent: true });
  }

  // approve: a configured reviewer password bypasses email delivery; otherwise
  // verifying the magic code IS the sign-in.
  const code = (body.code ?? "").trim();
  const reviewerEmail = env.REVIEWER_LOGIN_EMAIL?.trim().toLowerCase();
  const reviewerPassword = env.REVIEWER_LOGIN_PASSWORD?.trim();
  const isReviewerLogin =
    !!reviewerEmail && !!reviewerPassword && email === reviewerEmail && code === reviewerPassword;

  let login;
  let signedInVia: "reviewer_password" | "instantdb_magic_code";
  if (isReviewerLogin) {
    try {
      login = await createReviewerLogin(env, email);
      signedInVia = "reviewer_password";
    } catch (e) {
      console.error("createReviewerLogin failed", e);
      return Response.json({ error: "Could not sign in reviewer account." }, { status: 502 });
    }
  } else {
    if (!/^\d{6}$/.test(code)) {
      return Response.json({ error: "Enter the 6-digit code from your email." }, { status: 400 });
    }
    if (await isCodeLocked(env, email)) {
      return Response.json(
        { error: "Too many wrong codes. Request a new one and try again." },
        { status: 429 },
      );
    }

    try {
      login = await verifyLoginCode(env, email, code);
      signedInVia = "instantdb_magic_code";
    } catch (e) {
      console.error("checkMagicCode failed", e);
      await recordCodeFailure(env, email);
      return Response.json(
        { error: "That code didn't match. Check your email and try again." },
        { status: 401 },
      );
    }

    await clearCodeFailures(env, email);
  }
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
      signed_in_via: signedInVia,
      issued_at: Date.now(),
    },
  });
  return Response.json({ redirect_to: redirectTo });
}
