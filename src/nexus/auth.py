from __future__ import annotations

import json
import secrets
import time
from typing import Any
from urllib.parse import urlencode
from uuid import uuid4

from fastmcp.server.auth.auth import (
    AccessToken,
    ClientRegistrationOptions,
    OAuthProvider,
)
from fastmcp.server.auth.providers.jwt import JWTVerifier
from mcp.server.auth.provider import (
    AuthorizationCode,
    AuthorizationParams,
    AuthorizeError,
    RefreshToken,
    TokenError,
    construct_redirect_uri,
)
from mcp.shared.auth import OAuthClientInformationFull, OAuthToken
from starlette.requests import Request
from starlette.responses import HTMLResponse, JSONResponse
from starlette.routing import Route

from nexus.config import Settings
from nexus.db import get_pool

DEFAULT_AUTH_CODE_EXPIRY_SECONDS = 5 * 60
DEFAULT_ACCESS_TOKEN_EXPIRY_SECONDS = 60 * 60
DEFAULT_REFRESH_TOKEN_EXPIRY_SECONDS = 60 * 60 * 24 * 30

CLIENTS_TABLE = "oauth_clients"
PENDING_TABLE = "oauth_pending_authorizations"
AUTH_CODES_TABLE = "oauth_authorization_codes"
ACCESS_TOKENS_TABLE = "oauth_access_tokens"
REFRESH_TOKENS_TABLE = "oauth_refresh_tokens"


