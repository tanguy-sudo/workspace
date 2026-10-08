// @ts-check
// ── pages/snippets.js ──

let searchQuery = "",
  filterLang = "all",
  filterFav = false;

let _snipViewMode  = safeStorageGet("workspace-snippets-view", "grid");
let _snipSelectMode = false;
let _snipSelectedIds = new Set();
let snippetStack = ["root"]; // pile de navigation dans les dossiers
const _expanded  = new Set(); // IDs des snippets explicitement dépliés
let _snippetFocusId = getParam("focus");
let _snippetFocusDone = false;

/** Encode la pile snippets dans l'URL (sans recharger la page). */
function _stackToUrl(stack) {
  const folders = stack.slice(1); // exclut root
  const base = "snippets.html";
  return folders.length ? `${base}?path=${folders.join(",")}` : base;
}

/** Pousse une nouvelle entrée d'historique pour la navigation snippets. */
function _pushSnippetHistory(newStack) {
  history.pushState({ folderStack: [...newStack] }, "", _stackToUrl(newStack));
}

const LANG_COLORS = {
  javascript: "#f7df1e",
  typescript: "#3178c6",
  python: "#3572A5",
  bash: "#89e051",
  sql: "#e38c00",
  markdown: "#0f766e",
  html: "#e34c26",
  css: "#563d7c",
  json: "#292929",
  dockerfile: "#384d54",
  rust: "#dea584",
  go: "#00ADD8",
  java: "#b07219",
  php: "#4F5D95",
  ruby: "#701516",
  plaintext: "#666",
};

bootPage(() => {
  initPageCommon();

  // Restaurer la pile complète depuis le param `path` (ex: folder1,folder2)
  // Rétro-compat : on accepte aussi l'ancien param `folder` (un seul niveau)
  const pathParam = getParam("path");
  if (pathParam) {
    snippetStack = ["root", ...pathParam.split(",").filter(Boolean)];
  } else {
    const fid = getParam("folder");
    if (fid && fid !== "root") snippetStack = buildSnippetFolderStack(fid);
  }

  if (_snippetFocusId) {
    const asFolder = getSnippetFolder(_snippetFocusId);
    if (asFolder && asFolder.id !== "root") {
      const folderPath = buildSnippetFolderStack(asFolder.id).slice(0, -1);
      snippetStack = folderPath.length ? folderPath : ["root"];
    } else {
      const asSnippet = getSnippet(_snippetFocusId);
      if (asSnippet) {
        snippetStack = buildSnippetFolderStack(asSnippet.folderId || "root");
      }
    }
  }

  // Initialiser l'état de l'historique pour que popstate fonctionne dès la 1ère page
  history.replaceState({ folderStack: [...snippetStack] }, "", location.href);

  // Bouton Retour navigateur → restaurer la pile puis re-render
  window.addEventListener("popstate", (e) => {
    if (e.state?.folderStack) {
      snippetStack = e.state.folderStack;
      render();
    }
  });

  renderLangFilters();
  render();
  bindEvents();
});

function currentFolderId() {
  const id = snippetStack[snippetStack.length - 1];
  return !id || id === "root" ? null : id;
}

function isSearching() {
  // filterFav seul garde l'arborescence
  return !!(searchQuery || filterLang !== "all");
}

/** Déplace le snippet srcId avant ou après targetId dans la liste courante. */

function toggleSnipSelectMode() {
  _snipSelectMode = !_snipSelectMode;
  _snipSelectedIds.clear();
  render();
  _renderSnipSelectBar();
  document.getElementById("btn-snip-select")?.classList.toggle("active-accent", _snipSelectMode);
}

function _renderSnipSelectBar() {
  let bar = document.getElementById("snip-select-bar");
  if (!_snipSelectMode) { if (bar) bar.remove(); return; }
  if (!bar) {
    bar = el("div", "bulk-action-bar");
    bar.id = "snip-select-bar";
    bar.innerHTML =
      '<span id="snip-select-count">0 sélectionné(s)</span>' +
      '<button class="btn btn-danger btn-sm" id="btn-snip-bulk-delete">Supprimer</button>' +
      '<button class="btn btn-ghost btn-sm" id="btn-snip-select-cancel">Annuler</button>';
    document.body.appendChild(bar);
    bar.querySelector("#btn-snip-bulk-delete").addEventListener("click", () => {
      if (!_snipSelectedIds.size) return;
      const _sFolIds = [..._snipSelectedIds].filter(id => !!getSnippetFolder(id) && getSnippetFolder(id).nodeType === 'folder');
      const _sSnpIds = [..._snipSelectedIds].filter(id => !_sFolIds.includes(id));
      const _sParts  = [];
      if (_sFolIds.length) _sParts.push(`${_sFolIds.length} dossier${_sFolIds.length>1?'s':''}`);
      if (_sSnpIds.length) _sParts.push(`${_sSnpIds.length} snippet${_sSnpIds.length>1?'s':''}`);
      confirmDialog(`Supprimer ${_sParts.join(' et ')} ?`, () => {
        _sFolIds.forEach(id => { try { deleteSnippetFolder(id); } catch(_){} });
        _sSnpIds.forEach(id => deleteSnippet(id));
        _snipSelectedIds.clear();
        _snipSelectMode = false;
        render();
        _renderSnipSelectBar();
        showToast("Éléments supprimés", "success");
      });
    });
    bar.querySelector("#btn-snip-select-cancel").addEventListener("click", () => {
      _snipSelectMode = false; _snipSelectedIds.clear();
      render(); _renderSnipSelectBar();
      document.getElementById("btn-snip-select")?.classList.remove("active-accent");
    });
  }
  bar.querySelector("#snip-select-count").textContent =
    _snipSelectedIds.size + " sélectionné" + (_snipSelectedIds.size > 1 ? "s" : "");
  requestAnimationFrame(() => bar.classList.add("open"));
}

