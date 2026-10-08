// @ts-check
// ── shortcuts.js ── raccourcis clavier ──

// État navigation rapide (g + lettre)
let _gMode = false,
  _gTimer = null;

// Panneau d'aide raccourcis (?)
function _showShortcutsHelp() {
  const existing = document.getElementById("sc-help-overlay");
  if (existing) {
    existing.remove();
    return;
  }
  const el = document.createElement("div");
  el.id = "sc-help-overlay";
  el.innerHTML = `
<div id="sc-help-box">
  <div id="sc-help-header"><strong>Raccourcis clavier</strong><button id="sc-help-close" aria-label="Fermer">✕</button></div>
  <div id="sc-help-grid">
    <div class="sc-group"><div class="sc-group-title">Navigation</div>
      <div class="sc-row"><kbd>Ctrl</kbd><kbd>K</kbd><span>Palette de recherche</span></div>
      <div class="sc-row"><kbd>g</kbd><kbd>h</kbd><span>Tableau de bord</span></div>
      <div class="sc-row"><kbd>g</kbd><kbd>t</kbd><span>Tâches</span></div>
      <div class="sc-row"><kbd>g</kbd><kbd>s</kbd><span>Snippets</span></div>
      <div class="sc-row"><kbd>g</kbd><kbd>j</kbd><span>Journal</span></div>
      <div class="sc-row"><kbd>g</kbd><kbd>p</kbd><span>Projets</span></div>
      <div class="sc-row"><kbd>g</kbd><kbd>r</kbd><span>RH</span></div>
      <div class="sc-row"><kbd>g</kbd><kbd>e</kbd><span>Export</span></div>
      <div class="sc-row"><kbd>g</kbd><kbd>n</kbd><span>Planification</span></div>
    </div>
    <div class="sc-group"><div class="sc-group-title">Actions</div>
      <div class="sc-row"><kbd>N</kbd><span>Nouvel élément</span></div>
      <div class="sc-row"><kbd>Ctrl</kbd><kbd>N</kbd><span>Nouvel élément</span></div>
      <div class="sc-row"><kbd>Enter</kbd><span>Valider la modale</span></div>
      <div class="sc-row"><kbd>Esc</kbd><span>Fermer modale / palette</span></div>
      <div class="sc-row"><kbd>?</kbd><kbd>,</kbd><span>Afficher cette aide</span></div>
    </div>
  </div>
</div>`;
  Object.assign(el.style, {
    position: "fixed",
    inset: "0",
    background: "rgba(0,0,0,.6)",
    backdropFilter: "blur(8px)",
    zIndex: "600",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    animation: "pageFadeIn 180ms ease both",
  });
  const box = el.querySelector("#sc-help-box");
  Object.assign(box.style, {
    background: "var(--bg-2)",
    border: "1px solid var(--border-hi)",
    borderRadius: "var(--r-xl)",
    padding: "var(--sp-5) var(--sp-6)",
    width: "min(540px, calc(100vw - 32px))",
    boxShadow: "var(--shadow-lg)",
    animation: "scaleIn 200ms var(--ease-out, ease) both",
  });
  el.querySelector("#sc-help-header").style.cssText =
    "display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--sp-4)";
  const closeBtn = el.querySelector("#sc-help-close");
  Object.assign(closeBtn.style, {
    background: "none",
    border: "none",
    cursor: "pointer",
    color: "var(--text-3)",
    fontSize: "1rem",
    padding: "4px 8px",
    borderRadius: "var(--r-sm)",
  });
  closeBtn.addEventListener("click", () => el.remove());
  el.addEventListener("click", (e) => {
    if (e.target === el) el.remove();
  });
  el.addEventListener("keydown", (e) => {
    if (e.key === "Escape") el.remove();
  });

  // Styles inline pour le grid (évite d'avoir besoin d'un nouveau fichier CSS)
  const style = document.createElement("style");
  style.textContent = `
    #sc-help-grid { display:grid; grid-template-columns:1fr 1fr; gap:var(--sp-5); }
    .sc-group-title { font-family:var(--font-mono,monospace); font-size:.65rem; text-transform:uppercase;
      letter-spacing:.1em; color:var(--text-3); margin-bottom:var(--sp-3); }
    .sc-row { display:flex; align-items:center; gap:6px; font-size:.83rem;
      color:var(--text-2); margin-bottom:var(--sp-2); }
    .sc-row span { margin-left:auto; color:var(--text-3); font-size:.78rem; }
    kbd { display:inline-flex; align-items:center; justify-content:center;
      background:var(--bg-3); border:1px solid var(--border-hi);
      border-radius:5px; padding:1px 6px; font-family:var(--font-mono,monospace);
      font-size:.72rem; color:var(--text); min-width:22px;
      box-shadow:0 1px 0 var(--border-hi); }
  `;
  el.appendChild(style);
  document.body.appendChild(el);
  closeBtn.focus();
}

