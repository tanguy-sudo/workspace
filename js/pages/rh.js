// @ts-check
// ── pages/rh.js ──

let rhStack = ["root"];
let _rhSelectMode = false;
let _rhSelectedIds = new Set();
let _rhFilterTag    = null;
const _rhExpanded = new Set();
let _rhFocusId = getParam("focus");
let _rhFocusDone = false;

/** Encode la pile RH dans l'URL (sans recharger la page). */
function _stackToUrl(stack) {
  const folders = stack.slice(1); // exclut root
  const base = "rh.html";
  return folders.length ? `${base}?path=${folders.join(",")}` : base;
}

/** Pousse une nouvelle entrée d'historique pour la navigation RH. */
function _pushRhHistory(newStack) {
  history.pushState({ folderStack: [...newStack] }, "", _stackToUrl(newStack));
}

bootPage(() => {
  initPageCommon();

  // Restaurer la pile complète depuis le param `path` (ex: folder1,folder2)
  // Rétro-compat : on accepte aussi l'ancien param `folder` (un seul niveau)
  const pathParam = getParam("path");
  if (pathParam) {
    rhStack = ["root", ...pathParam.split(",").filter(Boolean)];
  } else {
    const fid = getParam("folder");
    if (fid && fid !== "root") rhStack = buildStack(fid);
  }

  if (_rhFocusId) {
    const fullPath = buildStack(_rhFocusId);
    if (fullPath.length > 1) rhStack = fullPath.slice(0, -1);
  }

  // Initialiser l'état de l'historique pour que popstate fonctionne dès la 1ère page
  history.replaceState({ folderStack: [...rhStack] }, "", location.href);

  // Bouton Retour navigateur → restaurer la pile puis re-render
  window.addEventListener("popstate", (e) => {
    if (e.state?.folderStack) {
      rhStack = e.state.folderStack;
      render();
    }
  });

  render();
  bindEvents();
});

function buildStack(targetId) {
  const root = getRhRoot();
  function search(node, target, path) {
    if (node.id === target) return [...path, node.id];
    for (const c of node.children || []) {
      const found = search(c, target, [...path, node.id]);
      if (found) return found;
    }
    return null;
  }
  return search(root, targetId, []) || ["root"];
}

// ── Render ────────────────────────────────────────────────

function render() {
  renderBreadcrumb();
  renderTree();
  _tryFocusRhTarget();
}

function _tryFocusRhTarget() {
  if (!_rhFocusId || _rhFocusDone) return;
  const cards = [...document.querySelectorAll("[data-rh-id]")];
  const target = cards.find((el) => el.dataset.rhId === _rhFocusId);
  if (!target) return;
  _rhFocusDone = true;
  target.scrollIntoView({ behavior: "smooth", block: "center" });
  const prevBox = target.style.boxShadow;
  const prevOutline = target.style.outline;
  target.style.outline = "2px solid var(--accent)";
  target.style.boxShadow = "0 0 0 4px color-mix(in srgb,var(--accent) 20%,transparent)";
  setTimeout(() => {
    target.style.outline = prevOutline;
    target.style.boxShadow = prevBox;
  }, 1600);
}

function renderBreadcrumb() {
  buildBreadcrumb("rh-breadcrumb", rhStack, {
    getLabel:   (id, i) => i === 0 ? "RH" : getRhNode(id)?.name,
    onNavigate: (s) => { rhStack = s; _pushRhHistory(s); render(); },
  });
}

