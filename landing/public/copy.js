const btn = document.getElementById("copy-btn");
const url = document.getElementById("mcp-url");

btn.addEventListener("click", async () => {
  await navigator.clipboard.writeText(url.textContent.trim());
  btn.textContent = "Copied";
  btn.classList.add("copied");
  setTimeout(() => {
    btn.textContent = "Copy";
    btn.classList.remove("copied");
  }, 1500);
});
