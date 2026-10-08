// @ts-check
// ── components.js ── générateurs HTML partagés ──
//
// STRUCTURE DES DÉPENDANCES :
// - Ce fichier charge sur TOUTES les pages HTML (voir index.html, projects.html, etc.)
// - Il dépend de: db.js, storage.js, router.js
// - Il fournit: modals, toasts, forms, date pickers, etc.
// - Utilitaires externalisés vers des modules séparés:
//   * modal-utils.js — gestion de taille/persistance des modals
//   * date-picker-utils.js — logique de calendrier et formatage de dates
//   * markdown-editor.js — éditeur markdown (charge séparément, partout)
//
// PATTERN DE CHARGEMENT GLOBAL :
// Chaque page HTML charge ces scripts dans cet ordre:
//   1. Dexie (DB)
//   2. DB wrapper
//   3. Storage, SafeStorage, CommonUtils
//   4. Router, Components, ModalUtils, DatePickerUtils
//   5. Theme, GlobalSearch, Shortcuts, DragDrop, WikiLinks, MarkdownEditor
//   6. Favorites
//   7. Page-specific (pages/home.js, pages/projects.js, etc.)
//
// NOTES D'OPTIMISATION :
// - markdown-editor.js se charge partout car utilisé par: project, journal, export
// - Si vous segmentez par page, déplacez markdown-editor.js dans les pages spécifiques
// - La charge de MarkdownEditor sur les pages simples (index, settings) est mineure (~50KB)

const MODAL_CLOSE_DELAY_MS = 220; // durée animation fermeture modal
const TOAST_DURATION_MS = 2400; // durée affichage toast
const TOAST_FADE_OUT_MS = 300; // durée fondu sortie toast
const REMINDER_CHECK_INTERVAL_MS = 30 * 1000;
const REMINDER_OVERDUE_NOTIFY_WINDOW_MS = 24 * 60 * 60 * 1000;
// ↓ Constantes de modal déplacées dans js/modal-utils.js ↓

const COLORS = [
  "#64b0ff",
  "#b482ff",
  "#f0a030",
  "#ff7080",
  "#4ecb8d",
  "#ff8c64",
  "#e8d44d",
  "#40d9c0",
];

const LANGUAGES = [
  "javascript",
  "typescript",
  "python",
  "markdown",
  "bash",
  "sql",
  "html",
  "css",
  "json",
  "yaml",
  "dockerfile",
  "rust",
  "go",
  "java",
  "php",
  "ruby",
  "plaintext",
];

let _globalReminderTimer = null;

function _parseReminderStore() {
  try {
    const raw = localStorage.getItem("workspace-reminder-fired-v1");
    return raw ? JSON.parse(raw) : {};
  } catch (_) {
    return {};
  }
}

function _saveReminderStore(store) {
  try {
    localStorage.setItem("workspace-reminder-fired-v1", JSON.stringify(store));
  } catch (_) {}
}

function _getTodoReminderDueTs(todo) {
  if (todo?.reminderAt) {
    const ts = Date.parse(todo.reminderAt);
    if (!isNaN(ts)) return ts;
  }
  if (todo?.dueDate) {
    const ts = Date.parse(todo.dueDate + "T23:59:59");
    if (!isNaN(ts)) return ts;
  }
  return null;
}

function _ensureReminderNotificationPermission() {
  if (typeof Notification === "undefined") return;
  if (
    Notification.permission === "default" &&
    !localStorage.getItem("workspace-notif-asked")
  ) {
    localStorage.setItem("workspace-notif-asked", "1");
    Notification.requestPermission().catch(() => {});
  }
}

function _checkGlobalDueReminders() {
  const now = Date.now();
  const todos = typeof getTodos === "function" ? getTodos() : [];
  if (!todos?.length) return;

  const firedStore = _parseReminderStore();
  let changed = false;

  for (const todo of todos) {
    if (!todo || todo.status === "done") continue;
    const dueTs = _getTodoReminderDueTs(todo);
    if (dueTs == null || dueTs > now) continue;
    if (now - dueTs > REMINDER_OVERDUE_NOTIFY_WINDOW_MS) continue;

    const key = `${todo.id}:${dueTs}`;
    if (firedStore[key]) continue;

    const title = todo.title || "Tâche";
    const ctx = todo.context ? `@${todo.context}` : "Échéance atteinte";

    try {
      showToast(`⏰ Rappel : ${title}`, "error");
      if (typeof Notification !== "undefined" && Notification.permission === "granted") {
        new Notification("Rappel : " + title, {
          body: ctx,
          tag: "workspace-rem-" + todo.id,
        });
      }
    } catch (_) {}

    firedStore[key] = now;
    changed = true;
  }

  if (changed) {
    const cutoff = now - 30 * 24 * 60 * 60 * 1000;
    Object.keys(firedStore).forEach((k) => {
      if ((firedStore[k] || 0) < cutoff) delete firedStore[k];
    });
    _saveReminderStore(firedStore);
  }
}

function _slugifyModalKey(value) {
  return String(value || "modal")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "modal";
}

// ↓ Fonctions de gestion de taille modale déplacées dans js/modal-utils.js ↓
// (_getModalViewportLimit, _clampModalSize, _loadModalSize, _saveModalSize, _clearModalSize, _initResizableModal)

function initGlobalReminderWatcher() {
  if (_globalReminderTimer) return;
  _ensureReminderNotificationPermission();
  _checkGlobalDueReminders();
  _globalReminderTimer = setInterval(_checkGlobalDueReminders, REMINDER_CHECK_INTERVAL_MS);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") _checkGlobalDueReminders();
  });
}

// ── Icons centralisés ────────────────────────────────────
const IC = {
  folder: `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M1.5 4a1 1 0 011-1h3.17a1 1 0 01.71.29l1.12 1.12a1 1 0 00.71.3H13.5a1 1 0 011 1v6a1 1 0 01-1 1h-11a1 1 0 01-1-1V4z"/></svg>`,
  plus: `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"   stroke-linecap="round"><path d="M8 3v10M3 8h10"/></svg>`,
  search: `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14"/></svg>`,
  trash: `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M2.5 4h11M5 4V2.5h6V4M6.5 7v5M9.5 7v5M3.5 4l.5 9.5h8l.5-9.5"/></svg>`,
  edit: `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M11.5 2.5l2 2-8 8H3.5v-2l8-8z"/></svg>`,
  back: `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M10 3L5 8l5 5"/></svg>`,
  close: `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg>`,
  reset: `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="5" width="6" height="6" rx="1"/><path d="M1.5 1.5L4 4M4 2.5V4M4 4H2.5M14.5 1.5L12 4M12 2.5V4M12 4h1.5M1.5 14.5L4 12M4 12V13.5M4 12H2.5M14.5 14.5L12 12M12 12V13.5M12 12h1.5"/></svg>`,
  chevron: `<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M6 4l4 4-4 4"/></svg>`,
  copy: `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><rect x="5.5" y="5.5" width="8" height="9" rx="1"/><path d="M10.5 5.5V3a1 1 0 00-1-1h-7a1 1 0 00-1 1v8a1 1 0 001 1h2.5"/></svg>`,
  check: `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"   stroke-linecap="round"><path d="M3 8l4 4 6-7"/></svg>`,
  star: `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M8 2l1.6 3.2 3.5.5-2.55 2.48.6 3.5L8 9.96 4.85 11.68l.6-3.5L2.9 5.7l3.5-.5z"/></svg>`,
  starFill: `<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M8 2l1.6 3.2 3.5.5-2.55 2.48.6 3.5L8 9.96 4.85 11.68l.6-3.5L2.9 5.7l3.5-.5z"/></svg>`,
  clock: `<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="8" cy="8" r="6.5"/><path d="M8 4.5v4l2.5 1.5"/></svg>`,
  link: `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M6.5 9.5a4 4 0 005.66-5.66L10.5 2.2A4 4 0 004.84 7.86"/><path d="M9.5 6.5a4 4 0 00-5.66 5.66L5.5 13.8A4 4 0 0011.16 8.14"/></svg>`,
  memo: `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><rect x="2.5" y="1.5" width="11" height="13" rx="1.5"/><path d="M5 5.5h6M5 8h6M5 10.5h4"/></svg>`,
  info: `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="8" cy="8" r="6.5"/><path d="M8 7.5v4M8 5.5v.5"/></svg>`,
  code: `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M5 4l-3 4 3 4M11 4l3 4-3 4M9 2l-2 12"/></svg>`,
  password: `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="7" width="10" height="7" rx="1.5"/><path d="M5.5 7V5.5a2.5 2.5 0 015 0V7"/><circle cx="8" cy="10.5" r=".9"/></svg>`,
  upload: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>`,
  empty: `<svg width="44" height="44" viewBox="0 0 44 44" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"><rect x="6" y="10" width="32" height="26" rx="3"/><path d="M15 22h14M15 28h9"/></svg>`,
  rh: `<svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="8" cy="5" r="2.5"/><path d="M2.5 13.5c0-3 2.5-5 5.5-5s5.5 2 5.5 5"/></svg>`,
  todo: `<svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><rect x="1.5" y="1.5" width="13" height="13" rx="2"/><path d="M5 8l2 2 4-4"/></svg>`,
  snippet: `<svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M5 4l-3 4 3 4M11 4l3 4-3 4M9 2l-2 12"/></svg>`,
  smart: `<svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4"/><circle cx="8" cy="8" r="3"/></svg>`,
  arrow: `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M3 8h10M9 5l4 3-4 3"/></svg>`,
  dep: `<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M8 2v12M4 10l4 4 4-4"/></svg>`,
  pin: `<svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><path d="M9.5 1a.5.5 0 01.35.85L8.5 3.2l.8 3.8 2.85.95a.5.5 0 01.1.9L8.5 11v3.5l-.5.5-.5-.5V11L3.75 8.85a.5.5 0 01.1-.9L6.7 7l.8-3.8L6.15 1.85A.5.5 0 016.5 1h3z"/></svg>`,
  pinOff: `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M9.5 1.5l-3 1.5.5 3.5-3 2 3.5 1.5V13l.5.5.5-.5V10l3.5-1.5-3-2 .5-3.5zM2 14l3.5-3.5"/></svg>`,
  lockClosed: `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="7" width="10" height="7" rx="1.5"/><path d="M5.5 7V5.5a2.5 2.5 0 015 0V7"/></svg>`,
  lockOpen: `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="7" width="10" height="7" rx="1.5"/><path d="M10.5 7V5.5a2.5 2.5 0 00-4.27-1.77"/></svg>`,
};