function renderTree() {
  const currentId = rhStack[rhStack.length - 1];
  const currentNode = getRhNode(currentId);
  const container = document.getElementById("rh-tree");
  container.innerHTML = "";

  document.getElementById("doc-count").textContent = countAllDocs(
    getRhRoot().children || [],
  );

  // Bouton retour si on est dans un sous-dossier — TOUJOURS affiché, même si vide
  if (rhStack.length > 1) {
    const backBtn = el("button", "btn btn-ghost");
    backBtn.style.marginBottom = "var(--sp-3)";
    backBtn.innerHTML = IC.back + " Remonter";
    backBtn.addEventListener("click", () => {
      _rhFilterTag = null;
      history.back();
    });
    makeDropTarget(backBtn, "__back__", (draggedId) => {
      const parentId = rhStack[rhStack.length - 2];
      if (moveRhNode(draggedId, parentId)) {
        render();
        showToast("Déplacé dans le dossier parent", "success");
      }
    });
    container.appendChild(backBtn);
  }

  if (!currentNode?.children?.length) {
    const e = el("div", "empty-state");
    e.innerHTML = IC.empty + "<p>Dossier vide.</p>";
    container.appendChild(e);
    return;
  }

  const folders = currentNode.children.filter((c) => c.nodeType === "folder");
  let docs = currentNode.children.filter((c) => c.nodeType === "document");
  _renderTagFilter(docs);
  if (_rhFilterTag) docs = docs.filter((d) => (d.tags || []).includes(_rhFilterTag));

  const visibleDocIds = new Set(docs.map((doc) => doc.id));
  const visibleChildren = currentNode.children.filter((child) =>
    child.nodeType === "folder" || visibleDocIds.has(child.id),
  );

  visibleChildren.forEach((child, i) => {
    const card = child.nodeType === "folder"
      ? createRhFolderCard(child)
      : createDocCard(child);
    card.style.animationDelay = `${i * 25}ms`;
    container.appendChild(card);
  });
}

// ── Cards ─────────────────────────────────────────────────



function _renderTagFilter(docs) {
  const wrap = document.getElementById("rh-tag-filters");
  if (!wrap) return;
  const allTags = [...new Set(docs.flatMap((d) => d.tags || []))];
  wrap.innerHTML = "";
  wrap.style.display = allTags.length ? "" : "none";
  if (!allTags.length) return;

  const allBtn = el("button",
    "filter-btn" + (_rhFilterTag === null ? " active-accent" : ""), "Tous");
  allBtn.addEventListener("click", () => { _rhFilterTag = null; render(); });
  wrap.appendChild(allBtn);

  allTags.forEach((tag) => {
    const btn = el("button",
      "filter-btn" + (_rhFilterTag === tag ? " active-accent" : ""), escHtml(tag));
    btn.addEventListener("click", () => { _rhFilterTag = tag; render(); });
    wrap.appendChild(btn);
  });
}

function toggleRhSelectMode() {
  _rhSelectMode = !_rhSelectMode;
  _rhSelectedIds.clear();
  render();
  _renderRhSelectBar();
  document.getElementById("btn-rh-select")?.classList.toggle("active-accent", _rhSelectMode);
}

function _renderRhSelectBar() {
  let bar = document.getElementById("rh-select-bar");
  if (!_rhSelectMode) { if (bar) bar.remove(); return; }
  if (!bar) {
    bar = el("div", "bulk-action-bar");
    bar.id = "rh-select-bar";
    bar.innerHTML =
      '<span id="rh-select-count">0 sélectionné(s)</span>' +
      '<button class="btn btn-danger btn-sm" id="btn-rh-bulk-delete">Supprimer</button>' +
      '<button class="btn btn-ghost btn-sm" id="btn-rh-cancel">Annuler</button>';
    document.body.appendChild(bar);
    bar.querySelector("#btn-rh-bulk-delete").addEventListener("click", () => {
      if (!_rhSelectedIds.size) return;
      {
        const _rhFolIds = [..._rhSelectedIds].filter(id => getRhNode(id)?.nodeType === "folder");
        const _rhDocIds = [..._rhSelectedIds].filter(id => getRhNode(id)?.nodeType === "document");
        const _rhParts  = [];
        if (_rhFolIds.length) _rhParts.push(`${_rhFolIds.length} dossier${_rhFolIds.length>1?"s":""}`);
        if (_rhDocIds.length) _rhParts.push(`${_rhDocIds.length} document${_rhDocIds.length>1?"s":""}`);
        confirmDialog(`Supprimer ${_rhParts.join(" et ")} ?`, () => {
          _rhSelectedIds.forEach((id) => deleteRhNode(id));
          _rhSelectedIds.clear(); _rhSelectMode = false;
          render(); _renderRhSelectBar();
          showToast("Éléments supprimés", "success");
        });
      }
    });
    bar.querySelector("#btn-rh-cancel").addEventListener("click", () => {
      _rhSelectMode = false; _rhSelectedIds.clear();
      render(); _renderRhSelectBar();
      document.getElementById("btn-rh-select")?.classList.remove("active-accent");
    });
  }
  bar.querySelector("#rh-select-count").textContent =
    _rhSelectedIds.size + " sélectionné" + (_rhSelectedIds.size > 1 ? "s" : "");
  requestAnimationFrame(() => bar.classList.add("open"));
}

