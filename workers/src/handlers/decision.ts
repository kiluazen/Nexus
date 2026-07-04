import type { NexusEnv } from "../types";
import { sendLoginCode, verifyLoginCode, displayNameFromEmail } from "../instant";
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
    try {
      await sendLoginCode(env, email);
    } catch (e) {
      console.error("sendMagicCode failed", e);
      return Response.json({ error: "Could not send the code. Try again." }, { status: 502 });
    }
    return Response.json({ sent: true });
  }

  // approve: verifying the magic code IS the sign-in.
  const code = (body.code ?? "").trim();
  if (!/^\d{6}$/.test(code)) {
    return Response.json({ error: "Enter the 6-digit code from your email." }, { status: 400 });
  }

  let login;
  try {
    login = await verifyLoginCode(env, email, code);
  } catch (e) {
    console.error("checkMagicCode failed", e);
    return Response.json(
      { error: "That code didn't match. Check your email and try again." },
      { status: 401 },
    );
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
      signed_in_via: "instantdb_magic_code",
      issued_at: Date.now(),
    },
  });
  return Response.json({ redirect_to: redirectTo });
}
