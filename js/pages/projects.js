// @ts-nocheck
// ── pages/projects.js ──

let searchQuery = "";

let _projViewMode     = safeStorageGet("workspace-projects-view", "grid");
let _projListSelect   = false;
let _projListSelected = new Set();
let _currentParentId  = getParam("parent") || safeStorageGet("workspace-projects-parent", "") || null;

bootPage(() => {
  initPageCommon();
  render();
  bindEvents();
  // Écouter les changements d'historique navigateur (bouton back/forward)
  window.addEventListener("popstate", () => {
    _currentParentId = getParam("parent") || null;
    render();
  });
});

function _getSuggestedProjectCategories() {
  return [...new Set(
    getProjects()
      .flatMap((project) => project.categories || [])
      .map((category) => String(category || "").trim())
      .filter(Boolean),
  )].sort((a, b) => a.localeCompare(b, "fr", { sensitivity: "base" }));
}


function toggleProjListSelect() {
  _projListSelect = !_projListSelect;
  _projListSelected.clear();
  render();
  _renderProjListSelectBar();
  document.getElementById("btn-projlist-select")?.classList.toggle("active-accent", _projListSelect);
}

function _setCurrentParentId(parentId) {
  _currentParentId = parentId || null;
  // Mettre à jour l'URL pour l'historique du navigateur
  const url = _currentParentId ? `projects.html?parent=${encodeURIComponent(_currentParentId)}` : 'projects.html';
  history.pushState({ parentId: _currentParentId }, "", url);
  // Garder localStorage pour la rétro-compatibilité
  safeStorageSet("workspace-projects-parent", _currentParentId || "");
}

function _ensureValidCurrentParent() {
  if (!_currentParentId) return;
  if (!getProject(_currentParentId)) _setCurrentParentId(null);
}

function _countSubProjects(projectId) {
  return getProjects().filter((p) => (p.parentId || null) === projectId).length;
}

function _buildPathToCurrentParent() {
  if (!_currentParentId) return [];
  if (typeof getProjectAncestors === "function") {
    return [...getProjectAncestors(_currentParentId), getProject(_currentParentId)].filter(Boolean);
  }
  const all = getProjects();
  const map = new Map(all.map((p) => [p.id, p]));
  const path = [];
  const seen = new Set();
  let cursor = map.get(_currentParentId);
  while (cursor && !seen.has(cursor.id)) {
    path.unshift(cursor);
    seen.add(cursor.id);
    cursor = cursor.parentId ? map.get(cursor.parentId) : null;
  }
  return path;
}

function _renderBreadcrumb() {
  const scopeEl = document.getElementById("project-scope");
  const bcEl = document.getElementById("projects-breadcrumb");
  if (!scopeEl || !bcEl) return;

  const path = _buildPathToCurrentParent();
  scopeEl.textContent = _currentParentId
    ? `Sous-projets de ${path[path.length - 1]?.name || "Projet"}`
    : "Racine";

  const rootLabel = "Tous les projets";
  let html = `<button type="button" class="projects-breadcrumb-btn" data-parent="">${escHtml(rootLabel)}</button>`;
  path.forEach((p) => {
    html += `<span class="projects-breadcrumb-sep">/</span><button type="button" class="projects-breadcrumb-btn" data-parent="${escHtml(p.id)}">${escHtml(p.name)}</button>`;
  });
  bcEl.innerHTML = html;
}

