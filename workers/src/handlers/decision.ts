import type { NexusEnv } from "../types";
import { verifySupabaseJwt, displayNameFromClaims } from "../auth/supabase-jwt";
import { loadParsedAuthRequest } from "./authorize";

interface DecisionBody {
  nonce: string;
  action: "approve" | "deny";
  supabase_token?: string;
}

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

  if (!body.nonce || (body.action !== "approve" && body.action !== "deny")) {
    return Response.json({ error: "missing_nonce_or_action" }, { status: 400 });
  }

  const parsed = await loadParsedAuthRequest(env, body.nonce);
  if (!parsed) {
    return Response.json({ error: "authorization_request_expired" }, { status: 410 });
  }

  if (body.action === "deny") {
    const u = new URL(parsed.redirectUri);
    u.searchParams.set("error", "access_denied");
    if (parsed.state) u.searchParams.set("state", parsed.state);
    return Response.json({ redirect_to: u.toString() });
  }

  const claims = await verifySupabaseJwt(body.supabase_token, env);
  if (!claims) {
    return Response.json({ error: "invalid_supabase_token" }, { status: 401 });
  }

  const props = {
    userId: claims.sub,
    email: claims.email ?? "",
    displayName: displayNameFromClaims(claims),
  };

  const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
    request: parsed,
    userId: claims.sub,
    scope: parsed.scope,
    props,
    metadata: {
      signed_in_via: claims.app_metadata?.provider ?? "supabase",
      issued_at: Date.now(),
    },
  });
  return Response.json({ redirect_to: redirectTo });
}
