/* ============================================================
   help.js — "How to Play" instructions modal.
   Opens on demand via the header button, and once automatically on
   a player's first visit (remembered in localStorage so it doesn't
   nag). Closes via the ×, the "Got it" button, a backdrop click, or
   the Escape key.
   ============================================================ */
(function () {
  "use strict";

  function ready(fn) {
    if (document.readyState === "loading")
      document.addEventListener("DOMContentLoaded", fn);
    else fn();
  }

  ready(function () {
    const modal = document.getElementById("help-modal");
    if (!modal) return;
    const openBtn = document.getElementById("help-open");
    const closeBtn = document.getElementById("help-close");
    const okBtn = document.getElementById("help-ok");

    const open = () => modal.classList.add("open");
    const close = () => modal.classList.remove("open");

    if (openBtn) openBtn.addEventListener("click", open);
    if (closeBtn) closeBtn.addEventListener("click", close);
    if (okBtn) okBtn.addEventListener("click", close);

    // Click on the dark backdrop (outside the card) closes it.
    modal.addEventListener("click", (e) => { if (e.target === modal) close(); });
    // Escape closes it.
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && modal.classList.contains("open")) close();
    });

    // Auto-show once for first-time visitors.
    let seen = false;
    try { seen = localStorage.getItem("cotuong-help-seen") === "1"; } catch (_) {}
    if (!seen) {
      open();
      try { localStorage.setItem("cotuong-help-seen", "1"); } catch (_) {}
    }
  });
})();
