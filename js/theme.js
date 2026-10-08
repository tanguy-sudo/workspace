// @ts-check
// ── theme.js ──

const THEMES = [
  { id: "dark", label: "Dark", bg: "#0d1520", accent: "#f0a030" },
  { id: "light", label: "Light", bg: "#f2efe8", accent: "#c47800" },
  { id: "midnight", label: "Midnight", bg: "#050810", accent: "#4488ff" },
  { id: "nord", label: "Nord", bg: "#1c2130", accent: "#88ccdd" },
  { id: "violet", label: "Violet", bg: "#12101e", accent: "#a070ff" },
  { id: "coffee", label: "Coffee", bg: "#1a1208", accent: "#e8982a" },
  { id: "matcha", label: "Matcha", bg: "#0e1a10", accent: "#66cc66" },
  { id: "rose-pine", label: "Rosé Pine", bg: "#191724", accent: "#ebbcba" },
  { id: "cyberpunk", label: "Cyberpunk", bg: "#080c10", accent: "#00e5ff" },
  { id: "gruvbox", label: "Gruvbox", bg: "#1d2021", accent: "#fabd2f" },
  { id: "sakura", label: "Sakura", bg: "#fdf6f8", accent: "#d4538a" },
  { id: "dusk", label: "Dusk", bg: "#1a1520", accent: "#ff8c69" },
];

function initTheme() {
  const t = getTheme();
  document.documentElement.setAttribute("data-theme", t);
  _applyAccentOverride();
  _renderThemeBtn(t);
  initMobileMenu();
}

/** @param {string} themeId */
function _renderThemeBtn(themeId) {
  const theme = THEMES.find((t) => t.id === themeId) || THEMES[0];
  document.querySelectorAll(".theme-toggle").forEach((btn) => {
    const el = /** @type {HTMLElement} */ (btn);
    el.innerHTML = `<span class="theme-toggle-swatch" style="background:${theme.bg}"><span style="background:${theme.accent}"></span></span>`;
    el.title = `Thème : ${theme.label}`;
  });
}

// Appelée depuis chaque page via addEventListener("click", toggleTheme)
// et depuis global-search.js via toggleTheme() sans argument
/** @param {MouseEvent} [e] */
function toggleTheme(e) {
  const trigger =
    e?.currentTarget instanceof Element
      ? e.currentTarget
      : document.querySelector(".theme-toggle");
  openThemePicker(trigger);
}