// ── Focus trap utilitaire ────────────────────────────────

function _trapFocus(container) {
  const sel =
    'a[href],button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';
  const getFocusable = () => [...container.querySelectorAll(sel)];
  function onKeyDown(e) {
    if (e.key !== "Tab") return;
    const focusable = getFocusable();
    if (!focusable.length) {
      e.preventDefault();
      return;
    }
    const first = focusable[0],
      last = focusable[focusable.length - 1];
    if (e.shiftKey) {
      if (document.activeElement === first) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }
  container.addEventListener("keydown", onKeyDown);
  // Auto-focus premier input ou premier bouton non-close
  const firstInput = container.querySelector("input,textarea,select");
  const firstBtn = container.querySelector("button:not(.btn-close)");
  (firstInput || firstBtn || getFocusable()[0])?.focus();
  return () => container.removeEventListener("keydown", onKeyDown);
}

function _bindOverlayOutsideClickClose(overlay, close) {
  if (!overlay || typeof close !== "function") return;
  let pointerDownOnOverlay = false;

  overlay.addEventListener("pointerdown", (e) => {
    pointerDownOnOverlay = e.target === overlay;
  });

  overlay.addEventListener("click", (e) => {
    if (e.target !== overlay) {
      pointerDownOnOverlay = false;
      return;
    }
    if (pointerDownOnOverlay) close();
    pointerDownOnOverlay = false;
  });
}

// ── Modal générique ──────────────────────────────────────

function createModal({
  title,
  content,
  onConfirm,
  confirmLabel = "Confirmer",
  hideCancel = false,
  isConfirmEnabled,
  watchConfirm = false,
  disabledConfirmTitle = "",
  resizable = "auto",
  sizeStorageKey = "",
}) {
  if (typeof onConfirm !== "function") onConfirm = () => {};
  const trigger = document.activeElement;
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title-${Date.now()}">
      <div class="modal-header">
        <span class="modal-title">${escHtml(title)}</span>
        <div class="modal-header-actions">
          <button type="button" class="btn-icon btn-modal-reset" aria-label="Réinitialiser la taille" title="Réinitialiser la taille" hidden>${IC.reset}</button>
          <button type="button" class="btn-icon btn-close" aria-label="Fermer">${IC.close}</button>
        </div>
      </div>
      <div class="modal-body"></div>
      <div class="modal-footer">
        ${hideCancel ? "" : '<button type="button" class="btn btn-ghost btn-cancel">Annuler</button>'}
        <button type="button" class="btn btn-primary btn-confirm">${confirmLabel}</button>
      </div>
    </div>`;
  overlay.querySelector(".modal-body").appendChild(content);
  const modalEl = overlay.querySelector(".modal");
  const hasMarkdownEditor = !!overlay.querySelector(".md-editor, [data-md-initial]");
  const shouldEnableResize =
    resizable === true || (resizable === "auto" && hasMarkdownEditor);
  const resetSizeBtn = overlay.querySelector(".btn-modal-reset");
  let resolvedStorageKey = "";
  let cleanupResizable = null;
  if (shouldEnableResize && modalEl) {
    const handleDirs = ["nw", "ne", "sw", "se"];
    const handles = handleDirs.map((dir) => {
      const handle = document.createElement("span");
      handle.className = `modal-resize-handle modal-resize-handle--${dir}`;
      handle.dataset.resizeDir = dir;
      handle.setAttribute("aria-hidden", "true");
      modalEl.appendChild(handle);
      return handle;
    });
    modalEl.classList.add("modal-resizable");
    resolvedStorageKey =
      sizeStorageKey ||
      (hasMarkdownEditor
        ? "md-" + _slugifyModalKey(title)
        : "generic-" + _slugifyModalKey(title));
    cleanupResizable = _initResizableModal(modalEl, handles, resolvedStorageKey);
    resetSizeBtn?.removeAttribute("hidden");
  }
  resetSizeBtn?.addEventListener("click", () => {
    if (!modalEl || !resolvedStorageKey) return;
    _clearModalSize(resolvedStorageKey);
    modalEl.style.width = "";
    modalEl.style.height = "";
  });
  enhanceDateInputsIn(overlay);

  const confirmBtn = overlay.querySelector(".btn-confirm");
  const refreshConfirmState = () => {
    if (typeof isConfirmEnabled !== "function" || !confirmBtn) return;
    const enabled = !!isConfirmEnabled();
    confirmBtn.disabled = !enabled;
    confirmBtn.title = enabled ? "" : disabledConfirmTitle;
  };

  let removeTrap;
  const close = () => {
    cleanupResizable?.();
    removeTrap?.();
    overlay.classList.remove("open");
    overlay.classList.add("closing");
    // Retirer les popups de calendrier créés hors overlay
    overlay.querySelectorAll("[data-dt-popup-id]").forEach((trigger) => {
      const id = trigger.dataset.dtPopupId;
      if (id) document.getElementById(id)?.remove();
    });
    document.querySelectorAll(".dt-popup").forEach((p) => p.remove());
    setTimeout(() => {
      overlay.remove();
      if (trigger?.isConnected) trigger.focus?.();
    }, MODAL_CLOSE_DELAY_MS);
  };
  overlay.querySelector(".btn-close").addEventListener("click", close);
  overlay.querySelector(".btn-cancel")?.addEventListener("click", close);
  confirmBtn?.addEventListener("click", () => {
    if (confirmBtn.disabled) return;
    const shouldClose = onConfirm();
    if (shouldClose === false) return;
    close();
  });

  if (watchConfirm) {
    overlay.querySelector(".modal-body")?.addEventListener("input", refreshConfirmState);
    overlay.querySelector(".modal-body")?.addEventListener("change", refreshConfirmState);
  }
  _bindOverlayOutsideClickClose(overlay, close);

  document.body.appendChild(overlay);
  document.body.style.overflow = "hidden";
  requestAnimationFrame(() => {
    overlay.classList.add("open");
    removeTrap = _trapFocus(modalEl);
    refreshConfirmState();
  });
  // Libérer le scroll au remove (observateur minimal)
  const obs = new MutationObserver(() => {
    if (!document.body.contains(overlay)) {
      document.body.style.overflow = "";
      obs.disconnect();
    }
  });
  obs.observe(document.body, { childList: true });
  return {
    close,
    refreshConfirmState,
    setConfirmEnabled: (enabled, title = "") => {
      if (!confirmBtn) return;
      confirmBtn.disabled = !enabled;
      confirmBtn.title = enabled ? "" : title;
    },
    confirmBtn,
  };
}

// ── Confirm dialog ───────────────────────────────────────

function confirmDialog(message, onConfirm) {
  if (typeof onConfirm !== "function") onConfirm = () => {};
  const trigger = document.activeElement;
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="confirm-dialog" role="alertdialog" aria-modal="true">
      <div class="confirm-dialog-title">Confirmation</div>
      <p class="confirm-msg"></p>
      <div class="modal-footer" style="padding:0;border:none;margin-top:0">
        <button type="button" class="btn btn-ghost btn-cancel">Annuler</button>
        <button type="button" class="btn btn-danger btn-ok">Supprimer</button>
      </div>
    </div>`;
  overlay.querySelector(".confirm-msg").textContent = message;
  let removeTrap;
  const close = () => {
    removeTrap?.();
    overlay.classList.remove("open");
    overlay.classList.add("closing");
    setTimeout(() => {
      overlay.remove();
      if (trigger?.isConnected) trigger.focus?.();
    }, MODAL_CLOSE_DELAY_MS);
    document.body.style.overflow = "";
  };
  overlay.querySelector(".btn-cancel").addEventListener("click", close);
  overlay.querySelector(".btn-ok").addEventListener("click", () => {
    onConfirm();
    close();
  });
  _bindOverlayOutsideClickClose(overlay, close);
  document.body.appendChild(overlay);
  document.body.style.overflow = "hidden";
  requestAnimationFrame(() => {
    overlay.classList.add("open");
    removeTrap = _trapFocus(overlay.querySelector(".confirm-dialog"));
  });
  const obs = new MutationObserver(() => {
    if (!document.body.contains(overlay)) {
      document.body.style.overflow = "";
      obs.disconnect();
    }
  });
  obs.observe(document.body, { childList: true });
}

// ── Toast ────────────────────────────────────────────────

function showToast(msg, type = "") {
  const t = document.createElement("div");
  t.className = "toast" + (type ? " " + type : "");
  t.textContent = msg;
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add("show"));
  setTimeout(() => {
    t.classList.remove("show");
    setTimeout(() => t.remove(), TOAST_FADE_OUT_MS);
  }, TOAST_DURATION_MS);
}

