// "Sign in with Google" for the consent page — a standard server-side OAuth
// authorization-code flow that runs INSIDE our ChatGPT OAuth consent step.
//
// Flow: consent page -> /auth/google/start?nonce=<consent nonce> -> Google ->
// /auth/google/callback -> we exchange the code, read the verified email from
// the id_token, resolve it to an InstantDB user, and complete the ChatGPT
// authorization. Gated on GOOGLE_CLIENT_ID/SECRET being set; until then the
// consent page simply doesn't show the button.
import type { NexusEnv } from "../types";
import { adminDb, ensureFriendCode, displayNameFromEmail } from "../instant";
import { loadParsedAuthRequest } from "../handlers/authorize";

export function googleConfigured(env: NexusEnv): boolean {
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
}

function redirectUri(env: NexusEnv): string {
  return `${env.BASE_URL.replace(/\/$/, "")}/auth/google/callback`;
}

/** Kick off Google sign-in: stash the consent nonce under an oauth state, redirect to Google. */
export async function handleGoogleStart(req: Request, env: NexusEnv): Promise<Response> {
  if (!googleConfigured(env)) return new Response("Google sign-in not configured", { status: 404 });
  const url = new URL(req.url);
  const nonce = url.searchParams.get("nonce") ?? "";
  if (!nonce) return new Response("missing nonce", { status: 400 });

  const state = crypto.randomUUID();
  await env.NEXUS_CACHE.put(`goog:${state}`, nonce, { expirationTtl: 600 });

  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", env.GOOGLE_CLIENT_ID!);
  authUrl.searchParams.set("redirect_uri", redirectUri(env));
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", "openid email profile");
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("prompt", "select_account");
  return Response.redirect(authUrl.toString(), 302);
}

interface IdTokenClaims {
  iss?: string;
  aud?: string;
  exp?: number;
  email?: string;
  email_verified?: boolean | string;
  name?: string;
}

function decodeJwtPayload(jwt: string): IdTokenClaims | null {
  const parts = jwt.split(".");
  if (parts.length !== 3) return null;
  try {
    const json = atob(parts[1]!.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(json) as IdTokenClaims;
  } catch {
    return null;
  }
}

/** Google redirected back with a code: finish the sign-in and the ChatGPT grant. */
export async function handleGoogleCallback(req: Request, env: NexusEnv): Promise<Response> {
  if (!googleConfigured(env)) return new Response("Google sign-in not configured", { status: 404 });
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state") ?? "";
  if (url.searchParams.get("error") || !code || !state) {
    return htmlError("Google sign-in was cancelled or failed. Go back and try again.");
  }

  const nonce = await env.NEXUS_CACHE.get(`goog:${state}`);
  if (!nonce) return htmlError("This sign-in expired. Go back and reconnect.");
  // The state is single-use (replay protection), but the consent stash is only
  // consumed after sign-in succeeds — a transient Google failure shouldn't
  // force the user to restart from ChatGPT.
  await env.NEXUS_CACHE.delete(`goog:${state}`);

  const parsed = await loadParsedAuthRequest(env, nonce, { consume: false });
  if (!parsed) return htmlError("This sign-in expired. Go back and reconnect.");

  // Exchange the code for tokens (server-to-server, so the id_token is trusted).
  let tokenRes: { id_token?: string };
  try {
    const r = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: env.GOOGLE_CLIENT_ID!,
        client_secret: env.GOOGLE_CLIENT_SECRET!,
        redirect_uri: redirectUri(env),
        grant_type: "authorization_code",
      }),
    });
    if (!r.ok) throw new Error(`token ${r.status}`);
    tokenRes = await r.json();
  } catch (e) {
    console.error("google token exchange failed", e);
    return htmlError("Couldn't complete Google sign-in. Try again.");
  }

  const claims = tokenRes.id_token ? decodeJwtPayload(tokenRes.id_token) : null;
  const emailVerified = claims?.email_verified === true || claims?.email_verified === "true";
  if (
    !claims ||
    !claims.email ||
    !emailVerified ||
    claims.aud !== env.GOOGLE_CLIENT_ID ||
    !(claims.iss === "accounts.google.com" || claims.iss === "https://accounts.google.com") ||
    (claims.exp ?? 0) * 1000 < Date.now()
  ) {
    return htmlError("Google didn't return a verified email. Try a different account.");
  }

  const email = claims.email.trim().toLowerCase();
  const db = adminDb(env);
  await db.auth.createToken({ email }); // auto-provisions the $users row if new
  const res = await db.query({ $users: { $: { where: { email } } } });
  const user = res.$users[0];
  if (!user) return htmlError("Couldn't set up your account. Try again.");
  await ensureFriendCode(db, user.id);
  await env.NEXUS_CACHE.delete(`consent:${nonce}`);

  const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
    request: parsed,
    userId: user.id,
    scope: parsed.scope,
    props: { userId: user.id, email, displayName: claims.name || displayNameFromEmail(email) },
    metadata: { signed_in_via: "google", issued_at: Date.now() },
  });
  return Response.redirect(redirectTo, 302);
}

function htmlError(message: string): Response {
  const body = `<!doctype html><html><head><meta charset="utf-8"/><title>Nexus</title>
<style>body{background:#f5f2ea;color:#525051;font-family:ui-sans-serif,system-ui,sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;text-align:center;padding:2rem}h1{color:#3a3838;font-size:1.6rem;margin-bottom:.5rem}p{color:#9B9692;max-width:24rem;line-height:1.5}</style>
</head><body><div><h1>Sign-in problem</h1><p>${message}</p></div></body></html>`;
  return new Response(body, { status: 400, headers: { "content-type": "text/html; charset=utf-8" } });
}
