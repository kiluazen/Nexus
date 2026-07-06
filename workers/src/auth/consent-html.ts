// Consent + sign-in page for the OAuth authorize flow. It supports the normal
// email-code path plus a configured reviewer password for app review.
export function consentHtml(opts: { nonce: string; clientName: string }): string {
  const clientName = escapeHtml(opts.clientName);
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Connect Nexus</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    background: #f5f2ea; color: #525051;
    font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
    min-height: 100vh; margin: 0; display: flex; align-items: center; justify-content: center;
    padding: 2rem;
  }
  .card { width: 100%; max-width: 22rem; text-align: center; }
  h1 { color: #3a3838; font-size: 1.6rem; margin: 0 0 .4rem; }
  .sub { color: #9B9692; line-height: 1.5; margin: 0 0 1.6rem; font-size: .95rem; }
  .sub b { color: #525051; font-weight: 600; }
  input {
    width: 100%; padding: .7rem .9rem; font-size: 1rem; color: #3a3838;
    border: 1px solid #d8d2c4; border-radius: .6rem; background: #fffdf8; outline: none;
    text-align: center;
  }
  input + input { margin-top: .6rem; }
  input:focus { border-color: #b8b0a0; }
  input.code { letter-spacing: .5em; font-size: 1.3rem; font-variant-numeric: tabular-nums; }
  button {
    width: 100%; margin-top: .8rem; padding: .7rem; font-size: 1rem; font-weight: 600;
    color: #f5f2ea; background: #3a3838; border: 0; border-radius: .6rem; cursor: pointer;
  }
  button:disabled { opacity: .5; cursor: default; }
  button.ghost { background: transparent; color: #9B9692; font-weight: 500; margin-top: .4rem; }
  .hint { color: #9B9692; font-size: .83rem; min-height: 1.1rem; margin-top: .65rem; }
  .err { color: #b0504a; font-size: .875rem; min-height: 1.2rem; margin-top: .7rem; }
</style>
</head>
<body>
<div class="card">
  <h1>Nexus</h1>
  <p class="sub"><b>${clientName}</b> wants to connect to your Nexus log.<br/>Sign in with your email to continue.</p>

  <form id="signin">
    <input id="email" type="email" placeholder="you@example.com" autocomplete="email" required autofocus/>
    <input id="code" type="password" autocomplete="one-time-code" placeholder="Code or reviewer password" required/>
    <button id="verify" type="submit">Verify &amp; connect</button>
    <button id="send" class="ghost" type="button">Email me a code</button>
    <button class="ghost" type="button" onclick="deny()">Cancel</button>
  </form>

  <div class="hint" id="hint"></div>
  <div class="err" id="err"></div>
</div>
<script>
  const nonce = ${JSON.stringify(opts.nonce)};
  const $ = (s) => document.querySelector(s);
  const err = (m) => { $("#err").textContent = m || ""; };
  const hint = (m) => { $("#hint").textContent = m || ""; };

  async function post(body) {
    const r = await fetch("/oauth/decision", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ nonce, ...body }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || "Something went wrong.");
    return data;
  }

  $("#send").addEventListener("click", async () => {
    err(""); hint("");
    const email = $("#email").value.trim();
    if (!email) return;
    $("#send").disabled = true; $("#send").textContent = "Sending…";
    try {
      await post({ action: "request_code", email });
      hint("Code sent. Paste it above, then connect.");
      $("#code").focus();
    } catch (ex) {
      err(ex.message);
    } finally {
      $("#send").disabled = false; $("#send").textContent = "Email me a code";
    }
  });

  $("#signin").addEventListener("submit", async (e) => {
    e.preventDefault(); err("");
    const email = $("#email").value.trim();
    const code = $("#code").value.trim();
    if (!email) { err("Enter your email."); return; }
    if (!code) { err("Enter your email code or reviewer password."); return; }
    $("#verify").disabled = true; $("#verify").textContent = "Verifying…";
    try {
      const data = await post({ action: "approve", email, code });
      window.location.href = data.redirect_to;
    } catch (ex) {
      err(ex.message);
      $("#verify").disabled = false; $("#verify").textContent = "Verify & connect";
    }
  });

  async function deny() {
    try {
      const data = await post({ action: "deny" });
      window.location.href = data.redirect_to;
    } catch (ex) { err(ex.message); }
  }
</script>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