// ── Color picker ─────────────────────────────────────────

function createColorPicker(selected, onChange) {
  const wrap = document.createElement("div");
  wrap.className = "color-picker";
  COLORS.forEach((c) => {
    const s = document.createElement("button");
    s.type = "button";
    s.className = "color-swatch" + (c === selected ? " selected" : "");
    s.style.background = c;
    s.title = c;
    s.addEventListener("click", () => {
      wrap
        .querySelectorAll(".color-swatch")
        .forEach((x) => x.classList.remove("selected"));
      s.classList.add("selected");
      onChange(c);
    });
    wrap.appendChild(s);
  });
  return wrap;
}

// ── Language select ──────────────────────────────────────

function createLangSelect(selected) {
  const sel = document.createElement("select");
  LANGUAGES.forEach((l) => {
    const opt = document.createElement("option");
    opt.value = l;
    opt.textContent = l;
    if (l === selected) opt.selected = true;
    sel.appendChild(opt);
  });
  return sel;
}

// ── Carte projet ─────────────────────────────────────────

function createProjectCard(project) {
  const card = document.createElement("div");
  card.className = "project-card";
  card.style.setProperty("--project-color", project.color);
  card.dataset.id = project.id;
  const lockToChildren = !!project.lockToChildren;

  // Comptage récursif via utilitaires partagés (common-utils.js)
  const counts = {
    link:   countTreeNodes(project.children, (n) => n.nodeType === "item" && n.type === "link"),
    memo:   countTreeNodes(project.children, (n) => n.nodeType === "item" && n.type === "memo"),
    code:   countTreeNodes(project.children, (n) => n.nodeType === "item" && n.type === "code"),
    info:   countTreeNodes(project.children, (n) => n.nodeType === "item" && n.type === "info"),
    password: countTreeNodes(project.children, (n) => n.nodeType === "item" && n.type === "password"),
    folder: countTreeNodes(project.children, (n) => n.nodeType === "folder"),
  };

  const statItem = (val, label, icon) =>
    val > 0 ? `<div class="project-card-stat" title="${label}">${icon}<span>${val}</span></div>` : "";

  card.innerHTML = `
    <div class="project-card-header">
      <div class="project-card-icon">${IC.folder}</div>
      <div class="project-card-name">${escHtml(project.name)}</div>
    </div>
    <div class="project-card-stats">
      ${statItem(counts.folder, "Dossiers",  IC.folder)}
      ${statItem(counts.link,   "Liens",     IC.link)}
      ${statItem(counts.memo,   "Mémos",     IC.memo)}
      ${statItem(counts.code,   "Snippets",  IC.code)}
      ${statItem(counts.info,   "Infos",     `<svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="8" cy="8" r="6"/><path d="M8 7v5M8 5v.5"/></svg>`)}
      ${statItem(counts.password, "Mots de passe", IC.password)}
    </div>
    <div class="project-card-actions">
      <button class="btn-icon project-lock-toggle${lockToChildren ? " active" : ""}" data-action="lock-route" aria-pressed="${lockToChildren ? "true" : "false"}" title="${lockToChildren ? "Cadenas fermé : clic vers les sous-projets" : "Cadenas ouvert : clic vers le projet"}">${lockToChildren ? IC.lockClosed : IC.lockOpen}</button>
      <button class="btn-icon" data-action="fav" title="${project.favorite ? 'Retirer des favoris' : 'Marquer favori'}">${project.favorite ? IC.starFill : IC.star}</button>
      <button class="btn-icon danger" data-action="delete" title="Supprimer">${IC.trash}</button>
    </div>`;

  card.addEventListener("click", (e) => {
    if (e.target.closest("[data-action]")) return;
    if (lockToChildren) {
      card.dispatchEvent(
        new CustomEvent("project:navigate-children", {
          bubbles: true,
          detail: { id: project.id },
        }),
      );
      return;
    }
    goToProject(project.id);
  });
  const _favBtn = card.querySelector('[data-action="fav"]');
  if (_favBtn) {
    _favBtn.classList.toggle("fav-star", true);
    _favBtn.classList.toggle("active", !!project.favorite);
  }
  card.querySelector('[data-action="fav"]')?.addEventListener("click", (e) => {
    e.stopPropagation();
    updateProject(project.id, { favorite: !project.favorite });
    const grid = document.getElementById("projects-grid");
    if (grid) grid.dispatchEvent(new CustomEvent("project:refresh"));
    if (typeof render === "function") render();
  });
  card.querySelector('[data-action="lock-route"]')?.addEventListener("click", (e) => {
    e.stopPropagation();
    updateProject(project.id, { lockToChildren: !lockToChildren });
    const grid = document.getElementById("projects-grid");
    if (grid) grid.dispatchEvent(new CustomEvent("project:refresh"));
    if (typeof render === "function") render();
  });
  card
    .querySelector('[data-action="delete"]')
    .addEventListener("click", (e) => {
      e.stopPropagation();
      card.dispatchEvent(
        new CustomEvent("project:delete", {
          bubbles: true,
          detail: { id: project.id },
        }),
      );
    });
  return card;
}

// ── Priority chip ────────────────────────────────────────

function createPriorityChip(priorityId) {
  const priorities = getTodoPriorities();
  const p = priorities.find((p) => p.id === priorityId) || {
    label: priorityId,
    color: "#666",
  };
  const chip = document.createElement("span");
  chip.className = "priority-chip";
  chip.style.cssText = `background:${p.color}20;color:${p.color};border:1px solid ${p.color}40;`;
  chip.innerHTML = `<span class="priority-dot" style="background:${_safeCssColor(p.color)}"></span>${escHtml(p.label)}`;
  return chip;
}

// ── Truncate note ────────────────────────────────────────

function createTruncatedNote(text, resolver, onClick) {
  const wrap = document.createElement("div");
  if (!text) return wrap;

  const lines = text.split("\n");
  const isLong = lines.length > 3 || text.length > 200;

  const noteEl = document.createElement("div");
  noteEl.className =
    "truncate-text doc-card-note md-rendered" + (isLong ? " collapsed" : "");

  // Rendu Markdown (avec wiki-links et liens)
  if (typeof renderMarkdown === "function") {
    noteEl.innerHTML = renderMarkdown(text);
    if (resolver && onClick && typeof bindWikiLinks === "function") {
      bindWikiLinks(noteEl, resolver, onClick);
    }
  } else if (resolver && onClick) {
    noteEl.innerHTML = renderWikiText(text, resolver, onClick).replace(
      /\n/g,
      "<br>",
    );
    bindWikiLinks(noteEl, resolver, onClick);
  } else {
    noteEl.textContent = text;
    noteEl.style.whiteSpace = "pre-wrap";
  }
  wrap.appendChild(noteEl);

  if (isLong) {
    const btn = document.createElement("button");
    btn.className = "see-more-btn";
    btn.textContent = "↓ voir plus";
    btn.addEventListener("click", () => {
      const collapsed = noteEl.classList.toggle("collapsed");
      btn.textContent = collapsed ? "↓ voir plus" : "↑ voir moins";
    });
    wrap.appendChild(btn);
  }
  return wrap;
}

// ── Item form content (pour project items) ───────────────