/** Réordonne un nœud RH avant/après un autre dans le même dossier. */
function _rhReorderRelativeTo(srcId, targetId, before) {
  const parentId = rhStack[rhStack.length - 1];
  const parentNode = parentId === "root" ? getRhRoot() : getRhNode(parentId);
  if (!parentNode) return;
  const ids = (parentNode.children || []).map((c) => c.id).filter((id) => id !== srcId);
  const idx = ids.indexOf(targetId);
  if (idx === -1) return;
  ids.splice(before ? idx : idx + 1, 0, srcId);
  reorderRhChildren(parentId, ids);
  render();
}

function createRhFolderCard(folder) {
  const count = (folder.children || []).length;
  const card = el("div", "rh-folder-card");
  card.dataset.rhId = folder.id;
  card.innerHTML = `
    <div class="rh-folder-icon">${IC.folder}</div>
    <div class="rh-folder-name">${escHtml(folder.name)}</div>
    <div class="rh-folder-count">${count} élément${count > 1 ? "s" : ""}</div>
    ${_rhSelectMode ? '<input type="checkbox" class="todo-select-cb" style="pointer-events:none">' : ""}
    <div class="card-actions">
      <button class="btn-icon" data-a="pin" title="${folder.pinned?'Désépingler':'Épingler'}" style="${folder.pinned?'color:var(--accent)':''}">${folder.pinned ? IC.pin : IC.pinOff}</button>
      <button class="btn-icon" data-a="move" title="Déplacer dans un dossier">${IC.folder}</button>
      <button class="btn-icon" data-a="rename" title="Renommer">${IC.edit}</button>
      <button class="btn-icon danger" data-a="delete" title="Supprimer">${IC.trash}</button>
    </div>
    <div class="rh-folder-arrow">${IC.chevron}</div>`;
  card.addEventListener("click", (e) => {
    if (e.target.closest("[data-a]")) return;
    if (_rhSelectMode) {
      const checked = _rhSelectedIds.has(folder.id);
      if (checked) _rhSelectedIds.delete(folder.id); else _rhSelectedIds.add(folder.id);
      card.classList.toggle("selected", !checked);
      const cb = card.querySelector(".todo-select-cb");
      if (cb) cb.checked = !checked;
      _renderRhSelectBar();
      return;
    }
    _rhFilterTag = null;
    const nextStack = [...rhStack, folder.id];
    rhStack = nextStack;
    _pushRhHistory(nextStack);
    trackVisit("rh", folder.id, folder.name);
    render();
  });
  card.querySelector('[data-a="pin"]')?.addEventListener("click", (e) => {
    e.stopPropagation();
    updateRhNode(folder.id, { pinned: !folder.pinned });
    render();
  });
  card.querySelector('[data-a="move"]')?.addEventListener("click", (e) => {
    e.stopPropagation();
    openMoveRhModal(folder);
  });
  card.querySelector('[data-a="rename"]').addEventListener("click", (e) => {
    e.stopPropagation();
    _openNodeRenameModal(folder);
  });
  card.querySelector('[data-a="delete"]').addEventListener("click", (e) => {
    e.stopPropagation();
    confirmDialog(`Supprimer « ${folder.name} » et tout son contenu ?`, () => {
      deleteRhNode(folder.id);
      render();
      showToast("Dossier supprimé");
    });
  });

  makeDraggable(card, folder.id, "folder");
  makeDropTarget(card, folder.id, (draggedId, pos) => {
    if (pos) { _rhReorderRelativeTo(draggedId, folder.id, pos === "before"); return; }
    if (moveRhNode(draggedId, folder.id)) {
      render();
      showToast(`Déplacé dans « ${folder.name} »`, "success");
    }
  }, { reorderTypes: ["folder", "doc"] });

  return card;
}

