// @ts-check
// ── pages/project.js ──

let projectId,
  project,
  folderStack   = [],
  activeFilter  = "all";

/** Encode la pile de dossiers dans l'URL (sans recharger la page). */
function _stackToUrl(stack) {
  const folders = stack.slice(1); // exclut le projectId
  const base = `project.html?id=${projectId}`;
  return folders.length ? `${base}&path=${folders.join(",")}` : base;
}

/** Pousse une nouvelle entrée dans l'historique du navigateur. */
function _pushFolderHistory(newStack) {
  history.pushState({ folderStack: [...newStack] }, "", _stackToUrl(newStack));
}
let _pjSelectMode = false;
let _pjSelectedIds = new Set();
const _pjExpanded = new Set();
let _projectFocusId = getParam("focus");
let _projectFocusDone = false;

function _buildProjectNodePath(children, targetId, path = []) {
  for (const node of children || []) {
    const nextPath = [...path, node.id];
    if (node.id === targetId) return nextPath;
    if (node.children?.length) {
      const found = _buildProjectNodePath(node.children, targetId, nextPath);
      if (found) return found;
    }
  }
  return null;
}

bootPage(() => {
  projectId = getCurrentProjectId();
  if (!projectId) {
    goProjects();
    return;
  }
  project = getProject(projectId);
  if (!project) {
    goProjects();
    return;
  }

  initPageCommon();

  // Restaurer la pile complète depuis le param `path` (ex: folder1,folder2)
  // Rétro-compat : on accepte aussi l'ancien param `folder` (un seul niveau)
  const pathParam = getParam("path");
  if (pathParam) {
    folderStack = [projectId, ...pathParam.split(",").filter(Boolean)];
  } else {
    const fid = getCurrentFolderId();
    folderStack = fid && fid !== projectId ? [projectId, fid] : [projectId];
  }

  if (_projectFocusId) {
    const fullPath = _buildProjectNodePath(project.children || [], _projectFocusId);
    if (fullPath?.length) folderStack = [projectId, ...fullPath.slice(0, -1)];
  }

  // Initialiser l'état de l'historique pour que popstate fonctionne dès la 1ère page
  history.replaceState({ folderStack: [...folderStack] }, "", location.href);

  // Bouton Retour navigateur → remonter d'un niveau dans l'arborescence
  window.addEventListener("popstate", (e) => {
    if (e.state?.folderStack) {
      folderStack = e.state.folderStack;
      render();
    }
  });

  trackVisit("project", project.id, project.name, project.color);
  touchProject(projectId);

  initPage();
  render();
  bindEvents();
});

// ── Init ──────────────────────────────────────────────────

function initPage() {
  document.title = `${project.name} — Workspace`;
  document.documentElement.style.setProperty("--project-color", project.color);
  document.getElementById("project-name").textContent = project.name;
}

// ── Render ────────────────────────────────────────────────

function render() {
  project = getProject(projectId); // Refresh
  renderBreadcrumb();
  renderFilters();
  renderTree();
  renderLinkedTodos();
  _tryFocusProjectTarget();
  document.getElementById("item-count").textContent = countAllItems(
    project.children || [],
  );
}

