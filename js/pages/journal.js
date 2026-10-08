// @ts-check
// ── pages/journal.js ──
// Journal de bord personnel : entrées datées, contenu Markdown libre.

let _currentEntryId = null;
let _journalSearch  = "";
let _jrnSelectMode  = false;
let _jrnSelectedIds = new Set();
let _saveTimer = null;
let _mdEditor = null;

const MOODS = [
  { id: "great", emoji: "😄", label: "Excellente" },
  { id: "good", emoji: "🙂", label: "Bonne" },
  { id: "neutral", emoji: "😐", label: "Neutre" },
  { id: "low", emoji: "😕", label: "Moyenne" },
  { id: "bad", emoji: "😞", label: "Difficile" },
];

bootPage(() => {
  initPageCommon();

  document
    .getElementById("btn-new-entry")
    ?.addEventListener("click", () => handleCreate());
  document.getElementById("btn-jrn-select")?.addEventListener("click", toggleJrnSelectMode);
  _injectJournalTemplateBtn();
  document
    .getElementById("btn-empty-create")
    ?.addEventListener("click", () => handleCreate());
  const _debouncedSearch = debounce((val) => {
    _journalSearch = val;
    renderList();
  }, 200);
  document.getElementById("journal-search")?.addEventListener("input", (e) => {
    _debouncedSearch(e.target.value);
  });

  // Première entrée à ouvrir = la plus récente
  const entries = sortedEntries();
  if (entries.length) _currentEntryId = entries[0].id;

  renderList();
  renderMain();

  // Création automatique demandée via la palette globale
  if (sessionStorage.getItem("workspace_create_journal") === "1") {
    sessionStorage.removeItem("workspace_create_journal");
    handleCreate();
  }
});

// ── Helpers ─────────────────────────────────────────────

