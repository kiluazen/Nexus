export function consentHtml(opts: {
  nonce: string;
  clientName: string;
  supabaseUrl: string;
  publishableKey: string;
  baseUrl: string;
}): string {
  const payload = JSON.stringify({
    nonce: opts.nonce,
    clientName: opts.clientName,
    supabaseUrl: opts.supabaseUrl,
    publishableKey: opts.publishableKey,
    baseUrl: opts.baseUrl,
  }).replace(/</g, "\\u003c");

  return TEMPLATE.replace("__CONFIG__", payload);
}

const TEMPLATE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Nexus – Sign in</title>
    <style>
      *{ margin:0; padding:0; box-sizing:border-box; }
      body {
        background:#f5f2ea; color:#525051;
        font-family:ui-sans-serif,system-ui,-apple-system,sans-serif;
        min-height:100vh; display:flex; flex-direction:column;
        align-items:center; justify-content:center;
        position:relative; overflow:hidden;
      }
      .bg-img { position:fixed; top:50%; left:50%;
        transform:translate(-50%,-50%); width:min(500px,80vw);
        border-radius:18px; opacity:0.12; pointer-events:none; z-index:0; }
      main { position:relative; z-index:1; text-align:center; padding:2rem; max-width:400px; }
      h1 { font-size:2.4rem; font-weight:700; margin-bottom:0.6rem; color:#3a3838; }
      p { font-size:1.15rem; color:#9B9692; line-height:1.5; margin-bottom:1.5rem; }
      button { border:0; border-radius:999px; padding:.85rem 1.1rem; font-size:1rem; cursor:pointer; width:100%; }
      button.primary { background:#111; color:#fff; }
      button.primary:hover { background:#333; }
      button.primary:disabled { background:#999; cursor:wait; }
      .divider { display:flex; align-items:center; gap:1rem; margin:1.25rem 0; color:#9B9692; font-size:.875rem; }
      .divider::before, .divider::after { content:""; flex:1; border-top:1px solid #e7dcc6; }
      .email-form { display:none; }
      .email-form input { width:100%; padding:.75rem 1rem; border:1px solid #e7dcc6; border-radius:12px; font-size:1rem; background:#fff; outline:none; }
      .email-form input:focus { border-color:#111; }
      .email-form .fields { display:flex; flex-direction:column; gap:.75rem; margin-bottom:1rem; }
      pre { white-space:pre-wrap; word-break:break-word; color:#c44; margin-top:1rem; font-size:.9rem; }
      .spinner { display:inline-block; width:18px; height:18px; border:2px solid #fff; border-top-color:transparent; border-radius:50%; animation:spin .6s linear infinite; vertical-align:middle; margin-right:8px; }
      @keyframes spin { to { transform:rotate(360deg); } }
      footer { position:fixed; bottom:2rem; z-index:1; text-align:center; }
      footer a { color:#9B9692; text-decoration:none; font-size:0.95rem; }
      footer a:hover { color:#525051; }
      footer a svg { width:20px; height:20px; vertical-align:middle; margin-right:6px; fill:currentColor; }
    </style>
    <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
  </head>
  <body>
    <img class="bg-img" src="https://kushalsm.com/playground_pic.png" alt="" />
    <main>
      <h1>Nexus</h1>
      <p id="subtitle"></p>
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
      const subtitleEl = document.getElementById("subtitle");
      const errorEl = document.getElementById("error");
      subtitleEl.textContent = "Connect Nexus to " + config.clientName + ".";
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

      async function decideApprove(hadExistingSession) {
        const target = config.clientName;
        if (hadExistingSession) {
          statusEl.innerHTML = '<span class="spinner"></span>Found your Nexus session. Connecting to ' + target + '…';
        } else {
          statusEl.innerHTML = '<span class="spinner"></span>Connecting to ' + target + '…';
        }
        loginActions.hidden = true;
        const { data } = await client.auth.getSession();
        const accessToken = data.session?.access_token;
        if (!accessToken) throw new Error("No Nexus session found.");
        const response = await fetch(config.baseUrl + "/oauth/decision", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            nonce: config.nonce,
            action: "approve",
            supabase_token: accessToken,
          })
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || response.statusText);
        statusEl.innerHTML = '<span class="spinner"></span>Connected. Returning you to ' + target + '…';
        window.location.assign(payload.redirect_to);
        setTimeout(() => window.close(), 1500);
      }

      loginButton.addEventListener("click", async () => {
        const redirectTo = config.baseUrl + "/auth/callback?nonce=" + encodeURIComponent(config.nonce);
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
        emailLoginButton.textContent = "Signing in…";
        emailLoginButton.disabled = true;
        const { error } = await client.auth.signInWithPassword({ email, password });
        if (error) {
          emailLoginButton.textContent = "Sign in with email";
          emailLoginButton.disabled = false;
          setError(error.message);
          return;
        }
        try { await decideApprove(); } catch (err) { setError(err.message || String(err)); }
      });

      passwordInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") emailLoginButton.click();
      });

      async function init() {
        if (!config.nonce) {
          setError("Missing authorization nonce.");
          return;
        }
        const { data } = await client.auth.getSession();
        if (data.session) {
          try { await decideApprove(true); } catch (err) { setError(err.message || String(err)); }
          return;
        }
        statusEl.textContent = "Sign in to your Nexus account.";
        loginActions.hidden = false;
        emailForm.style.display = "block";
      }

      init().catch((error) => setError(error instanceof Error ? error.message : String(error)));
    </script>
  </body>
</html>`;
