import type { NexusEnv } from "../types";
import { handleAuthorize } from "./authorize";
import { handleDecision } from "./decision";
import { handleGoogleStart, handleGoogleCallback } from "../auth/google";
import { handleProtectedResource } from "./protected-resource";
import { sendLoginCode, verifyLoginCode, revokeToken } from "../instant";
import { isCodeLocked, recordCodeFailure, clearCodeFailures } from "../lib/attempts";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default {
  async fetch(req: Request, env: NexusEnv, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;

    // RFC 9728 path-suffixed protected-resource fallbacks
    const pr = handleProtectedResource(req, env);
    if (pr) return pr;

    // OpenID Connect mirror of /.well-known/oauth-authorization-server
    if (path === "/.well-known/openid-configuration") {
      return Response.redirect(`${env.BASE_URL}/.well-known/oauth-authorization-server`, 302);
    }

    // OpenAI domain verification token — apex-served plain text.
    if (path === "/.well-known/openai-apps-challenge") {
      return new Response("p7WC1Y8Ev8u7vcTTDqzMy7RAZo5YtbfLifniIRJKXe8\n", {
        headers: { "content-type": "text/plain" },
      });
    }

    // OAuth surface we own
    if (path === "/authorize" || path.startsWith("/authorize/")) {
      return handleAuthorize(req, env);
    }
    if (path === "/oauth/decision") {
      return handleDecision(req, env);
    }
    // "Sign in with Google" from the consent page: start -> Google -> callback.
    if (path === "/auth/google/start") {
      return handleGoogleStart(req, env);
    }
    if (path === "/auth/google/callback") {
      return handleGoogleCallback(req, env);
    }

    // Unauthenticated CLI/agent login: email magic code in, InstantDB
    // refresh token out. The refresh token is the CLI's bearer from then on.
    if (req.method === "GET" && path === "/api/v1/auth/config") {
      return Response.json({
        auth_enabled: true,
        flow: "email_code",
        request_code: "/api/v1/auth/request_code",
        verify_code: "/api/v1/auth/verify_code",
      });
    }
    if (req.method === "POST" && path === "/api/v1/auth/request_code") {
      const body = await req.json<{ email?: string }>().catch(() => ({} as { email?: string }));
      const email = (body.email ?? "").trim().toLowerCase();
      if (!EMAIL_RE.test(email)) {
        return Response.json({ error: "invalid_email" }, { status: 400 });
      }
      // One code per address per minute (KV's minimum TTL) — enough to stop
      // accidental loops.
      const rlKey = `rl:code:${email}`;
      if (await env.NEXUS_CACHE.get(rlKey)) {
        return Response.json({ error: "slow_down" }, { status: 429 });
      }
      await env.NEXUS_CACHE.put(rlKey, "1", { expirationTtl: 60 });
      try {
        await sendLoginCode(env, email);
      } catch (e) {
        console.error("request_code failed", e);
        return Response.json({ error: "send_failed" }, { status: 502 });
      }
      return Response.json({ sent: true });
    }
    if (req.method === "POST" && path === "/api/v1/auth/verify_code") {
      const body = await req
        .json<{ email?: string; code?: string }>()
        .catch(() => ({} as { email?: string; code?: string }));
      const email = (body.email ?? "").trim().toLowerCase();
      const code = (body.code ?? "").trim();
      if (!EMAIL_RE.test(email) || !/^\d{6}$/.test(code)) {
        return Response.json({ error: "invalid_email_or_code" }, { status: 400 });
      }
      if (await isCodeLocked(env, email)) {
        return Response.json({ error: "too_many_attempts" }, { status: 429 });
      }
      try {
        const login = await verifyLoginCode(env, email, code);
        await clearCodeFailures(env, email);
        return Response.json({
          token: login.refreshToken,
          user_id: login.userId,
          email: login.email,
        });
      } catch (e) {
        console.error("verify_code failed", e);
        await recordCodeFailure(env, email);
        return Response.json({ error: "invalid_code" }, { status: 401 });
      }
    }
    // Revoke the presented InstantDB refresh token so `nexus auth logout`
    // invalidates the session server-side, not just locally.
    if (req.method === "POST" && path === "/api/v1/auth/logout") {
      const auth = req.headers.get("authorization") ?? "";
      const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
      if (token) {
        try {
          await revokeToken(env, token);
        } catch (e) {
          console.error("logout revoke failed", e);
        }
      }
      return Response.json({ logged_out: true });
    }

    if (path === "/health") {
      return new Response("ok", { status: 200, headers: { "content-type": "text/plain" } });
    }

    if (path === "/") {
      return Response.json({
        name: "Nexus",
        version: "4.0",
        mcp_path: "/mcp",
        auth_enabled: true,
        tools: [
          "nexus_log_entries",
          "nexus_get_history",
          "nexus_update_entry",
          "nexus_manage_friends",
        ],
      });
    }

    return new Response("Not found", { status: 404 });
  },
};