function _reorderSnippetRelativeTo(srcId, targetId, insertBefore) {
  const visible  = getFiltered();
  const allSnips = getSnippets();
  // Construire l'ordre final sur les snippets visibles
  const ids = visible.map((s) => s.id).filter((id) => id !== srcId);
  const targetIdx = ids.indexOf(targetId);
  if (targetIdx === -1) return;
  ids.splice(insertBefore ? targetIdx : targetIdx + 1, 0, srcId);
  // Construire l'ordre global : visibles réordonnés + non-visibles préservés
  const visibleSet = new Set(visible.map((s) => s.id));
  const nonVisible = allSnips.filter((s) => !visibleSet.has(s.id)).map((s) => s.id);
  reorderSnippets([...ids, ...nonVisible]);
  render();
}

function _mixedTokenFromType(id, type) {
  return `${type === "snippet" ? "s" : "f"}:${id}`;
}

function _resolveDraggedSnippetType(draggedId, draggedType) {
  if (draggedType === "snippet" || draggedType === "snippet-folder") return draggedType;
  const maybeFolder = getSnippetFolder(draggedId);
  return maybeFolder && maybeFolder.nodeType === "folder" ? "snippet-folder" : "snippet";
}

function _reorderMixedRelativeTo(draggedId, draggedType, targetId, targetType, insertBefore) {
  const currentId = currentFolderId() || "root";
  const resolvedDragType = _resolveDraggedSnippetType(draggedId, draggedType);
  const srcToken = _mixedTokenFromType(draggedId, resolvedDragType);
  const targetToken = _mixedTokenFromType(targetId, targetType);
  const order = getSnippetMixedOrder(currentId);
  if (!order.includes(targetToken)) return;
  const compact = order.filter((t) => t !== srcToken);
  const idx = compact.indexOf(targetToken);
  if (idx === -1) return;
  compact.splice(insertBefore ? idx : idx + 1, 0, srcToken);
  setSnippetMixedOrder(currentId, compact);
  render();
}

function render() {
  renderBreadcrumb();
  const _allFiltered = getFiltered();
  const snippets = filterFav ? _allFiltered.filter((s) => s.favorite) : _allFiltered;
  const foldersEl = document.getElementById("snippet-folders");
  const list = document.getElementById("snippets-list");
  foldersEl.innerHTML = "";
  list.innerHTML = "";
  list.className = _snipViewMode === "list" ? "snippets-list view-list" : "snippets-list";
  document.getElementById("snippet-count").textContent = getSnippets().length;

  // En mode recherche/filtre : afficher uniquement les résultats plats (sur tous les snippets)
  if (isSearching()) {
    if (!snippets.length) {
      list.appendChild(
        createEmptyState(
          EMPTY_ICONS.snippets,
          "Aucun résultat",
          "Aucun snippet ne correspond à ta recherche.",
        ),
      );
      _tryFocusSnippetTarget();
      return;
    }
    snippets.forEach((s, i) => {
      const c = buildCard(s);
      c.style.animationDelay = i * 25 + "ms";
      list.appendChild(c);
    });
    requestAnimationFrame(highlightAll);
    _tryFocusSnippetTarget();
    return;
  }

  // Mode dossier : sous-dossiers + snippets du dossier courant
  const currentFolder =
    getSnippetFolder(snippetStack[snippetStack.length - 1]) ||
    getSnippetFoldersRoot();
  function _folderHasFav(f) {
    const snips = getSnippets().filter((s) => s.favorite);
    if (snips.some((s) => s.folderId === f.id)) return true;
    return (f.children || []).filter((c) => c.nodeType === "folder").some(_folderHasFav);
  }
  const subFolders = (currentFolder.children || []).filter(
    (c) => c.nodeType === "folder" && (!filterFav || _folderHasFav(c)),
  );

  // Bouton "Remonter" si dans un sous-dossier
  if (snippetStack.length > 1) {
    const backBtn = el("button", "btn btn-ghost");
    backBtn.style.marginBottom = "var(--sp-3)";
    backBtn.innerHTML = IC.back + " Remonter";
    backBtn.addEventListener("click", () => {
      history.back();
    });
    makeDropTarget(backBtn, "__back__", (draggedId) => {
      const parentId = snippetStack[snippetStack.length - 2] || "root";
      const ok = _dndCurrentType === "snippet-folder"
        ? moveSnippetFolder(draggedId, parentId)
        : moveSnippetToFolder(draggedId, parentId);
      if (ok) { render(); showToast("Déplacé dans le dossier parent", "success"); }
    });
    foldersEl.appendChild(backBtn);
  }

  // Section dossiers favoris (au niveau racine seulement, hors recherche)
  if (snippetStack.length === 1 && !filterFav) {
    const allFolders = (getSnippetFoldersRoot().children || []).filter(
      (c) => c.nodeType === "folder" && c.favorite,
    );
    const favFolderWrap = document.getElementById("snippet-fav-folders");
    if (favFolderWrap) {
      favFolderWrap.style.display = allFolders.length ? "" : "none";
      const favFolderGrid = favFolderWrap.querySelector(".fav-folders-grid");
      if (favFolderGrid) {
        favFolderGrid.innerHTML = "";
        allFolders.forEach((f) => {
          const card = buildFolderCard(f);
          favFolderGrid.appendChild(card);
        });
      }
    }
  } else {
    const favFolderWrap = document.getElementById("snippet-fav-folders");
    if (favFolderWrap) favFolderWrap.style.display = "none";
  }

  if (!snippets.length && !subFolders.length) {
    list.appendChild(
      createEmptyState(
        EMPTY_ICONS.snippets,
        "Dossier vide",
        "Ajoute un snippet ou crée un sous-dossier.",
      ),
    );
    _tryFocusSnippetTarget();
    return;
  }

  const order = getSnippetMixedOrder(currentFolder.id || "root");
  const folderById = new Map(subFolders.map((f) => [f.id, f]));
  const snippetById = new Map(snippets.map((s) => [s.id, s]));
  const visibleEntries = [];
  order.forEach((token) => {
    if (token.startsWith("f:")) {
      const folder = folderById.get(token.slice(2));
      if (folder) visibleEntries.push({ type: "folder", item: folder });
      return;
    }
    if (token.startsWith("s:")) {
      const snippet = snippetById.get(token.slice(2));
      if (snippet) visibleEntries.push({ type: "snippet", item: snippet });
    }
  });

  visibleEntries.forEach((entry, i) => {
    const card = entry.type === "folder" ? buildFolderCard(entry.item) : buildCard(entry.item);
    card.style.animationDelay = i * 25 + "ms";
    list.appendChild(card);
  });
  requestAnimationFrame(highlightAll);
  _tryFocusSnippetTarget();
}