class NexusOAuthProvider(OAuthProvider):
    def __init__(self, settings: Settings):
        settings.validate()
        settings.validate_auth()
        assert settings.base_url is not None
        assert settings.supabase_url is not None
        assert settings.supabase_publishable_key is not None

        super().__init__(
            base_url=settings.base_url,
            client_registration_options=ClientRegistrationOptions(
                enabled=True,
                valid_scopes=["openid", "profile", "email"],
                default_scopes=["openid", "profile", "email"],
            ),
        )
        self._settings = settings
        self._supabase_url = settings.supabase_url
        self._supabase_publishable_key = settings.supabase_publishable_key
        self._supabase_verifier = JWTVerifier(
            jwks_uri=f"{self._supabase_url}/auth/v1/.well-known/jwks.json",
            issuer=f"{self._supabase_url}/auth/v1",
            algorithm="ES256",
        )

    def get_routes(self, mcp_path: str | None = None) -> list[Route]:
        routes = super().get_routes(mcp_path)
        routes.extend(
            [
                Route("/oauth/consent", endpoint=self.consent_page, methods=["GET"]),
                Route("/oauth/pending", endpoint=self.pending_details, methods=["GET"]),
                Route("/oauth/decision", endpoint=self.oauth_decision, methods=["POST"]),
                Route("/auth/callback", endpoint=self.auth_callback_page, methods=["GET"]),
            ]
        )
        return routes

    async def get_client(self, client_id: str) -> OAuthClientInformationFull | None:
        raw = self._fetch_one(CLIENTS_TABLE, key_column="client_id", key=client_id)
        if raw is None:
            return None
        return OAuthClientInformationFull.model_validate(raw)

    async def register_client(self, client_info: OAuthClientInformationFull) -> None:
        payload = client_info.model_dump(mode="json")
        self._upsert_json(
            CLIENTS_TABLE,
            key_column="client_id",
            key=client_info.client_id,
            payload=payload,
        )

    async def authorize(
        self, client: OAuthClientInformationFull, params: AuthorizationParams
    ) -> str:
        if client.client_id is None:
            raise AuthorizeError(
                error="invalid_client",
                error_description="Client ID is required.",
            )

        pending_id = str(uuid4())
        payload = {
            "pending_id": pending_id,
            "client_id": client.client_id,
            "client_name": client.client_name or client.client_id,
            "redirect_uri": str(params.redirect_uri),
            "redirect_uri_provided_explicitly": params.redirect_uri_provided_explicitly,
            "scopes": params.scopes or [],
            "state": params.state,
            "code_challenge": params.code_challenge,
            "resource": params.resource,
            "created_at": int(time.time()),
        }
        self._upsert_json(
            PENDING_TABLE,
            key_column="pending_id",
            key=pending_id,
            payload=payload,
        )
        return f"{self._settings.base_url}/oauth/consent?pending_id={pending_id}"

    async def load_authorization_code(
        self, client: OAuthClientInformationFull, authorization_code: str
    ) -> AuthorizationCode | None:
        raw = self._fetch_one(AUTH_CODES_TABLE, key_column="code", key=authorization_code)
        if raw is None:
            return None
        code = AuthorizationCode.model_validate(raw["authorization_code"])
        if code.client_id != client.client_id:
            return None
        if code.expires_at < time.time():
            self._delete_row(AUTH_CODES_TABLE, key_column="code", key=authorization_code)
            return None
        return code

    async def exchange_authorization_code(
        self, client: OAuthClientInformationFull, authorization_code: AuthorizationCode
    ) -> OAuthToken:
        raw = self._fetch_one(AUTH_CODES_TABLE, key_column="code", key=authorization_code.code)
        if raw is None:
            raise TokenError("invalid_grant", "Authorization code not found.")
        self._delete_row(AUTH_CODES_TABLE, key_column="code", key=authorization_code.code)

        token_payload = raw.get("token_payload", {})
        access_token_value = secrets.token_urlsafe(48)
        refresh_token_value = secrets.token_urlsafe(48)
        access_expires_at = int(time.time() + DEFAULT_ACCESS_TOKEN_EXPIRY_SECONDS)
        refresh_expires_at = int(time.time() + DEFAULT_REFRESH_TOKEN_EXPIRY_SECONDS)
        scopes = authorization_code.scopes

        access_token = AccessToken(
            token=access_token_value,
            client_id=client.client_id or "",
            scopes=scopes,
            expires_at=access_expires_at,
            claims=token_payload,
        )
        refresh_token = RefreshToken(
            token=refresh_token_value,
            client_id=client.client_id or "",
            scopes=scopes,
            expires_at=refresh_expires_at,
        )

        self._upsert_json(
            ACCESS_TOKENS_TABLE,
            key_column="token",
            key=access_token_value,
            payload={
                "access_token": access_token.model_dump(mode="json"),
                "user_id": token_payload.get("sub", ""),
            },
        )
        self._upsert_json(
            REFRESH_TOKENS_TABLE,
            key_column="token",
            key=refresh_token_value,
            payload={
                "refresh_token": refresh_token.model_dump(mode="json"),
                "token_payload": token_payload,
            },
        )

        return OAuthToken(
            access_token=access_token_value,
            token_type="Bearer",
            expires_in=DEFAULT_ACCESS_TOKEN_EXPIRY_SECONDS,
            refresh_token=refresh_token_value,
            scope=" ".join(scopes),
        )

    async def load_refresh_token(
        self, client: OAuthClientInformationFull, refresh_token: str
    ) -> RefreshToken | None:
        raw = self._fetch_one(REFRESH_TOKENS_TABLE, key_column="token", key=refresh_token)
        if raw is None:
            return None
        token = RefreshToken.model_validate(raw["refresh_token"])
        if token.client_id != client.client_id:
            return None
        if token.expires_at is not None and token.expires_at < time.time():
            self._delete_row(REFRESH_TOKENS_TABLE, key_column="token", key=refresh_token)
            return None
        return token

    async def exchange_refresh_token(
        self,
        client: OAuthClientInformationFull,
        refresh_token: RefreshToken,
        scopes: list[str],
    ) -> OAuthToken:
        raw = self._fetch_one(REFRESH_TOKENS_TABLE, key_column="token", key=refresh_token.token)
        if raw is None:
            raise TokenError("invalid_grant", "Refresh token not found.")

        original_scopes = set(refresh_token.scopes)
        requested_scopes = set(scopes)
        if not requested_scopes.issubset(original_scopes):
            raise TokenError(
                "invalid_scope",
                "Requested scopes exceed those authorized by the refresh token.",
            )

        self._delete_row(REFRESH_TOKENS_TABLE, key_column="token", key=refresh_token.token)
        token_payload = raw.get("token_payload", {})

        access_token_value = secrets.token_urlsafe(48)
        new_refresh_token_value = secrets.token_urlsafe(48)
        access_expires_at = int(time.time() + DEFAULT_ACCESS_TOKEN_EXPIRY_SECONDS)
        refresh_expires_at = int(time.time() + DEFAULT_REFRESH_TOKEN_EXPIRY_SECONDS)

        access_token = AccessToken(
            token=access_token_value,
            client_id=client.client_id or "",
            scopes=scopes,
            expires_at=access_expires_at,
            claims=token_payload,
        )
        next_refresh_token = RefreshToken(
            token=new_refresh_token_value,
            client_id=client.client_id or "",
            scopes=scopes,
            expires_at=refresh_expires_at,
        )
        self._upsert_json(
            ACCESS_TOKENS_TABLE,
            key_column="token",
            key=access_token_value,
            payload={
                "access_token": access_token.model_dump(mode="json"),
                "user_id": token_payload.get("sub", ""),
            },
        )
        self._upsert_json(
            REFRESH_TOKENS_TABLE,
            key_column="token",
            key=new_refresh_token_value,
            payload={
                "refresh_token": next_refresh_token.model_dump(mode="json"),
                "token_payload": token_payload,
            },
        )

        return OAuthToken(
            access_token=access_token_value,
            token_type="Bearer",
            expires_in=DEFAULT_ACCESS_TOKEN_EXPIRY_SECONDS,
            refresh_token=new_refresh_token_value,
            scope=" ".join(scopes),
        )

    async def load_access_token(self, token: str) -> AccessToken | None:  # type: ignore[override]
        raw = self._fetch_one(ACCESS_TOKENS_TABLE, key_column="token", key=token)
        if raw is None:
            return None
        access_token = AccessToken.model_validate(raw["access_token"])
        if access_token.expires_at is not None and access_token.expires_at < time.time():
            self._delete_row(ACCESS_TOKENS_TABLE, key_column="token", key=token)
            return None
        return access_token

    async def revoke_token(self, token: AccessToken | RefreshToken) -> None:
        table_name = ACCESS_TOKENS_TABLE if isinstance(token, AccessToken) else REFRESH_TOKENS_TABLE
        key = token.token
        self._delete_row(table_name, key_column="token", key=key)

    async def verify_bearer_token(self, token: str) -> tuple[dict[str, Any], str] | None:
        access_token = await self.load_access_token(token)
        if access_token is not None:
            return dict(access_token.claims), "nexus"

        verified = await self._supabase_verifier.verify_token(token)
        if verified is not None:
            return dict(verified.claims), "supabase"

        return None

    async def consent_page(self, request: Request) -> HTMLResponse:
        pending_id = request.query_params.get("pending_id", "")
        return HTMLResponse(
            _consent_html(
                pending_id=pending_id,
                supabase_url=self._supabase_url,
                publishable_key=self._supabase_publishable_key,
                base_url=self._settings.base_url or "",
            )
        )

    async def pending_details(self, request: Request) -> JSONResponse:
        pending_id = request.query_params.get("pending_id", "").strip()
        if not pending_id:
            return JSONResponse({"error": "pending_id is required"}, status_code=400)

        raw = self._fetch_one(PENDING_TABLE, key_column="pending_id", key=pending_id)
        if raw is None:
            return JSONResponse({"error": "authorization request not found"}, status_code=404)

        client = await self.get_client(raw["client_id"])
        return JSONResponse(
            {
                "client_name": raw.get("client_name") or (client.client_name if client else raw["client_id"]),
                "scopes": raw.get("scopes", []),
                "redirect_uri": raw.get("redirect_uri", ""),
            }
        )

    async def oauth_decision(self, request: Request) -> JSONResponse:
        body = await request.json()
        pending_id = str(body.get("pending_id", "")).strip()
        action = str(body.get("action", "")).strip()
        if not pending_id or action not in {"approve", "deny"}:
            return JSONResponse(
                {"error": "pending_id and valid action are required"},
                status_code=400,
            )

        raw = self._fetch_one(PENDING_TABLE, key_column="pending_id", key=pending_id)
        if raw is None:
            return JSONResponse({"error": "authorization request not found"}, status_code=404)

        if action == "deny":
            self._delete_row(PENDING_TABLE, key_column="pending_id", key=pending_id)
            redirect_to = construct_redirect_uri(
                raw["redirect_uri"],
                error="access_denied",
                state=raw.get("state"),
            )
            return JSONResponse({"redirect_to": redirect_to})

        token = _extract_bearer_token(request)
        if token is None:
            return JSONResponse({"error": "Authentication is required."}, status_code=401)

        verified = await self._supabase_verifier.verify_token(token)
        if verified is None:
            return JSONResponse({"error": "Supabase session is invalid."}, status_code=401)

        user_claims = dict(verified.claims)
        user_id = str(user_claims.get("sub", "")).strip()
        if not user_id:
            return JSONResponse({"error": "Supabase token is missing sub."}, status_code=401)

        code_value = secrets.token_urlsafe(32)
        auth_code = AuthorizationCode(
            code=code_value,
            client_id=raw["client_id"],
            redirect_uri=raw["redirect_uri"],
            redirect_uri_provided_explicitly=bool(raw["redirect_uri_provided_explicitly"]),
            scopes=list(raw.get("scopes", [])),
            expires_at=time.time() + DEFAULT_AUTH_CODE_EXPIRY_SECONDS,
            code_challenge=raw["code_challenge"],
            resource=raw.get("resource"),
        )
        token_payload = {
            "sub": user_id,
            "email": user_claims.get("email", ""),
        }
        self._upsert_json(
            AUTH_CODES_TABLE,
            key_column="code",
            key=code_value,
            payload={
                "authorization_code": auth_code.model_dump(mode="json"),
                "token_payload": token_payload,
            },
        )
        self._delete_row(PENDING_TABLE, key_column="pending_id", key=pending_id)
        redirect_to = construct_redirect_uri(
            raw["redirect_uri"],
            code=code_value,
            state=raw.get("state"),
        )
        return JSONResponse({"redirect_to": redirect_to})

    async def auth_callback_page(self, request: Request) -> HTMLResponse:
        pending_id = request.query_params.get("pending_id", "")
        return HTMLResponse(
            _callback_html(
                pending_id=pending_id,
                supabase_url=self._supabase_url,
                publishable_key=self._supabase_publishable_key,
                base_url=self._settings.base_url or "",
            )
        )

    def _fetch_one(self, table_name: str, *, key_column: str, key: str) -> dict[str, Any] | None:
        pool = get_pool(self._settings)
        with pool.connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    f"select raw_json::text from {table_name} where {key_column} = %s",
                    (key,),
                )
                row = cursor.fetchone()
        if row is None:
            return None
        return json.loads(row[0])

    def _upsert_json(
        self,
        table_name: str,
        *,
        key_column: str,
        key: str | None,
        payload: dict[str, Any],
    ) -> None:
        pool = get_pool(self._settings)
        with pool.connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    f"""
                    insert into {table_name} ({key_column}, raw_json)
                    values (%s, %s::jsonb)
                    on conflict ({key_column}) do update
                    set raw_json = excluded.raw_json
                    """,
                    (key, json.dumps(payload)),
                )
            connection.commit()

    def _delete_row(self, table_name: str, *, key_column: str, key: str) -> None:
        pool = get_pool(self._settings)
        with pool.connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    f"delete from {table_name} where {key_column} = %s",
                    (key,),
                )
            connection.commit()