/** @param {Element|null} trigger */
function openThemePicker(trigger) {
  document.querySelectorAll(".theme-picker-popup").forEach((p) => p.remove());

  const current = document.documentElement.getAttribute("data-theme") || "dark";
  const popup = document.createElement("div");
  popup.className = "theme-picker-popup";
  popup.setAttribute("role", "menu");
  popup.addEventListener("click", (e) => e.stopPropagation());

  THEMES.forEach((theme) => {
    const isActive = theme.id === current;
    const item = document.createElement("button");
    item.className = "theme-picker-item" + (isActive ? " active" : "");
    item.setAttribute("role", "menuitem");
    item.innerHTML = `
      <span class="theme-picker-swatch" style="background:${theme.bg}">
        <span class="theme-picker-dot" style="background:${theme.accent}"></span>
      </span>
      <span class="theme-picker-label">${theme.label}</span>
      ${isActive ? '<svg class="theme-picker-check" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="2,6 5,9 10,3"/></svg>' : ""}
    `;
    item.addEventListener("click", () => {
      applyTheme(theme.id);
      _closePopup();
    });
    popup.appendChild(item);
  });

  // Séparateur + sélecteur d'accent custom
  const sep = document.createElement("div");
  sep.className = "theme-picker-sep";
  popup.appendChild(sep);

  const accentRow = document.createElement("div");
  accentRow.className = "theme-picker-accent-row";

  const savedAccent = safeStorageGet("workspace-accent", null);
  // Couleur actuelle : override sauvegardé ou accent du thème actif
  const currentAccent =
    savedAccent || (THEMES.find((t) => t.id === current)?.accent ?? "#f0a030");

  accentRow.innerHTML = `
    <span class="theme-picker-accent-label">Accent</span>
    <input type="color" class="theme-picker-accent-input" value="${currentAccent}" title="Couleur d'accent personnalisée">
    ${savedAccent ? `<button class="theme-picker-accent-reset" title="Remettre l'accent du thème">✕</button>` : ""}
  `;

  const colorInput = accentRow.querySelector(".theme-picker-accent-input");
  colorInput.addEventListener("input", (e) => {
    const hex = /** @type {HTMLInputElement} */ (e.target).value;
    _setAccentVars(hex);
    safeStorageSet("workspace-accent", hex);
    // Met à jour le bouton reset si besoin
    let resetBtn = accentRow.querySelector(".theme-picker-accent-reset");
    if (!resetBtn) {
      resetBtn = document.createElement("button");
      resetBtn.className = "theme-picker-accent-reset";
      resetBtn.title = "Remettre l'accent du thème";
      resetBtn.textContent = "✕";
      resetBtn.addEventListener("click", _doReset);
      accentRow.appendChild(resetBtn);
    }
  });

  function _doReset() {
    safeStorageRemove("workspace-accent");
    _clearAccentOverride();
    accentRow.querySelector(".theme-picker-accent-reset")?.remove();
    const themeAccent =
      THEMES.find((t) => t.id === current)?.accent ?? "#f0a030";
    /** @type {HTMLInputElement} */ (colorInput).value = themeAccent;
  }

  accentRow
    .querySelector(".theme-picker-accent-reset")
    ?.addEventListener("click", _doReset);

  popup.appendChild(accentRow);

  document.body.appendChild(popup);

  popup.style.visibility = "hidden";
  requestAnimationFrame(() => {
    const rect = trigger
      ? trigger.getBoundingClientRect()
      : { bottom: 58, top: 0, right: window.innerWidth };
    const topbarEl = document.querySelector(".topbar");
    const topbarBottom = topbarEl
      ? topbarEl.getBoundingClientRect().bottom
      : rect.bottom;
    const pw = popup.offsetWidth;
    const ph = popup.offsetHeight;
    let top = topbarBottom + 8;
    // Aligne le bord droit de la popup sur le bord droit de la topbar (ou du bouton sur desktop)
    const anchorRight = topbarEl
      ? topbarEl.getBoundingClientRect().right
      : rect.right;
    let left = anchorRight - pw;
    // Clamp : ne pas sortir des bords de l'écran
    if (left + pw > window.innerWidth - 8) left = window.innerWidth - pw - 8;
    if (left < 8) left = 8;
    if (top + ph > window.innerHeight - 8) {
      const topbarTop = topbarEl
        ? topbarEl.getBoundingClientRect().top
        : rect.top;
      top = topbarTop - ph - 8;
      if (top < 8) top = 8;
    }
    popup.style.top = top + "px";
    popup.style.left = left + "px";
    popup.style.visibility = "";
  });

  function _closePopup() {
    popup.remove();
    document.removeEventListener("click", _onOutside);
    document.removeEventListener("keydown", _onKey);
  }
  function _onOutside() {
    _closePopup();
  }
  /** @param {KeyboardEvent} e */
  function _onKey(e) {
    if (e.key === "Escape") _closePopup();
  }

  setTimeout(() => {
    document.addEventListener("click", _onOutside);
    document.addEventListener("keydown", _onKey);
  }, 0);
}

/** @param {string} themeId */
function applyTheme(themeId) {
  document.documentElement.setAttribute("data-theme", themeId);
  setTheme(themeId);
  // Réinitialise l'accent custom pour adopter celui du nouveau thème
  safeStorageRemove("workspace-accent");
  _clearAccentOverride();
  _renderThemeBtn(themeId);
}

// ── Accent personnalisé ────────────────────────────────────

/** Convertit un hex (#rrggbb) en { r, g, b } */
function _hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/** Convertit { r, g, b } en HSL { h, s, l } (s et l en 0-100) */
function _rgbToHsl({ r, g, b }) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b);
  let h, s;
  const l = (max + min) / 2;
  if (max === min) {
    h = s = 0;
  } else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        break;
      case g:
        h = ((b - r) / d + 2) / 6;
        break;
      default:
        h = ((r - g) / d + 4) / 6;
    }
  }
  return {
    h: Math.round(h * 360),
    s: Math.round(s * 100),
    l: Math.round(l * 100),
  };
}

/** Applique les 3 variables CSS d'accent depuis un hex */
function _setAccentVars(hex) {
  const { r, g, b } = _hexToRgb(hex);
  const { h, s, l } = _rgbToHsl({ r, g, b });
  const hiL = Math.min(l + 15, 92);
  const root = document.documentElement;
  root.style.setProperty("--accent", hex);
  root.style.setProperty("--accent-dim", `rgba(${r},${g},${b},0.13)`);
  root.style.setProperty("--accent-hi", `hsl(${h},${s}%,${hiL}%)`);
}

/** Efface les surcharges (retour aux vars du thème) */
function _clearAccentOverride() {
  const root = document.documentElement;
  root.style.removeProperty("--accent");
  root.style.removeProperty("--accent-dim");
  root.style.removeProperty("--accent-hi");
}

/** Relit le localStorage et applique si présent */
function _applyAccentOverride() {
  const saved = safeStorageGet("workspace-accent", null);
  if (saved) _setAccentVars(saved);
}

// Horloge dans la topbar
function initClock() {
  const el = document.querySelector(".topbar-clock");
  if (!el) return;
  const tick = () => {
    const now = new Date();
    el.textContent = now.toLocaleTimeString("fr-FR", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  };
  tick();
  setInterval(tick, 1000);
}
