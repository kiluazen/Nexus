import type { AuthRequest } from "@cloudflare/workers-oauth-provider";
import type { NexusEnv } from "../types";
import { consentHtml } from "../auth/consent-html";

const CONSENT_TTL = 60 * 10; // 10 minutes

export function detectClient(redirectUri: string, clientName: string | undefined): string {
  // Map well-known OAuth callback hosts back to a friendly client name we
  // can show on the consent page so users know what they're connecting.
  // For localhost callbacks (CLI flows) the host is ambiguous between our
  // own CLI, Codex, and other dev tools — fall back to the DCR client_name.
  let host = "";
  try {
    host = new URL(redirectUri).hostname.toLowerCase();
  } catch {
    return clientName || "an application";
  }
  if (host.endsWith("claude.ai") || host.endsWith("claude.com") || host.endsWith("anthropic.com")) return "Claude";
  if (host.endsWith("chatgpt.com") || host.endsWith("openai.com")) return "ChatGPT";
  if (host.includes("codex")) return "Codex";
  if (host === "localhost" || host === "127.0.0.1") {
    if (clientName) {
      const lower = clientName.toLowerCase();
      if (lower.includes("codex")) return "Codex";
      if (lower.includes("claude")) return "Claude";
      if (lower.includes("nexus")) return "the Nexus CLI";
      return clientName;
    }
    return "a local CLI";
  }
  return clientName || host;
}

export async function handleAuthorize(req: Request, env: NexusEnv): Promise<Response> {
  const url = new URL(req.url);
  const segments = url.pathname.split("/").filter(Boolean);

  if (segments.length === 1) {
    // GET /authorize?response_type=...&client_id=...
    const parsed = await env.OAUTH_PROVIDER.parseAuthRequest(req);
    const nonce = crypto.randomUUID();
    const info = parsed.clientId ? await env.OAUTH_PROVIDER.lookupClient(parsed.clientId) : null;
    const client = detectClient(parsed.redirectUri, info?.clientName);
    await env.NEXUS_CACHE.put(
      `consent:${nonce}`,
      JSON.stringify({ ...parsed, _client: client }),
      { expirationTtl: CONSENT_TTL },
    );
    return Response.redirect(`${url.origin}/authorize/${nonce}`, 302);
  }

  // GET /authorize/<nonce> — render consent page
  const nonce = segments[1]!;
  const stash = await env.NEXUS_CACHE.get(`consent:${nonce}`);
  if (!stash) return expiredHtml();
  const parsed = JSON.parse(stash) as AuthRequest & { _client?: string };
  return new Response(
    consentHtml({ nonce, clientName: parsed._client ?? "an application" }),
    { headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

function expiredHtml(): Response {
  const body = `<!doctype html><html><head><meta charset="utf-8"/><title>Nexus</title>
<style>body{background:#f5f2ea;color:#525051;font-family:ui-sans-serif,system-ui,sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;text-align:center;padding:2rem;}h1{color:#3a3838;font-size:2rem;margin-bottom:.6rem;}p{color:#9B9692;max-width:24rem;line-height:1.5;}</style>
</head><body><div><h1>Authorization expired</h1><p>This sign-in link is older than 10 minutes. Go back to the app you were connecting and start over.</p></div></body></html>`;
  return new Response(body, { status: 410, headers: { "content-type": "text/html; charset=utf-8" } });
}

/**
 * Read the stashed auth request. `consume` deletes it (final approve/deny);
 * peeking keeps it alive so the request-code step can run first.
 */
export async function loadParsedAuthRequest(
  env: NexusEnv,
  nonce: string,
  opts: { consume: boolean },
): Promise<AuthRequest | null> {
  const raw = await env.NEXUS_CACHE.get(`consent:${nonce}`);
  if (!raw) return null;
  if (opts.consume) await env.NEXUS_CACHE.delete(`consent:${nonce}`);
  return JSON.parse(raw) as AuthRequest;
}