def _extract_bearer_token(request: Request) -> str | None:
    header = request.headers.get("authorization", "")
    if not header.lower().startswith("bearer "):
        return None
    return header.split(" ", 1)[1].strip() or None


def _consent_html(
    *,
    pending_id: str,
    supabase_url: str,
    publishable_key: str,
    base_url: str,
) -> str:
    payload = json.dumps(
        {
            "pendingId": pending_id,
            "supabaseUrl": supabase_url,
            "publishableKey": publishable_key,
            "baseUrl": base_url,
        }
    )
    return """<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Nexus – Sign in</title>
    <style>
      *{ margin:0; padding:0; box-sizing:border-box; }
      body {
        background:#f5f2ea;
        color:#525051;
        font-family:ui-sans-serif,system-ui,-apple-system,sans-serif;
        min-height:100vh;
        display:flex;
        flex-direction:column;
        align-items:center;
        justify-content:center;
        position:relative;
        overflow:hidden;
      }
      .bg-img {
        position:fixed;
        top:50%;
        left:50%;
        transform:translate(-50%,-50%);
        width:min(500px,80vw);
        border-radius:18px;
        opacity:0.12;
        pointer-events:none;
        z-index:0;
      }
      main {
        position:relative;
        z-index:1;
        text-align:center;
        padding:2rem;
        max-width:400px;
      }
      h1 {
        font-size:2.4rem;
        font-weight:700;
        margin-bottom:0.6rem;
        color:#3a3838;
      }
      p {
        font-size:1.15rem;
        color:#9B9692;
        line-height:1.5;
        margin-bottom:1.5rem;
      }
      button { border:0; border-radius:999px; padding:.85rem 1.1rem; font-size:1rem; cursor:pointer; width:100%; }
      button.primary { background:#111; color:#fff; }
      button.primary:hover { background:#333; }
      button.primary:disabled { background:#999; cursor:wait; }
      .divider { display:flex; align-items:center; gap:1rem; margin:1.25rem 0; color:#9B9692; font-size:.875rem; }
      .divider::before, .divider::after { content:""; flex:1; border-top:1px solid #e7dcc6; }
      .email-form { display:none; }
      .email-form input { width:100%; padding:.75rem 1rem; border:1px solid #e7dcc6; border-radius:12px; font-size:1rem; background:#fff; box-sizing:border-box; outline:none; }
      .email-form input:focus { border-color:#111; }
      .email-form .fields { display:flex; flex-direction:column; gap:.75rem; margin-bottom:1rem; }
      pre { white-space:pre-wrap; word-break:break-word; color:#c44; margin-top:1rem; font-size:.9rem; }
      .spinner { display:inline-block; width:18px; height:18px; border:2px solid #fff; border-top-color:transparent; border-radius:50%; animation:spin .6s linear infinite; vertical-align:middle; margin-right:8px; }
      @keyframes spin { to { transform:rotate(360deg); } }
      footer {
        position:fixed;
        bottom:2rem;
        z-index:1;
        text-align:center;
      }
      footer a {
        color:#9B9692;
        text-decoration:none;
        font-size:0.95rem;
        transition:color 0.2s;
      }
      footer a:hover { color:#525051; }
      footer a svg {
        width:20px;
        height:20px;
        vertical-align:middle;
        margin-right:6px;
        fill:currentColor;
      }
    </style>
    <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
  </head>
  <body>
    <img class="bg-img" src="https://kushalsm.com/playground_pic.png" alt="" />
    <main>
      <h1>Nexus</h1>
      <p id="status">Loading...</p>
      <div id="login-actions" hidden>
        <button class="primary" id="login">Continue with Google</button>
        <div class="divider">or</div>
        <div class="email-form" id="email-form">
          <div class="fields">
            <input type="email" id="email-input" placeholder="Email" autocomplete="email" />
            <input type="password" id="password-input" placeholder="Password" autocomplete="current-password" />
          </div>
          <button class="primary" id="email-login">Sign in with email</button>
        </div>
      </div>
      <pre id="error" hidden></pre>
    </main>
    <footer>
      <a href="https://twitter.com/KushalSM5" target="_blank" rel="noopener">
        <svg viewBox="0 0 24 24"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
        @KushalSM5
      </a>
    </footer>
    <script>
      const config = __CONFIG__;
      const client = window.supabase.createClient(config.supabaseUrl, config.publishableKey, {
        auth: {
          autoRefreshToken: false,
          persistSession: true,
          detectSessionInUrl: false,
          flowType: "pkce"
        }
      });
      const statusEl = document.getElementById("status");
      const errorEl = document.getElementById("error");
      const loginActions = document.getElementById("login-actions");
      const loginButton = document.getElementById("login");
      const emailForm = document.getElementById("email-form");
      const emailInput = document.getElementById("email-input");
      const passwordInput = document.getElementById("password-input");
      const emailLoginButton = document.getElementById("email-login");

      function setError(message) {
        statusEl.textContent = "Something went wrong.";
        errorEl.hidden = false;
        errorEl.textContent = message;
      }

      function clientLabel(redirectUri) {
        if (!redirectUri) return null;
        if (redirectUri.includes("claude.ai") || redirectUri.includes("claude.com")) return "Claude";
        if (redirectUri.includes("chatgpt.com") || redirectUri.includes("openai.com")) return "ChatGPT";
        return null;
      }

      let pendingData = null;

      async function autoApprove(hasExistingSession) {
        const label = clientLabel(pendingData?.redirect_uri);
        const target = label ? ` to ${label}` : "";
        if (hasExistingSession) {
          statusEl.innerHTML = '<span class="spinner"></span>Found existing session. Connecting' + target + '...';
        } else {
          statusEl.innerHTML = '<span class="spinner"></span>Connecting' + target + '...';
        }
        loginActions.hidden = true;
        const { data } = await client.auth.getSession();
        const accessToken = data.session?.access_token;
        if (!accessToken) throw new Error("No session found.");
        const response = await fetch(`${config.baseUrl}/oauth/decision`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${accessToken}`
          },
          body: JSON.stringify({ pending_id: config.pendingId, action: "approve" })
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || response.statusText);
        statusEl.innerHTML = '<span class="spinner"></span>Redirecting' + target + '...';
        window.location.assign(payload.redirect_to);
        setTimeout(() => window.close(), 1000);
      }

      loginButton.addEventListener("click", async () => {
        const redirectTo = `${config.baseUrl}/auth/callback?pending_id=${encodeURIComponent(config.pendingId)}`;
        const { error } = await client.auth.signInWithOAuth({
          provider: "google",
          options: { redirectTo }
        });
        if (error) setError(error.message);
      });

      emailLoginButton.addEventListener("click", async () => {
        const email = emailInput.value.trim();
        const password = passwordInput.value;
        if (!email || !password) {
          setError("Please enter both email and password.");
          return;
        }
        emailLoginButton.textContent = "Signing in\u2026";
        emailLoginButton.disabled = true;
        const { error } = await client.auth.signInWithPassword({ email, password });
        if (error) {
          emailLoginButton.textContent = "Sign in with email";
          emailLoginButton.disabled = false;
          setError(error.message);
          return;
        }
        try { await autoApprove(false); } catch (err) { setError(err.message || String(err)); }
      });

      passwordInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") emailLoginButton.click();
      });

      async function init() {
        if (!config.pendingId) {
          setError("Missing pending authorization ID.");
          return;
        }
        const resp = await fetch(`${config.baseUrl}/oauth/pending?pending_id=${encodeURIComponent(config.pendingId)}`);
        if (resp.ok) pendingData = await resp.json();
        const { data } = await client.auth.getSession();
        if (data.session) {
          try { await autoApprove(true); } catch (err) { setError(err.message || String(err)); }
          return;
        }
        const label = clientLabel(pendingData?.redirect_uri);
        statusEl.textContent = label ? `Sign in to connect Nexus to ${label}.` : "Sign in to connect Nexus.";
        loginActions.hidden = false;
        emailForm.style.display = "block";
      }

      init().catch((error) => setError(error instanceof Error ? error.message : String(error)));
    </script>
  </body>
</html>
""".replace("__CONFIG__", payload.replace("</", "<\\/"))