function createDocCard(doc) {
  const collapsed = !_rhExpanded.has(doc.id);
  const card = el("div",
    "doc-card rh-tree" + (collapsed ? " collapsed" : "") + (_rhSelectMode && _rhSelectedIds.has(doc.id) ? " selected" : ""));
  card.dataset.rhId = doc.id;
  card.style.display = "grid";

  makeDraggable(card, doc.id, "doc");
  makeDropTarget(card, doc.id, (draggedId, pos) => {
    if (pos) _rhReorderRelativeTo(draggedId, doc.id, pos === "before");
  }, { reorder: true });

  const resolver = (title) => {
    const all = getAllRhDocs(getRhRoot().children || []);
    return (
      all.find((d) => d.title?.toLowerCase() === title.toLowerCase()) || null
    );
  };

  let meta = "";
  if (doc.date)
    meta += `<span>${new Date(doc.date).toLocaleDateString("fr-FR")}</span>`;

  const _tagChips = (doc.tags || []).map((t) => `<span class="tag-chip">${escHtml(t)}</span>`).join("");
  let bodyHtml = `${_tagChips ? `<div class="doc-card-tags">${_tagChips}</div>` : ""}`;
  const detectedUrl = (typeof safeUrl === "function" ? safeUrl(doc.url) : null) || (typeof safeUrl === "function" ? safeUrl((((doc.note || "").match(/\bhttps?:\/\/[^\s<>"')]+/i) || [])[0] || "")) : null);
  const titleHtml = detectedUrl
     ? `<a href="${escHtml(detectedUrl)}" class="doc-card-title doc-card-title-link" target="_blank" rel="noopener noreferrer">${escHtml(doc.title)}</a>`
    : `<div class="doc-card-title">${escHtml(doc.title)}</div>`;
  if (meta) bodyHtml += `<div class="doc-card-meta">${meta}</div>`;
  const safeDocUrl = typeof safeUrl === "function" ? safeUrl(doc.url) : null;
  if (safeDocUrl)
    bodyHtml += `<a href="${escHtml(safeDocUrl)}" class="doc-card-url" target="_blank" rel="noopener noreferrer">${escHtml(safeDocUrl)}</a>`;

  card.innerHTML = `<div class="doc-card-main">
    <div class="doc-card-summary" style="cursor:pointer">${titleHtml}</div>
    <div class="doc-card-body">${bodyHtml}</div>
  </div>
    <div class="doc-card-actions">
      <button class="btn-icon rh-doc-collapse-btn${collapsed ? " is-collapsed" : ""}" data-a="collapse" title="${collapsed ? "Déplier" : "Plier"}" aria-label="${collapsed ? "Déplier" : "Plier"}">
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 6l4 4 4-4"/></svg>
      </button>
      <button class="btn-icon" data-a="pin" title="${doc.pinned?'Désépingler':'Épingler'}" style="${doc.pinned?'color:var(--accent)':''}">${doc.pinned ? IC.pin : IC.pinOff}</button>
      <button class="btn-icon" data-a="move" title="Déplacer dans un dossier">${IC.folder}</button>
      <button class="btn-icon" data-a="edit">${IC.edit}</button>
      <button class="btn-icon danger" data-a="delete">${IC.trash}</button>
    </div>`;

  // Insérer la checkbox APRÈS innerHTML pour qu'elle ne soit pas écrasée
  if (_rhSelectMode) {
    card.style.gridTemplateColumns = "auto 1fr auto";
    const cb = el("input"); cb.type = "checkbox"; cb.className = "todo-select-cb";
    cb.style.cssText = "align-self:center;flex-shrink:0";
    cb.checked = _rhSelectedIds.has(doc.id);
    cb.addEventListener("change", () => {
      if (cb.checked) _rhSelectedIds.add(doc.id); else _rhSelectedIds.delete(doc.id);
      card.classList.toggle("selected", cb.checked); _renderRhSelectBar();
    });
    card.prepend(cb);
  }
  const toggleCollapsed = () => {
    const isCollapsed = card.classList.toggle("collapsed");
    if (isCollapsed) _rhExpanded.delete(doc.id);
    else _rhExpanded.add(doc.id);
    const btn = card.querySelector('[data-a="collapse"]');
    btn?.classList.toggle("is-collapsed", isCollapsed);
    if (btn) {
      btn.title = isCollapsed ? "Déplier" : "Plier";
      btn.setAttribute("aria-label", isCollapsed ? "Déplier" : "Plier");
    }
  };
  const toggleSelection = () => {
    const cb = card.querySelector(".todo-select-cb");
    if (cb) { cb.checked = !cb.checked; cb.dispatchEvent(new Event("change")); }
  };

  card.querySelector('[data-a="collapse"]')?.addEventListener("click", (e) => {
    e.stopPropagation();
    if (_rhSelectMode) return;
    toggleCollapsed();
  });

  card.querySelector(".doc-card-summary")?.addEventListener("click", (e) => {
    if (e.target.closest("a, button, input")) return;
    if (_rhSelectMode) {
      toggleSelection();
      return;
    }
    toggleCollapsed();
  });

  card.querySelector(".doc-card-body")?.addEventListener("click", (e) => {
    if (e.target.closest(".see-more-btn, a, button, input")) return;
    if (_rhSelectMode) {
      toggleSelection();
      return;
    }
    openDocViewModal(doc);
  });

  // Note tronquée avec wiki links
  if (doc.note) {
    const noteWrap = createTruncatedNote(doc.note, resolver, (node) =>
      openWikiModal(node),
    );
    card.querySelector(".doc-card-body")?.appendChild(noteWrap);
  }

  // Fichier joint
  if (doc.file) {
    const fe = renderFileAttachment(doc.file);
    if (fe) card.querySelector(".doc-card-body")?.appendChild(fe);
  }

  card.querySelector('[data-a="pin"]')?.addEventListener("click", (e) => {
    e.stopPropagation();
    updateRhNode(doc.id, { pinned: !doc.pinned });
    render();
  });
  card.querySelector('[data-a="move"]')?.addEventListener("click", (e) => {
    e.stopPropagation();
    openMoveRhModal(doc);
  });
  card
    .querySelector('[data-a="edit"]')
    .addEventListener("click", () => openDocModal(doc));
  card.querySelector('[data-a="delete"]').addEventListener("click", () => {
    confirmDialog(`Supprimer « ${doc.title} » ?`, () => {
      deleteRhNode(doc.id);
      render();
      showToast("Document supprimé");
    });
  });
  return card;
}

// ── Events ────────────────────────────────────────────────

function bindEvents() {
  document
    .getElementById("btn-new-doc")
    .addEventListener("click", () => openDocModal());
  document
    .getElementById("btn-new-folder")
    .addEventListener("click", openFolderModal);
  document.getElementById("btn-rh-select")?.addEventListener("click", toggleRhSelectMode);
}

// ── Modals ────────────────────────────────────────────────

function openDocViewModal(doc) {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal modal-doc-view">
      <div class="modal-header">
        <span class="modal-title">${escHtml(doc.title)}</span>
        <div style="display:flex;gap:var(--sp-2)">
          <button class="btn btn-ghost btn-sm" id="dv-edit">${IC.edit} Modifier</button>
          <button class="btn-icon btn-close" aria-label="Fermer">✕</button>
        </div>
      </div>
      <div class="modal-body modal-doc-body">
        ${typeof safeUrl === "function" && safeUrl(doc.url) ? `<a href="${escHtml(safeUrl(doc.url))}" class="doc-view-url" target="_blank" rel="noopener noreferrer">${escHtml(safeUrl(doc.url))}</a>` : ""}
        ${doc.date ? `<div class="doc-view-date">📅 ${new Date(doc.date).toLocaleDateString("fr-FR")}</div>` : ""}
        <div id="dv-content" class="md-rendered doc-view-content"></div>
        ${doc.file ? `<div class="doc-view-file"></div>` : ""}
      </div>
    </div>`;

  const close = () => {
    overlay.classList.remove("open");
    setTimeout(() => overlay.remove(), 220);
  };
  overlay.querySelector(".btn-close").addEventListener("click", close);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  overlay.querySelector("#dv-edit").addEventListener("click", () => {
    close();
    setTimeout(() => openDocModal(doc), 230);
  });

  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add("open"));

  // Rendu markdown
  const contentEl = overlay.querySelector("#dv-content");
  if (doc.note) {
    if (typeof renderMarkdownInto === "function") {
      const resolver = (title) => {
        const all = getAllRhDocs(getRhRoot().children || []);
        return all.find((d) => d.title?.toLowerCase() === title.toLowerCase()) || null;
      };
      renderMarkdownInto(contentEl, doc.note);
      if (typeof bindWikiLinks === "function") {
        bindWikiLinks(contentEl, resolver, (node) => { close(); openWikiModal(node); });
      }
    } else {
      contentEl.textContent = doc.note;
    }
  } else {
    contentEl.innerHTML = "<p style='color:var(--text-3);font-style:italic'>Aucun contenu.</p>";
  }

  if (doc.file) {
    const fe = renderFileAttachment(doc.file);
    if (fe) overlay.querySelector(".doc-view-file")?.appendChild(fe);
  }
}

function openDocModal(existing) {
  let selFile = existing?.file || null;
  const isEdit = !!existing;
  let formReady = false;
  const normalizeTags = (v) =>
    String(v || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .join("|");
  const fileSig = (f) => (f ? `${f.name || ""}|${f.type || ""}|${f.size || ""}` : "");
  const initialState = isEdit
    ? JSON.stringify({
      title: existing.title || "",
      url: existing.url || "",
      date: existing.date || "",
      note: existing.note || "",
      tags: (existing.tags || []).join("|"),
      file: fileSig(existing.file),
    })
    : "";
  const content = el("div");
  content.innerHTML = `
    <div class="field"><label>Titre *</label><input type="text" id="d-title" maxlength="120" value="${escHtml(existing?.title || "")}"></div>
    <div class="field"><label>URL <span style="color:var(--text-3);font-size:.75rem">(optionnel)</span></label><input type="url" id="d-url" placeholder="https://…" value="${escHtml(existing?.url || "")}"></div>
    <div class="field"><label>Date <span style="color:var(--text-3);font-size:.75rem">(optionnel)</span></label><input type="date" id="d-date" value="${existing?.date || ""}"></div>
    <div class="field"><label>Tags <span style="color:var(--text-3);font-size:.75rem">(séparés par des virgules)</span></label><input type="text" id="d-tags" value="${(existing?.tags||[]).join(', ')||''}" placeholder="api, java…"></div>
    <div class="field"><label>Note <span style="color:var(--text-3);font-size:.75rem">(optionnel — Markdown + [[liens]] supportés)</span></label><div id="d-note-mount" data-md-initial="${escHtml(existing?.note || "")}"></div></div>
    <div class="field"><label>Fichier joint</label>
      <div class="drop-zone" id="d-drop">${IC.upload}<span>Glisser un fichier ou cliquer</span></div>
      <div id="d-preview"></div>
    </div>`;

  const modalApi = createModal({
    title: existing ? "Modifier le document" : "Ajouter un document",
    confirmLabel: existing ? "Enregistrer" : "Ajouter",
    content,
    watchConfirm: true,
    isConfirmEnabled: () => {
      if (!formReady) return false;
      const state = {
        title: document.getElementById("d-title")?.value.trim() || "",
        url: document.getElementById("d-url")?.value.trim() || "",
        date: document.getElementById("d-date")?.value || "",
        note: document.getElementById("d-note")?.value.trim() || "",
        tags: normalizeTags(document.getElementById("d-tags")?.value),
        file: fileSig(selFile),
      };
      if (!state.title) return false;
      return !isEdit || JSON.stringify(state) !== initialState;
    },
    disabledConfirmTitle: existing
      ? "Aucune modification détectée ou titre requis"
      : "Le titre est requis",
    onConfirm: () => {
      const title = document.getElementById("d-title")?.value.trim();
      if (!title) {
        showToast("Titre requis");
        return;
      }
      const data = {
        nodeType: "document",
        title,
        url: document.getElementById("d-url")?.value.trim() || "",
        date: document.getElementById("d-date")?.value || "",
        note: document.getElementById("d-note")?.value.trim() || "",
        tags: (document.getElementById("d-tags")?.value || "").split(",").map((s) => s.trim()).filter(Boolean),
        file: selFile,
      };
      const parentId = rhStack[rhStack.length - 1];
      if (existing) {
        updateRhNode(existing.id, data);
        showToast("Document mis à jour");
      } else {
        addRhNode(parentId, { id: uid(), ...data, createdAt: Date.now() });
        showToast("Document ajouté !");
      }
      render();
    },
  });

  setTimeout(() => {
    // Markdown editor pour la note
    const noteMount = document.getElementById("d-note-mount");
    if (noteMount && typeof createMarkdownEditor === "function") {
      const initial = noteMount.dataset.mdInitial || "";
      const md = createMarkdownEditor({
        initialValue: initial,
        minHeight: 140,
      });
      md.textarea.id = "d-note";
      noteMount.replaceWith(md.root);
    }

    const drop = document.getElementById("d-drop");
    const prev = document.getElementById("d-preview");
    if (drop)
      initDragDrop(drop, (f) => {
        selFile = f;
        if (prev) {
          prev.innerHTML = "";
          const fe = renderFileAttachment(f);
          if (fe) prev.appendChild(fe);
        }
        modalApi.refreshConfirmState();
      });
    if (existing?.file && prev) {
      const fe = renderFileAttachment(existing.file);
      if (fe) prev.appendChild(fe);
    }
    formReady = true;
    modalApi.refreshConfirmState();
    document.getElementById("d-title")?.focus();
  }, 30);
}

function openFolderModal() {
  openNewFolderModal({
    placeholder: "Ex: Transport 2025",
    onCreate: (name) => {
      const parentId = rhStack[rhStack.length - 1];
      addRhNode(parentId, { id: uid(), nodeType: "folder", name, children: [], createdAt: Date.now() });
      render();
      showToast("Dossier créé");
    },
  });
}

function _openNodeRenameModal(node) {
  openRenameModal(node.name, (name) => {
    updateRhNode(node.id, { name });
    render();
  });
}

function listAllRhFolders() {
  const root = getRhRoot();
  const out = [];
  (function walk(node, depth) {
    if (!node || node.nodeType !== "folder") return;
    out.push({ id: node.id, name: node.name, depth });
    (node.children || [])
      .filter((c) => c.nodeType === "folder")
      .forEach((c) => walk(c, depth + 1));
  })(root, 0);
  return out;
}

function getRhParentId(nodeId) {
  const root = getRhRoot();
  let parentId = "root";
  (function walk(node) {
    if (!node?.children?.length) return;
    for (const child of node.children) {
      if (child.id === nodeId) {
        parentId = node.id || "root";
        return;
      }
      if (child.nodeType === "folder") walk(child);
    }
  })(root);
  return parentId;
}

function openMoveRhModal(node) {
  const currentParentId = getRhParentId(node.id);
  const content = el("div");
  const folderOptions = listAllRhFolders()
    .map(
      (f) =>
        `<option value="${f.id}" ${currentParentId === f.id ? "selected" : ""}>${"\u00a0\u00a0".repeat(f.depth)}${escHtml(f.name)}</option>`,
    )
    .join("");
  content.innerHTML = `
    <div class="field"><label>Déplacer « ${escHtml(node.title || node.name || "élément")} » vers</label>
      <select id="rh-move-folder">${folderOptions}</select>
    </div>`;
  createModal({
    title: node.nodeType === "document" ? "Déplacer le document" : "Déplacer le dossier",
    confirmLabel: "Déplacer",
    content,
    onConfirm: () => {
      const target = document.getElementById("rh-move-folder")?.value || "root";
      if (target === currentParentId) return;
      const ok = moveRhNode(node.id, target);
      if (!ok) {
        showToast("Déplacement impossible", "error");
        return;
      }
      render();
      showToast(node.nodeType === "document" ? "Document déplacé" : "Dossier déplacé", "success");
    },
  });
}

// ── Helpers ───────────────────────────────────────────────

function countAllDocs(children) {
  return countTreeNodes(children, (node) => node.nodeType === "document");
}

function getAllRhDocs(children) {
  return collectTreeNodes(children, (node) => node.nodeType === "document");
}