function _tryFocusSnippetTarget() {
  if (!_snippetFocusId || _snippetFocusDone) return;
  const cards = [...document.querySelectorAll("[data-snippet-focus-id]")];
  const target = cards.find((el) => el.dataset.snippetFocusId === _snippetFocusId);
  if (!target) return;
  _snippetFocusDone = true;
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
  buildBreadcrumb("snippet-breadcrumb", snippetStack, {
    getLabel:   (id, i) => i === 0 ? "Snippets" : getSnippetFolder(id)?.name,
    onNavigate: (s) => { snippetStack = s; _pushSnippetHistory(s); render(); },
  });
}

function getFiltered() {
  const all = getSnippets();
  const inFolder = isSearching()
    ? all
    : all.filter((s) => (s.folderId || null) === currentFolderId());
  return inFolder.filter((s) => {
    if (filterFav && !s.favorite) return false;
    if (filterLang !== "all" && s.language !== filterLang) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return (
        (s.title || "").toLowerCase().includes(q) ||
        (s.code || "").toLowerCase().includes(q) ||
        (s.tags || []).some((t) => t.toLowerCase().includes(q)) ||
        (s.language || "").toLowerCase().includes(q)
      );
    }
    return true;
  });
}

function buildFolderCard(folder) {
  const directSnippets = getSnippets().filter(
    (s) => (s.folderId || null) === folder.id,
  ).length;
  const subFolders = (folder.children || []).filter(
    (c) => c.nodeType === "folder",
  ).length;
  const card = el("div", "snippet-folder-card");
  card.dataset.snippetFocusId = folder.id;
  card.innerHTML = `
    <div class="snippet-folder-icon">${IC.folder}</div>
    <div class="snippet-folder-info">
      <div class="snippet-folder-name">${escHtml(folder.name)}</div>
      <div class="snippet-folder-count">${directSnippets} snippet${directSnippets > 1 ? "s" : ""}${subFolders ? ` · ${subFolders} sous-dossier${subFolders > 1 ? "s" : ""}` : ""}</div>
    </div>
    <div class="card-actions">
      <button class="btn-icon fav-star${folder.favorite ? ' active' : ''}" data-a="fav" title="${folder.favorite ? 'Retirer des favoris' : 'Marquer favori'}">${folder.favorite ? IC.starFill : IC.star}</button>
      <button class="btn-icon" data-a="move" title="Déplacer dans un dossier">${IC.folder}</button>
      <button class="btn-icon" data-a="rename" title="Renommer">${IC.edit}</button>
      <button class="btn-icon danger" data-a="delete" title="Supprimer">${IC.trash}</button>
    </div>
    <div class="snippet-folder-arrow">${IC.chevron}</div>`;
  card.addEventListener("click", (e) => {
    if (e.target.closest("[data-a]")) return;
    if (_snipSelectMode) {
      const cb = card.querySelector(".todo-select-cb");
      if (cb) { cb.checked = !cb.checked; cb.dispatchEvent(new Event("change")); }
      return;
    }
    const nextStack = [...snippetStack, folder.id];
    snippetStack = nextStack;
    _pushSnippetHistory(nextStack);
    render();
  });
  card.querySelector('[data-a="fav"]')?.addEventListener("click", (e) => {
    e.stopPropagation();
    updateSnippetFolder(folder.id, { favorite: !folder.favorite });
    render();
  });
  card.querySelector('[data-a="move"]')?.addEventListener("click", (e) => {
    e.stopPropagation();
    openMoveFolderModal(folder);
  });
  card.querySelector('[data-a="rename"]').addEventListener("click", (e) => {
    e.stopPropagation();
    openFolderRenameModal(folder);
  });
  card.querySelector('[data-a="delete"]').addEventListener("click", (e) => {
    e.stopPropagation();
    openFolderDeleteModal(folder);
  });

  if (_snipSelectMode) {
    const cb = document.createElement("input");
    cb.type = "checkbox"; cb.className = "todo-select-cb";
    cb.checked = _snipSelectedIds.has(folder.id);
    cb.style.cssText = "pointer-events:none;flex-shrink:0;margin-right:8px;align-self:center";
    cb.addEventListener("change", () => {
      if (cb.checked) _snipSelectedIds.add(folder.id); else _snipSelectedIds.delete(folder.id);
      card.classList.toggle("selected", cb.checked); _renderSnipSelectBar();
    });
    card.prepend(cb);
  }
  makeDraggable(card, folder.id, "snippet-folder");
  makeDropTarget(card, folder.id, (draggedId, pos) => {
    if (pos) {
      _reorderMixedRelativeTo(
        draggedId,
        _dndCurrentType,
        folder.id,
        "snippet-folder",
        pos === "before",
      );
      return;
    }
    const ok = _dndCurrentType === "snippet-folder"
      ? moveSnippetFolder(draggedId, folder.id)
      : moveSnippetToFolder(draggedId, folder.id);
    if (ok) {
      render();
      showToast(
        _dndCurrentType === "snippet-folder" ? "Dossier déplacé" : "Snippet déplacé",
        "success",
      );
    }
  }, { reorderTypes: ["snippet-folder", "snippet"] });

  return card;
}

