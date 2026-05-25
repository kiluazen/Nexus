import type { NexusEnv } from "../types";
import { handleAuthorize, handleCallback } from "./authorize";
import { handleDecision } from "./decision";
import { handleProtectedResource } from "./protected-resource";

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
    if (path === "/auth/callback") {
      return handleCallback(req, env);
    }
    if (path === "/oauth/decision") {
      return handleDecision(req, env);
    }

    // Unauthenticated CLI bootstrap
    if (req.method === "GET" && path === "/api/v1/auth/config") {
      return Response.json({
        auth_enabled: true,
        supabase_url: env.SUPABASE_URL,
        supabase_publishable_key: env.SUPABASE_PUBLISHABLE_KEY,
      });
    }

    if (path === "/health") {
      return new Response("ok", { status: 200, headers: { "content-type": "text/plain" } });
    }

    if (path === "/db-test") {
      const { Client } = await import("pg");
      const cs = env.NEXUS_DB.connectionString;
      const c = new Client({ connectionString: cs, ssl: false });
      const t0 = Date.now();
      try {
        console.log("db-test: connecting...");
        await c.connect();
        console.log("db-test: connected in", Date.now() - t0, "ms");
        const r = await c.query("SELECT 1 AS ok, current_database() AS db, version() AS v");
        return Response.json({ ok: true, ms: Date.now() - t0, row: r.rows[0] });
      } catch (e) {
        console.error("db-test error:", e);
        return Response.json({ ok: false, ms: Date.now() - t0, error: String(e) }, { status: 500 });
      } finally {
        _ctx.waitUntil(c.end().catch(() => {}));
      }
    }

    if (path === "/") {
      return Response.json({
        name: "Nexus",
        version: "3.0",
        mcp_path: "/mcp",
        auth_enabled: true,
        tools: [
          "log_fitness_entries",
          "get_fitness_history",
          "update_fitness_entry",
          "manage_friend_connections",
        ],
      });
    }

    return new Response("Not found", { status: 404 });
  },
};