function sortedEntries() {
  return getJournalEntries()
    .slice()
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

function filteredEntries() {
  const list = sortedEntries();
  if (!_journalSearch.trim()) return list;
  const q = _journalSearch.toLowerCase();
  return list.filter(
    (e) =>
      (e.title || "").toLowerCase().includes(q) ||
      (e.content || "").toLowerCase().includes(q) ||
      (e.tags || []).some((t) => t.toLowerCase().includes(q)),
  );
}

function formatDay(ts) {
  return new Date(ts).toLocaleDateString("fr-FR", { day: "2-digit" });
}
function formatMon(ts) {
  return new Date(ts)
    .toLocaleDateString("fr-FR", { month: "short" })
    .replace(".", "");
}
function formatFull(ts) {
  return new Date(ts).toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}
function formatTime(ts) {
  return new Date(ts).toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}
function preview(text) {
  if (!text) return "Aucun contenu";
  // Strip markdown markers grossier
  return text
    .replace(/[*_`#>\[\]()-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
}

// ── Rendu liste latérale ────────────────────────────────


function toggleJrnSelectMode() {
  _jrnSelectMode = !_jrnSelectMode;
  _jrnSelectedIds.clear();
  renderList();
  _renderJrnSelectBar();
  document.getElementById("btn-jrn-select")?.classList.toggle("active-accent", _jrnSelectMode);
}

function _renderJrnSelectBar() {
  let bar = document.getElementById("jrn-select-bar");
  if (!_jrnSelectMode) { if (bar) bar.remove(); return; }
  if (!bar) {
    bar = el("div", "bulk-action-bar");
    bar.id = "jrn-select-bar";
    bar.innerHTML =
      '<span id="jrn-select-count">0 sélectionnée(s)</span>' +
      '<button class="btn btn-danger btn-sm" id="btn-jrn-bulk-delete">Supprimer</button>' +
      '<button class="btn btn-ghost btn-sm" id="btn-jrn-cancel">Annuler</button>';
    document.body.appendChild(bar);
    bar.querySelector("#btn-jrn-bulk-delete").addEventListener("click", () => {
      if (!_jrnSelectedIds.size) return;
      confirmDialog(`Supprimer ${_jrnSelectedIds.size} entrée${_jrnSelectedIds.size > 1 ? "s" : ""} ?`, () => {
        _jrnSelectedIds.forEach((id) => deleteJournalEntry(id));
        _jrnSelectedIds.clear(); _jrnSelectMode = false;
        _currentEntryId = sortedEntries()[0]?.id || null;
        renderList(); renderMain(); _renderJrnSelectBar();
        showToast("Entrées supprimées", "success");
        if (typeof updateTrashBadge === "function") updateTrashBadge();
      });
    });
    bar.querySelector("#btn-jrn-cancel").addEventListener("click", () => {
      _jrnSelectMode = false; _jrnSelectedIds.clear();
      renderList(); _renderJrnSelectBar();
      document.getElementById("btn-jrn-select")?.classList.remove("active-accent");
    });
  }
  bar.querySelector("#jrn-select-count").textContent =
    _jrnSelectedIds.size + " sélectionnée" + (_jrnSelectedIds.size > 1 ? "s" : "");
  requestAnimationFrame(() => bar.classList.add("open"));
}

function renderList() {
  const list = document.getElementById("journal-list");
  const cnt = document.getElementById("journal-count");
  const sideCnt = document.getElementById("journal-side-count");
  if (!list) return;
  list.innerHTML = "";

  const filtered = filteredEntries();
  const total = sortedEntries().length;
  if (cnt) cnt.textContent = total + " entrée" + (total > 1 ? "s" : "");
  if (sideCnt) sideCnt.textContent = filtered.length;

  if (!filtered.length) {
    list.innerHTML = `<div class="journal-side-empty">${
      _journalSearch
        ? "Aucune entrée ne correspond."
        : "Aucune entrée pour l'instant."
    }</div>`;
    return;
  }

  filtered.forEach((entry) => {
    const item = document.createElement("div");
    item.className = "journal-entry-wrap";

    const btn = document.createElement("button");
    btn.className =
      "journal-entry" + (entry.id === _currentEntryId ? " active" : "");
    const mood = MOODS.find((m) => m.id === entry.mood);
    btn.innerHTML = `
      <div class="journal-entry-date">
        <div class="journal-entry-day">${formatDay(entry.createdAt)}</div>
        <div class="journal-entry-mon">${formatMon(entry.createdAt)}</div>
      </div>
      <div class="journal-entry-body">
        <div class="journal-entry-title">${escHtml(entry.title || "Entrée du " + formatFull(entry.createdAt))}</div>
        <div class="journal-entry-preview">${escHtml(preview(entry.content))}</div>
      </div>
      ${mood ? `<div class="journal-entry-mood" title="${escHtml(mood.label)}">${mood.emoji}</div>` : ""}`;
    if (_jrnSelectMode) {
      const cb = document.createElement("input");
      cb.type = "checkbox"; cb.className = "todo-select-cb";
      cb.checked = _jrnSelectedIds.has(entry.id);
      cb.style.cssText = "margin-right:8px;flex-shrink:0";
      cb.addEventListener("change", () => {
        if (cb.checked) _jrnSelectedIds.add(entry.id); else _jrnSelectedIds.delete(entry.id);
        btn.classList.toggle("selected", cb.checked);
        _renderJrnSelectBar();
      });
      btn.prepend(cb);
    }
    btn.addEventListener("click", (e) => {
      if (_jrnSelectMode) {
        const cb = btn.querySelector(".todo-select-cb");
        if (cb && e.target !== cb) { cb.checked = !cb.checked; cb.dispatchEvent(new Event("change")); }
        return;
      }
      _currentEntryId = entry.id;
      renderList();
      renderMain();
    });

    const delBtn = document.createElement("button");
    delBtn.className = "journal-entry-del";
    delBtn.title = "Supprimer cette entrée";
    delBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
      <polyline points="2,4 3,4 14,4"/>
      <path d="M13 4l-.7 9a1 1 0 01-1 1H4.7a1 1 0 01-1-1L3 4"/>
      <path d="M6 4V3a1 1 0 011-1h2a1 1 0 011 1v1"/>
    </svg>`;
    delBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      confirmDialog(`Supprimer « ${entry.title || "cette entrée"} » ?`, () => {
        if (_currentEntryId === entry.id) {
          const remaining = filteredEntries().filter((en) => en.id !== entry.id);
          _currentEntryId = remaining[0]?.id || null;
        }
        deleteJournalEntry(entry.id);
        renderList();
        renderMain();
        showToast("Entrée déplacée dans la corbeille");
        if (typeof updateTrashBadge === "function") updateTrashBadge();
      });
    });

    item.appendChild(btn);
    item.appendChild(delBtn);
    list.appendChild(item);
  });
}

// ── Rendu zone principale ───────────────────────────────