function buildCard(s) {
  const collapsed = !_expanded.has(s.id);
  const card = el("div",
    "snippet-card" + (collapsed ? " collapsed" : "") +
    (_snipSelectMode && _snipSelectedIds.has(s.id) ? " selected" : ""));
  const color = LANG_COLORS[s.language] || "var(--text-3)";
  let selectCheckbox = null;
  if (_snipSelectMode) {
    const cb = el("input"); cb.type = "checkbox"; cb.className = "todo-select-cb";
    cb.checked = _snipSelectedIds.has(s.id);
    cb.addEventListener("change", () => {
      if (cb.checked) _snipSelectedIds.add(s.id); else _snipSelectedIds.delete(s.id);
      card.classList.toggle("selected", cb.checked); _renderSnipSelectBar();
    });
    selectCheckbox = cb;
  }

  card.dataset.snippetId = s.id;
  card.dataset.snippetFocusId = s.id;
  makeDraggable(card, s.id, "snippet");
  makeDropTarget(card, s.id, (draggedId, position) => {
    if (isSearching()) {
      _reorderSnippetRelativeTo(draggedId, s.id, position === "before");
      return;
    }
    _reorderMixedRelativeTo(draggedId, _dndCurrentType, s.id, "snippet", position === "before");
  }, { reorder: true });

  const langIcon = el("span", "lang-icon");
  langIcon.style.cssText = `background:${color}20;color:${color};`;
  langIcon.textContent = (s.language || "txt").slice(0, 3).toUpperCase();
  const favBtn = el("button", "fav-star" + (s.favorite ? " active" : ""));
  favBtn.innerHTML = s.favorite ? IC.starFill : IC.star;
  favBtn.title = s.favorite ? "Retirer des favoris" : "Favoris";
  favBtn.addEventListener("click", () => {
    updateSnippet(s.id, { favorite: !s.favorite });
    render();
  });
  const moveBtn = el("button", "btn-icon");
  moveBtn.innerHTML = IC.folder;
  moveBtn.title = "Déplacer dans un dossier";
  moveBtn.addEventListener("click", () => openMoveModal(s));
  const editBtn = el("button", "btn-icon");
  editBtn.innerHTML = IC.edit;
  editBtn.addEventListener("click", () => openModal(s));
  const delBtn = el("button", "btn-icon danger");
  delBtn.innerHTML = IC.trash;
  delBtn.addEventListener("click", () =>
    confirmDialog(`Supprimer « ${s.title} » ?`, () => {
      deleteSnippet(s.id);
      render();
      renderLangFilters();
      showToast("Snippet supprimé");
    }),
  );

  // Bouton plier / déplier
  const collapseBtn = el(
    "button",
    "snippet-collapse-btn" + (collapsed ? " is-collapsed" : ""),
  );
  collapseBtn.title = collapsed ? "Déplier" : "Plier";
  collapseBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 6l4 4 4-4"/></svg>`;
  collapseBtn.addEventListener("click", () => {
    if (_expanded.has(s.id)) {
      _expanded.delete(s.id);
      card.classList.add("collapsed");
      collapseBtn.classList.add("is-collapsed");
      collapseBtn.title = "Déplier";
    } else {
      _expanded.add(s.id);
      card.classList.remove("collapsed");
      collapseBtn.classList.remove("is-collapsed");
      collapseBtn.title = "Plier";
    }
  });

  const header = el("div", "snippet-card-header");
  header.style.cursor = "pointer";
  if (selectCheckbox) {
    selectCheckbox.style.cssText = "flex-shrink:0;align-self:center;margin:0 var(--sp-2) 0 0";
    header.appendChild(selectCheckbox);
  }
  header.appendChild(langIcon);
  header.appendChild(el("div", "snippet-title", escHtml(s.title)));
  const acts = el("div", "snippet-card-actions");
  acts.appendChild(favBtn);
  acts.appendChild(moveBtn);
  acts.appendChild(editBtn);
  acts.appendChild(delBtn);
  acts.appendChild(collapseBtn);
  header.appendChild(acts);

  // Clic sur l'en-tête (hors boutons) = plier / déplier (ou sélectionner)
  header.addEventListener("click", (e) => {
    if (e.target.closest("button")) return;
    if (_snipSelectMode) return;
    collapseBtn.click();
  });
  // En mode sélection : toute la carte (pas seulement le header) est cliquable
  card.addEventListener("click", (e) => {
    if (!_snipSelectMode) return;
    if (e.target.closest("button, a, input")) return;
    e.stopPropagation();
    const cb = card.querySelector(".todo-select-cb");
    if (cb) { cb.checked = !cb.checked; cb.dispatchEvent(new Event("change")); }
  });

  const body = el("div", "snippet-card-body");
  const shouldRenderMarkdown =
    s.language === "markdown" &&
    typeof renderMarkdown === "function";
  if (shouldRenderMarkdown) {
    // Vue rendue par défaut ; toggle pour voir la source
    const rendered = el("div", "md-render snippet-md-render");
    rendered.innerHTML = renderMarkdown(s.code || "");
    body.appendChild(rendered);

    const toggleBtn = el("button", "copy-btn snippet-md-toggle");
    toggleBtn.innerHTML = `<svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M1 4h14M1 8h8M1 12h5"/></svg> Source`;
    let showSource = false;
    toggleBtn.addEventListener("click", () => {
      showSource = !showSource;
      if (showSource) {
        rendered.style.display = "none";
        pre.style.display = "block";
        toggleBtn.innerHTML = `<svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M1 4h14M1 8h8M1 12h5"/></svg> Rendu`;
      } else {
        rendered.style.display = "";
        pre.style.display = "none";
        toggleBtn.innerHTML = `<svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M1 4h14M1 8h8M1 12h5"/></svg> Source`;
      }
    });

    const pre = el("pre");
    pre.style.display = "none";
    const codeEl = el("code", "language-markdown");
    codeEl.textContent = s.code;
    pre.appendChild(codeEl);
    body.appendChild(pre);

    // injecter toggleBtn dans footer plus tard via closure — on le stocke sur body
    body._mdToggleBtn = toggleBtn;
  } else {
    const pre = el("pre");
    const codeEl = el("code", s.language ? `language-${s.language}` : "");
    codeEl.textContent = s.code;
    pre.appendChild(codeEl);
    body.appendChild(pre);
  }

  const footer = el("div", "snippet-card-footer");

  // Bouton toggle source/rendu pour les snippets Markdown
  if (body._mdToggleBtn) footer.appendChild(body._mdToggleBtn);

  const copyBtn = el("button", "copy-btn");
  copyBtn.innerHTML = IC.copy + " Copier";
  copyBtn.addEventListener("click", () => {
    navigator.clipboard.writeText(s.code).then(() => {
      copyBtn.innerHTML = IC.check + " Copié !";
      copyBtn.classList.add("copied");
      setTimeout(() => {
        copyBtn.innerHTML = IC.copy + " Copier";
        copyBtn.classList.remove("copied");
      }, 1500);
    });
  });
  footer.appendChild(copyBtn);

  // Ouvrir dans un nouvel onglet (page dédiée avec highlighting)
  const newTabBtn = el("button", "copy-btn");
  newTabBtn.style.marginLeft = "8px";
  newTabBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M7 3H3a1 1 0 00-1 1v9a1 1 0 001 1h9a1 1 0 001-1V9"/><path d="M10 2h4v4M14 2L8 8"/></svg> Plein écran`;
  newTabBtn.addEventListener("click", () => {
    let html;
    if (shouldRenderMarkdown) {
      const body = renderMarkdown(s.code || "");
      html = `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><title>${escHtml(s.title)}</title>
<style>
*{box-sizing:border-box}
body{margin:0;background:#0d1117;color:#e6edf3;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;line-height:1.7;min-height:100vh}
.hdr{padding:14px 24px;background:#161b22;border-bottom:1px solid #30363d;display:flex;align-items:center;gap:16px;position:sticky;top:0}
.hdr-title{color:#e6edf3;font-size:14px;font-weight:600;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.hdr-lang{color:#8b949e;font-size:12px;background:#21262d;padding:3px 10px;border-radius:6px}
.content{max-width:820px;margin:0 auto;padding:40px 32px}
h1,h2,h3,h4{color:#e6edf3;margin-top:1.5em;margin-bottom:.5em}
h1{font-size:1.8rem;border-bottom:1px solid #30363d;padding-bottom:.4em}
h2{font-size:1.3rem;border-bottom:1px solid #21262d;padding-bottom:.3em}
p{margin:.6em 0}
a{color:#58a6ff}
code{background:#21262d;padding:2px 6px;border-radius:4px;font-family:monospace;font-size:.9em}
pre{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:20px;overflow:auto}
pre code{background:none;padding:0;font-size:.88rem}
blockquote{border-left:3px solid #30363d;margin:0;padding-left:16px;color:#8b949e}
table{border-collapse:collapse;width:100%}
th,td{border:1px solid #30363d;padding:8px 12px;text-align:left}
th{background:#161b22}
ul,ol{padding-left:1.5em}
li{margin:.25em 0}
hr{border:none;border-top:1px solid #30363d;margin:1.5em 0}
input[type=checkbox]{margin-right:6px}
</style>
</head><body>
<div class="hdr">
  <span class="hdr-title">${escHtml(s.title)}</span>
  <span class="hdr-lang">Markdown</span>
</div>
<div class="content">${body}</div>
</body></html>`;
    } else {
      html = `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><title>${escHtml(s.title)}</title>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/atom-one-dark.min.css" integrity="sha384-oaMLBGEzBOJx3UHwac0cVndtX5fxGQIfnAeFZ35RTgqPcYlbprH9o9PUV/F8Le07" crossorigin="anonymous">
<style>*{box-sizing:border-box}body{margin:0;background:#0d1117;font-family:monospace;min-height:100vh}
.hdr{padding:14px 24px;background:#161b22;border-bottom:1px solid #30363d;display:flex;align-items:center;justify-content:space-between;gap:16px;position:sticky;top:0}
.hdr-title{color:#e6edf3;font-size:14px;font-weight:600;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.hdr-lang{color:#8b949e;font-size:12px;background:#21262d;padding:3px 10px;border-radius:6px;flex-shrink:0}
.hdr-copy{color:#8b949e;font-size:12px;background:#21262d;border:1px solid #30363d;padding:4px 12px;border-radius:6px;cursor:pointer;transition:all .15s}
.hdr-copy:hover{color:#e6edf3;border-color:#8b949e}
pre{margin:0;padding:28px;overflow:auto}code{font-size:14px;line-height:1.7;white-space:pre;font-family:'JetBrains Mono',monospace}</style>
</head><body>
<div class="hdr">
  <span class="hdr-title">${escHtml(s.title)}</span>
  <span class="hdr-lang">${escHtml(s.language || "plaintext")}</span>
  <button class="hdr-copy" onclick="navigator.clipboard.writeText(document.querySelector('code').innerText).then(()=>{this.textContent='✓ Copié';setTimeout(()=>this.textContent='Copier',1500)})">Copier</button>
</div>
<pre><code class="language-${escHtml(s.language || "plaintext")}">${escHtml(s.code)}</code></pre>
<script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js" integrity="sha384-F/bZzf7p3Joyp5psL90p/p89AZJsndkSoGwRpXcZhleCWhd8SnRuoYo4d0yirjJp" crossorigin="anonymous"><\/script>
<script>hljs.highlightAll()<\/script>
</body></html>`;
    }
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank");
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  });
  footer.appendChild(newTabBtn);

  // Aperçu HTML/CSS
  if (s.language === "html" || s.language === "css") {
    const prevBtn = el("button", "copy-btn");
    prevBtn.style.marginLeft = "8px";
    prevBtn.innerHTML = "👁 Aperçu";
    prevBtn.addEventListener("click", () => openPreview(s));
    footer.appendChild(prevBtn);
  }

  if ((s.tags || []).length) {
    const tw = el("div", "tags-list");
    tw.style.marginTop = "0";
    s.tags.forEach((t) => tw.appendChild(el("span", "tag", "#" + escHtml(t))));
    footer.appendChild(tw);
  }

  card.appendChild(header);
  card.appendChild(body);
  card.appendChild(footer);
  return card;
}

