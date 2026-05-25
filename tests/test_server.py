"""
Regression tests for the Nexus server.

Three critical surface areas:
1. MCP endpoints — must handle requests directly, never redirect (307/308)
2. REST API endpoints — must exist and respond correctly
3. Auth — MCP auth and HTTP bearer auth paths must resolve properly
"""

from __future__ import annotations

import os
import unittest

# Ensure server can import without real config (all fields have defaults/are optional)
os.environ.setdefault("NEXUS_DATABASE_URL", "")

from fastmcp import Client
from starlette.testclient import TestClient

from nexus.server import build_http_app, mcp, require_mcp_user, _protected_resource_payload
from nexus.app import UserContext


class McpEndpointTests(unittest.TestCase):
    """MCP endpoints must never redirect. ChatGPT and other MCP clients
    send to the configured URL exactly — a 307 means a broken integration."""

    def setUp(self) -> None:
        self.app = build_http_app("/mcp")
        self.client = TestClient(self.app, raise_server_exceptions=False)

    def test_post_mcp_no_trailing_slash_no_redirect(self) -> None:
        """POST /mcp is the canonical MCP endpoint. Must not redirect."""
        resp = self.client.post("/mcp", follow_redirects=False)
        self.assertNotIn(
            resp.status_code,
            (301, 302, 307, 308),
            f"POST /mcp returned {resp.status_code} redirect — MCP clients will loop and fail",
        )

    def test_get_mcp_no_trailing_slash_no_redirect(self) -> None:
        """GET /mcp (canonical). Must not redirect."""
        resp = self.client.get("/mcp", follow_redirects=False)
        self.assertNotIn(
            resp.status_code,
            (301, 302, 307, 308),
            f"GET /mcp returned {resp.status_code} redirect",
        )

    def test_post_mcp_trailing_slash_no_redirect(self) -> None:
        """POST /mcp/ (alias) should also work, not redirect."""
        resp = self.client.post("/mcp/", follow_redirects=False)
        self.assertNotIn(
            resp.status_code,
            (301, 302, 307, 308),
            f"POST /mcp/ returned {resp.status_code} redirect",
        )

    def test_get_mcp_trailing_slash_no_redirect(self) -> None:
        """GET /mcp/ (alias) should also work, not redirect."""
        resp = self.client.get("/mcp/", follow_redirects=False)
        self.assertNotIn(
            resp.status_code,
            (301, 302, 307, 308),
            f"GET /mcp/ returned {resp.status_code} redirect",
        )


class RestApiEndpointTests(unittest.TestCase):
    """REST API endpoints must exist and return proper responses."""

    def setUp(self) -> None:
        self.app = build_http_app("/mcp")
        self.client = TestClient(self.app, raise_server_exceptions=False)

    def test_root_returns_service_info(self) -> None:
        resp = self.client.get("/")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["name"], "Nexus")
        self.assertEqual(
            data["tools"],
            [
                "log_fitness_entries",
                "get_fitness_history",
                "update_fitness_entry",
                "manage_friend_connections",
            ],
        )

    def test_health_exists(self) -> None:
        resp = self.client.get("/health")
        # 200 if DB configured, 503 if not — never 404
        self.assertIn(resp.status_code, (200, 503))

    def test_auth_config_returns_json(self) -> None:
        resp = self.client.get("/api/v1/auth/config")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn("auth_enabled", data)
        self.assertIn("supabase_url", data)
        self.assertIn("supabase_publishable_key", data)

    def test_api_me_without_auth_returns_test_user(self) -> None:
        """When auth is not configured, /api/v1/me returns the test user."""
        resp = self.client.get("/api/v1/me")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["user_id"], "test-user-1")

    def test_api_history_not_404(self) -> None:
        resp = self.client.get("/api/v1/history")
        self.assertNotEqual(resp.status_code, 404, "/api/v1/history route is missing")

    def test_api_log_not_404(self) -> None:
        resp = self.client.post("/api/v1/log", json={"entries": []})
        self.assertNotEqual(resp.status_code, 404, "/api/v1/log route is missing")

    def test_api_update_not_404(self) -> None:
        resp = self.client.post("/api/v1/update", json={"entry_id": 1, "data": {}})
        self.assertNotEqual(resp.status_code, 404, "/api/v1/update route is missing")

    def test_api_friends_not_404(self) -> None:
        resp = self.client.post("/api/v1/friends", json={"action": "list"})
        self.assertNotEqual(resp.status_code, 404, "/api/v1/friends route is missing")