function _tryFocusProjectTarget() {
  if (!_projectFocusId || _projectFocusDone) return;
  const cards = [...document.querySelectorAll("[data-project-node-id]")];
  const target = cards.find((el) => el.dataset.projectNodeId === _projectFocusId);
  if (!target) return;
  _projectFocusDone = true;
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

function renderLinkedTodos() {
  const wrap = document.getElementById("project-linked-todos");
  if (!wrap) return;
  const todos = getTodos().filter(
    (t) => t.projectId === projectId && t.status !== "done",
  );
  if (!todos.length) { wrap.style.display = "none"; return; }
  wrap.style.display = "block";
  const prioOrder = getTodoPriorities().map((p) => p.id);
  todos.sort((a, b) => prioOrder.indexOf(a.priorityId) - prioOrder.indexOf(b.priorityId));
  wrap.innerHTML = `<div class="linked-todos-title">Tâches liées (${todos.length})</div>`;
  const list = el("div", "linked-todos-list");
  todos.forEach((t) => {
    const row = el("div", "linked-todo-row");
    row.innerHTML =
      `<span class="linked-todo-prio">${createPriorityChip(t.priorityId).outerHTML}</span>` +
      `<span class="linked-todo-title">${escHtml(t.title)}</span>` +
      (t.dueDate ? `<span class="linked-todo-due">📅 ${t.dueDate}</span>` : "");
    row.addEventListener("click", () => {
      window.location.href = "todos.html";
    });
    list.appendChild(row);
  });
  wrap.appendChild(list);
}


function togglePjSelectMode() {
  _pjSelectMode = !_pjSelectMode;
  _pjSelectedIds.clear();
  render();
  _renderPjSelectBar();
  document.getElementById("btn-pj-select")?.classList.toggle("active-accent", _pjSelectMode);
}

function _renderPjSelectBar() {
  let bar = document.getElementById("pj-select-bar");
  if (!_pjSelectMode) { if (bar) bar.remove(); return; }
  if (!bar) {
    bar = el("div", "bulk-action-bar");
    bar.id = "pj-select-bar";
    bar.innerHTML =
      '<span id="pj-select-count">0 sélectionné(s)</span>' +
      '<button class="btn btn-danger btn-sm" id="btn-pj-bulk-delete">Supprimer</button>' +
      '<button class="btn btn-ghost btn-sm" id="btn-pj-cancel">Annuler</button>';
    document.body.appendChild(bar);
    bar.querySelector("#btn-pj-bulk-delete").addEventListener("click", () => {
      if (!_pjSelectedIds.size) return;
      {
        const _pjFolIds = [..._pjSelectedIds].filter(id => getProjectNode(projectId, id)?.nodeType === "folder");
        const _pjItmIds = [..._pjSelectedIds].filter(id => getProjectNode(projectId, id)?.nodeType !== "folder");
        const _pjParts  = [];
        if (_pjFolIds.length) _pjParts.push(`${_pjFolIds.length} dossier${_pjFolIds.length>1?"s":""}`);
        if (_pjItmIds.length) _pjParts.push(`${_pjItmIds.length} item${_pjItmIds.length>1?"s":""}`);
        confirmDialog(`Supprimer ${_pjParts.join(" et ")} ?`, () => {
          _pjSelectedIds.forEach((id) => deleteProjectNode(projectId, id));
          _pjSelectedIds.clear(); _pjSelectMode = false;
          project = getProject(projectId);
          render(); _renderPjSelectBar();
          showToast("Éléments supprimés", "success");
        });
      }
    });
    bar.querySelector("#btn-pj-cancel").addEventListener("click", () => {
      _pjSelectMode = false; _pjSelectedIds.clear();
      render(); _renderPjSelectBar();
      document.getElementById("btn-pj-select")?.classList.remove("active-accent");
    });
  }
  bar.querySelector("#pj-select-count").textContent =
    _pjSelectedIds.size + " sélectionné" + (_pjSelectedIds.size > 1 ? "s" : "");
  requestAnimationFrame(() => bar.classList.add("open"));
}

function renderBreadcrumb() {
  buildBreadcrumb("breadcrumb-project", folderStack, {
    getLabel:   (id) => id === projectId ? project.name : getProjectNode(projectId, id)?.name,
    onNavigate: (s) => { folderStack = s; _pushFolderHistory(s); render(); },
  });
}

function renderFilters() {
  document
    .querySelectorAll(".type-filter")
    .forEach((b) =>
      b.classList.toggle("active", b.dataset.filter === activeFilter),
    );
}

function _matchesProjectFilter(node, filterType) {
  if (!node) return false;
  if (filterType === "all") return true;
  if (node.nodeType === "item") return node.type === filterType;
  if (node.nodeType !== "folder") return false;
  return (node.children || []).some((child) => _matchesProjectFilter(child, filterType));
}

function renderTree() {
  const currentId = folderStack[folderStack.length - 1];
  const currentNode =
    currentId === projectId
      ? { children: project.children || [], nodeType: "folder" }
      : getProjectNode(projectId, currentId);

  const container = document.getElementById("tree-container");
  container.innerHTML = "";

  if (!currentNode) return;

  const children = currentNode.children || [];
  const visibleChildren = activeFilter === "all"
    ? children
    : children.filter((child) => _matchesProjectFilter(child, activeFilter));

  // Met les éléments épinglés en tête tout en conservant l'ordre relatif.
  const orderedChildren = visibleChildren
    .map((child, index) => ({ child, index }))
    .sort((a, b) => {
      const ap = a.child.pinned ? 1 : 0;
      const bp = b.child.pinned ? 1 : 0;
      if (ap !== bp) return bp - ap;
      return a.index - b.index;
    })
    .map((entry) => entry.child);

  // Bouton retour si on est dans un sous-dossier — TOUJOURS affiché, même si vide
  if (folderStack.length > 1) {
    const backBtn = el("button", "btn btn-ghost");
    backBtn.style.marginBottom = "var(--sp-3)";
    backBtn.innerHTML = IC.back + " Remonter";
    backBtn.addEventListener("click", () => {
      history.back();
    });
    makeDropTarget(backBtn, "__back__", (draggedId) => {
      const parentId = folderStack[folderStack.length - 2];
      if (moveProjectNode(projectId, draggedId, parentId)) {
        project = getProject(projectId);
        render();
        showToast("Déplacé dans le dossier parent", "success");
      }
    });
    container.appendChild(backBtn);
  }

  if (orderedChildren.length === 0) {
    const e = el("div", "empty-state");
    e.innerHTML = IC.empty + "<p>Ce dossier est vide.</p>";
    container.appendChild(e);
    return;
  }

  const listWrap = el("div", "items-list");
  orderedChildren.forEach((child, i) => {
    const card = child.nodeType === "folder"
      ? createFolderCard(child)
      : createItemCard(child);
    card.style.animationDelay = `${i * 25}ms`;
    listWrap.appendChild(card);
  });
  container.appendChild(listWrap);

  const hasItems = children.some((child) => child.nodeType === "item");
  const hasFilteredItems = visibleChildren.some((child) => child.nodeType === "item");
  if (!hasFilteredItems && hasItems && activeFilter !== "all") {
    const e = el("div", "empty-state", "<p>Aucun item de ce type.</p>");
    container.appendChild(e);
  }
}

// ── Folder card ───────────────────────────────────────────

function createFolderCard(folder) {
  const card = el("div", "tree-folder-card" + (folder.pinned ? " pinned" : ""));
  card.dataset.projectNodeId = folder.id;
  const count = (folder.children || []).length;
  card.innerHTML = `
    <div class="folder-icon">${IC.folder}</div>
    <div class="folder-name">${escHtml(folder.name)}</div>
    <div class="folder-count">${count} élément${count > 1 ? "s" : ""}</div>
    <div class="card-actions">
      <button class="btn-icon" data-a="pin" title="${folder.pinned ? 'Désépingler' : 'Épingler'}" style="${folder.pinned ? 'color:var(--accent)' : ''}">${folder.pinned ? IC.pin : IC.pinOff}</button>
      <button class="btn-icon" data-a="move" title="Déplacer dans un dossier">${IC.folder}</button>
      <button class="btn-icon" data-a="convert" title="Transformer en sous-projet">${IC.arrow}</button>
      <button class="btn-icon" data-a="rename" title="Renommer">${IC.edit}</button>
      <button class="btn-icon danger" data-a="delete" title="Supprimer">${IC.trash}</button>
    </div>
    ${_pjSelectMode ? '<input type="checkbox" class="todo-select-cb" style="pointer-events:none">' : ""}
    <div class="folder-arrow">${IC.chevron}</div>`;
  card.addEventListener("click", (e) => {
    if (e.target.closest("[data-a]")) return;
    if (_pjSelectMode) {
      const checked = _pjSelectedIds.has(folder.id);
      if (checked) _pjSelectedIds.delete(folder.id); else _pjSelectedIds.add(folder.id);
      card.classList.toggle("selected", !checked);
      const cb = card.querySelector(".todo-select-cb");
      if (cb) cb.checked = !checked;
      _renderPjSelectBar();
      return;
    }
    folderStack.push(folder.id);
    _pushFolderHistory(folderStack);
    render();
  });
  card.querySelector('[data-a="pin"]')?.addEventListener("click", (e) => {
    e.stopPropagation();
    const nextPinned = !folder.pinned;
    updateProjectNode(projectId, folder.id, { pinned: nextPinned });
    project = getProject(projectId);
    render();
    showToast(nextPinned ? "Dossier épinglé" : "Dossier désépinglé", "success");
  });
  card.querySelector('[data-a="move"]')?.addEventListener("click", (e) => {
    e.stopPropagation();
    openMoveProjectNodeModal(folder);
  });
  card.querySelector('[data-a="convert"]')?.addEventListener("click", (e) => {
    e.stopPropagation();
    openConvertFolderToSubProjectModal(folder);
  });
  card.querySelector('[data-a="rename"]').addEventListener("click", (e) => {
    e.stopPropagation();
    openRenameFolder(folder);
  });
  card.querySelector('[data-a="delete"]').addEventListener("click", (e) => {
    e.stopPropagation();
    confirmDialog(
      `Supprimer le dossier « ${folder.name} » et tout son contenu ?`,
      () => {
        deleteProjectNode(projectId, folder.id);
        render();
        showToast("Dossier supprimé");
      },
    );
  });

  makeDraggable(card, folder.id, "folder");
  makeDropTarget(card, folder.id, (draggedId, pos) => {
    if (pos) { _projReorderRelativeTo(draggedId, folder.id, pos === "before"); return; }
    if (moveProjectNode(projectId, draggedId, folder.id)) {
      project = getProject(projectId);
      render();
      showToast(`Déplacé dans « ${folder.name} »`, "success");
    }
  }, { reorderTypes: ["folder", "item"] });

  return card;
}

function createReadonlyCopyRow(label, value, { masked = false, copyLabel = "Copier" } = {}) {
  if (!value) return null;
  const row = el("div", "item-secret-row");
  const labelEl = el("span", "item-secret-label");
  labelEl.textContent = label;
  const input = document.createElement("input");
  input.className = "item-secret-input";
  input.type = masked ? "password" : "text";
  input.value = value;
  input.readOnly = true;
  input.setAttribute("aria-label", label);

  row.append(labelEl, input);

  if (masked) {
    const toggleBtn = el("button", "btn btn-ghost btn-sm");
    toggleBtn.type = "button";
    toggleBtn.textContent = "Afficher";
    toggleBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const reveal = input.type === "password";
      input.type = reveal ? "text" : "password";
      toggleBtn.textContent = reveal ? "Masquer" : "Afficher";
    });
    row.appendChild(toggleBtn);
  }

  const copyBtn = el("button", "btn btn-ghost btn-sm");
  copyBtn.type = "button";
  copyBtn.innerHTML = IC.copy + ` ${copyLabel}`;
  copyBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(value);
      copyBtn.innerHTML = IC.check + " Copié";
      setTimeout(() => {
        copyBtn.innerHTML = IC.copy + ` ${copyLabel}`;
      }, 1400);
    } catch (_) {
      showToast("Copie impossible", "error");
    }
  });

  row.appendChild(copyBtn);
  return row;
}