function openPreview(s) {
  const content = el("div");
  const iframe = document.createElement("iframe");
  iframe.className = "snippet-preview-frame";
  iframe.style.height = "320px";
  iframe.setAttribute("sandbox", "");
  if (s.language === "html") iframe.srcdoc = sanitizePreviewHtml(s.code);
  else
    iframe.srcdoc = `<style>${sanitizePreviewCss(s.code)}</style><div style="padding:16px;font-family:sans-serif"><p>Prévisualisation CSS</p><h2>Titre exemple</h2><button>Bouton</button></div>`;
  content.appendChild(iframe);
  createModal({
    title: `Aperçu — ${escHtml(s.title)}`,
    content,
    onConfirm: () => {},
    confirmLabel: "Fermer",
    hideCancel: true,
  });
}

function renderLangFilters() {
  const wrap = document.getElementById("lang-filters");
  if (!wrap) return;
  const used = [
    ...new Set(
      getSnippets()
        .map((s) => s.language)
        .filter(Boolean),
    ),
  ];
  wrap.innerHTML = "";
  const allBtn = el(
    "button",
    "filter-btn" + (filterLang === "all" ? " active-accent" : ""),
    "Tous",
  );
  allBtn.addEventListener("click", () => {
    filterLang = "all";
    render();
    renderLangFilters();
  });
  wrap.appendChild(allBtn);
  used.forEach((l) => {
    const btn = el(
      "button",
      "filter-btn" + (filterLang === l ? " active-accent" : ""),
      escHtml(l),
    );
    btn.addEventListener("click", () => {
      filterLang = l;
      render();
      renderLangFilters();
    });
    wrap.appendChild(btn);
  });
}

