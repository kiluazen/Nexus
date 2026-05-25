import type { AuthRequest } from "@cloudflare/workers-oauth-provider";
import type { NexusEnv } from "../types";
import { consentHtml } from "../auth/consent-html";
import { callbackHtml } from "../auth/callback-html";

const CONSENT_TTL = 60 * 10; // 10 minutes

export async function handleAuthorize(req: Request, env: NexusEnv): Promise<Response> {
  const url = new URL(req.url);
  const segments = url.pathname.split("/").filter(Boolean);

  if (segments.length === 1) {
    // GET /authorize?response_type=...&client_id=...
    const parsed = await env.OAUTH_PROVIDER.parseAuthRequest(req);
    const nonce = crypto.randomUUID();
    await env.NEXUS_CACHE.put(`consent:${nonce}`, JSON.stringify(parsed), {
      expirationTtl: CONSENT_TTL,
    });
    return Response.redirect(`${url.origin}/authorize/${nonce}`, 302);
  }

  // GET /authorize/<nonce> — render consent page
  const nonce = segments[1]!;
  const stash = await env.NEXUS_CACHE.get(`consent:${nonce}`);
  if (!stash) {
    return new Response("Authorization request expired. Try again.", { status: 410 });
  }
  return new Response(consentHtml({
    nonce,
    supabaseUrl: env.SUPABASE_URL,
    publishableKey: env.SUPABASE_PUBLISHABLE_KEY,
    baseUrl: env.BASE_URL,
  }), { headers: { "content-type": "text/html; charset=utf-8" } });
}

export async function handleCallback(req: Request, env: NexusEnv): Promise<Response> {
  const url = new URL(req.url);
  const nonce = url.searchParams.get("nonce") ?? "";
  return new Response(callbackHtml({
    nonce,
    supabaseUrl: env.SUPABASE_URL,
    publishableKey: env.SUPABASE_PUBLISHABLE_KEY,
    baseUrl: env.BASE_URL,
  }), { headers: { "content-type": "text/html; charset=utf-8" } });
}

export async function loadParsedAuthRequest(
  env: NexusEnv,
  nonce: string,
): Promise<AuthRequest | null> {
  const raw = await env.NEXUS_CACHE.get(`consent:${nonce}`);
  if (!raw) return null;
  await env.NEXUS_CACHE.delete(`consent:${nonce}`);
  return JSON.parse(raw) as AuthRequest;
}