function createPasswordBlock(item) {
  if (!item?.password && !item?.login && !item?.url && !item?.secretEncrypted) return null;
  const wrap = el("div", "item-secret-block");

  const appendUrlRow = () => {
    const safeItemUrl = typeof safeUrl === "function" ? safeUrl(item.url) : null;
    if (!safeItemUrl) return;
    const urlActions = el("div", "item-secret-row item-secret-row-actions");
    const openLink = document.createElement("a");
    openLink.href = safeItemUrl;
    openLink.target = "_blank";
    openLink.rel = "noopener";
    openLink.className = "item-card-url";
    openLink.textContent = safeItemUrl;
    const copyUrlBtn = el("button", "btn btn-ghost btn-sm");
    copyUrlBtn.type = "button";
    copyUrlBtn.innerHTML = IC.copy + " Copier l'URL";
    copyUrlBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      try {
       await navigator.clipboard.writeText(safeItemUrl);
        copyUrlBtn.innerHTML = IC.check + " URL copiée";
        setTimeout(() => {
          copyUrlBtn.innerHTML = IC.copy + " Copier l'URL";
        }, 1400);
      } catch (_) {
        showToast("Copie impossible", "error");
      }
    });
    urlActions.append(openLink, copyUrlBtn);
    wrap.appendChild(urlActions);
  };

  const renderSecretRows = (secret) => {
    wrap.innerHTML = "";
    const loginRow = createReadonlyCopyRow("Login", secret?.login || "", { copyLabel: "Copier le login" });
    const passwordRow = createReadonlyCopyRow("Mot de passe", secret?.password || "", { masked: true, copyLabel: "Copier le mot de passe" });
    if (loginRow) wrap.appendChild(loginRow);
    if (passwordRow) wrap.appendChild(passwordRow);
    appendUrlRow();
  };

  if (!item.secretEncrypted) {
    renderSecretRows({ login: item.login || "", password: item.password || "" });
    return wrap;
  }

  if (!isSecretVaultUnlocked()) {
    const lockedMsg = el("div", "item-secret-locked");
    lockedMsg.textContent = "Contenu chiffré";
    const unlockBtn = el("button", "btn btn-ghost btn-sm");
    unlockBtn.type = "button";
    unlockBtn.textContent = "Déverrouiller";
    unlockBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const unlocked = await ensureProjectVaultUnlocked("Déverrouiller cet item sécurisé");
      if (unlocked) render();
    });
    wrap.append(lockedMsg, unlockBtn);
    appendUrlRow();
    return wrap;
  }

  wrap.textContent = "Déchiffrement…";
  void (async () => {
    try {
      renderSecretRows(await readPasswordItemSecret(item));
    } catch (_) {
      wrap.textContent = "Impossible de déchiffrer cet item.";
    }
  })();
  return wrap;
}

// ── Item card ─────────────────────────────────────────────