function buildItemFormContent(existing) {
  const div = document.createElement("div");
  div.innerHTML = `
    <div class="field">
      <label>Type</label>
      <div id="item-type-row" style="display:flex;gap:8px;flex-wrap:wrap;"></div>
    </div>
    <div class="field"><label>Titre *</label><input id="f-title" type="text" maxlength="120" value="${escHtml(existing?.title || "")}"></div>
    <div class="field" id="f-cat-field"><label>Catégorie</label><select id="f-cat"></select></div>
    <div class="field"><label>Tags <span style="color:var(--text-3);font-size:.72rem">(virgules)</span></label><input type="text" id="f-tags" value="${(existing?.tags||[]).join(', ')||''}" placeholder="api, feature…"></div>
    <div class="field" id="f-url-field"><label>URL</label><input id="f-url" type="url" placeholder="https://…" value="${escHtml(existing?.url || "")}"></div>
    <div class="field" id="f-login-field"><label>Identifiant / login</label><input id="f-login" type="text" autocomplete="username" placeholder="john.doe" value="${escHtml(existing?.login || "")}"></div>
    <div class="field" id="f-password-field"><label>Mot de passe</label><input id="f-password" type="password" autocomplete="current-password" placeholder="Mot de passe" value="${escHtml(existing?.password || "")}"></div>
    <div class="field" id="f-lang-field"><label>Langage</label><div id="f-lang-wrap"></div></div>
    <div class="field" id="f-code-field"><label>Code</label><textarea id="f-code" style="font-family:var(--font-mono);font-size:.82rem;min-height:120px">${escHtml(existing?.code || "")}</textarea></div>
    <div class="field" id="f-note-field"><label>Note</label><div id="f-note-mount" data-md-initial="${escHtml(existing?.note || "")}"></div></div>
    <div class="field">
      <label>Fichier joint</label>
      <div class="drop-zone" id="f-drop">${IC.upload}<span>Glisser un fichier ou cliquer</span></div>
      <div id="f-file-preview"></div>
    </div>`;
  return div;
}

// ── Helpers ──────────────────────────────────────────────

