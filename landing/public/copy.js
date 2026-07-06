const btn = document.getElementById("copy-btn");
const url = document.getElementById("mcp-url");

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for when the async clipboard API is blocked (no user
    // activation, insecure context, older browsers).
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    document.body.removeChild(ta);
    return ok;
  }
}

btn.addEventListener("click", async () => {
  const ok = await copyText(url.textContent.trim());
  btn.textContent = ok ? "Copied" : "Copy manually";
  btn.classList.add("copied");
  setTimeout(() => {
    btn.textContent = "Copy";
    btn.classList.remove("copied");
  }, 1500);
});