function createItemCard(item) {
  const collapsed = !_pjExpanded.has(item.id);
  const card = el("div",
    "item-card" + (collapsed ? " collapsed" : "") + (item.pinned ? " pinned" : "") + (_pjSelectMode && _pjSelectedIds.has(item.id) ? " selected" : ""));
  card.dataset.projectNodeId = item.id;
  card.dataset.id = item.id;
  if (_pjSelectMode) {
    const cb = el("input"); cb.type = "checkbox"; cb.className = "todo-select-cb";
    cb.checked = _pjSelectedIds.has(item.id);
    cb.addEventListener("change", () => {
      if (cb.checked) _pjSelectedIds.add(item.id); else _pjSelectedIds.delete(item.id);
      card.classList.toggle("selected", cb.checked); _renderPjSelectBar();
    });
    card.prepend(cb);
    card.addEventListener("click", (e) => {
      if (e.target.closest("[data-a]")) return;
      if (e.target === cb) return;
      cb.checked = !cb.checked; cb.dispatchEvent(new Event("change"));
    });
  }

  makeDraggable(card, item.id, "item");
  makeDropTarget(card, item.id, (draggedId, pos) => {
    if (pos) _projReorderRelativeTo(draggedId, item.id, pos === "before");
  }, { reorder: true });

  // Résolveur wiki links
  const resolver = (title) => {
    const all = getAllProjectItems(project.children || []);
    return (
      all.find((i) => i.title?.toLowerCase() === title.toLowerCase()) || null
    );
  };

  const safeItemUrl = typeof safeUrl === "function" ? safeUrl(item.url) : null;
  const _iTagChips = (item.tags || []).map((t) => `<span class="tag-chip">${escHtml(t)}</span>`).join("");
  let bodyHtml = `${_iTagChips ? `<div class="item-card-tags">${_iTagChips}</div>` : ""}`;
  const titleHtml = item.type === "link" && safeItemUrl
    ? `<a href="${escHtml(safeItemUrl)}" class="item-card-title item-card-title-link" target="_blank" rel="noopener noreferrer">${escHtml(item.title)}</a>`
    : `<div class="item-card-title">${escHtml(item.title)}</div>`;
  if (item.category)
    bodyHtml += `<div style="margin-top:3px"><span class="badge" style="background:var(--bg-4);color:var(--text-2)">${escHtml(item.category)}</span></div>`;
  if (safeItemUrl && item.type !== "password")
    bodyHtml += `<a href="${escHtml(safeItemUrl)}" class="item-card-url" target="_blank" rel="noopener noreferrer">${escHtml(safeItemUrl)}</a>`;

  card.innerHTML = `
    <div style="padding-top:2px"><span class="badge badge-${item.type}">${item.type}</span></div>
    <div class="item-card-main">
      <div class="item-card-summary">${titleHtml}</div>
      <div class="item-card-body">${bodyHtml}</div>
    </div>
    <div class="item-card-actions">
      <button class="btn-icon item-collapse-btn${collapsed ? " is-collapsed" : ""}" data-a="collapse" title="${collapsed ? "Déplier" : "Plier"}" aria-label="${collapsed ? "Déplier" : "Plier"}">
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 6l4 4 4-4"/></svg>
      </button>
      <button class="btn-icon" data-a="pin" title="${item.pinned ? 'Désépingler' : 'Épingler'}" style="${item.pinned ? 'color:var(--accent)' : ''}">${item.pinned ? IC.pin : IC.pinOff}</button>
      <button class="btn-icon" data-a="move" title="Déplacer dans un dossier">${IC.folder}</button>
      <button class="btn-icon" data-a="edit"   title="Modifier">${IC.edit}</button>
      <button class="btn-icon danger" data-a="delete" title="Supprimer">${IC.trash}</button>
    </div>`;

  let noteWrap = null;

  // Note avec wiki links
  if (item.note) {
    noteWrap = createTruncatedNote(item.note, resolver, (node) =>
      openWikiModal(node),
    );
    card.querySelector(".item-card-body").appendChild(noteWrap);
    bindWikiLinks(noteWrap, resolver, (node) => openWikiModal(node));
  }

  if (item.type === "password") {
    const passwordBlock = createPasswordBlock(item);
    if (passwordBlock) card.querySelector(".item-card-body").appendChild(passwordBlock);
  }

  // Bloc code
  if (item.type === "code" && item.code) {
    const codeBlock = createCodeBlock(item.code, item.language);
    card.querySelector(".item-card-body").appendChild(codeBlock);
  }

  // Fichier joint
  if (item.file) {
    const fileEl = renderFileAttachment(item.file);
    if (fileEl) card.querySelector(".item-card-body").appendChild(fileEl);
  }

  const codeActions = el("div", "item-code-actions");
  const fullBtn = el("button", "see-more-btn");
  fullBtn.type = "button";
  fullBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M7 3H3a1 1 0 00-1 1v9a1 1 0 001 1h9a1 1 0 001-1V9"/><path d="M10 2h4v4M14 2L8 8"/></svg> Plein écran`;
  fullBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    void openItemFullscreen(item);
  });
  codeActions.appendChild(fullBtn);

  const seeMoreBtn = noteWrap?.querySelector(".see-more-btn");
  if (seeMoreBtn) {
    seeMoreBtn.remove();
    codeActions.classList.add("item-inline-actions");
    codeActions.prepend(seeMoreBtn);
    noteWrap.appendChild(codeActions);
  } else {
    card.querySelector(".item-card-body").appendChild(codeActions);
  }

  const collapseBtn = card.querySelector('[data-a="collapse"]');
  const toggleCollapsed = () => {
    const isCollapsed = card.classList.toggle("collapsed");
    if (isCollapsed) _pjExpanded.delete(item.id);
    else _pjExpanded.add(item.id);
    collapseBtn?.classList.toggle("is-collapsed", isCollapsed);
    if (collapseBtn) {
      collapseBtn.title = isCollapsed ? "Déplier" : "Plier";
      collapseBtn.setAttribute("aria-label", isCollapsed ? "Déplier" : "Plier");
    }
  };
  collapseBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    if (_pjSelectMode) return;
    toggleCollapsed();
  });
  card.querySelector(".item-card-summary")?.addEventListener("click", (e) => {
    if (_pjSelectMode) return;
    if (e.target.closest("a, button, input")) return;
    toggleCollapsed();
  });

  card
    .querySelector('[data-a="edit"]')
    .addEventListener("click", (e) => {
      if (_pjSelectMode) { e.stopPropagation(); return; }
      void openItemModal(item);
    });
  card.querySelector('[data-a="pin"]')?.addEventListener("click", (e) => {
    e.stopPropagation();
    const nextPinned = !item.pinned;
    updateProjectNode(projectId, item.id, { pinned: nextPinned });
    project = getProject(projectId);
    render();
    showToast(nextPinned ? "Item épinglé" : "Item désépinglé", "success");
  });
  card.querySelector('[data-a="move"]')?.addEventListener("click", (e) => {
    e.stopPropagation();
    openMoveProjectNodeModal(item);
  });
  card.querySelector('[data-a="delete"]').addEventListener("click", () => {
    confirmDialog(`Supprimer « ${item.title} » ?`, () => {
      deleteProjectNode(projectId, item.id);
      render();
      showToast("Item supprimé");
    });
  });
  return card;
}