function escHtml(s = "") {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Valide qu'une valeur est une couleur CSS sûre (hex, rgb/hsl, var CSS).
 * Retourne la valeur si valide, sinon le fallback.
 * Empêche l'injection CSS/HTML via des couleurs saisies par l'utilisateur.
 */
function _safeCssColor(v, fallback) {
  const fb = fallback || "var(--text-2)";
  if (!v) return fb;
  const s = String(v).trim();
  if (/^#[0-9a-fA-F]{3,8}$/.test(s)) return s;
  if (/^(rgb|rgba|hsl|hsla)\(\s*[\d.,\s%/]+\)$/.test(s)) return s;
  if (/^var\(--[a-zA-Z0-9-]+\)$/.test(s)) return s;
  return fb;
}

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}

// ── Drag & drop reorder ──────────────────────────────────

function initDragReorder(container, onReorder) {
  let draggedEl = null;

  function getItems() {
    return [...container.querySelectorAll(".drag-item")];
  }

  container.addEventListener("dragstart", (e) => {
    draggedEl = e.target.closest(".drag-item");
    if (!draggedEl) return;
    draggedEl.classList.add("dragging");
    e.dataTransfer.effectAllowed = "move";
  });

  container.addEventListener("dragend", () => {
    if (!draggedEl) return;
    draggedEl.classList.remove("dragging");
    getItems().forEach((i) =>
      i.classList.remove("drag-over-top", "drag-over-bottom"),
    );
    draggedEl = null;
    // Lire le nouvel ordre
    const ids = getItems()
      .map((i) => i.dataset.id)
      .filter(Boolean);
    onReorder(ids);
  });

  container.addEventListener("dragover", (e) => {
    e.preventDefault();
    if (!draggedEl) return;
    const target = e.target.closest(".drag-item");
    if (!target || target === draggedEl) return;
    getItems().forEach((i) =>
      i.classList.remove("drag-over-top", "drag-over-bottom"),
    );
    const rect = target.getBoundingClientRect();
    const mid = rect.top + rect.height / 2;
    if (e.clientY < mid) {
      target.classList.add("drag-over-top");
      container.insertBefore(draggedEl, target);
    } else {
      target.classList.add("drag-over-bottom");
      target.after(draggedEl);
    }
  });
}

// ── Empty state avec illustration SVG ───────────────────

function createEmptyState(icon, title, subtitle) {
  const wrap = el("div", "empty-state");
  wrap.innerHTML = `
    <div class="empty-state-icon">${icon}</div>
    <h3>${title}</h3>
    ${subtitle ? `<p>${subtitle}</p>` : ""}`;
  return wrap;
}

const EMPTY_ICONS = {
  projects: `<svg width="32" height="32" viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"><path d="M4 8a2 2 0 012-2h6l3 3h10a2 2 0 012 2v13a2 2 0 01-2 2H6a2 2 0 01-2-2V8z"/></svg>`,
  items: `<svg width="32" height="32" viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"><rect x="4" y="4" width="24" height="24" rx="3"/><path d="M10 12h12M10 16h12M10 20h8"/></svg>`,
  todos: `<svg width="32" height="32" viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"><rect x="4" y="4" width="24" height="24" rx="3"/><path d="M11 16l3 3 7-7"/></svg>`,
  snippets: `<svg width="32" height="32" viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"><path d="M10 9l-5 7 5 7M22 9l5 7-5 7M18 6l-4 20"/></svg>`,
  rh: `<svg width="32" height="32" viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"><circle cx="16" cy="10" r="5"/><path d="M5 27c0-6 5-10 11-10s11 4 11 10"/></svg>`,
  recent: `<svg width="32" height="32" viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"><circle cx="16" cy="16" r="12"/><path d="M16 9v8l5 3"/></svg>`,
};

// ── Custom Date / DateTime Picker ────────────────────────
// ↓ Utilitaires de date picker déplacés dans js/date-picker-utils.js ↓
// (_MONTHS_FR, _DAYS_FR, _dtFormat, _dtToNative, _dtFromNative, _buildDtCalendar)

function enhanceDateInput(input) {
  if (input.dataset.dtEnhanced) return;
  input.dataset.dtEnhanced = "1";
  const isDateTime = input.type === "datetime-local";

  const wrap = document.createElement("div");
  wrap.className = "dt-wrap";
  input.parentNode.insertBefore(wrap, input);
  wrap.appendChild(input);
  input.style.cssText =
    "position:absolute;opacity:0;pointer-events:none;width:0;height:0";

  const calSVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`;
  const display = document.createElement("span");
  display.className = "dt-display";

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "dt-trigger";
  trigger.innerHTML = calSVG;
  trigger.appendChild(display);
  wrap.insertBefore(trigger, input);

  const popup = document.createElement("div");
  popup.className = "dt-popup";
  popup.hidden = true;
  document.body.appendChild(popup);

  const now = new Date();
  const state = {
    year: now.getFullYear(),
    month: now.getMonth(),
    selected: null,
    isDateTime,
  };
  const placeholder = isDateTime
    ? "Choisir date & heure…"
    : "Choisir une date…";

  function _sync() {
    if (!state.selected) {
      input.value = "";
      display.textContent = placeholder;
      trigger.classList.remove("has-value");
    } else {
      input.value = _dtToNative(state.selected, isDateTime);
      display.textContent = _dtFormat(state.selected, isDateTime);
      trigger.classList.add("has-value");
    }
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  if (input.value) {
    state.selected = _dtFromNative(input.value, isDateTime);
    if (state.selected) {
      state.year = state.selected.getFullYear();
      state.month = state.selected.getMonth();
      display.textContent = _dtFormat(state.selected, isDateTime);
      trigger.classList.add("has-value");
    } else {
      display.textContent = placeholder;
    }
  } else {
    display.textContent = placeholder;
  }

  function renderPopup() {
    _buildDtCalendar(popup, state);

    popup.querySelectorAll(".dt-day:not(.other-month)").forEach((btn) => {
      btn.addEventListener("click", () => {
        const d = new Date(Number(btn.dataset.ms));
        const ref = state.selected || new Date();
        d.setHours(ref.getHours(), ref.getMinutes(), 0, 0);
        state.selected = d;
        state.year = d.getFullYear();
        state.month = d.getMonth();
        renderPopup();
      });
    });

    popup.querySelector(".dt-prev").addEventListener("click", () => {
      if (--state.month < 0) {
        state.month = 11;
        state.year--;
      }
      renderPopup();
    });
    popup.querySelector(".dt-next").addEventListener("click", () => {
      if (++state.month > 11) {
        state.month = 0;
        state.year++;
      }
      renderPopup();
    });

    if (isDateTime) {
      const hEl = popup.querySelector(".dt-hour");
      const mEl = popup.querySelector(".dt-min");
      [hEl, mEl].forEach((el) =>
        el?.addEventListener("input", () => {
          if (!state.selected) {
            state.selected = new Date(
              state.year,
              state.month,
              new Date().getDate(),
            );
          }
          state.selected.setHours(
            Math.min(23, Math.max(0, parseInt(hEl.value) || 0)),
            Math.min(59, Math.max(0, parseInt(mEl.value) || 0)),
            0,
            0,
          );
        }),
      );
    }

    popup.querySelector(".dt-btn-clear").addEventListener("click", () => {
      state.selected = null;
      _sync();
      popup.hidden = true;
    });
    popup.querySelector(".dt-btn-today").addEventListener("click", () => {
      const d = new Date();
      if (!isDateTime) d.setHours(0, 0, 0, 0);
      state.selected = d;
      state.year = d.getFullYear();
      state.month = d.getMonth();
      renderPopup();
    });
    popup.querySelector(".dt-btn-ok").addEventListener("click", () => {
      if (isDateTime) {
        const hEl = popup.querySelector(".dt-hour");
        const mEl = popup.querySelector(".dt-min");
        if (state.selected && hEl && mEl) {
          state.selected.setHours(
            Math.min(23, Math.max(0, parseInt(hEl.value) || 0)),
            Math.min(59, Math.max(0, parseInt(mEl.value) || 0)),
            0,
            0,
          );
        }
      }
      _sync();
      popup.hidden = true;
    });
  }

  popup.addEventListener("click", (e) => e.stopPropagation());

  function _positionPopup() {
    const r = trigger.getBoundingClientRect();
    const vpH = window.innerHeight;
    const vpW = window.innerWidth;
    const popW = popup.offsetWidth || 288;
    const popH = popup.offsetHeight || 420;
    const margin = 8;

    // Vertical : en dessous si assez de place, sinon au-dessus
    let top = r.bottom + 6;
    if (top + popH > vpH - margin) {
      const topAbove = r.top - popH - 6;
      top =
        topAbove >= margin ? topAbove : Math.max(margin, vpH - popH - margin);
    }

    // Horizontal : aligné à gauche du trigger, recalé si déborde
    let left = r.left;
    if (left + popW > vpW - margin) left = vpW - popW - margin;
    if (left < margin) left = margin;

    popup.style.top = top + "px";
    popup.style.left = left + "px";
  }

  trigger.addEventListener("click", (e) => {
    e.stopPropagation();
    document.querySelectorAll(".dt-popup:not([hidden])").forEach((p) => {
      p.hidden = true;
    });
    if (popup.hidden) {
      // Rendre d'abord hors écran pour mesurer, puis positionner
      popup.style.visibility = "hidden";
      popup.hidden = false;
      renderPopup();
      requestAnimationFrame(() => {
        _positionPopup();
        popup.style.visibility = "";
      });
    } else {
      popup.hidden = true;
    }
  });

  document.addEventListener("click", (e) => {
    if (!wrap.contains(e.target) && !popup.contains(e.target))
      popup.hidden = true;
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !popup.hidden) popup.hidden = true;
  });
}

function enhanceDateInputsIn(container) {
  container
    .querySelectorAll('input[type="date"], input[type="datetime-local"]')
    .forEach(enhanceDateInput);
}

// ── Floating topbar — scroll behaviour ──────────────────
(function () {
  const topbar = document.querySelector(".topbar");
  if (!topbar) return;

  let ticking = false;
  const THRESHOLD = 20;

  function update() {
    if (window.scrollY > THRESHOLD) {
      topbar.classList.add("scrolled");
    } else {
      topbar.classList.remove("scrolled");
    }
    ticking = false;
  }

  window.addEventListener(
    "scroll",
    () => {
      if (!ticking) {
        requestAnimationFrame(update);
        ticking = true;
      }
    },
    { passive: true },
  );

  update(); // état initial
})();

// ── Scroll reveal — IntersectionObserver stagger ─────────
(function () {
  const SELECTORS = [
    ".recent-card",
    ".nav-card",
    ".reminder-card",
    ".project-card",
    ".rh-folder-card",
    ".doc-card",
    ".snippet-card",
    ".snippet-folder-card",
    ".todo-card",
    ".plan-task-card",
    ".planning-form-card",
  ].join(",");

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.06, rootMargin: "0px 0px -32px 0px" },
  );

  function observeCards() {
    // Grouper par conteneur parent pour le stagger
    const cards = [...document.querySelectorAll(SELECTORS)];

    // Regrouper par parent direct pour calculer l'index local
    const groups = new Map();
    cards.forEach((card) => {
      const parent = card.parentElement;
      if (!groups.has(parent)) groups.set(parent, []);
      groups.get(parent).push(card);
    });

    groups.forEach((siblings) => {
      siblings.forEach((card, i) => {
        card.classList.add("card-reveal");
        card.style.setProperty("--reveal-i", Math.min(i, 7));
        observer.observe(card);
      });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", observeCards);
  } else {
    observeCards();
  }

  // Réobserver après chaque navigation (router SPA)
  const _origPushState = history.pushState.bind(history);
  history.pushState = function (...args) {
    _origPushState(...args);
    setTimeout(observeCards, 120);
  };
})();

// ── Mobile menu ──────────────────────────────────────────

function initMobileMenu() {
  const btn = document.querySelector(".topbar-menu-btn");
  if (!btn) return;
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    _toggleMobilePanel(btn);
  });
}

function _toggleMobilePanel(btn) {
  if (document.querySelector(".topbar-mobile-panel")) {
    _closeMobilePanel(btn);
  } else {
    _openMobilePanel(btn);
  }
}

function _openMobilePanel(btn) {
  const navLinks = document.querySelectorAll(".topbar-nav a");
  const panel = document.createElement("div");
  panel.className = "topbar-mobile-panel";
  panel.addEventListener("click", (e) => e.stopPropagation());

  navLinks.forEach((link) => {
    const a = document.createElement("a");
    a.href = link.getAttribute("href");
    a.textContent = link.textContent.trim();
    if (link.classList.contains("active")) a.className = "active";
    panel.appendChild(a);
  });

  document.body.appendChild(panel);

  const topbarEl = document.querySelector(".topbar");
  const rect = topbarEl.getBoundingClientRect();
  panel.style.top = rect.bottom + 8 + "px";
  panel.style.left = rect.left + "px";
  panel.style.width = rect.width + "px";

  btn.setAttribute("aria-expanded", "true");
  btn.classList.add("active");

  setTimeout(() => {
    document.addEventListener("click", _onMobileOutside);
    document.addEventListener("keydown", _onMobileKey);
  }, 0);
}

function _closeMobilePanel(btn) {
  document.querySelector(".topbar-mobile-panel")?.remove();
  const b = btn || document.querySelector(".topbar-menu-btn");
  if (b) {
    b.setAttribute("aria-expanded", "false");
    b.classList.remove("active");
  }
  document.removeEventListener("click", _onMobileOutside);
  document.removeEventListener("keydown", _onMobileKey);
}

function _onMobileOutside() {
  _closeMobilePanel(null);
}

function _onMobileKey(e) {
  if (e.key === "Escape") _closeMobilePanel(null);
}

// ── Corbeille ─────────────────────────────────────────────

const _TRASH_TYPE_META = {
  todo:    { label: "Tâches",   icon: `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M3 8l3 3 7-6"/></svg>` },
  project: { label: "Projets",  icon: `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="2" y="3" width="5" height="5" rx="1"/><rect x="9" y="3" width="5" height="5" rx="1"/><rect x="2" y="10" width="5" height="5" rx="1"/><rect x="9" y="10" width="5" height="5" rx="1"/></svg>` },
  journal: { label: "Journal",  icon: `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 2h8a1 1 0 011 1v11a1 1 0 01-1 1H4a1 1 0 01-1-1V3a1 1 0 011-1z"/><path d="M6 6h4M6 9h4"/></svg>` },
  snippet: { label: "Snippets", icon: `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><polyline points="5,4 2,8 5,12"/><polyline points="11,4 14,8 11,12"/></svg>` },
  rh:           { label: "RH",              icon: `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="8" cy="5" r="2.5"/><path d="M3 14c0-2.76 2.24-5 5-5s5 2.24 5 5"/></svg>` },
  "project-node": { label: "Éléments projet", icon: `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M2 4a1 1 0 011-1h3l2 2h5a1 1 0 011 1v7a1 1 0 01-1 1H3a1 1 0 01-1-1V4z"/></svg>` },
};

const _DAY_MS = 24 * 60 * 60 * 1000;
const _TRASH_TTL_DAYS = 30;

function _trashItemTitle(item) {
  const base = item.title || item.name || item.content?.slice(0, 60) || "(sans titre)";
  if (item._trashType === "project-node" && item._projectName) {
    return `${base} <span style="color:var(--text-3);font-size:.75em">— ${escHtml(item._projectName)}</span>`;
  }
  return escHtml(base);
}

function _trashDaysLeft(deletedAt) {
  const elapsed = Date.now() - deletedAt;
  return Math.max(0, _TRASH_TTL_DAYS - Math.floor(elapsed / _DAY_MS));
}

function _trashDaysAgo(deletedAt) {
  return Math.max(0, Math.floor((Date.now() - deletedAt) / _DAY_MS));
}

/** Met à jour le badge du bouton corbeille dans la topbar. */
function updateTrashBadge() {
  const btn = document.querySelector(".trash-topbar-btn");
  if (!btn) return;
  const count = typeof getTrashCount === "function" ? getTrashCount() : 0;
  let badge = btn.querySelector(".trash-count-badge");
  if (count > 0) {
    btn.classList.add("has-items");
    if (!badge) {
      badge = document.createElement("span");
      badge.className = "trash-count-badge";
      btn.appendChild(badge);
    }
    badge.textContent = count > 99 ? "99+" : count;
  } else {
    btn.classList.remove("has-items");
    badge?.remove();
  }
}

/** Ouvre le modal corbeille. */
function openTrashModal() {
  const items = typeof getTrash === "function" ? getTrash() : [];

  // Grouper par type
  const groups = {};
  items.forEach((item) => {
    const t = item._trashType || "todo";
    if (!groups[t]) groups[t] = [];
    groups[t].push(item);
  });

  const listHTML = items.length === 0
    ? `<div class="trash-empty-state">
         <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round">
           <polyline points="3,6 5,6 21,6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>
           <path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/>
         </svg>
         <p>La corbeille est vide</p>
       </div>`
    : Object.entries(groups).map(([type, grpItems]) => {
        const meta = _TRASH_TYPE_META[type] || _TRASH_TYPE_META.todo;
        const rows = grpItems.map((item) => {
          const daysLeft = _trashDaysLeft(item._deletedAt);
          const daysAgo  = _trashDaysAgo(item._deletedAt);
          const expireClass = daysLeft <= 5 ? "expires-soon" : "";
          return `<div class="trash-item" data-id="${item.id}">
              <div class="trash-item-icon">${meta.icon}</div>
              <div class="trash-item-body">
                <div class="trash-item-title">${_trashItemTitle(item)}</div>
                <div class="trash-item-meta">
                  Supprimé ${daysAgo === 0 ? "aujourd'hui" : `il y a ${daysAgo}j`} ·
                  <span class="${expireClass}">expire dans ${daysLeft}j</span>
                </div>
              </div>
              <div class="trash-item-actions">
                <button class="btn btn-sm btn-ghost trash-restore-btn" data-id="${item.id}" title="Restaurer">
                  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M3 8a5 5 0 105-5H5"/><polyline points="2,5 5,8 8,5"/></svg>
                  Restaurer
                </button>
                <button class="btn btn-sm btn-danger-ghost trash-delete-btn" data-id="${item.id}" title="Supprimer définitivement">
                  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg>
                </button>
              </div>
            </div>`;
        }).join("");
        return `<div class="trash-group-label">${meta.label}</div>${rows}`;
      }).join("");

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal trash-modal-wrap" role="dialog" aria-modal="true">
      <div class="modal-header">
        <span class="modal-title" style="display:flex;align-items:center;gap:8px;">
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">
            <polyline points="2,4 3,4 14,4"/><path d="M13 4l-.7 9a1 1 0 01-1 1H4.7a1 1 0 01-1-1L3 4"/>
            <path d="M6 4V3a1 1 0 011-1h2a1 1 0 011 1v1"/>
          </svg>
          Corbeille
          <span class="trash-modal-count">${items.length} élément${items.length !== 1 ? "s" : ""}</span>
        </span>
        <div style="display:flex;gap:8px;align-items:center;">
          ${items.length > 0 ? `<button class="btn btn-sm btn-danger-ghost" id="trash-empty-all-btn">Tout vider</button>` : ""}
          <button class="btn-icon btn-close" aria-label="Fermer">✕</button>
        </div>
      </div>
      <div class="modal-body">
        <p class="trash-modal-info">
          Les éléments supprimés sont conservés <strong>30 jours</strong> puis effacés définitivement.
        </p>
        <div id="trash-list">${listHTML}</div>
      </div>
    </div>`;

  const close = () => {
    overlay.classList.remove("open");
    overlay.classList.add("closing");
    setTimeout(() => overlay.remove(), 200);
    document.body.style.overflow = "";
  };

  overlay.querySelector(".btn-close").addEventListener("click", close);
  _bindOverlayOutsideClickClose(overlay, close);
  document.addEventListener("keydown", function _esc(e) {
    if (e.key === "Escape") { close(); document.removeEventListener("keydown", _esc); }
  });

  overlay.querySelector("#trash-empty-all-btn")?.addEventListener("click", () => {
    confirmDialog("Vider définitivement toute la corbeille ?", () => {
      if (typeof emptyTrash === "function") emptyTrash();
      updateTrashBadge();
      close();
    });
  });

  overlay.querySelector("#trash-list")?.addEventListener("click", (e) => {
    const restoreBtn = e.target.closest(".trash-restore-btn");
    const deleteBtn  = e.target.closest(".trash-delete-btn");
    if (restoreBtn) {
      const id = restoreBtn.dataset.id;
      if (typeof restoreFromTrash === "function") restoreFromTrash(id);
      restoreBtn.closest(".trash-item")?.remove();
      updateTrashBadge();
      _refreshTrashCount(overlay);
      _refreshCurrentPage();
    }
    if (deleteBtn) {
      const id = deleteBtn.dataset.id;
      confirmDialog("Supprimer définitivement cet élément ?", () => {
        if (typeof permanentlyDelete === "function") permanentlyDelete(id);
        deleteBtn.closest(".trash-item")?.remove();
        updateTrashBadge();
        _refreshTrashCount(overlay);
      });
    }
  });

  document.body.appendChild(overlay);
  document.body.style.overflow = "hidden";
  requestAnimationFrame(() => overlay.classList.add("open"));
}

function _refreshTrashCount(modal) {
  const count = typeof getTrashCount === "function" ? getTrashCount() : 0;
  const badge = modal.querySelector(".trash-modal-count");
  if (badge) badge.textContent = `${count} élément${count !== 1 ? "s" : ""}`;
  if (count === 0) {
    const list = modal.querySelector("#trash-list");
    if (list) list.innerHTML = `<div class="trash-empty-state"><p>La corbeille est vide</p></div>`;
    modal.querySelector("#trash-empty-all-btn")?.remove();
  }
}

/** Rafraîchit le rendu de la page courante sans rechargement. */
function _refreshCurrentPage() {
  // Chaque page expose ses fonctions de rendu globalement (scripts non-module).
  // On appelle celles qui existent selon le contexte.
  try {
    if (typeof window.renderFilters === "function") window.renderFilters();
    if (typeof window.render       === "function") window.render();
    if (typeof window.renderList   === "function") window.renderList();
    if (typeof window.renderMain   === "function") window.renderMain();
  } catch (e) { /* silencieux */ }
}

/** Injecte le bouton corbeille dans la topbar (appelé par chaque page). */
function initTrashButton() {
  if (document.querySelector(".trash-topbar-btn")) return; // déjà présent
  const right = document.querySelector(".topbar-right");
  if (!right) return;

  const btn = document.createElement("button");
  btn.className = "trash-topbar-btn";
  btn.title = "Corbeille";
  btn.type = "button";
  btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round">
    <polyline points="2,4 3,4 14,4"/><path d="M13 4l-.7 9a1 1 0 01-1 1H4.7a1 1 0 01-1-1L3 4"/>
    <path d="M6.5 7v4M9.5 7v4"/><path d="M6 4V3a1 1 0 011-1h2a1 1 0 011 1v1"/>
  </svg>`;
  btn.addEventListener("click", openTrashModal);

  // Insérer avant le premier enfant (avant storage-indicator)
  right.insertBefore(btn, right.firstChild);
  updateTrashBadge();
}

// ── Templates ─────────────────────────────────────────────

const _TPL_ICONS = {
  "journal": `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M4 2h8a1 1 0 011 1v11a1 1 0 01-1 1H4a1 1 0 01-1-1V3a1 1 0 011-1z"/><path d="M6 6h4M6 9h4"/></svg>`,
  "todo":    `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M3 8l3 3 7-6"/></svg>`,
};

/**
 * Ouvre un picker de templates flottant sous `triggerEl`.
 * `onSelect(template)` est appelé avec le template appliqué (vars interpolées).
 */
function openTemplatePicker(type, triggerEl, onSelect) {
  // Ferme tout picker existant
  document.querySelector(".tpl-picker-popup")?.remove();

  const templates = typeof getTemplatesByType === "function"
    ? getTemplatesByType(type)
    : [];

  const popup = document.createElement("div");
  popup.className = "tpl-picker-popup";

  if (templates.length === 0) {
    popup.innerHTML = `
      <div class="tpl-picker-empty">Aucun modèle pour ce type.</div>
      <button class="tpl-picker-manage">⚙ Gérer les modèles</button>`;
  } else {
    popup.innerHTML = `
      <div class="tpl-picker-list">
        ${templates.map((t) => `
          <button class="tpl-picker-item" data-id="${t.id}">
            <span class="tpl-picker-item-icon">${t.icon || "📋"}</span>
            <span class="tpl-picker-item-name">${escHtml(t.name)}</span>
          </button>`).join("")}
      </div>
      <div class="tpl-picker-footer">
        <button class="tpl-picker-manage">⚙ Gérer les modèles</button>
      </div>`;
  }

  // Positionnement sous le bouton déclencheur
  document.body.appendChild(popup);
  const rect = triggerEl.getBoundingClientRect();
  let left = rect.left;
  if (left + 220 > window.innerWidth - 8) left = window.innerWidth - 228;
  popup.style.top  = `${rect.bottom + 6}px`;
  popup.style.left = `${Math.max(8, left)}px`;
  requestAnimationFrame(() => popup.classList.add("open"));

  const close = () => {
    popup.classList.remove("open");
    setTimeout(() => popup.remove(), 150);
  };

  // Sélection d'un template
  popup.querySelector(".tpl-picker-list")?.addEventListener("click", (e) => {
    const btn = e.target.closest(".tpl-picker-item");
    if (!btn) return;
    const tpl = templates.find((t) => t.id === btn.dataset.id);
    if (tpl && typeof applyTemplateVars === "function") {
      onSelect(applyTemplateVars(tpl));
    }
    close();
  });

  // Gérer les modèles
  popup.querySelector(".tpl-picker-manage")?.addEventListener("click", () => {
    close();
    openTemplateManager(type);
  });

  // Fermeture extérieure
  const onOutside = (e) => {
    if (!popup.contains(e.target) && e.target !== triggerEl) {
      close();
      document.removeEventListener("click", onOutside, true);
    }
  };
  setTimeout(() => document.addEventListener("click", onOutside, true), 10);
}

/**
 * Ouvre le modal de gestion des templates (CRUD).
 */
function openTemplateManager(initialType = "journal") {
  let _activeType = initialType === "todo" ? "todo" : "journal";

  function _buildManagerHTML() {
    const all = typeof getTemplates === "function" ? getTemplates() : [];
    const filtered = all.filter((t) => t.type === _activeType);

    const rows = filtered.length === 0
      ? `<div class="tpl-mgr-empty">Aucun modèle — créez-en un !</div>`
      : filtered.map((t) => `
          <div class="tpl-mgr-item" data-id="${t.id}">
            <span class="tpl-mgr-item-icon">${t.icon || "📋"}</span>
            <div class="tpl-mgr-item-body">
              <div class="tpl-mgr-item-name">${escHtml(t.name)}</div>
              <div class="tpl-mgr-item-preview">${escHtml((t.title || "").slice(0, 60))}</div>
            </div>
            <div class="tpl-mgr-item-actions">
              <button class="btn btn-sm btn-ghost tpl-edit-btn" data-id="${t.id}">Modifier</button>
              <button class="btn btn-sm btn-danger-ghost tpl-delete-btn" data-id="${t.id}">✕</button>
            </div>
          </div>`).join("");

    return `
      <div class="tpl-mgr-tabs">
        <button class="tpl-mgr-tab${_activeType === "journal" ? " active" : ""}" data-type="journal">
          ${_TPL_ICONS.journal} Journal
        </button>
        <button class="tpl-mgr-tab${_activeType === "todo" ? " active" : ""}" data-type="todo">
          ${_TPL_ICONS.todo} Tâches
        </button>
      </div>
      <div class="tpl-mgr-list" id="tpl-mgr-list">${rows}</div>`;
  }

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal tpl-mgr-wrap" role="dialog" aria-modal="true">
      <div class="modal-header">
        <span class="modal-title">📋 Gérer les modèles</span>
        <button class="btn-icon btn-close" aria-label="Fermer">✕</button>
      </div>
      <div class="modal-body" id="tpl-mgr-body">
        ${_buildManagerHTML()}
      </div>
      <div class="modal-footer">
        <button class="btn btn-ghost btn-cancel">Fermer</button>
        <button class="btn btn-primary" id="tpl-new-btn">+ Nouveau modèle</button>
      </div>
    </div>`;

  const close = () => {
    overlay.classList.remove("open");
    overlay.classList.add("closing");
    setTimeout(() => overlay.remove(), 200);
    document.body.style.overflow = "";
  };

  const refresh = () => {
    overlay.querySelector("#tpl-mgr-body").innerHTML = _buildManagerHTML();
    _bindManagerEvents();
  };

  function _bindManagerEvents() {
    // Onglets
    overlay.querySelectorAll(".tpl-mgr-tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        _activeType = tab.dataset.type;
        refresh();
      });
    });

    // Supprimer
    overlay.querySelectorAll(".tpl-delete-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        confirmDialog("Supprimer ce modèle ?", () => {
          if (typeof deleteTemplate === "function") deleteTemplate(btn.dataset.id);
          refresh();
        });
      });
    });

    // Modifier
    overlay.querySelectorAll(".tpl-edit-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const tpl = (typeof getTemplates === "function" ? getTemplates() : [])
          .find((t) => t.id === btn.dataset.id);
        if (tpl) _openTemplateForm(tpl, refresh);
      });
    });
  }

  overlay.querySelector(".btn-close").addEventListener("click", close);
  overlay.querySelector(".btn-cancel").addEventListener("click", close);
  _bindOverlayOutsideClickClose(overlay, close);
  document.addEventListener("keydown", function _esc(e) {
    if (e.key === "Escape") { close(); document.removeEventListener("keydown", _esc); }
  });

  overlay.querySelector("#tpl-new-btn").addEventListener("click", () => {
    _openTemplateForm({ type: _activeType }, refresh);
  });

  document.body.appendChild(overlay);
  document.body.style.overflow = "hidden";
  requestAnimationFrame(() => { overlay.classList.add("open"); _bindManagerEvents(); });
}

/** Formulaire de création/édition d'un template (modal empilé). */
function _openTemplateForm(tpl, onSave) {
  const isNew = !tpl.id;
  const isTodo = tpl.type === "todo";

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.style.zIndex = "1001";
  overlay.innerHTML = `
    <div class="modal tpl-form-wrap" role="dialog" aria-modal="true">
      <div class="modal-header">
        <span class="modal-title">${isNew ? "Nouveau modèle" : "Modifier le modèle"}</span>
        <button class="btn-icon btn-close" aria-label="Fermer">✕</button>
      </div>
      <div class="modal-body">
        <div class="field">
          <label>Type</label>
          <select id="tf-type">
            <option value="journal"${tpl.type === "journal" ? " selected" : ""}>Journal</option>
            <option value="todo"${tpl.type === "todo" ? " selected" : ""}>Tâche</option>
          </select>
        </div>
        <div class="field-row">
          <div class="field" style="flex:0 0 56px">
            <label>Icône</label>
            <input type="text" id="tf-icon" value="${tpl.icon || "📋"}" maxlength="2" style="text-align:center;font-size:1.2rem">
          </div>
          <div class="field">
            <label>Nom du modèle *</label>
            <input type="text" id="tf-name" value="${escHtml(tpl.name || "")}" maxlength="60" placeholder="ex: Standup, Bug fix…">
          </div>
        </div>
        <div class="field">
          <label>Titre pré-rempli <span style="color:var(--text-3);font-size:.72rem">— <code>{{date}}</code> sera remplacé par la date du jour</span></label>
          <input type="text" id="tf-title" value="${escHtml(tpl.title || "")}" maxlength="120">
        </div>
        ${isTodo ? `
        <div class="field-row">
          <div class="field">
            <label>Priorité par défaut</label>
            <select id="tf-prio">
              ${(typeof getTodoPriorities === "function" ? getTodoPriorities() : [])
                .map((p) => `<option value="${p.id}"${tpl.priorityId === p.id ? " selected" : ""}>${escHtml(p.label)}</option>`)
                .join("")}
            </select>
          </div>
          <div class="field">
            <label>Temps estimé (min)</label>
            <input type="text" id="tf-time" inputmode="decimal" value="${tpl.estimatedTime || ""}" placeholder="Ex: 60 ou 60*5">
          </div>
          <div class="field">
            <label>Contexte</label>
            <input type="text" id="tf-ctx" value="${escHtml(tpl.context || "")}" placeholder="@bureau…" maxlength="40">
          </div>
        </div>` : `
        <div class="field">
          <label>Contenu Markdown <span style="color:var(--text-3);font-size:.72rem">— <code>{{date}}</code> disponible ici aussi</span></label>
          <textarea id="tf-content" rows="8" style="font-family:var(--font-mono);font-size:.82rem">${escHtml(tpl.content || "")}</textarea>
        </div>`}
        <div class="field">
          <label>Tags (virgule)</label>
          <input type="text" id="tf-tags" value="${escHtml((tpl.tags || []).join(", "))}" placeholder="standup, réunion…">
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-ghost btn-cancel">Annuler</button>
        <button class="btn btn-primary btn-confirm">${isNew ? "Créer" : "Enregistrer"}</button>
      </div>
    </div>`;

  const close = () => {
    overlay.classList.remove("open");
    setTimeout(() => overlay.remove(), 200);
    document.body.style.overflow = "hidden"; // le manager en dessous est encore ouvert
  };

  overlay.querySelector(".btn-close").addEventListener("click", close);
  overlay.querySelector(".btn-cancel").addEventListener("click", close);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });

  overlay.querySelector(".btn-confirm").addEventListener("click", () => {
    const name = overlay.querySelector("#tf-name")?.value.trim();
    if (!name) { showToast("Nom requis"); return; }

    const type = overlay.querySelector("#tf-type")?.value;
    const isTodoForm = type === "todo";
    const rawEstimatedTime = overlay.querySelector("#tf-time")?.value || "";
    const parsedEstimatedTime =
      typeof parseEstimatedTimeExpression === "function"
        ? parseEstimatedTimeExpression(rawEstimatedTime)
        : (() => {
            const n = Number(rawEstimatedTime);
            if (!Number.isFinite(n) || n < 0) return { valid: false, minutes: 0 };
            return { valid: true, minutes: Math.floor(n) };
          })();

    if (isTodoForm && rawEstimatedTime.trim() && !parsedEstimatedTime.valid) {
      showToast("Temps estimé invalide. Exemples: 60, 60*5, (30+30)");
      return;
    }

    const data = {
      name,
      type,
      icon:          overlay.querySelector("#tf-icon")?.value.trim() || "📋",
      title:         overlay.querySelector("#tf-title")?.value.trim(),
      tags:          (overlay.querySelector("#tf-tags")?.value || "").split(",").map((s) => s.trim()).filter(Boolean),
      ...(isTodoForm ? {
        priorityId:    overlay.querySelector("#tf-prio")?.value,
        estimatedTime: parsedEstimatedTime.minutes,
        context:       overlay.querySelector("#tf-ctx")?.value.trim(),
      } : {
        content:       overlay.querySelector("#tf-content")?.value,
        mood:          tpl.mood || "",
      }),
    };

    if (isNew) {
      if (typeof createTemplate === "function") createTemplate(data);
      showToast("Modèle créé !");
    } else {
      if (typeof updateTemplate === "function") updateTemplate(tpl.id, data);
      showToast("Modèle mis à jour !");
    }
    close();
    onSave?.();
  });

  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add("open"));
  setTimeout(() => overlay.querySelector("#tf-name")?.focus(), 50);
}

// Enregistre l'action "Gérer les modèles" dans la palette globale
(function _registerTemplateAction() {
  const register = () => {
    if (typeof window.registerQuickAction !== "function") return;
    window.registerQuickAction({
      id: "open-template-manager",
      title: "Gérer les modèles",
      sub: "Créer, modifier ou supprimer des modèles de tâches et de journal",
      icon: `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">
        <rect x="2" y="2" width="5" height="5" rx="1"/><rect x="9" y="2" width="5" height="5" rx="1"/>
        <rect x="2" y="9" width="5" height="5" rx="1"/><rect x="9" y="9" width="5" height="5" rx="1"/>
      </svg>`,
      keywords: ["template", "modèle", "standup", "retro", "journal", "todo"],
      run: () => openTemplateManager(),
    });
  };
  // La palette est initialisée après DOMContentLoaded
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", register);
  } else {
    setTimeout(register, 200);
  }
})();

// ════════════════════════════════════════════════════════════
// UTILITAIRES DE PAGE — factorisation inter-pages
// ════════════════════════════════════════════════════════════

/**
 * Initialisation commune à toutes les pages.
 * Remplace le bloc répété dans chaque bootPage().
 */
function initPageCommon() {
  applySiteBranding();
  initTheme();
  initTrashButton();
  initClock();
  setActiveNav();
  document
    .querySelector(".theme-toggle")
    ?.addEventListener("click", toggleTheme);
  initGlobalReminderWatcher();
  if (typeof autoBackupCheck === "function") autoBackupCheck();
}

function applySiteBranding() {
  const siteName =
    (typeof getSettings === "function" && getSettings()?.siteName?.trim()) ||
    "Workspace";

  document.querySelectorAll(".topbar-logo").forEach((logo) => {
    const mark = logo.querySelector(".logo-mark");
    if (!mark) {
      logo.textContent = siteName;
      return;
    }
    logo.innerHTML = "";
    logo.appendChild(mark);
    logo.appendChild(document.createTextNode(" " + siteName));
  });

  const title = (document.title || "").trim();
  if (title.includes("—")) {
    const [left] = title.split("—");
    document.title = `${left.trim()} — ${siteName}`;
  }
}

/**
 * Construit un fil d'Ariane générique dans un conteneur DOM.
 *
 * @param {string}   containerId  ID de l'élément DOM cible
 * @param {string[]} stack        Pile d'IDs de navigation (du root au courant)
 * @param {object}   opts
 *   opts.getLabel(id, index) {Function}  Retourne le libellé d'un ID
 *   opts.onNavigate(newStack) {Function} Appelé quand l'utilisateur clique sur un niveau
 */
function buildBreadcrumb(containerId, stack, opts = {}) {
  const bc = document.getElementById(containerId);
  if (!bc) return;
  bc.innerHTML = "";
  stack.forEach((id, i) => {
    if (i > 0) bc.appendChild(el("span", "sep", "/"));
    const label = opts.getLabel ? opts.getLabel(id, i) : id;
    const span  = el("span", i === stack.length - 1 ? "current" : "bc-item");
    span.textContent = label || "…";
    if (i < stack.length - 1) {
      span.addEventListener("click", () => {
        opts.onNavigate?.(stack.slice(0, i + 1));
      });
    }
    bc.appendChild(span);
  });
}

/**
 * Ouvre une modal "Nouveau dossier" générique.
 *
 * @param {object} opts
 *   opts.placeholder {string}           Placeholder du champ nom
 *   opts.onCreate(name: string) {Function}  Appelé avec le nom saisi
 */
function openNewFolderModal({ placeholder = "", onCreate }) {
  const inputId = "gm-folder-name-" + Date.now();
  const content = el("div");
  content.innerHTML =
    `<div class="field"><label>Nom du dossier *</label>` +
    `<input type="text" id="${inputId}" maxlength="60" placeholder="${escHtml(placeholder)}"></div>`;
  createModal({
    title: "Nouveau dossier",
    confirmLabel: "Créer",
    content,
    watchConfirm: true,
    isConfirmEnabled: () => !!document.getElementById(inputId)?.value.trim(),
    disabledConfirmTitle: "Le nom du dossier est requis",
    onConfirm: () => {
      const name = document.getElementById(inputId)?.value.trim();
      if (!name) { showToast("Nom requis"); return; }
      onCreate(name);
    },
  });
  setTimeout(() => {
    const input = document.getElementById(inputId);
    if (input) { input.focus(); input.select(); }
  }, 30);
}

/**
 * Ouvre une modal "Renommer" générique.
 *
 * @param {string}   currentName  Valeur pré-remplie dans le champ
 * @param {Function} onRename(newName: string)  Appelé avec le nouveau nom
 * @param {string}   [title]      Titre de la modal (défaut : "Renommer")
 */
function openRenameModal(currentName, onRename, title = "Renommer") {
  const inputId = "gm-rename-" + Date.now();
  const content = el("div");
  content.innerHTML =
    `<div class="field"><label>Nom</label>` +
    `<input type="text" id="${inputId}" value="${escHtml(currentName)}" maxlength="60"></div>`;
  createModal({
    title,
    confirmLabel: "Enregistrer",
    content,
    watchConfirm: true,
    isConfirmEnabled: () => {
      const name = document.getElementById(inputId)?.value.trim();
      return !!name && name !== String(currentName || "").trim();
    },
    disabledConfirmTitle: "Modifie le nom pour enregistrer",
    onConfirm: () => {
      const name = document.getElementById(inputId)?.value.trim();
      if (!name) return;
      onRename(name);
    },
  });
  setTimeout(() => {
    const input = document.getElementById(inputId);
    if (input) { input.focus(); input.select(); }
  }, 30);
}

/** Met à jour l'icône et le label du bouton toggle vue grille/liste. */
function _updateViewToggleBtn(btnId, gridIconId, listIconId, labelId, mode) {
  const gridIcon = document.getElementById(gridIconId);
  const listIcon = document.getElementById(listIconId);
  const label    = document.getElementById(labelId);
  if (!gridIcon || !listIcon) return;
  if (mode === "list") {
    gridIcon.style.display = "none";
    listIcon.style.display = "";
    if (label) label.textContent = "Liste";
  } else {
    gridIcon.style.display = "";
    listIcon.style.display = "none";
    if (label) label.textContent = "Grille";
  }
}