function bindEvents() {
  document
    .getElementById("btn-new-snippet")
    .addEventListener("click", () => openModal());
  document
    .getElementById("btn-new-folder")
    ?.addEventListener("click", () => openFolderCreateModal());
  document.getElementById("btn-snip-select")?.addEventListener("click", toggleSnipSelectMode);
  document.getElementById("btn-snip-view-toggle")?.addEventListener("click", () => {
    _snipViewMode = _snipViewMode === "grid" ? "list" : "grid";
    safeStorageSet("workspace-snippets-view", _snipViewMode);
    _updateViewToggleBtn("btn-snip-view-toggle","snip-icon-grid","snip-icon-list","snip-view-label",_snipViewMode);
    render();
  });
  _updateViewToggleBtn("btn-snip-view-toggle","snip-icon-grid","snip-icon-list","snip-view-label",_snipViewMode);
  document.getElementById("search-input").addEventListener(
    "input",
    debounce((e) => {
      searchQuery = e.target.value;
      render();
    }, 200),
  );
  document.getElementById("btn-fav-filter")?.addEventListener("click", () => {
    filterFav = !filterFav;
    document
      .getElementById("btn-fav-filter")
      .classList.toggle("active-accent", filterFav);
    render();
  });
  document
    .getElementById("btn-import")
    ?.addEventListener("click", openImportModal);
}