class OAuthDiscoveryTests(unittest.TestCase):
    """OAuth well-known endpoints must be reachable for MCP auth to work."""

    def setUp(self) -> None:
        self.app = build_http_app("/mcp")
        self.client = TestClient(self.app, raise_server_exceptions=False)

    def test_oauth_protected_resource_exists(self) -> None:
        resp = self.client.get("/.well-known/oauth-protected-resource")
        # Returns 200 if base_url is set, otherwise may not exist — but should not crash
        self.assertNotEqual(resp.status_code, 500)

    def test_oauth_protected_resource_mcp_path(self) -> None:
        resp = self.client.get("/.well-known/oauth-protected-resource/mcp")
        self.assertNotEqual(resp.status_code, 500)

    def test_protected_resource_doc_served_at_all_three_variants(self) -> None:
        """Regression for the slash bug: clients hit one of three URLs to
        fetch the metadata. All three must respond with the same payload,
        and `resource` must be the no-slash canonical form. See
        docs/mcp-path-trailing-slash.md."""
        # Without base_url configured these routes don't exist — covered
        # separately. When they do exist (prod path), all three must agree.
        paths = [
            "/.well-known/oauth-protected-resource",
            "/.well-known/oauth-protected-resource/mcp",
            "/.well-known/oauth-protected-resource/mcp/",
        ]
        statuses = {p: self.client.get(p).status_code for p in paths}
        if all(code == 404 for code in statuses.values()):
            self.skipTest("base_url not configured in test env; covered by prod curl checks")
        for p, code in statuses.items():
            self.assertEqual(code, 200, f"{p} returned {code}")
        resources = {p: self.client.get(p).json()["resource"] for p in paths}
        unique = set(resources.values())
        self.assertEqual(
            len(unique), 1,
            f"protected-resource docs disagree across variants: {resources}",
        )
        resource = next(iter(unique))
        self.assertFalse(
            resource.endswith("/"),
            f"resource must have no trailing slash, got {resource!r}",
        )

    def test_protected_resource_payload_resource_has_no_trailing_slash(self) -> None:
        """Claude's SDK strict-matches the `resource` field against the URL
        clients tried. Most clients hit /mcp (no slash), so `resource` must
        be the no-slash form regardless of whether canonical_path was
        passed with or without a trailing slash. See
        docs/mcp-path-trailing-slash.md."""
        for canonical in ("/mcp", "/mcp/"):
            payload = _protected_resource_payload(
                base_url="https://nexus.example.com/",
                canonical_path=canonical,
            )
            self.assertEqual(payload["resource"], "https://nexus.example.com/mcp")
            self.assertEqual(payload["authorization_servers"], ["https://nexus.example.com"])


class McpToolMetadataTests(unittest.IsolatedAsyncioTestCase):
    """Public tool names and annotations should be review-friendly."""

    async def test_tool_names_and_annotations(self) -> None:
        async with Client(mcp) as client:
            tools = {tool.name: tool for tool in await client.list_tools()}

        self.assertEqual(
            set(tools),
            {
                "log_fitness_entries",
                "get_fitness_history",
                "update_fitness_entry",
                "manage_friend_connections",
            },
        )
        self.assertTrue(tools["get_fitness_history"].annotations.readOnlyHint)
        self.assertTrue(tools["update_fitness_entry"].annotations.destructiveHint)
        self.assertTrue(tools["manage_friend_connections"].annotations.openWorldHint)


class AuthHelperTests(unittest.TestCase):
    """Auth helpers must resolve user context correctly."""

    def test_require_mcp_user_returns_test_user_without_auth(self) -> None:
        """When no access token is available, should return test user."""
        user = require_mcp_user()
        self.assertIsInstance(user, UserContext)
        self.assertEqual(user.user_id, "test-user-1")
        self.assertEqual(user.display_name, "Local Test User")


if __name__ == "__main__":
    unittest.main()