def _callback_html(
    *,
    pending_id: str,
    supabase_url: str,
    publishable_key: str,
    base_url: str,
) -> str:
    payload = json.dumps(
        {
            "pendingId": pending_id,
            "supabaseUrl": supabase_url,
            "publishableKey": publishable_key,
            "baseUrl": base_url,
        }
    )
    return """<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Nexus – Connecting</title>
    <style>
      *{ margin:0; padding:0; box-sizing:border-box; }
      body {
        background:#f5f2ea;
        color:#525051;
        font-family:ui-sans-serif,system-ui,-apple-system,sans-serif;
        min-height:100vh;
        display:flex;
        flex-direction:column;
        align-items:center;
        justify-content:center;
        position:relative;
        overflow:hidden;
      }
      .bg-img {
        position:fixed;
        top:50%;
        left:50%;
        transform:translate(-50%,-50%);
        width:min(500px,80vw);
        border-radius:18px;
        opacity:0.12;
        pointer-events:none;
        z-index:0;
      }
      main {
        position:relative;
        z-index:1;
        text-align:center;
        padding:2rem;
      }
      h1 {
        font-size:2.4rem;
        font-weight:700;
        margin-bottom:0.6rem;
        color:#3a3838;
      }
      p {
        font-size:1.15rem;
        color:#9B9692;
        line-height:1.5;
      }
      .spinner { display:inline-block; width:18px; height:18px; border:2px solid #3a3838; border-top-color:transparent; border-radius:50%; animation:spin .6s linear infinite; vertical-align:middle; margin-right:8px; }
      @keyframes spin { to { transform:rotate(360deg); } }
      pre { white-space:pre-wrap; word-break:break-word; color:#c44; margin-top:1rem; font-size:.9rem; }
    </style>
    <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
  </head>
  <body>
    <img class="bg-img" src="https://kushalsm.com/playground_pic.png" alt="" />
    <main>
      <h1>Nexus</h1>
      <p id="status"><span class="spinner"></span>Connecting...</p>
      <pre id="error" hidden></pre>
    </main>
    <script>
      const config = __CONFIG__;
      const client = window.supabase.createClient(config.supabaseUrl, config.publishableKey, {
        auth: {
          autoRefreshToken: false,
          persistSession: true,
          detectSessionInUrl: false,
          flowType: "pkce"
        }
      });
      function clientLabel(redirectUri) {
        if (!redirectUri) return null;
        if (redirectUri.includes("claude.ai") || redirectUri.includes("claude.com")) return "Claude";
        if (redirectUri.includes("chatgpt.com") || redirectUri.includes("openai.com")) return "ChatGPT";
        return null;
      }

      async function init() {
        const statusEl = document.getElementById("status");
        const searchParams = new URLSearchParams(window.location.search);
        const code = searchParams.get("code");
        if (!code) throw new Error("Missing code.");

        statusEl.innerHTML = '<span class="spinner"></span>Signing in...';
        const { error } = await client.auth.exchangeCodeForSession(code);
        if (error) throw error;

        const { data } = await client.auth.getSession();
        const accessToken = data.session?.access_token;
        if (!accessToken) throw new Error("Session not established.");

        const pendingResp = await fetch(`${config.baseUrl}/oauth/pending?pending_id=${encodeURIComponent(config.pendingId)}`);
        const pending = pendingResp.ok ? await pendingResp.json() : null;
        const label = clientLabel(pending?.redirect_uri);
        const target = label ? ` to ${label}` : "";

        statusEl.innerHTML = '<span class="spinner"></span>Redirecting' + target + '...';
        const response = await fetch(`${config.baseUrl}/oauth/decision`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${accessToken}`
          },
          body: JSON.stringify({ pending_id: config.pendingId, action: "approve" })
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || response.statusText);
        window.location.assign(payload.redirect_to);
        setTimeout(() => window.close(), 1000);
      }
      init().catch((error) => {
        document.getElementById("status").textContent = "Something went wrong.";
        const el = document.getElementById("error");
        el.hidden = false;
        el.textContent = error.message || String(error);
      });
    </script>
  </body>
</html>
""".replace("__CONFIG__", payload.replace("</", "<\\/"))
