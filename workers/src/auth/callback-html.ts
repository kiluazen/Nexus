export function callbackHtml(opts: {
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
    <title>Nexus – Connecting</title>
    <style>
      *{ margin:0; padding:0; box-sizing:border-box; }
      body { background:#f5f2ea; color:#525051;
        font-family:ui-sans-serif,system-ui,-apple-system,sans-serif;
        min-height:100vh; display:flex; flex-direction:column;
        align-items:center; justify-content:center; position:relative; overflow:hidden; }
      .bg-img { position:fixed; top:50%; left:50%;
        transform:translate(-50%,-50%); width:min(500px,80vw);
        border-radius:18px; opacity:0.12; pointer-events:none; z-index:0; }
      main { position:relative; z-index:1; text-align:center; padding:2rem; }
      h1 { font-size:2.4rem; font-weight:700; margin-bottom:0.6rem; color:#3a3838; }
      p { font-size:1.15rem; color:#9B9692; line-height:1.5; }
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
      <p id="subtitle"></p>
      <p id="status"><span class="spinner"></span>Connecting...</p>
      <pre id="error" hidden></pre>
    </main>
    <script>
      const config = __CONFIG__;
      const client = window.supabase.createClient(config.supabaseUrl, config.publishableKey, {
        auth: { autoRefreshToken: false, persistSession: true, detectSessionInUrl: false, flowType: "pkce" }
      });
      document.getElementById("subtitle").textContent = "Connect Nexus to " + config.clientName + ".";

      async function init() {
        const statusEl = document.getElementById("status");
        const code = new URLSearchParams(window.location.search).get("code");
        if (!code) throw new Error("Missing code.");

        statusEl.innerHTML = '<span class="spinner"></span>Signing you in…';
        const { error } = await client.auth.exchangeCodeForSession(code);
        if (error) throw error;

        const { data } = await client.auth.getSession();
        const accessToken = data.session?.access_token;
        if (!accessToken) throw new Error("Session not established.");

        statusEl.innerHTML = '<span class="spinner"></span>Connecting to ' + config.clientName + '…';
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
        statusEl.innerHTML = '<span class="spinner"></span>Connected. Returning you to ' + config.clientName + '…';
        window.location.assign(payload.redirect_to);
        setTimeout(() => window.close(), 1500);
      }
      init().catch((error) => {
        document.getElementById("status").textContent = "Something went wrong.";
        const el = document.getElementById("error");
        el.hidden = false;
        el.textContent = error.message || String(error);
      });
    </script>
  </body>
</html>`;