async function openItemFullscreen(item) {
  let safeItem = item;
  if (item.type === "password" && item.secretEncrypted) {
    const unlocked = isSecretVaultUnlocked() || await ensureProjectVaultUnlocked("Déverrouiller cet item sécurisé");
    if (!unlocked) return;
    try {
      safeItem = { ...item, ...(await readPasswordItemSecret(item)) };
    } catch (_) {
      showToast("Impossible de déchiffrer cet item", "error");
      return;
    }
  }
  const isCode = safeItem.type === "code" && !!safeItem.code;
  const isPassword = safeItem.type === "password";
  const safeItemUrl = typeof safeUrl === "function" ? safeUrl(safeItem.url) : null;
  const title = escHtml(safeItem.title || "Item");
  const typeLabel = escHtml(safeItem.type || "item");
  const lang = escHtml(safeItem.language || "plaintext");
  const tagsHtml = (safeItem.tags || []).map((t) => `<span class="tag">#${escHtml(t)}</span>`).join("");
  const categoryHtml = safeItem.category ? `<span class="pill">${escHtml(safeItem.category)}</span>` : "";
  const linkHtml = safeItemUrl && !isPassword
    ? `<a class="link" href="${escHtml(safeItemUrl)}" target="_blank" rel="noopener noreferrer">${escHtml(safeItemUrl)}</a>`
    : "";
  const noteHtml = safeItem.note
    ? (typeof renderMarkdown === "function"
      ? renderMarkdown(safeItem.note)
      : escHtml(safeItem.note).replace(/\n/g, "<br>"))
    : "";
  const fileNameHtml = safeItem.file?.name
    ? `<div class="file">Fichier joint: ${safeItem.file.base64
      ? `<a class="file-link" href="#" data-file-src="${escHtml(safeItem.file.base64)}" data-file-mime="${escHtml(safeItem.file.mime || "application/octet-stream")}" target="_blank" rel="noopener">${escHtml(safeItem.file.name)}</a>`
      : escHtml(safeItem.file.name)}</div>`
    : "";
  const passwordHtml = isPassword
     ? `<div class="secret-box">${safeItem.login ? `<label>Identifiant / login</label><div class="secret-actions"><input id="login-fullscreen" type="text" value="${escHtml(safeItem.login || "")}" readonly><button id="login-copy" type="button">Copier le login</button></div>` : ""}${safeItem.password ? `<label>Mot de passe</label><div class="secret-actions"><input id="pw-fullscreen" type="password" value="${escHtml(safeItem.password || "")}" readonly><button id="pw-toggle" type="button">Afficher</button><button id="pw-copy" type="button">Copier</button></div>` : ""}${safeItemUrl ? `<label style="margin-top:12px">URL</label><div class="secret-actions"><a class="link" href="${escHtml(safeItemUrl)}" target="_blank" rel="noopener noreferrer">${escHtml(safeItemUrl)}</a><button id="url-copy" type="button">Copier l'URL</button></div>` : ""}</div>`
    : "";

  const bodyHtml = isCode
    ? `<pre><code class="language-${lang}">${escHtml(safeItem.code || "")}</code></pre>`
    : `<div class="content">${linkHtml}${categoryHtml || tagsHtml ? `<div class="meta">${categoryHtml}${tagsHtml}</div>` : ""}${passwordHtml}${noteHtml ? `<div class="note md">${noteHtml}</div>` : ""}${fileNameHtml}</div>`;

  const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><title>${title}</title>
${isCode ? '<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/atom-one-dark.min.css" integrity="sha384-oaMLBGEzBOJx3UHwac0cVndtX5fxGQIfnAeFZ35RTgqPcYlbprH9o9PUV/F8Le07" crossorigin="anonymous">' : ""}
<style>
*{box-sizing:border-box}
body{margin:0;background:#0d1117;color:#e6edf3;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;line-height:1.7;min-height:100vh}
.hdr{padding:14px 24px;background:#161b22;border-bottom:1px solid #30363d;display:flex;align-items:center;justify-content:space-between;gap:16px;position:sticky;top:0}
.hdr-title{color:#e6edf3;font-size:14px;font-weight:600;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.hdr-type{color:#8b949e;font-size:12px;background:#21262d;padding:3px 10px;border-radius:6px;flex-shrink:0}
.hdr-copy{color:#8b949e;font-size:12px;background:#21262d;border:1px solid #30363d;padding:4px 12px;border-radius:6px;cursor:pointer;transition:all .15s}
.hdr-copy:hover{color:#e6edf3;border-color:#8b949e}
.content{max-width:900px;margin:0 auto;padding:28px 24px}
.link{display:inline-block;margin-bottom:12px;color:#58a6ff;word-break:break-all}
.meta{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px}
.pill,.tag{font-size:12px;border-radius:999px;padding:2px 10px;border:1px solid #30363d;background:#161b22;color:#c9d1d9}
.note{color:#c9d1d9}
.note h1,.note h2,.note h3{color:#e6edf3}
.note pre{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:14px;overflow:auto}
.note code{background:#21262d;border-radius:4px;padding:1px 5px}
.file{margin-top:14px;color:#8b949e;font-size:13px}
.file-link{color:#58a6ff;text-decoration:none}
.file-link:hover{text-decoration:underline}
.secret-box{margin-bottom:16px}
.secret-box label{display:block;margin-bottom:6px;color:#8b949e;font-size:12px;text-transform:uppercase;letter-spacing:.04em}
.secret-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.secret-actions input{flex:1;min-width:220px;background:#161b22;border:1px solid #30363d;color:#e6edf3;border-radius:8px;padding:10px 12px;font-family:'JetBrains Mono',monospace}
.secret-actions button{background:#21262d;border:1px solid #30363d;color:#c9d1d9;border-radius:8px;padding:10px 12px;cursor:pointer}
.secret-actions button:hover{color:#e6edf3;border-color:#8b949e}
pre{margin:0;padding:28px;overflow:auto}code{font-size:14px;line-height:1.7;white-space:pre;font-family:'JetBrains Mono',monospace}
</style>
</head><body>
<div class="hdr">
  <span class="hdr-title">${title}</span>
  <span class="hdr-type">${isCode ? lang : typeLabel}</span>
  <button class="hdr-copy" onclick="navigator.clipboard.writeText(${isCode ? "document.querySelector('code').innerText" : isPassword ? "document.getElementById('pw-fullscreen')?.value || document.getElementById('login-fullscreen')?.value || document.body.innerText" : "document.body.innerText"}).then(()=>{this.textContent='✓ Copié';setTimeout(()=>this.textContent='Copier',1500)})">Copier</button>
</div>
${isCode ? bodyHtml : `<div class="content">${bodyHtml}</div>`}
${isCode ? '<script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js" integrity="sha384-F/bZzf7p3Joyp5psL90p/p89AZJsndkSoGwRpXcZhleCWhd8SnRuoYo4d0yirjJp" crossorigin="anonymous"><\/script><script>hljs.highlightAll()<\/script>' : ""}
<script>
(() => {
  const blobUrls = [];
  const toBlobUrl = (dataUrl, mime) => {
    if (!dataUrl || !dataUrl.startsWith('data:')) return dataUrl;
    const parts = dataUrl.split(',');
    if (parts.length < 2) return dataUrl;
    const byteString = atob(parts[1]);
    const bytes = new Uint8Array(byteString.length);
    for (let i = 0; i < byteString.length; i++) bytes[i] = byteString.charCodeAt(i);
    const blobUrl = URL.createObjectURL(new Blob([bytes], { type: mime || 'application/octet-stream' }));
    blobUrls.push(blobUrl);
    return blobUrl;
  };
  document.querySelectorAll('[data-file-src]').forEach((link) => {
    const src = link.getAttribute('data-file-src');
    const mime = link.getAttribute('data-file-mime');
    link.href = toBlobUrl(src, mime);
  });
  const pwInput = document.getElementById('pw-fullscreen');
  const pwToggle = document.getElementById('pw-toggle');
  const pwCopy = document.getElementById('pw-copy');
  const loginInput = document.getElementById('login-fullscreen');
  const loginCopy = document.getElementById('login-copy');
  const urlCopy = document.getElementById('url-copy');
  const urlLink = urlCopy ? urlCopy.previousElementSibling : null;
  if (pwInput && pwToggle) {
    pwToggle.addEventListener('click', () => {
      const reveal = pwInput.type === 'password';
      pwInput.type = reveal ? 'text' : 'password';
      pwToggle.textContent = reveal ? 'Masquer' : 'Afficher';
    });
  }
  if (pwInput && pwCopy) {
    pwCopy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(pwInput.value || '');
        pwCopy.textContent = 'Copié';
        setTimeout(() => { pwCopy.textContent = 'Copier'; }, 1500);
      } catch (_) {}
    });
  }
  if (loginInput && loginCopy) {
    loginCopy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(loginInput.value || '');
        loginCopy.textContent = 'Copié';
        setTimeout(() => { loginCopy.textContent = 'Copier le login'; }, 1500);
      } catch (_) {}
    });
  }
  if (urlCopy) {
    urlCopy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(urlLink?.href || '');
        urlCopy.textContent = 'URL copiée';
        setTimeout(() => { urlCopy.textContent = "Copier l'URL"; }, 1500);
      } catch (_) {}
    });
  }
  window.addEventListener('beforeunload', () => {
    blobUrls.forEach((url) => URL.revokeObjectURL(url));
  });
})();
</script>
</body></html>`;
  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank");
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

// ── Events ────────────────────────────────────────────────

function bindEvents() {
  document.getElementById("btn-back").addEventListener("click", () => {
    goProjects(project?.parentId || null);
  });
  document
    .getElementById("btn-new-item")
    .addEventListener("click", () => { void openItemModal(); });
  document
    .getElementById("btn-new-folder")
    .addEventListener("click", () => _openNewFolderModal());
  document.getElementById("btn-pj-select")?.addEventListener("click", togglePjSelectMode);
  document
    .getElementById("btn-edit-project")
    .addEventListener("click", openEditProjectModal);

  document.querySelectorAll(".type-filter").forEach((b) =>
    b.addEventListener("click", () => {
      activeFilter = b.dataset.filter;
      render();
    }),
  );
}

// ── Modals ────────────────────────────────────────────────

async function openItemModal(existing) {
  let safeExisting = existing || null;
  if (existing?.type === "password" && existing.secretEncrypted) {
    const unlocked = isSecretVaultUnlocked() || await ensureProjectVaultUnlocked("Déverrouiller cet item pour le modifier");
    if (!unlocked) return;
    try {
      safeExisting = { ...existing, ...(await readPasswordItemSecret(existing)) };
    } catch (_) {
      showToast("Impossible de déchiffrer cet item", "error");
      return;
    }
  }
  let selType = existing?.type || "link";
  let selFile = safeExisting?.file || null;
  const isEdit = !!existing;
  let initialState = "";
  let getFormState = () => null;
  project = getProject(projectId);

  const content = buildItemFormContent(safeExisting);
  let modalApi;
  const commitNodeData = (nodeData) => {
    const currentFolderId = folderStack[folderStack.length - 1];
    if (existing) {
      updateProjectNode(projectId, existing.id, nodeData);
      showToast("Item mis à jour");
    } else {
      addProjectNode(projectId, currentFolderId, {
        id: uid(),
        ...nodeData,
        createdAt: Date.now(),
      });
      showToast("Item ajouté !");
    }
    render();
  };
  modalApi = createModal({
    title: existing ? "Modifier l'item" : "Ajouter un item",
    confirmLabel: existing ? "Enregistrer" : "Ajouter",
    content,
    watchConfirm: true,
    isConfirmEnabled: () => {
      const state = getFormState();
      if (!state || !state.title) return false;
      return !isEdit || JSON.stringify(state) !== initialState;
    },
    disabledConfirmTitle: existing
      ? "Aucune modification détectée ou champ requis manquant"
      : "Le titre est requis",
    onConfirm: () => {
      const title = document.getElementById("f-title")?.value.trim();
      if (!title) {
        showToast("Titre requis");
        return;
      }
      const login = document.getElementById("f-login")?.value.trim() || "";
      const password = document.getElementById("f-password")?.value || "";
      const nodeData = {
        nodeType: "item",
        type: selType,
        title,
        category: document.getElementById("f-cat")?.value || "",
        url:
          selType === "link" || selType === "password"
            ? document.getElementById("f-url")?.value.trim() || ""
            : "",
        login:
          selType === "password"
            ? login
            : "",
        password:
          selType === "password"
            ? password
            : "",
        secretEncrypted: null,
        note:
          selType !== "code"
            ? document.getElementById("f-note")?.value.trim() || ""
            : "",
        code:
          selType === "code"
            ? document.getElementById("f-code")?.value || ""
            : "",
        language:
          selType === "code"
            ? document.getElementById("f-lang-sel")?.value || "javascript"
            : "",
        tags: (document.getElementById("f-tags")?.value || "").split(",").map((s) => s.trim()).filter(Boolean),
        file: selFile,
      };
      if (selType === "password" && hasSecretVaultEnabled()) {
        void (async () => {
          const unlocked = isSecretVaultUnlocked() || await ensureProjectVaultUnlocked("Déverrouiller le coffre pour enregistrer cet item");
          if (!unlocked) return;
          try {
            nodeData.secretEncrypted = (login || password)
              ? await encryptPasswordItemSecret({ login, password })
              : null;
            nodeData.login = "";
            nodeData.password = "";
            commitNodeData(nodeData);
            modalApi.close();
          } catch (_) {
            showToast("Chiffrement impossible", "error");
          }
        })();
        return false;
      }
      commitNodeData(nodeData);
    },
  });

  setTimeout(() => {
    // Type buttons
    const typeRow = document.getElementById("item-type-row");
    if (typeRow) {
      ["link", "memo", "info", "code", "password"].forEach((t) => {
        const btn = el(
          "button",
          t === selType ? "btn btn-primary btn-sm" : "btn btn-ghost btn-sm",
        );
        btn.innerHTML = IC[t] + ` ${t}`;
        btn.addEventListener("click", () => {
          selType = t;
          typeRow
            .querySelectorAll("button")
            .forEach((b) => (b.className = "btn btn-ghost btn-sm"));
          btn.className = "btn btn-primary btn-sm";
          toggleItemFields(t);
          modalApi.refreshConfirmState();
        });
        typeRow.appendChild(btn);
      });
    }

    // Catégories
    const tagsInput = document.getElementById("f-tags");
    if (tagsInput) tagsInput.value = (safeExisting?.tags || []).join(", ");
    const catSel = document.getElementById("f-cat");
    if (catSel) {
      const opt0 = el("option");
      opt0.value = "";
      opt0.textContent = "Aucune";
      catSel.appendChild(opt0);
      (project.categories || []).forEach((c) => {
        const opt = el("option");
        opt.value = c;
        opt.textContent = c;
        if (c === safeExisting?.category) opt.selected = true;
        catSel.appendChild(opt);
      });
    }

    // Langue select
    const langWrap = document.getElementById("f-lang-wrap");
    if (langWrap) {
      const langSel = createLangSelect(safeExisting?.language || "javascript");
      langSel.id = "f-lang-sel";
      langWrap.appendChild(langSel);
    }

    // Markdown editor pour la note
    const noteMount = document.getElementById("f-note-mount");
    if (noteMount && typeof createMarkdownEditor === "function") {
      const initial = noteMount.dataset.mdInitial || "";
      const md = createMarkdownEditor({
        initialValue: initial,
        minHeight: 140,
      });
      md.textarea.id = "f-note";
      noteMount.replaceWith(md.root);
      md.root.id = "f-note-field-inner";
    }

    // Drop zone
    const dropZone = document.getElementById("f-drop");
    const preview = document.getElementById("f-file-preview");
    if (dropZone) {
      initDragDrop(dropZone, (file) => {
        selFile = file;
        if (preview) {
          preview.innerHTML = "";
          const fe = renderFileAttachment(file);
          if (fe) preview.appendChild(fe);
        }
        modalApi.refreshConfirmState();
      });
      if (safeExisting?.file && preview) {
        const fe = renderFileAttachment(safeExisting.file);
        if (fe) preview.appendChild(fe);
      }
    }

    const normalizeTags = (v) =>
      String(v || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .join("|");
    const fileSig = (f) => (f ? `${f.name || ""}|${f.type || ""}|${f.size || ""}` : "");
    getFormState = () => {
      const currentType = selType;
      return {
        type: currentType,
        title: document.getElementById("f-title")?.value.trim() || "",
        category: document.getElementById("f-cat")?.value || "",
        url: currentType === "link" || currentType === "password" ? document.getElementById("f-url")?.value.trim() || "" : "",
        login: currentType === "password" ? document.getElementById("f-login")?.value.trim() || "" : "",
        password: currentType === "password" ? document.getElementById("f-password")?.value || "" : "",
        note: currentType !== "code" ? document.getElementById("f-note")?.value.trim() || "" : "",
        code: currentType === "code" ? document.getElementById("f-code")?.value || "" : "",
        language: currentType === "code" ? document.getElementById("f-lang-sel")?.value || "javascript" : "",
        tags: normalizeTags(document.getElementById("f-tags")?.value),
        file: fileSig(selFile),
      };
    };
    if (isEdit) initialState = JSON.stringify(getFormState());

    toggleItemFields(selType);
    modalApi.refreshConfirmState();
    document.getElementById("f-title")?.focus();
  }, 30);
}

function ensureProjectVaultUnlocked(reason) {
  if (!hasSecretVaultEnabled()) return Promise.resolve(true);
  if (isSecretVaultUnlocked()) return Promise.resolve(true);
  return new Promise((resolve) => {
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const content = document.createElement("div");
    content.innerHTML = `
      <p style="margin:0 0 12px;color:var(--text-2)">${escHtml(reason || "Déverrouiller le coffre")}</p>
      <div class="field"><label>Mot de passe maître</label><input id="project-vault-password" type="password" autocomplete="current-password"></div>`;
    const api = createModal({
      title: "Déverrouiller le coffre",
      confirmLabel: "Déverrouiller",
      content,
      watchConfirm: true,
      isConfirmEnabled: () => !!document.getElementById("project-vault-password")?.value,
      disabledConfirmTitle: "Le mot de passe est requis",
      onConfirm: () => {
        const password = document.getElementById("project-vault-password")?.value || "";
        if (!password) return false;
        void (async () => {
          try {
            await unlockSecretVault(password);
            showToast("Coffre déverrouillé", "success");
            api.close();
            done(true);
          } catch (_) {
            showToast("Mot de passe maître invalide", "error");
          }
        })();
        return false;
      },
    });
    const overlay = api.confirmBtn?.closest(".modal")?.parentElement;
    overlay?.querySelector(".btn-cancel")?.addEventListener("click", () => done(false), { once: true });
    overlay?.querySelector(".btn-close")?.addEventListener("click", () => done(false), { once: true });
    overlay?.addEventListener("click", (e) => {
      if (e.target === overlay) done(false);
    }, { once: true });
  });
}

function toggleItemFields(type) {
  const urlField = document.getElementById("f-url-field");
  const loginField = document.getElementById("f-login-field");
  const passwordField = document.getElementById("f-password-field");
  const noteField = document.getElementById("f-note-field");
  const codeField = document.getElementById("f-code-field");
  const langField = document.getElementById("f-lang-field");
  if (urlField) urlField.style.display = type === "link" || type === "password" ? "" : "none";
  if (loginField) loginField.style.display = type === "password" ? "" : "none";
  if (passwordField) passwordField.style.display = type === "password" ? "" : "none";
  if (noteField) noteField.style.display = type === "code" ? "none" : "";
  if (codeField) codeField.style.display = type === "code" ? "" : "none";
  if (langField) langField.style.display = type === "code" ? "" : "none";
}

/** Réordonne un nœud de projet avant/après un autre dans le dossier courant. */
function _projReorderRelativeTo(srcId, targetId, before) {
  const parentId = folderStack[folderStack.length - 1];
  const parentNode = parentId === projectId
    ? { children: project.children || [] }
    : getProjectNode(projectId, parentId);
  if (!parentNode) return;
  const ids = (parentNode.children || []).map((c) => c.id).filter((id) => id !== srcId);
  const idx = ids.indexOf(targetId);
  if (idx === -1) return;
  ids.splice(before ? idx : idx + 1, 0, srcId);
  reorderProjectChildren(projectId, parentId, ids);
  project = getProject(projectId);
  render();
}

function _openNewFolderModal() {
  openNewFolderModal({
    placeholder: "Ex: Backend",
    onCreate: (name) => {
      const parentId = folderStack[folderStack.length - 1];
      addProjectNode(projectId, parentId, { id: uid(), nodeType: "folder", name, children: [], createdAt: Date.now() });
      render();
      showToast("Dossier créé");
    },
  });
}

function openRenameFolder(folder) {
  openRenameModal(folder.name, (name) => {
    updateProjectNode(projectId, folder.id, { name });
    project = getProject(projectId);
    render();
  }, "Renommer le dossier");
}

function _buildProjectParentTargetOptions(selectedId) {
  const projects = (getProjects() || []).slice();
  const pathLabel = (p) => {
    const ancestors = typeof getProjectAncestors === "function"
      ? getProjectAncestors(p.id)
      : [];
    return [...ancestors.map((a) => a.name), p.name].join(" / ");
  };

  return projects
    .sort((a, b) =>
      pathLabel(a).localeCompare(pathLabel(b), "fr", { sensitivity: "base" }),
    )
    .map((p) => {
      const selected = p.id === selectedId ? "selected" : "";
      return `<option value="${escHtml(p.id)}" ${selected}>${escHtml(pathLabel(p))}</option>`;
    })
    .join("");
}

function openConvertFolderToSubProjectModal(folder) {
  const options = _buildProjectParentTargetOptions(projectId);
  const content = el("div");
  content.innerHTML = `
    <div class="field">
      <label>Projet parent cible</label>
      <select id="sp-parent-target">${options}</select>
    </div>
    <p style="margin-top:var(--sp-2);font-size:.78rem;color:var(--text-3)">Le dossier « ${escHtml(folder.name)} » sera retiré de « ${escHtml(project.name)} » puis créé comme sous-projet du parent choisi.</p>`;

  createModal({
    title: "Transformer en sous-projet",
    confirmLabel: "Transformer",
    content,
    onConfirm: () => {
      const targetParentId = document.getElementById("sp-parent-target")?.value || projectId;
      const targetParent = getProject(targetParentId);
      if (!targetParent) {
        showToast("Projet parent cible introuvable", "error");
        return;
      }
      const created = convertProjectFolderToSubProject(projectId, folder.id, {
        parentId: targetParentId,
        color: project.color,
      });
      if (!created) {
        showToast("Conversion impossible", "error");
        return;
      }
      _pjSelectedIds.delete(folder.id);
      project = getProject(projectId);
      render();
      showToast(`Sous-projet créé dans « ${targetParent.name} »`, "success");
    },
  });
}

function _listProjectFoldersForMove() {
  const p = getProject(projectId);
  const out = [{ id: projectId, name: p?.name || "Projet", depth: 0 }];
  (function walk(nodes, depth) {
    (nodes || []).forEach((n) => {
      if (n.nodeType !== "folder") return;
      out.push({ id: n.id, name: n.name, depth });
      walk(n.children || [], depth + 1);
    });
  })(p?.children || [], 1);
  return out;
}

function _findProjectParentId(nodeId) {
  const p = getProject(projectId);
  if (!p) return projectId;
  let parent = projectId;
  (function walk(nodes, parentId) {
    for (const n of nodes || []) {
      if (n.id === nodeId) {
        parent = parentId;
        return true;
      }
      if (n.nodeType === "folder" && walk(n.children || [], n.id)) return true;
    }
    return false;
  })(p.children || [], projectId);
  return parent;
}

function openMoveProjectNodeModal(node) {
  const currentParentId = _findProjectParentId(node.id);
  const blockedIds = new Set([node.id]);
  if (node.nodeType === "folder") {
    (function collect(n) {
      (n.children || []).forEach((c) => {
        if (c.nodeType !== "folder") return;
        blockedIds.add(c.id);
        collect(c);
      });
    })(node);
  }

  const options = _listProjectFoldersForMove()
    .filter((f) => !blockedIds.has(f.id))
    .map(
      (f) =>
        `<option value="${f.id}" ${f.id === currentParentId ? "selected" : ""}>${"\u00a0\u00a0".repeat(f.depth)}${escHtml(f.name)}</option>`,
    )
    .join("");

  const content = el("div");
  content.innerHTML = `
    <div class="field"><label>Déplacer « ${escHtml(node.title || node.name || "élément")} » vers</label>
      <select id="pj-move-folder">${options}</select>
    </div>
    <p style="margin-top:var(--sp-2);font-size:.78rem;color:var(--text-3)">Destination limitée au projet courant.</p>`;

  createModal({
    title: node.nodeType === "folder" ? "Déplacer le dossier" : "Déplacer l'item",
    confirmLabel: "Déplacer",
    content,
    onConfirm: () => {
      const targetId = document.getElementById("pj-move-folder")?.value || projectId;
      if (targetId === currentParentId) return;
      const ok = moveProjectNode(projectId, node.id, targetId);
      if (!ok) {
        showToast("Déplacement impossible", "error");
        return;
      }
      project = getProject(projectId);
      render();
      showToast(node.nodeType === "folder" ? "Dossier déplacé" : "Item déplacé", "success");
    },
  });
}

function openEditProjectModal() {
  project = getProject(projectId);
  let color = project.color;
  const initialName = String(project.name || "").trim();
  const initialColor = color;

  const content = el("div");
  content.innerHTML = `
    <div class="field"><label>Nom *</label><input type="text" id="m-pname" value="${escHtml(project.name)}" maxlength="60"></div>
    <div class="field"><label>Couleur</label><div id="m-ppicker"></div></div>
    <div class="divider"></div>
    <div class="field">
      <label>Catégories</label>
      <div id="m-cats" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px;"></div>
      <div style="display:flex;gap:8px">
        <input type="text" id="m-newcat" placeholder="Nouvelle catégorie" maxlength="40" style="flex:1">
        <button class="btn btn-ghost btn-sm" id="m-addcat">Ajouter</button>
      </div>
    </div>
    <div class="divider"></div>
    <button class="btn btn-danger" id="m-delproj">Supprimer ce projet</button>`;

  const modalApi = createModal({
    title: "Modifier le projet",
    confirmLabel: "Enregistrer",
    content,
    watchConfirm: true,
    isConfirmEnabled: () => {
      const name = document.getElementById("m-pname")?.value.trim() || "";
      if (!name) return false;
      return name !== initialName || color !== initialColor;
    },
    disabledConfirmTitle: "Aucune modification détectée ou nom requis",
    onConfirm: () => {
      const name = document.getElementById("m-pname")?.value.trim();
      if (!name) return;
      updateProject(projectId, { name, color });
      document.getElementById("project-name").textContent = name;
      document.documentElement.style.setProperty("--project-color", color);
      showToast("Projet mis à jour");
      project = getProject(projectId);
      renderBreadcrumb();
    },
  });

  setTimeout(() => {
    document
      .getElementById("m-ppicker")
      ?.appendChild(createColorPicker(color, (c) => {
        color = c;
        modalApi.refreshConfirmState();
      }));
    refreshCatList();

    document.getElementById("m-addcat")?.addEventListener("click", () => {
      const val = document.getElementById("m-newcat")?.value.trim();
      if (!val) return;
      addProjectCategory(projectId, val);
      document.getElementById("m-newcat").value = "";
      refreshCatList();
    });
    document.getElementById("m-delproj")?.addEventListener("click", () => {
      confirmDialog(`Supprimer le projet « ${project.name} » ?`, () => {
        deleteProject(projectId);
        goProjects();
      });
    });
    document.getElementById("m-pname")?.focus();
    modalApi.refreshConfirmState();
  }, 30);

  function refreshCatList() {
    const wrap = document.getElementById("m-cats");
    if (!wrap) return;
    wrap.innerHTML = "";
    const p = getProject(projectId);
    (p?.categories || []).forEach((c) => {
      const chip = el("span", "tag");
      chip.innerHTML =
        escHtml(c) +
        ` <button style="background:none;border:none;cursor:pointer;color:var(--text-3);padding:0;font-size:10px" data-cat="${escHtml(c)}">✕</button>`;
      chip.querySelector("button").addEventListener("click", () => {
        removeProjectCategory(projectId, c);
        refreshCatList();
      });
      wrap.appendChild(chip);
    });
  }
}

// ── Helpers ───────────────────────────────────────────────

function countAllItems(children) {
  return countTreeNodes(children, (node) => node.nodeType === "item");
}

function getAllProjectItems(children) {
  return collectTreeNodes(children, (node) => node.nodeType === "item");
}
