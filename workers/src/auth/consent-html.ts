// Consent + sign-in page for the OAuth authorize flow.
//
// Styled to match the Nexus landing page (nexus.kushalsm.com): cream paper,
// cobalt ink, Geist type, and the Venus / Discobolus figures flanking the card
// on wide screens (they fall back to faint bottom-corner accents on narrow /
// popup / phone widths so they never crowd the form). Images are referenced
// from the landing domain — they're decorative, so a miss degrades gracefully.
//
// Two ways in, both immediate (no email code, no verification — what the OpenAI
// review requires of the credentials we submit):
//   1. Sign in with Google  -> /auth/google/start?nonce=...
//   2. Email + password      -> POST /oauth/decision {action: signin|signup}
// Sign-in is the default; "Create an account" toggles to signup in place.
const LANDING = "https://nexus.kushalsm.com";

export function consentHtml(opts: {
  nonce: string;
  clientName: string;
  googleEnabled: boolean;
}): string {
  const clientName = escapeHtml(opts.clientName);
  const googleBlock = opts.googleEnabled
    ? `
  <button type="button" class="google" id="google">
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"/><path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.02-3.7H.96v2.34A9 9 0 0 0 9 18z"/><path fill="#FBBC05" d="M3.98 10.72a5.4 5.4 0 0 1 0-3.44V4.96H.96a9 9 0 0 0 0 8.1l3.02-2.34z"/><path fill="#EA4335" d="M9 3.58c1.32 0 2.5.46 3.44 1.35l2.58-2.58C13.47.9 11.43 0 9 0A9 9 0 0 0 .96 4.96l3.02 2.34C4.68 5.16 6.66 3.58 9 3.58z"/></svg>
    <span>Continue with Google</span>
  </button>
  <div class="divider"><span>or</span></div>`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Connect Nexus</title>
<link rel="icon" href="${LANDING}/favicon.ico"/>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500&family=Geist+Mono:wght@400;500&display=swap"/>
<style>
  :root {
    color-scheme: light;
    --paper: #fbf8f1; --cream: #f4efe6; --ink: #1d2bb8; --body-ink: #0a0a23;
    --muted: rgba(10,10,35,.55); --line: rgba(29,43,184,.18); --panel: rgba(255,252,246,.72);
    --font-sans: "Geist", -apple-system, system-ui, sans-serif;
    --font-mono: "Geist Mono", ui-monospace, monospace;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: var(--font-sans); color: var(--body-ink); background: var(--cream);
    min-height: 100dvh; display: flex; align-items: center; justify-content: center;
    padding: 24px; line-height: 1.5; overflow-x: hidden;
  }
  /* Figures: faint bottom-corner accents by default (safe at any width);
     full flanking treatment only when there's room for it. */
  .bg-art {
    position: fixed; inset: 0; z-index: -1; pointer-events: none;
    background-image: url(${LANDING}/assets/venus.webp?v=4), url(${LANDING}/assets/discobolus.webp?v=3);
    background-repeat: no-repeat, no-repeat;
    background-position: left -5vw bottom, right -6vw bottom;
    background-size: auto 42%, auto 46%;
    opacity: .5;
  }
  @media (min-width: 1000px) {
    .bg-art {
      background-position: left 3vw center, right 2vw center;
      background-size: auto 82%, auto 90%;
      opacity: .9;
    }
  }
  .card {
    width: 100%; max-width: 380px; min-width: 0; text-align: center;
    background: var(--panel); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
    border: 1px solid var(--line); border-radius: 16px; padding: 34px 30px;
  }
  .brand { display: inline-flex; align-items: center; gap: 9px; margin-bottom: 14px; }
  .brand img { width: 28px; height: 28px; border-radius: 7px; display: block; }
  .brand span { font-size: 24px; font-weight: 500; letter-spacing: -.02em; color: var(--ink); }
  .sub { color: var(--muted); font-size: 14.5px; margin: 0 auto 22px; max-width: 30ch; }
  .sub b { color: var(--body-ink); font-weight: 500; }
  label {
    display: block; text-align: left; font-family: var(--font-mono);
    font-size: 11px; letter-spacing: .05em; text-transform: uppercase;
    color: var(--muted); margin: 14px 0 6px;
  }
  input {
    width: 100%; padding: 12px 14px; font-size: 15px; font-family: var(--font-sans);
    color: var(--body-ink); background: var(--paper); border: 1px solid var(--line);
    border-radius: 9px; outline: none;
  }
  input:focus { border-color: var(--ink); }
  button {
    width: 100%; margin-top: 18px; padding: 13px; font-size: 15px; font-weight: 500;
    font-family: var(--font-sans); color: var(--paper); background: var(--ink);
    border: 0; border-radius: 9px; cursor: pointer; transition: background .15s ease;
  }
  button:hover { background: var(--body-ink); }
  button:disabled { opacity: .5; cursor: default; }
  button.google {
    color: var(--body-ink); background: var(--paper); border: 1px solid var(--line);
    margin-top: 0; display: flex; align-items: center; justify-content: center; gap: 9px;
  }
  button.google:hover { background: #fff; }
  .divider {
    display: flex; align-items: center; gap: 12px; margin: 16px 0 2px;
    color: var(--muted); font-family: var(--font-mono); font-size: 12px;
  }
  .divider::before, .divider::after { content: ""; flex: 1; height: 1px; background: var(--line); }
  .toggle { margin-top: 16px; font-size: 13.5px; color: var(--muted); }
  .toggle a { color: var(--ink); font-weight: 500; text-decoration: none; cursor: pointer; }
  .err { color: #b0322c; font-size: 13px; min-height: 1.1em; margin-top: 12px; }
  @media (max-width: 480px) {
    body { padding: 14px; }
    .card { padding: 26px 20px; border-radius: 14px; }
  }
</style>
</head>
<body>
<div class="bg-art" aria-hidden="true"></div>
<main class="card">
  <div class="brand"><img src="${LANDING}/assets/nexus-logo-256.png" alt=""/><span>Nexus</span></div>
  <p class="sub"><b>${clientName}</b> wants to connect to your Nexus log.</p>
${googleBlock}
  <form id="form">
    <label for="email">Email</label>
    <input id="email" type="email" placeholder="you@example.com" autocomplete="email" required autofocus/>
    <label for="password">Password</label>
    <input id="password" type="password" placeholder="••••••••" autocomplete="current-password" required/>
    <button id="submit" type="submit">Sign in</button>
  </form>
  <p class="toggle" id="toggle">New to Nexus? <a id="toggle-link">Create an account</a></p>
  <div class="err" id="err"></div>
</main>
<script>
  const nonce = ${JSON.stringify(opts.nonce)};
  const $ = (s) => document.querySelector(s);
  const err = (m) => { $("#err").textContent = m || ""; };
  let mode = "signin"; // "signin" | "signup"

  function applyMode() {
    const signin = mode === "signin";
    $("#submit").textContent = signin ? "Sign in" : "Create account";
    $("#password").autocomplete = signin ? "current-password" : "new-password";
    $("#toggle").innerHTML = signin
      ? 'New to Nexus? <a id="toggle-link">Create an account</a>'
      : 'Already have an account? <a id="toggle-link">Sign in</a>';
    $("#toggle-link").addEventListener("click", () => { mode = signin ? "signup" : "signin"; err(""); applyMode(); });
  }

  async function post(body) {
    const r = await fetch("/oauth/decision", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ nonce, ...body }),
    });
    const data = await r.json().catch(() => ({}));
    return { ok: r.ok, data };
  }

  $("#form").addEventListener("submit", async (e) => {
    e.preventDefault(); err("");
    const email = $("#email").value.trim();
    const password = $("#password").value;
    if (!email || !password) return;
    $("#submit").disabled = true;
    $("#submit").textContent = mode === "signin" ? "Signing in…" : "Creating…";
    try {
      const { ok, data } = await post({ action: mode, email, password });
      if (ok && data.redirect_to) { window.location.href = data.redirect_to; return; }
      if (data.code === "no_account") { mode = "signup"; applyMode(); err("No account yet — set a password to create one."); }
      else if (data.code === "exists") { mode = "signin"; applyMode(); err("You already have an account. Enter your password to sign in."); }
      else err(data.error || "Something went wrong.");
    } catch (ex) {
      err("Network error. Try again.");
    } finally {
      // Re-derive from the CURRENT mode: an auto-switch (no_account/exists) may
      // have flipped it, so restoring a captured pre-request label would leave
      // the button contradicting the form (e.g. "Sign in" while in signup mode).
      $("#submit").disabled = false;
      $("#submit").textContent = mode === "signin" ? "Sign in" : "Create account";
    }
  });

  applyMode();
</script>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