function _renderProjListSelectBar() {
  let bar = document.getElementById("projlist-select-bar");
  if (!_projListSelect) { if (bar) bar.remove(); return; }
  if (!bar) {
    bar = el("div", "bulk-action-bar");
    bar.id = "projlist-select-bar";
    bar.innerHTML =
      '<span id="projlist-count">0 sélectionné(s)</span>' +
      '<button class="btn btn-danger btn-sm" id="btn-projlist-del">Supprimer</button>' +
      '<button class="btn btn-ghost btn-sm" id="btn-projlist-cancel">Annuler</button>';
    document.body.appendChild(bar);
    bar.querySelector("#btn-projlist-del").addEventListener("click", () => {
      if (!_projListSelected.size) return;
      confirmDialog(`Supprimer ${_projListSelected.size} projet${_projListSelected.size > 1 ? "s" : ""} ?`, () => {
        _projListSelected.forEach((id) => deleteProject(id));
        _projListSelected.clear(); _projListSelect = false;
        render(); _renderProjListSelectBar();
        showToast("Projets supprimés", "success");
      });
    });
    bar.querySelector("#btn-projlist-cancel").addEventListener("click", () => {
      _projListSelect = false; _projListSelected.clear();
      render(); _renderProjListSelectBar();
      document.getElementById("btn-projlist-select")?.classList.remove("active-accent");
    });
  }
  bar.querySelector("#projlist-count").textContent =
    _projListSelected.size + " sélectionné" + (_projListSelected.size > 1 ? "s" : "");
  requestAnimationFrame(() => bar.classList.add("open"));
}

function render() {
  _ensureValidCurrentParent();
  const projects = getProjects();
  const projectsInScope = projects.filter((p) => (p.parentId || null) === _currentParentId);
  const grid = document.getElementById("projects-grid");
  grid.innerHTML = "";
  grid.className = _projViewMode === "list" ? "projects-grid view-list" : "projects-grid";
  document.getElementById("project-count").textContent = projectsInScope.length;
  _renderBreadcrumb();

  // Section favoris
  const favWrap = document.getElementById("projects-favorites");
  const favs = projectsInScope.filter((p) => p.favorite);
  if (favWrap) {
    favWrap.style.display = favs.length ? "" : "none";
    const favGrid = favWrap.querySelector(".fav-projects-grid");
    if (favGrid) {
      favGrid.innerHTML = "";
      favs.forEach((p) => {
        const card = createProjectCard(p);
        favGrid.appendChild(card);
      });
    }
  }

  const filtered = projectsInScope.filter((p) =>
    p.name.toLowerCase().includes(searchQuery.toLowerCase()),
  );
  filtered.forEach((p, i) => {
    const card = createProjectCard(p);
    const subCount = _countSubProjects(p.id);
    const subBtn = el("button", "btn btn-ghost btn-sm project-subprojects-btn");
    subBtn.type = "button";
    subBtn.dataset.action = "children";
    subBtn.innerHTML = `${IC.folder}<span>Sous-projets (${subCount})</span>`;
    subBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      _setCurrentParentId(p.id);
      _projListSelected.clear();
      render();
      _renderProjListSelectBar();
    });
    card.appendChild(subBtn);
    card.style.animationDelay = `${i * 40}ms`;
    if (_projListSelect) {
      card.classList.add("select-mode");
      card.style.position = "relative";
      const cb = document.createElement("input");
      cb.type = "checkbox"; cb.className = "todo-select-cb";
      cb.checked = _projListSelected.has(p.id);
      cb.style.cssText = "position:absolute;top:10px;left:10px;z-index:2";
      cb.addEventListener("change", (e) => {
        e.stopPropagation();
        if (cb.checked) _projListSelected.add(p.id); else _projListSelected.delete(p.id);
        card.classList.toggle("selected", cb.checked);
        _renderProjListSelectBar();
      });
      card.addEventListener("click", (e) => {
        if (e.target === cb || e.target.closest("[data-action]")) return;
        cb.checked = !cb.checked; cb.dispatchEvent(new Event("change"));
        e.preventDefault(); e.stopPropagation();
      }, true);
      card.appendChild(cb);
    }
    grid.appendChild(card);
  });

  if (filtered.length === 0) {
    const e = el("div", "empty-state");
    e.style.gridColumn = "1/-1";
    e.innerHTML = IC.empty + `<p>${_currentParentId ? "Aucun sous-projet." : "Aucun projet."}</p>`;
    grid.appendChild(e);
  }

  const newBtn = el("button", "project-card project-card-new");
  newBtn.innerHTML = IC.plus + "<span>Nouveau projet</span>";
  newBtn.addEventListener("click", openNewModal);
  grid.appendChild(newBtn);
}

