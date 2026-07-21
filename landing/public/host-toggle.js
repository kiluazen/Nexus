// ChatGPT/Claude toggle on /get-started. External file because the site CSP
// is script-src 'self' (no inline).
const setHost = (host) => {
  document.body.classList.toggle("claude", host === "claude");
  for (const b of document.querySelectorAll(".host-btn"))
    b.setAttribute("aria-selected", String(b.dataset.host === host));
};
for (const b of document.querySelectorAll(".host-btn"))
  b.addEventListener("click", () => setHost(b.dataset.host));
if (location.hash === "#claude") setHost("claude");