document.addEventListener("keydown", (e) => {
  const tag = document.activeElement?.tagName?.toLowerCase();
  const typing = ["input", "select"].includes(tag);
  const inTextarea = tag === "textarea";

  // Ctrl+K ou Ctrl+Espace — recherche globale
  if (
    (e.ctrlKey || e.metaKey) &&
    (e.code === "Space" || String(e.key || "").toLowerCase() === "k")
  ) {
    e.preventDefault();
    window.openGlobalSearch?.();
    return;
  }

  // Escape — fermer modal ou palette
  if (e.key === "Escape") {
    const modal = document.querySelector(".modal-overlay.open");
    if (modal) {
      modal.classList.remove("open");
      modal.classList.add("closing");
      setTimeout(() => modal.remove(), 220);
      document.body.style.overflow = "";
      return;
    }
    const scHelp = document.getElementById("sc-help-overlay");
    if (scHelp) {
      scHelp.remove();
      return;
    }
    window.closeGlobalSearch?.();
    return;
  }

  // Entrée — valider la modale ouverte (sauf dans textarea)
  if (e.key === "Enter" && !inTextarea && !e.shiftKey) {
    const modal = document.querySelector(".modal-overlay.open");
    if (modal) {
      e.preventDefault();
      modal.querySelector(".btn-confirm")?.click();
      return;
    }
  }

  // Navigation rapide « g + lettre » (pas en train de taper)
  if (!typing && !inTextarea && !e.ctrlKey && !e.metaKey) {
    if (e.key === "g") {
      e.preventDefault();
      _gMode = true;
      clearTimeout(_gTimer);
      _gTimer = setTimeout(() => {
        _gMode = false;
      }, 1200);
      return;
    }
    if (_gMode) {
      _gMode = false;
      clearTimeout(_gTimer);
      const pages = {
        h: "index.html",
        t: "todos.html",
        s: "snippets.html",
        j: "journal.html",
        p: "projects.html",
        r: "rh.html",
        e: "export.html",
        n: "smart-planning.html",
      };
      if (pages[e.key]) {
        e.preventDefault();
        location.href = pages[e.key];
      }
      return;
    }

    // ? — aide raccourcis
    if (e.key === "?" || e.key === ",") {
      e.preventDefault();
      _showShortcutsHelp();
      return;
    }

    // N — nouveau (sans Ctrl, hors zone de saisie)
    if (e.key === "n") {
      e.preventDefault();
      const btn =
        document.getElementById("btn-new-entry") ||
        document.getElementById("btn-new-project") ||
        document.getElementById("btn-new-item") ||
        document.getElementById("btn-new-todo") ||
        document.getElementById("btn-new-snippet") ||
        document.getElementById("btn-new-doc");
      btn?.click();
      return;
    }
  }

  // Ctrl+N — nouveau élément (toujours actif, même en zone de saisie)
  if ((e.ctrlKey || e.metaKey) && e.key === "n" && !e.shiftKey) {
    e.preventDefault();
    const btn =
      document.getElementById("btn-new-entry") ||
      document.getElementById("btn-new-project") ||
      document.getElementById("btn-new-item") ||
      document.getElementById("btn-new-todo") ||
      document.getElementById("btn-new-snippet") ||
      document.getElementById("btn-new-doc");
    btn?.click();
    return;
  }
});
