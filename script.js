const header = document.querySelector("[data-header]");

const syncHeader = () => {
  if (!header) return;
  header.toggleAttribute("data-scrolled", window.scrollY > 18);
};

syncHeader();
window.addEventListener("scroll", syncHeader, { passive: true });

document.querySelectorAll("[data-copy-code]").forEach((copyButton) => {
  copyButton.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    const code = button.closest(".code-panel")?.querySelector("code")?.innerText;
    if (!code) return;
    const isEnglish = document.documentElement.lang?.toLowerCase().startsWith("en");
    const copyText = isEnglish ? "Copy" : "复制";
    const copiedText = isEnglish ? "Copied" : "已复制";
    const failedText = isEnglish ? "Failed" : "复制失败";

    try {
      await navigator.clipboard.writeText(code);
      button.textContent = copiedText;
      window.setTimeout(() => {
        button.textContent = copyText;
      }, 1400);
    } catch {
      button.textContent = failedText;
      window.setTimeout(() => {
        button.textContent = copyText;
      }, 1400);
    }
  });
});