function openModal(existing) {
  const isEdit = !!existing;
  let formReady = false;
  const normalizeTags = (v) =>
    String(v || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .join("|");
  const initialState = isEdit
    ? JSON.stringify({
      title: existing.title || "",
      code: existing.code || "",
      language: existing.language || "plaintext",
      tags: (existing.tags || []).join("|"),
      folderId: existing.folderId || "root",
    })
    : "";
  const content = el("div");
  const folderOptions = listAllSnippetFolders()
    .map(
      (f) =>
        `<option value="${f.id}" ${(existing ? existing.folderId || "root" : currentFolderId() || "root") === f.id ? "selected" : ""}>${"\u00a0\u00a0".repeat(f.depth)}${escHtml(f.name)}</option>`,
    )
    .join("");
  content.innerHTML = `
    <div class="field"><label>Titre *</label><input type="text" id="s-title" value="${escHtml(existing?.title || "")}" maxlength="100"></div>
    <div class="field-row">
      <div class="field"><label>Langage</label><div id="s-lang-wrap"></div></div>
      <div class="field"><label>Tags (virgule)</label><input type="text" id="s-tags" value="${escHtml((existing?.tags || []).join(", "))}" placeholder="docker, bash…"></div>
    </div>
    <div class="field"><label>Dossier</label><select id="s-folder">${folderOptions}</select></div>
    <div class="field" id="s-code-field"><label>Code *</label><textarea id="s-code" style="font-family:var(--font-mono);font-size:.82rem;min-height:160px">${escHtml(existing?.code || "")}</textarea></div>`;
  const modalApi = createModal({
    title: existing ? "Modifier" : "Nouveau snippet",
    confirmLabel: existing ? "Enregistrer" : "Ajouter",
    content,
    resizable: true,
    watchConfirm: true,
    isConfirmEnabled: () => {
      if (!formReady) return false;
      const state = {
        title: document.getElementById("s-title")?.value.trim() || "",
        code: document.getElementById("s-code")?.value || "",
        language: document.getElementById("s-lang-sel")?.value || "plaintext",
        tags: normalizeTags(document.getElementById("s-tags")?.value),
        folderId: document.getElementById("s-folder")?.value || "root",
      };
      if (!state.title || !state.code) return false;
      return !isEdit || JSON.stringify(state) !== initialState;
    },
    disabledConfirmTitle: existing
      ? "Aucune modification détectée ou champs requis manquants"
      : "Titre et code requis",
    onConfirm: () => {
      const title = document.getElementById("s-title")?.value.trim();
      const code = document.getElementById("s-code")?.value;
      if (!title) {
        showToast("Titre requis");
        return;
      }
      if (!code) {
        showToast("Code requis");
        return;
      }
      const folderId = document.getElementById("s-folder")?.value || "root";
      const data = {
        title,
        code,
        language: document.getElementById("s-lang-sel")?.value || "plaintext",
        tags: document
          .getElementById("s-tags")
          ?.value.split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        folderId: folderId === "root" ? null : folderId,
      };
      if (existing) {
        updateSnippet(existing.id, data);
        showToast("Snippet mis à jour");
      } else {
        createSnippet(data);
        showToast("Snippet ajouté !");
      }
      render();
      renderLangFilters();
    },
  });
  setTimeout(() => {
    const w = document.getElementById("s-lang-wrap");
    let mdEditor = null;

    const ensurePlainEditor = () => {
      if (!mdEditor) return;
      const codeField = document.getElementById("s-code-field");
      if (!codeField) return;
      const ta = document.createElement("textarea");
      ta.id = "s-code";
      ta.style.fontFamily = "var(--font-mono)";
      ta.style.fontSize = ".82rem";
      ta.style.minHeight = "160px";
      ta.value = mdEditor.getValue();
      mdEditor.root.replaceWith(ta);
      mdEditor = null;
    };

    const ensureMarkdownEditor = () => {
      if (mdEditor || typeof createMarkdownEditor !== "function") return;
      const ta = document.getElementById("s-code");
      if (!ta) return;
      const md = createMarkdownEditor({
        initialValue: ta.value || "",
        minHeight: 220,
      });
      md.textarea.id = "s-code";
      ta.replaceWith(md.root);
      mdEditor = md;
    };

    if (w) {
      const sel = createLangSelect(existing?.language || "javascript");
      sel.id = "s-lang-sel";
      sel.addEventListener("change", () => {
        if (sel.value === "markdown") ensureMarkdownEditor();
        else ensurePlainEditor();
        modalApi.refreshConfirmState();
      });
      w.appendChild(sel);
      if (sel.value === "markdown") ensureMarkdownEditor();
    }
    formReady = true;
    modalApi.refreshConfirmState();
    document.getElementById("s-title")?.focus();
  }, 30);
}

// ── Modales dossiers ─────────────────────────────────────────
function openFolderCreateModal() {
  const parentId = snippetStack[snippetStack.length - 1] || "root";
  openNewFolderModal({
    placeholder: "Ex: SQL utilitaires",
    onCreate: (name) => {
      addSnippetFolder(parentId, name);
      render();
      showToast("Dossier créé");
    },
  });
}

function openFolderRenameModal(folder) {
  openRenameModal(folder.name, (name) => {
    renameSnippetFolder(folder.id, name);
    render();
  }, "Renommer le dossier");
}

function openFolderDeleteModal(folder) {
  // Compter le contenu (snippets directs + descendants)
  const descendantIds = [];
  (function collect(n) {
    descendantIds.push(n.id);
    (n.children || []).forEach(collect);
  })(folder);
  const innerSnippets = getSnippets().filter((s) =>
    descendantIds.includes(s.folderId),
  ).length;
  const subFolders = descendantIds.length - 1;

  if (!innerSnippets && !subFolders) {
    confirmDialog(`Supprimer le dossier « ${folder.name} » ?`, () => {
      deleteSnippetFolder(folder.id, false);
      render();
      showToast("Dossier supprimé");
    });
    return;
  }

  const content = el("div");
  content.innerHTML = `
    <p style="font-size:.86rem;color:var(--text-2);margin-bottom:var(--sp-3)">
      Ce dossier contient <strong>${innerSnippets} snippet${innerSnippets > 1 ? "s" : ""}</strong>${subFolders ? ` et <strong>${subFolders} sous-dossier${subFolders > 1 ? "s" : ""}</strong>` : ""}.
    </p>
    <label style="display:flex;gap:8px;align-items:flex-start;font-size:.85rem;cursor:pointer;padding:var(--sp-2) 0">
      <input type="radio" name="sf-del-mode" value="move" checked style="margin-top:3px">
      <span><strong>Déplacer le contenu</strong> vers le dossier parent puis supprimer.</span>
    </label>
    <label style="display:flex;gap:8px;align-items:flex-start;font-size:.85rem;cursor:pointer;padding:var(--sp-2) 0">
      <input type="radio" name="sf-del-mode" value="purge" style="margin-top:3px">
      <span><strong style="color:var(--danger)">Tout supprimer</strong> (dossier + sous-dossiers + snippets contenus).</span>
    </label>`;
  createModal({
    title: `Supprimer « ${escHtml(folder.name)} »`,
    confirmLabel: "Supprimer",
    content,
    onConfirm: () => {
      const mode =
        document.querySelector('input[name="sf-del-mode"]:checked')?.value ||
        "move";
      deleteSnippetFolder(folder.id, mode === "purge");
      render();
      renderLangFilters();
      showToast(
        mode === "purge"
          ? "Dossier et contenu supprimés"
          : "Dossier supprimé, contenu déplacé",
      );
    },
  });
}

function openMoveModal(snippet) {
  const content = el("div");
  const folderOptions = listAllSnippetFolders()
    .map(
      (f) =>
        `<option value="${f.id}" ${(snippet.folderId || "root") === f.id ? "selected" : ""}>${"\u00a0\u00a0".repeat(f.depth)}${escHtml(f.name)}</option>`,
    )
    .join("");
  content.innerHTML = `
    <div class="field"><label>Déplacer « ${escHtml(snippet.title)} » vers</label>
      <select id="s-move-folder">${folderOptions}</select>
    </div>`;
  createModal({
    title: "Déplacer le snippet",
    confirmLabel: "Déplacer",
    content,
    onConfirm: () => {
      const target = document.getElementById("s-move-folder")?.value || "root";
      moveSnippetToFolder(snippet.id, target);
      render();
      showToast("Snippet déplacé");
    },
  });
}

function openMoveFolderModal(folder) {
  const currentParent = buildSnippetFolderStack(folder.id);
  const currentParentId = currentParent.length > 1 ? currentParent[currentParent.length - 2] : "root";

  const blockedIds = new Set();
  (function collect(node) {
    blockedIds.add(node.id);
    (node.children || [])
      .filter((c) => c.nodeType === "folder")
      .forEach(collect);
  })(folder);

  const folderOptions = listAllSnippetFolders()
    .filter((f) => !blockedIds.has(f.id))
    .map(
      (f) =>
        `<option value="${f.id}" ${currentParentId === f.id ? "selected" : ""}>${"\u00a0\u00a0".repeat(f.depth)}${escHtml(f.name)}</option>`,
    )
    .join("");

  const content = el("div");
  content.innerHTML = `
    <div class="field"><label>Déplacer « ${escHtml(folder.name)} » vers</label>
      <select id="sf-move-folder">${folderOptions}</select>
    </div>`;

  createModal({
    title: "Déplacer le dossier",
    confirmLabel: "Déplacer",
    content,
    onConfirm: () => {
      const target = document.getElementById("sf-move-folder")?.value || "root";
      if (target === currentParentId) return;
      const ok = moveSnippetFolder(folder.id, target);
      if (!ok) {
        showToast("Déplacement impossible", "error");
        return;
      }
      render();
      showToast("Dossier déplacé", "success");
    },
  });
}

function openImportModal() {
  const content = el("div");
  content.innerHTML = `
    <p style="font-size:.84rem;color:var(--text-2);margin-bottom:var(--sp-4)">Importe depuis un <strong>.json</strong>, un <strong>.md</strong> ou <strong>n'importe quel fichier de code</strong> (.java, .py, .ts…)</p>
    <div class="drop-zone" id="imp-drop">${IC.upload}<span>Glisser un fichier ou cliquer</span></div>
    <div id="imp-preview" style="margin-top:var(--sp-3)"></div>`;
  createModal({
    title: "Importer des snippets",
    content,
    onConfirm: () => {},
    confirmLabel: "Fermer",
    hideCancel: true,
  });
  setTimeout(() => {
    const drop = document.getElementById("imp-drop");
    const prev = document.getElementById("imp-preview");
    const handle = (file) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target.result;
        const ext = file.name.split(".").pop().toLowerCase();
        const lang = detectLangFromExt(file.name);
        let parsed = [];

        if (ext === "json") {
          try {
            const j = JSON.parse(text);
            parsed = Array.isArray(j) ? j : [j];
          } catch {
            showToast("JSON invalide", "error");
            return;
          }
        } else if (ext === "md") {
          // Blocs de code Markdown
          const re = /```(\w+)?\n([\s\S]*?)```/g;
          let m;
          while ((m = re.exec(text)) !== null)
            parsed.push({
              title: `Snippet ${parsed.length + 1}`,
              language: m[1] || "plaintext",
              code: m[2].trim(),
              tags: [],
            });
          // Si pas de blocs, importer tout le fichier comme un snippet
          if (!parsed.length)
            parsed = [
              { title: file.name, language: "markdown", code: text, tags: [] },
            ];
        } else {
          // Fichier de code direct (.java, .py, .ts, etc.)
          parsed = [
            {
              title: file.name.replace("." + ext, ""),
              language: lang,
              code: text,
              tags: [ext],
            },
          ];
        }

        if (!parsed.length) {
          showToast("Aucun snippet trouvé", "error");
          return;
        }
        if (prev) {
          prev.innerHTML = `<p style="font-size:.84rem;color:var(--success);margin-bottom:8px">✓ ${escHtml(file.name)} — ${parsed.length} snippet(s) détecté(s)</p>`;
          const btn = el("button", "btn btn-primary");
          btn.textContent = `Importer ${parsed.length} snippet(s)`;
          btn.addEventListener("click", () => {
            const fid = currentFolderId();
            parsed.forEach((s) =>
              createSnippet({
                title: s.title || "Sans titre",
                code: s.code || "",
                language: s.language || "plaintext",
                tags: s.tags || [],
                folderId: fid,
              }),
            );
            render();
            renderLangFilters();
            showToast(`${parsed.length} snippet(s) importé(s) !`, "success");
          });
          prev.appendChild(btn);
        }
      };
      reader.readAsText(file);
    };
    if (drop) {
      drop.addEventListener("dragover", (e) => {
        e.preventDefault();
        drop.classList.add("drag-over");
      });
      drop.addEventListener("dragleave", () =>
        drop.classList.remove("drag-over"),
      );
      drop.addEventListener("drop", (e) => {
        e.preventDefault();
        drop.classList.remove("drag-over");
        if (e.dataTransfer.files[0]) handle(e.dataTransfer.files[0]);
      });
      drop.addEventListener("click", () => {
        const inp = document.createElement("input");
        inp.type = "file";
        inp.accept = "*";
        inp.onchange = () => {
          if (inp.files[0]) handle(inp.files[0]);
        };
        inp.click();
      });
    }
  }, 30);
}

// ── Détection langue par extension ───────────────────────
const EXT_TO_LANG = {
  js: "javascript",
  ts: "typescript",
  jsx: "javascript",
  tsx: "typescript",
  py: "python",
  rb: "ruby",
  java: "java",
  kt: "kotlin",
  swift: "swift",
  cs: "csharp",
  go: "go",
  rs: "rust",
  php: "php",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  sql: "sql",
  html: "html",
  htm: "html",
  css: "css",
  scss: "css",
  json: "json",
  yaml: "yaml",
  yml: "yaml",
  xml: "xml",
  md: "markdown",
  dockerfile: "dockerfile",
  tf: "hcl",
  vue: "javascript",
  c: "c",
  cpp: "cpp",
  h: "c",
  hpp: "cpp",
  r: "r",
  m: "matlab",
  pl: "perl",
  lua: "lua",
};

function detectLangFromExt(filename) {
  const ext = filename.split(".").pop().toLowerCase();
  return EXT_TO_LANG[ext] || "plaintext";
}

// Patch openImportModal pour accepter tout type de fichier
const _origImportModal = openImportModal;
window._importModalPatched = true;