function renderMain() {
  const main = document.getElementById("journal-main");
  if (!main) return;

  const entry = _currentEntryId ? getJournalEntry(_currentEntryId) : null;
  if (!entry) {
    main.innerHTML = `
      <div class="journal-empty">
        <div class="journal-empty-icon">📓</div>
        <h2>Votre journal de bord</h2>
        <p>Un espace personnel pour consigner ce que vous voulez, librement.<br>Les entrées restent stockées en local, sur cette machine uniquement.</p>
        <button class="btn btn-primary" id="btn-empty-create">Écrire ma première entrée</button>
      </div>`;
    main
      .querySelector("#btn-empty-create")
      ?.addEventListener("click", () => handleCreate());
    return;
  }

  main.innerHTML = `
    <div class="journal-entry-header">
      <div style="flex:1;min-width:0">
        <input type="text" id="je-title" class="journal-entry-title-input"
               placeholder="Titre de l'entrée (optionnel)…"
               value="${escHtml(entry.title || "")}" maxlength="120">
        <div class="journal-entry-info">
          <span>📅 ${escHtml(formatFull(entry.createdAt))}</span>
          <span>🕐 ${escHtml(formatTime(entry.createdAt))}</span>
          ${
            entry.updatedAt && entry.updatedAt > entry.createdAt + 5000
              ? `<span>· modifié ${escHtml(timeAgo(entry.updatedAt))}</span>`
              : ""
          }
          <span class="saved" id="je-saved" style="visibility:hidden">✓ enregistré</span>
        </div>
      </div>
    </div>

    <div class="journal-mood-row" id="je-mood">
      ${MOODS.map(
        (m) =>
          `<button type="button" class="journal-mood-btn${m.id === entry.mood ? " active" : ""}" data-mood="${m.id}"><span>${m.emoji}</span><span>${m.label}</span></button>`,
      ).join("")}
    </div>

    <input type="text" id="je-tags" class="journal-tags-input"
           placeholder="Tags séparés par des virgules (ex: famille, travail, idée)"
           value="${escHtml((entry.tags || []).join(", "))}">

    <div id="je-editor-mount"></div>

    <div class="journal-actions">
      <button class="btn btn-ghost" id="btn-delete-entry" style="color:var(--danger)">
        Supprimer
      </button>
    </div>`;

  // Markdown editor
  const mount = main.querySelector("#je-editor-mount");
  if (mount && typeof createMarkdownEditor === "function") {
    _mdEditor = createMarkdownEditor({
      initialValue: entry.content || "",
      placeholder: "Écris librement ce que tu as en tête…",
      minHeight: 320,
      onChange: () => scheduleSave(),
    });
    mount.appendChild(_mdEditor.root);
  }

  // Bindings
  main.querySelector("#je-title")?.addEventListener("input", scheduleSave);
  main.querySelector("#je-tags")?.addEventListener("input", scheduleSave);
  main.querySelectorAll("#je-mood .journal-mood-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const current = getJournalEntry(_currentEntryId);
      const newMood =
        current?.mood === btn.dataset.mood ? "" : btn.dataset.mood;
      main
        .querySelectorAll(".journal-mood-btn")
        .forEach((b) =>
          b.classList.toggle("active", b.dataset.mood === newMood && newMood),
        );
      saveNow({ mood: newMood });
    });
  });
  main.querySelector("#btn-delete-entry")?.addEventListener("click", () => {
    confirmDialog(
      "Supprimer cette entrée du journal ? Cette action est irréversible.",
      () => {
        deleteJournalEntry(_currentEntryId);
        const remaining = sortedEntries();
        _currentEntryId = remaining[0]?.id || null;
        showToast("Entrée supprimée");
        renderList();
        renderMain();
      },
    );
  });
}

// ── Sauvegarde auto ─────────────────────────────────────

function scheduleSave() {
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => saveNow(), 400);
}

function saveNow(extra = {}) {
  if (!_currentEntryId) return;
  const titleEl = document.getElementById("je-title");
  const tagsEl = document.getElementById("je-tags");
  const changes = {
    title: titleEl ? titleEl.value.trim() : undefined,
    content: _mdEditor ? _mdEditor.getValue() : undefined,
    tags: tagsEl
      ? tagsEl.value
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined,
    ...extra,
  };
  Object.keys(changes).forEach(
    (k) => changes[k] === undefined && delete changes[k],
  );
  try {
    updateJournalEntry(_currentEntryId, changes);
    flashSaved();
    // Mise à jour discrète de la sidebar (sans re-render lourd)
    renderList();
  } catch (err) {
    showToast("Erreur lors de la sauvegarde", "error");
  }
}

function flashSaved() {
  const s = document.getElementById("je-saved");
  if (!s) return;
  s.style.visibility = "visible";
  clearTimeout(flashSaved._t);
  flashSaved._t = setTimeout(() => {
    s.style.visibility = "hidden";
  }, 1500);
}

// ── Création ────────────────────────────────────────────

function handleCreate(prefill = {}) {
  const entry = createJournalEntry(prefill);
  _currentEntryId = entry.id;
  _journalSearch = "";
  const searchInput = document.getElementById("journal-search");
  if (searchInput) searchInput.value = "";
  renderList();
  renderMain();
  setTimeout(() => document.getElementById("je-title")?.focus(), 30);
  showToast("Nouvelle entrée");
}

function _injectJournalTemplateBtn() {
  if (document.getElementById("btn-journal-templates")) return;
  const newBtn = document.getElementById("btn-new-entry");
  if (!newBtn) return;

  const btn = document.createElement("button");
  btn.id = "btn-journal-templates";
  btn.className = "btn btn-ghost btn-templates";
  btn.title = "Créer depuis un modèle";
  btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round">
    <rect x="2" y="2" width="5" height="5" rx="1"/><rect x="9" y="2" width="5" height="5" rx="1"/>
    <rect x="2" y="9" width="5" height="5" rx="1"/><rect x="9" y="9" width="5" height="5" rx="1"/>
  </svg> Modèles`;

  btn.addEventListener("click", () => {
    if (typeof openTemplatePicker === "function") {
      openTemplatePicker("journal", btn, (tpl) => {
        handleCreate({
          title:   tpl.title   || "",
          content: tpl.content || "",
          mood:    tpl.mood    || "",
          tags:    tpl.tags    || [],
        });
      });
    }
  });

  newBtn.insertAdjacentElement("beforebegin", btn);
}