function bindEvents() {
  document.getElementById("search-input").addEventListener("input", (e) => {
    searchQuery = e.target.value;
    render();
  });
  document
    .getElementById("btn-new-project")
    .addEventListener("click", openNewModal);
  document.getElementById("btn-projlist-select")?.addEventListener("click", toggleProjListSelect);
  document.getElementById("btn-view-toggle")?.addEventListener("click", () => {
    _projViewMode = _projViewMode === "grid" ? "list" : "grid";
    safeStorageSet("workspace-projects-view", _projViewMode);
    _updateViewToggleBtn("btn-view-toggle", "view-icon-grid", "view-icon-list", "view-label", _projViewMode);
    render();
  });
  _updateViewToggleBtn("btn-view-toggle", "view-icon-grid", "view-icon-list", "view-label", _projViewMode);
  document.getElementById("projects-breadcrumb")?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-parent]");
    if (!btn) return;
    _setCurrentParentId(btn.getAttribute("data-parent") || null);
    _projListSelected.clear();
    render();
    _renderProjListSelectBar();
  });
  document
    .getElementById("projects-grid")
    .addEventListener("project:refresh", () => render());
  document.getElementById("projects-grid")
    .addEventListener("project:delete", (e) => {
      const p = getProject(e.detail.id);
      const descendants = typeof getProjectDescendants === "function"
        ? getProjectDescendants(e.detail.id)
        : [];
      const suffix = descendants.length
        ? ` (et ${descendants.length} sous-projet${descendants.length > 1 ? "s" : ""})`
        : "";
      confirmDialog(
        `Supprimer le projet « ${p?.name} »${suffix} et tout son contenu ?`,
        () => {
          deleteProject(e.detail.id);
          if (_currentParentId === e.detail.id) _setCurrentParentId(null);
          render();
          showToast("Projet supprimé");
        },
      );
    });
  document.getElementById("projects-grid")
    .addEventListener("project:navigate-children", (e) => {
      const projectId = e?.detail?.id;
      if (!projectId) return;
      _setCurrentParentId(projectId);
      _projListSelected.clear();
      render();
      _renderProjListSelectBar();
    });
}

function openNewModal() {
  let color = COLORS[0];
  const parent = _currentParentId ? getProject(_currentParentId) : null;
  const suggestedCategories = _getSuggestedProjectCategories();
  const content = document.createElement("div");
  content.innerHTML = `
    <div class="field"><label>Nom *</label><input type="text" id="m-name" maxlength="60" placeholder="Ex: Migration SI 2025"></div>
    <div class="field"><label>Emplacement</label><input type="text" id="m-parent" value="${escHtml(parent?.name || "Racine")}" disabled></div>
    <div class="field"><label>Catégorie *</label><input type="text" id="m-category" maxlength="40" placeholder="Ex: Application" list="m-category-list"></div>
    <datalist id="m-category-list">${suggestedCategories.map((category) => `<option value="${escHtml(category)}"></option>`).join("")}</datalist>
    <div class="field"><label>Couleur</label><div id="m-picker"></div></div>`;
  createModal({
    title: parent ? "Nouveau sous-projet" : "Nouveau projet",
    confirmLabel: "Créer",
    content,
    watchConfirm: true,
    isConfirmEnabled: () => {
      const name = document.getElementById("m-name")?.value.trim();
      const category = document.getElementById("m-category")?.value.trim();
      return !!name && !!category;
    },
    disabledConfirmTitle: "Le nom du projet et une catégorie sont requis",
    onConfirm: () => {
      const name = document.getElementById("m-name").value.trim();
      const category = document.getElementById("m-category")?.value.trim();
      if (!name || !category) {
        showToast("Nom et catégorie requis");
        return;
      }
      createProject({ name, color, parentId: _currentParentId, categories: [category] });
      render();
      showToast(parent ? "Sous-projet créé !" : "Projet créé !");
    },
  });
  setTimeout(() => {
    document
      .getElementById("m-picker")
      ?.appendChild(createColorPicker(color, (c) => (color = c)));
    document.getElementById("m-name")?.focus();
  }, 30);
}
