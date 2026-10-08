// @ts-check
// ── pages/todos.js ──

let filterStatus   = "all";
let filterPriority = "all";
let filterContext  = "all";
let filterProject  = "all";
let filterDue      = "all";
let _selectMode    = false;
let _selectedIds   = new Set();
let viewMode = safeStorageGet("workspace-todos-view", "columns");
let _draggedTodoId = null;
let _todoDnDDocumentBound = false;
let _todoFocusId = getParam("focus");
let _todoFocusDone = false;
let _activeSavedViewId = getParam("savedView") || "";

const _RECUR_DAYS = [
  { n: 1, l: "L" },
  { n: 2, l: "Ma" },
  { n: 3, l: "Me" },
  { n: 4, l: "J" },
  { n: 5, l: "V" },
  { n: 6, l: "S" },
  { n: 7, l: "D" },
];

function _parseContextValues(value) {
  return [...new Set(
    String(value || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  )];
}

function _normalizeContextValue(value) {
  return _parseContextValues(value).join(", ");
}

function _getTodoContexts(todo) {
  if (!todo) return [];
  return _parseContextValues(todo.context);
}

function _normalizeRecurrenceForForm(recurrence) {
  if (!recurrence || typeof recurrence !== "object") return { type: "none" };
  const type = String(recurrence.type || "none");
  if (type === "daily") return { type: "daily" };
  if (type === "weekly") {
    const weeklyDays = [...new Set((Array.isArray(recurrence.weeklyDays) ? recurrence.weeklyDays : [])
      .map((x) => Number(x))
      .filter((x) => Number.isInteger(x) && x >= 1 && x <= 7))]
      .sort((a, b) => a - b);
    return weeklyDays.length ? { type: "weekly", weeklyDays } : { type: "none" };
  }
  if (type === "monthly_nth_weekday") {
    const nth = Number(recurrence.nth);
    const weekday = Number(recurrence.weekday);
    if ([1, 2, 3, 4, -1].includes(nth) && Number.isInteger(weekday) && weekday >= 1 && weekday <= 7) {
      return { type: "monthly_nth_weekday", nth, weekday };
    }
  }
  return { type: "none" };
}

function _readRecurrenceFromForm() {
  const type = document.getElementById("t-rec-type")?.value || "none";
  if (type === "none") return null;
  if (type === "daily") return { type: "daily" };
  if (type === "weekly") {
    const weeklyDays = [...document.querySelectorAll("input[name='t-rec-weekday']:checked")]
      .map((el) => Number(el.value))
      .filter((n) => Number.isInteger(n) && n >= 1 && n <= 7)
      .sort((a, b) => a - b);
    return weeklyDays.length ? { type: "weekly", weeklyDays } : null;
  }
  if (type === "monthly_nth_weekday") {
    const nth = Number(document.getElementById("t-rec-nth")?.value || 2);
    const weekday = Number(document.getElementById("t-rec-wd")?.value || 1);
    if (![1, 2, 3, 4, -1].includes(nth)) return null;
    if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7) return null;
    return { type: "monthly_nth_weekday", nth, weekday };
  }
  return null;
}

function _recurrenceForCompare(recurrence) {
  const r = _normalizeRecurrenceForForm(recurrence);
  if (r.type === "weekly") return `weekly:${(r.weeklyDays || []).join("-")}`;
  if (r.type === "monthly_nth_weekday") return `monthly:${r.nth}:${r.weekday}`;
  return r.type;
}

function _bindRecurrenceUi(modalApi) {
  const typeSel = document.getElementById("t-rec-type");
  const weekWrap = document.getElementById("t-rec-week-wrap");
  const monthWrap = document.getElementById("t-rec-month-wrap");
  if (!typeSel) return;

  const refreshVisibility = () => {
    const t = typeSel.value || "none";
    if (weekWrap) weekWrap.style.display = t === "weekly" ? "" : "none";
    if (monthWrap) monthWrap.style.display = t === "monthly_nth_weekday" ? "" : "none";
    modalApi?.refreshConfirmState?.();
  };

  typeSel.addEventListener("change", refreshVisibility);
  document.querySelectorAll("input[name='t-rec-weekday']").forEach((el) => {
    el.addEventListener("change", () => modalApi?.refreshConfirmState?.());
  });
  document.getElementById("t-rec-nth")?.addEventListener("change", () => modalApi?.refreshConfirmState?.());
  document.getElementById("t-rec-wd")?.addEventListener("change", () => modalApi?.refreshConfirmState?.());
  refreshVisibility();
}

function _recurrenceLabel(recurrence) {
  const r = _normalizeRecurrenceForForm(recurrence);
  if (r.type === "daily") return "Récurrence: quotidien";
  if (r.type === "weekly") {
    const map = { 1: "L", 2: "Ma", 3: "Me", 4: "J", 5: "V", 6: "S", 7: "D" };
    const days = (r.weeklyDays || []).map((n) => map[n]).filter(Boolean).join(", ");
    return days ? `Récurrence: hebdo (${days})` : "Récurrence: hebdo";
  }
  if (r.type === "monthly_nth_weekday") {
    const nthMap = { 1: "1er", 2: "2e", 3: "3e", 4: "4e", "-1": "dernier" };
    const wdMap = { 1: "lundi", 2: "mardi", 3: "mercredi", 4: "jeudi", 5: "vendredi", 6: "samedi", 7: "dimanche" };
    const nth = nthMap[String(r.nth)] || "N";
    const wd = wdMap[r.weekday] || "jour";
    return `Récurrence: ${nth} ${wd}`;
  }
  return "";
}

bootPage(() => {
  initPageCommon();
  _initTodoFiltersFromUrl();
  renderFilters();
  render();
  bindEvents();
});

function _todoViewStateKey(state) {
  if (!state) return "";
  const filters = state.filters || {};
  return JSON.stringify({
    status: filters.status || "all",
    priority: filters.priority || "all",
    context: filters.context || "all",
    project: filters.project || "all",
    due: filters.due || "all",
    viewMode: state.viewMode || "columns",
  });
}

function _getCurrentTodoViewState() {
  return {
    filters: {
      status: filterStatus,
      priority: filterPriority,
      context: filterContext,
      project: filterProject,
      due: filterDue,
    },
    viewMode,
  };
}

function _setTodoViewMode(mode) {
  viewMode = mode;
  safeStorageSet("workspace-todos-view", mode);
}

function _applyTodoViewState(state) {
  const filters = state?.filters || {};
  filterStatus = filters.status || "all";
  filterPriority = filters.priority || "all";
  filterContext = filters.context || "all";
  filterProject = filters.project || "all";
  filterDue = filters.due || "all";
  if (state?.viewMode) _setTodoViewMode(state.viewMode);
}

function _findMatchingSavedViewId() {
  const currentKey = _todoViewStateKey(_getCurrentTodoViewState());
  return getTodoSavedViews().find((view) => _todoViewStateKey(view) === currentKey)?.id || "";
}

function _describeTodoViewState(state) {
  const filters = state?.filters || {};
  const labels = [];
  const statusLabels = {
    all: "tous statuts",
    todo: "à faire",
    waitinginfo: "en attente d'info",
    inprogress: "en cours",
    done: "terminées",
  };
  const dueLabels = {
    all: "toutes échéances",
    overdue: "en retard",
    today: "aujourd'hui",
    week: "cette semaine",
    none: "sans échéance",
  };

  labels.push(statusLabels[filters.status || "all"] || (filters.status || "all"));
  if ((filters.priority || "all") !== "all") {
    const priority = getTodoPriorities().find((item) => item.id === filters.priority);
    labels.push(`priorité ${priority?.label || filters.priority}`);
  }
  if ((filters.context || "all") !== "all") labels.push(`contexte ${filters.context}`);
  if ((filters.project || "all") === "none") labels.push("sans projet");
  else if ((filters.project || "all") !== "all") {
    labels.push(getProject(filters.project)?.name || filters.project);
  }
  if ((filters.due || "all") !== "all") labels.push(dueLabels[filters.due] || filters.due);
  labels.push(state?.viewMode === "list" ? "vue liste" : state?.viewMode === "priority" ? "vue priorités" : "vue colonnes");
  return labels.join(" · ");
}

function _renderSavedViews() {
  const wrap = document.getElementById("todo-saved-views-list");
  if (!wrap) return;
  const views = getTodoSavedViews();
  const matchingId = _findMatchingSavedViewId();
  wrap.innerHTML = "";

  if (!views.length) {
    wrap.appendChild(el("span", "todo-saved-views-empty", "Aucune vue enregistrée."));
    return;
  }

  views.forEach((view) => {
    const isActive = (matchingId && matchingId === view.id) || _activeSavedViewId === view.id;
    const btn = el("button", "filter-btn" + (isActive ? " active-accent" : ""), escHtml(view.name));
    btn.type = "button";
    btn.addEventListener("click", () => {
      _activeSavedViewId = view.id;
      _applyTodoViewState(view);
      renderFilters();
      render();
    });
    wrap.appendChild(btn);
  });
}

function _openSaveViewModal() {
  const existingId = _findMatchingSavedViewId();
  const existing = existingId ? getTodoSavedViews().find((view) => view.id === existingId) : null;
  const content = el("div");
  content.innerHTML = `
    <div class="field"><label>Nom de la vue *</label><input type="text" id="tv-name" maxlength="60" value="${escHtml(existing?.name || "")}" placeholder="Ex: Inbox prioritaire"></div>
    <div class="field"><label>Résumé</label><div class="todo-view-summary" id="tv-summary"></div></div>`;
  const modalApi = createModal({
    title: existing ? "Mettre à jour la vue" : "Sauvegarder la vue",
    confirmLabel: existing ? "Mettre à jour" : "Enregistrer",
    content,
    watchConfirm: true,
    isConfirmEnabled: () => !!document.getElementById("tv-name")?.value.trim(),
    disabledConfirmTitle: "Le nom de la vue est requis",
    onConfirm: () => {
      const name = document.getElementById("tv-name")?.value.trim();
      if (!name) return false;
      const saved = saveTodoSavedView({
        id: existing?.id,
        name,
        ..._getCurrentTodoViewState(),
      });
      _activeSavedViewId = saved.id;
      renderFilters();
      render();
      showToast(existing ? "Vue mise à jour" : "Vue sauvegardée");
    },
  });
  setTimeout(() => {
    const summary = document.getElementById("tv-summary");
    if (summary) summary.textContent = _describeTodoViewState(_getCurrentTodoViewState());
    document.getElementById("tv-name")?.focus();
    modalApi.refreshConfirmState();
  }, 20);
}

function _openManageSavedViewsModal() {
  const content = el("div");
  content.innerHTML = '<div id="tv-manage-list"></div>';
  createModal({
    title: "Gérer les vues",
    confirmLabel: "Fermer",
    hideCancel: true,
    content,
    onConfirm: () => {},
  });

  const renderList = () => {
    const list = document.getElementById("tv-manage-list");
    if (!list) return;
    const views = getTodoSavedViews();
    list.innerHTML = "";
    if (!views.length) {
      list.innerHTML = '<div class="empty-state compact"><p>Aucune vue sauvegardée.</p></div>';
      return;
    }
    views.forEach((view) => {
      const row = el("div", "todo-view-manage-row");
      row.innerHTML = `
        <div>
          <div class="todo-view-manage-name">${escHtml(view.name)}</div>
          <div class="todo-view-manage-meta">${escHtml(_describeTodoViewState(view))}</div>
        </div>
        <div class="todo-view-manage-actions">
          <button type="button" class="btn btn-ghost btn-sm" data-action="apply">Ouvrir</button>
          <button type="button" class="btn btn-danger-ghost btn-sm" data-action="delete">Supprimer</button>
        </div>`;
      row.querySelector('[data-action="apply"]')?.addEventListener("click", () => {
        _activeSavedViewId = view.id;
        _applyTodoViewState(view);
        renderFilters();
        render();
        document.querySelector('.modal-close')?.click();
      });
      row.querySelector('[data-action="delete"]')?.addEventListener("click", () => {
        deleteTodoSavedView(view.id);
        if (_activeSavedViewId === view.id) _activeSavedViewId = "";
        renderList();
        renderFilters();
        render();
      });
      list.appendChild(row);
    });
  };

  setTimeout(renderList, 20);
}

function _collectTodoTagSuggestions() {
  const todoTags = getTodos().flatMap((todo) => todo.tags || []);
  const projectCategories = getProjects().flatMap((project) => project.categories || []);
  return [...new Set([...todoTags, ...projectCategories].map((tag) => String(tag || "").trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "fr", { sensitivity: "base" }))
    .slice(0, 12);
}

function _renderTodoTagSuggestions(input, container, suggestions) {
  if (!input || !container) return;
  container.innerHTML = "";
  suggestions.forEach((tag) => {
    const btn = el("button", "todo-tag-suggestion", `#${escHtml(tag)}`);
    btn.type = "button";
    btn.addEventListener("click", () => {
      const current = input.value.split(",").map((item) => item.trim()).filter(Boolean);
      if (!current.includes(tag)) current.push(tag);
      input.value = current.join(", ");
      input.dispatchEvent(new Event("input"));
    });
    container.appendChild(btn);
  });
}

function _initTodoFiltersFromUrl() {
  const savedViewId = getParam("savedView");
  if (savedViewId) {
    const savedView = getTodoSavedViews().find((view) => view.id === savedViewId);
    if (savedView) {
      _activeSavedViewId = savedView.id;
      _applyTodoViewState(savedView);
      return;
    }
  }
  const status = getParam("status");
  const priority = getParam("priority");
  const context = getParam("context");
  const project = getParam("project");
  const due = getParam("due");
  const mode = getParam("view");
  if (status) filterStatus = status;
  if (priority) filterPriority = priority;
  if (context) filterContext = context;
  if (project) filterProject = project;
  if (due) filterDue = due;
  if (mode) _setTodoViewMode(mode);
}

function render() {
  if (viewMode === "columns") renderColumns();
  else if (viewMode === "priority") renderPriorityBoard();
  else renderList();
  _syncViewModeButtons();
  _renderSavedViews();
  _tryFocusTodoTarget();
  _renderTodoDescriptions();
  document.getElementById("todo-count").textContent = getTodos().filter(
    (t) => t.status !== "done",
  ).length;
}

function _syncViewModeButtons() {
  const buttons = [
    { id: "btn-view-cols", mode: "columns" },
    { id: "btn-view-list", mode: "list" },
    { id: "btn-view-prio", mode: "priority" },
  ];

  buttons.forEach(({ id, mode }) => {
    const btn = document.getElementById(id);
    if (!btn) return;
    const isActive = viewMode === mode;
    btn.classList.toggle("active-accent", isActive);
    btn.setAttribute("aria-pressed", isActive ? "true" : "false");
  });
}

function _tryFocusTodoTarget() {
  if (!_todoFocusId || _todoFocusDone) return;
  const cards = [...document.querySelectorAll(".todo-card[data-id]")];
  const target = cards.find((el) => el.dataset.id === _todoFocusId);
  if (!target) return;
  _todoFocusDone = true;
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

function _renderTodoDescriptions() {
  if (typeof renderMarkdownInto !== "function") return;
  document.querySelectorAll(".todo-desc-md[data-md]").forEach((el) => {
    renderMarkdownInto(el, el.dataset.md);
    el.removeAttribute("data-md"); // marque comme déjà rendu
    el.classList.remove("todo-desc-md");
  });
}

function renderColumns() {
  _bindTodoDnDDocumentEvents();

  document.getElementById("todos-view").innerHTML = `
    <div class="todos-columns">
      <div id="col-todo"><div class="todo-column-header"><div class="todo-column-title status-todo-title">À faire <span class="todo-column-count" id="cnt-todo">0</span></div></div><div class="todo-list" id="list-todo" data-status="todo"></div></div>
      <div id="col-waitinginfo"><div class="todo-column-header"><div class="todo-column-title status-waitinginfo-title">En attente d'info <span class="todo-column-count" id="cnt-waitinginfo">0</span></div></div><div class="todo-list" id="list-waitinginfo" data-status="waitinginfo"></div></div>
      <div id="col-inprogress"><div class="todo-column-header"><div class="todo-column-title status-inprogress-title">En cours <span class="todo-column-count" id="cnt-inprogress">0</span></div></div><div class="todo-list" id="list-inprogress" data-status="inprogress"></div></div>
      <div id="col-done"><div class="todo-column-header"><div class="todo-column-title status-done-title">Terminé <span class="todo-column-count" id="cnt-done">0</span></div></div><div class="todo-list" id="list-done" data-status="done"></div></div>
    </div>`;

  ["todo", "waitinginfo", "inprogress", "done"].forEach((status) => {
    const todos = getFilteredTodos().filter((t) => t.status === status);
    const cntEl = document.getElementById("cnt-" + status);
    const listEl = document.getElementById("list-" + status);
    if (cntEl) cntEl.textContent = todos.length;

    todos.forEach((t, i) => {
      const c = buildTodoCard(t);
      c.style.animationDelay = i * 25 + "ms";
      listEl.appendChild(c);
    });

    if (!todos.length) {
      const placeholder = el("div", "");
      placeholder.style.cssText =
        "color:var(--text-3);font-size:.78rem;text-align:center;padding:20px 0;font-family:var(--font-mono);pointer-events:none;";
      placeholder.textContent = "Dépose ici";
      listEl.appendChild(placeholder);
    }

    // Drop zone = toute la colonne (pas juste les cartes existantes)
    const colEl = document.getElementById("col-" + status);
    colEl.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.stopPropagation();
      colEl.style.outline = "2px dashed var(--accent)";
      colEl.style.borderRadius = "var(--r-lg)";
    });
    colEl.addEventListener("dragleave", (e) => {
      // Vérifier qu'on quitte vraiment la colonne (pas juste un enfant)
      if (!colEl.contains(e.relatedTarget)) {
        colEl.style.outline = "";
      }
    });
    colEl.addEventListener("drop", (e) => {
      e.preventDefault();
      colEl.style.outline = "";
      const draggedId = _draggedTodoId;
      if (!draggedId) return;
      const todo = getTodo(draggedId);
      if (!todo || todo.status === status) return;
      if (status === "done") {
        const card = document.querySelector(
          `.drag-item[data-id="${draggedId}"]`,
        );
        card?.classList.add("animate-done");
        setTimeout(() => {
          updateTodo(draggedId, { status });
          render();
          renderFilters();
        }, 350);
      } else {
        updateTodo(draggedId, { status });
        render();
        renderFilters();
      }
      const labels = {
        todo: "À faire",
        inprogress: "En cours",
        waitinginfo: "En attente d'info",
        done: "Terminé",
      };
      showToast(`→ ${labels[status]}`);
    });
  });
}

function _bindTodoDnDDocumentEvents() {
  if (_todoDnDDocumentBound) return;
  _todoDnDDocumentBound = true;

  document.addEventListener(
    "dragstart",
    (e) => {
      const card = e.target.closest(".drag-item[data-id]");
      if (card) _draggedTodoId = card.dataset.id;
    },
    true,
  );
  document.addEventListener(
    "dragend",
    () => {
      _draggedTodoId = null;
    },
    true,
  );
}

function renderList() {
  const todos = getFilteredTodos().sort((a, b) => {
    const p = getTodoPriorities().map((x) => x.id);
    return p.indexOf(a.priorityId) - p.indexOf(b.priorityId);
  });
  document.getElementById("todos-view").innerHTML =
    '<div class="todo-flat-list" id="flat-list"></div>';
  const list = document.getElementById("flat-list");
  if (!todos.length) {
    list.appendChild(
      createEmptyState(
        EMPTY_ICONS.todos,
        "Aucune tâche",
        "Crée ta première tâche.",
      ),
    );
    return;
  }
  todos.forEach((t, i) => {
    const c = buildTodoCard(t);
    c.style.animationDelay = i * 20 + "ms";
    list.appendChild(c);
  });
  initDragReorder(list, (ids) => reorderTodos(ids));
}

function getFilteredTodos() {
  const today   = new Date().toISOString().slice(0, 10);
  const weekEnd = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
  return getTodos().filter((t) => {
    if (filterStatus   !== "all" && t.status     !== filterStatus)   return false;
    if (filterPriority !== "all" && t.priorityId !== filterPriority) return false;
    if (filterContext !== "all" && !_getTodoContexts(t).includes(filterContext)) return false;
    if (filterProject === "none" && (t.projectId || "")) return false;
    if (!["all", "none"].includes(filterProject) && (t.projectId || "") !== filterProject) return false;
    if (filterDue === "overdue" && (!t.dueDate || t.dueDate >= today))   return false;
    if (filterDue === "today"   && t.dueDate !== today)                  return false;
    if (filterDue === "week"    && (!t.dueDate || t.dueDate > weekEnd))  return false;
    if (filterDue === "none"    && t.dueDate)                            return false;
    return true;
  });
}

function renderFilters() {
  document
    .querySelectorAll(".status-filter")
    .forEach((b) => {
      b.classList.toggle("active-accent", b.dataset.s === filterStatus);
      b.classList.remove("active");
    });
  renderPriorityFilters();
  renderContextFilters();
  renderProjectFilters();
  renderDueFilters();
}

function renderPriorityFilters() {
  const wrap = document.getElementById("priority-filters");
  if (!wrap) return;
  wrap.innerHTML = "";
  const allBtn = el(
    "button",
    "filter-btn" + (filterPriority === "all" ? " active-accent" : ""),
    "Toutes",
  );
  allBtn.addEventListener("click", () => {
    filterPriority = "all";
    renderFilters();
    render();
  });
  wrap.appendChild(allBtn);
  getTodoPriorities().forEach((p) => {
    const btn = el("button", "filter-btn", escHtml(p.label));
    if (filterPriority === p.id)
      btn.style.cssText = `color:${p.color};border-color:${p.color}60;background:${p.color}18;`;
    btn.addEventListener("click", () => {
      filterPriority = p.id;
      renderFilters();
      render();
    });
    wrap.appendChild(btn);
  });
}

function renderContextFilters() {
  const wrap    = document.getElementById("context-filters");
  const wrapDiv = document.getElementById("context-filter-wrap");
  if (!wrap) return;
  const ctxs = [
    ...new Set(
      getTodos().flatMap((t) => _getTodoContexts(t)),
    ),
  ];
  wrap.innerHTML = "";
  if (wrapDiv) wrapDiv.style.display = ctxs.length ? "" : "none";
  if (!ctxs.length) return;
  const allBtn = el(
    "button",
    "filter-btn" + (filterContext === "all" ? " active-accent" : ""),
    "Tous",
  );
  allBtn.addEventListener("click", () => {
    filterContext = "all";
    render();
    renderContextFilters();
  });
  wrap.appendChild(allBtn);
  ctxs.forEach((c) => {
    const btn = el(
      "button",
      "filter-btn" + (filterContext === c ? " active-accent" : ""),
      escHtml(c),
    );
    btn.addEventListener("click", () => {
      filterContext = c;
      render();
      renderContextFilters();
    });
    wrap.appendChild(btn);
  });
}

function renderProjectFilters() {
  const wrap = document.getElementById("project-filters");
  const wrapDiv = document.getElementById("project-filter-wrap");
  if (!wrap) return;
  const projects = typeof getProjects === "function" ? getProjects() : [];
  if (wrapDiv) wrapDiv.style.display = projects.length ? "" : "none";
  if (!projects.length) return;
  wrap.innerHTML = "";
  const allBtn = el("button", "filter-btn" + (filterProject === "all" ? " active-accent" : ""), "Tous");
  allBtn.addEventListener("click", () => { filterProject = "all"; render(); renderProjectFilters(); });
  wrap.appendChild(allBtn);
  const noneBtn = el("button", "filter-btn" + (filterProject === "none" ? " active-accent" : ""), "Sans projet");
  noneBtn.addEventListener("click", () => { filterProject = "none"; render(); renderProjectFilters(); });
  wrap.appendChild(noneBtn);
  projects.forEach((p) => {
    const btn = el("button", "filter-btn" + (filterProject === p.id ? " active-accent" : ""), escHtml(p.name));
    btn.addEventListener("click", () => { filterProject = p.id; render(); renderProjectFilters(); });
    wrap.appendChild(btn);
  });
}

function renderDueFilters() {
  const wrap = document.getElementById("due-filters");
  if (!wrap) return;
  wrap.innerHTML = "";
  const opts = [
    { v: "all",     l: "Toutes" },
    { v: "overdue", l: "En retard" },
    { v: "today",   l: "Aujourd'hui" },
    { v: "week",    l: "Cette semaine" },
    { v: "none",    l: "Sans échéance" },
  ];
  opts.forEach(({ v, l }) => {
    const btn = el("button", "filter-btn" + (filterDue === v ? " active-accent" : ""), l);
    if (v === "overdue") btn.style.setProperty("--f-accent", "var(--danger)");
    btn.addEventListener("click", () => { filterDue = v; render(); renderDueFilters(); });
    wrap.appendChild(btn);
  });
}


function toggleSelectMode() {
  _selectMode = !_selectMode;
  _selectedIds.clear();
  render();
  _renderSelectBar();
  const btn = document.getElementById("btn-select-mode");
  if (btn) btn.classList.toggle("active-accent", _selectMode);
}

function _renderSelectBar() {
  let bar = document.getElementById("todo-select-bar");
  if (!_selectMode) { if (bar) bar.remove(); return; }
  if (!bar) {
    bar = el("div", "bulk-action-bar");
    bar.id = "todo-select-bar";
    bar.innerHTML =
      '<span id="select-count">0 sélectionnée(s)</span>' +
      '<button class="btn btn-ghost btn-sm" id="btn-bulk-edit">Modifier</button>' +
      '<button class="btn btn-danger btn-sm" id="btn-bulk-delete">Supprimer</button>' +
      '<button class="btn btn-ghost btn-sm" id="btn-select-cancel">Annuler</button>';
    document.body.appendChild(bar);
    bar.querySelector("#btn-bulk-edit").addEventListener("click", () => {
      if (!_selectedIds.size) { showToast("Aucune tâche sélectionnée"); return; }
      openBulkEditModal();
    });
    bar.querySelector("#btn-bulk-delete").addEventListener("click", () => {
      if (!_selectedIds.size) { showToast("Aucune tâche sélectionnée"); return; }
      confirmDialog(
        `Supprimer ${_selectedIds.size} tâche${_selectedIds.size > 1 ? "s" : ""} ?`,
        () => {
          _selectedIds.forEach((id) => deleteTodo(id));
          _selectedIds.clear();
          _selectMode = false;
          render();
          renderFilters();
          _renderSelectBar();
          showToast("Tâches supprimées", "success");
        },
      );
    });
    bar.querySelector("#btn-select-cancel").addEventListener("click", () => {
      _selectMode = false;
      _selectedIds.clear();
      render();
      _renderSelectBar();
      const btn = document.getElementById("btn-select-mode");
      if (btn) btn.classList.remove("active-accent");
    });
  }
  bar.querySelector("#select-count").textContent =
    _selectedIds.size + " sélectionnée" + (_selectedIds.size > 1 ? "s" : "");
  requestAnimationFrame(() => bar.classList.add("open"));
}

function openBulkEditModal() {
  const projects = getProjects();
  const priorities = getTodoPriorities();
  const content = el("div");
  content.innerHTML = `
    <div class="field"><label>Projet</label><select id="tb-project"><option value="__keep__">Ne pas changer</option><option value="__none__">Retirer le projet</option>${projects.map((project) => `<option value="${project.id}">${escHtml(project.name)}</option>`).join("")}</select></div>
    <div class="field-row">
      <div class="field"><label>Statut</label><select id="tb-status"><option value="__keep__">Ne pas changer</option><option value="todo">À faire</option><option value="waitinginfo">En attente d'info</option><option value="inprogress">En cours</option><option value="done">Terminé</option></select></div>
      <div class="field"><label>Priorité</label><select id="tb-priority"><option value="__keep__">Ne pas changer</option>${priorities.map((priority) => `<option value="${priority.id}">${escHtml(priority.label)}</option>`).join("")}</select></div>
    </div>
    <div class="field"><label>Contexte</label><input type="text" id="tb-context" maxlength="40" placeholder="Nouveau contexte"><div style="font-size:.72rem;color:var(--text-3);margin-top:6px">Tu peux saisir plusieurs contextes, séparés par des virgules (ex: @support, @DDSTABAT).</div><label style="display:flex;align-items:center;gap:8px;margin-top:8px;color:var(--text-2)"><input type="checkbox" id="tb-context-clear"> Vider le contexte</label></div>
    <div class="field"><label>Tags</label><input type="text" id="tb-tags" placeholder="api, urgent"><div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:8px"><label style="display:flex;align-items:center;gap:6px;color:var(--text-2)"><input type="radio" name="tb-tags-mode" value="keep" checked> Ne pas changer</label><label style="display:flex;align-items:center;gap:6px;color:var(--text-2)"><input type="radio" name="tb-tags-mode" value="replace"> Remplacer</label><label style="display:flex;align-items:center;gap:6px;color:var(--text-2)"><input type="radio" name="tb-tags-mode" value="add"> Ajouter</label><label style="display:flex;align-items:center;gap:6px;color:var(--text-2)"><input type="radio" name="tb-tags-mode" value="clear"> Vider</label></div></div>`;
  createModal({
    title: `Modifier ${_selectedIds.size} tâche${_selectedIds.size > 1 ? "s" : ""}`,
    confirmLabel: "Appliquer",
    content,
    watchConfirm: true,
    isConfirmEnabled: () => {
      const project = document.getElementById("tb-project")?.value || "__keep__";
      const status = document.getElementById("tb-status")?.value || "__keep__";
      const priority = document.getElementById("tb-priority")?.value || "__keep__";
      const context = _normalizeContextValue(document.getElementById("tb-context")?.value);
      const clearContext = !!document.getElementById("tb-context-clear")?.checked;
      const tagsMode = document.querySelector("input[name='tb-tags-mode']:checked")?.value || "keep";
      const tags = document.getElementById("tb-tags")?.value.trim() || "";
      return project !== "__keep__" || status !== "__keep__" || priority !== "__keep__" || !!context || clearContext || tagsMode !== "keep" || !!tags;
    },
    disabledConfirmTitle: "Choisis au moins une modification",
    onConfirm: () => {
      const project = document.getElementById("tb-project")?.value || "__keep__";
      const status = document.getElementById("tb-status")?.value || "__keep__";
      const priority = document.getElementById("tb-priority")?.value || "__keep__";
      const context = _normalizeContextValue(document.getElementById("tb-context")?.value);
      const clearContext = !!document.getElementById("tb-context-clear")?.checked;
      const tagsMode = document.querySelector("input[name='tb-tags-mode']:checked")?.value || "keep";
      const tagValues = (document.getElementById("tb-tags")?.value || "").split(",").map((item) => item.trim()).filter(Boolean);

      [..._selectedIds].forEach((id) => {
        const todo = getTodo(id);
        if (!todo) return;
        const changes = {};
        if (project !== "__keep__") changes.projectId = project === "__none__" ? "" : project;
        if (status !== "__keep__") changes.status = status;
        if (priority !== "__keep__") changes.priorityId = priority;
        if (clearContext) changes.context = "";
        else if (context) changes.context = context;
        if (tagsMode === "replace") changes.tags = tagValues;
        else if (tagsMode === "add") changes.tags = [...new Set([...(todo.tags || []), ...tagValues])];
        else if (tagsMode === "clear") changes.tags = [];
        updateTodo(id, changes);
      });

      renderFilters();
      render();
      _renderSelectBar();
      showToast("Mise à jour en masse appliquée");
    },
  });
}

function buildTodoCard(todo) {
  const card = el(
    "div",
    "todo-card drag-item" +
    (todo.status === "done" ? " is-done" : "") +
    (_selectMode && _selectedIds.has(todo.id) ? " selected" : ""),
  );
  card.dataset.id = todo.id;
  if (_selectMode) {
    const cb = el("input");
    cb.type = "checkbox";
    cb.className = "todo-select-cb";
    cb.checked = _selectedIds.has(todo.id);
    cb.addEventListener("change", () => {
      if (cb.checked) _selectedIds.add(todo.id);
      else _selectedIds.delete(todo.id);
      card.classList.toggle("selected", cb.checked);
      _renderSelectBar();
    });
    card.prepend(cb);
    card.style.cursor = "pointer";
    card.addEventListener("click", (e) => {
      if (e.target === cb) return;
      cb.checked = !cb.checked;
      cb.dispatchEvent(new Event("change"));
    });
  }
  card.draggable = true;
  card.setAttribute(
    "aria-label",
    `Tâche : ${todo.title}. Glisser pour déplacer.`,
  );
  card.setAttribute("role", "listitem");
  const allTodos = getTodos();
  const blocking = (todo.dependencies || []).filter((id) => {
    const d = allTodos.find((t) => t.id === id);
    return d && d.status !== "done";
  });

  const statusBtn = el(
    "button",
    "todo-status-btn" + (todo.status === "done" ? " done" : ""),
  );
  statusBtn.innerHTML = todo.status === "done" ? IC.check : "";
  statusBtn.addEventListener("click", () => {
    const next = todo.status === "done" ? "todo" : "done";
    if (next === "done" && viewMode === "columns") {
      card.classList.add("animate-done");
      setTimeout(() => {
        updateTodo(todo.id, { status: next });
        render();
        renderFilters();
      }, 380);
    } else {
      updateTodo(todo.id, { status: next });
      render();
      renderFilters();
    }
  });

  const titleEl = el("div", "todo-title", escHtml(todo.title));
  titleEl.addEventListener("click", (e) => {
    e.stopPropagation();
    openTodoModal(todo);
  });
  let descEl = null;
  if (todo.description) {
    descEl = el("div", "todo-desc");
    // Truncate description to avoid taking too much space
    let descToShow = todo.description;
    const maxChars = 200;
    if (descToShow.length > maxChars) {
      descToShow = descToShow.substring(0, maxChars).trim() + "...";
    }
    if (typeof renderMarkdownInto === "function") {
      renderMarkdownInto(descEl, descToShow);
    } else {
      descEl.textContent = descToShow;
    }
  }
  const actions = el("div", "todo-card-actions");
  const btnE = el("button", "btn-icon");
  btnE.innerHTML = IC.edit;
  btnE.addEventListener("click", () => openTodoModal(todo));
  const btnD = el("button", "btn-icon danger");
  btnD.innerHTML = IC.trash;
  btnD.addEventListener("click", () =>
    confirmDialog(`Supprimer « ${todo.title} » ?`, () => {
      deleteTodo(todo.id);
      render();
      renderFilters();
      showToast("Tâche supprimée");
    }),
  );
  actions.appendChild(btnE);
  actions.appendChild(btnD);
  const top = el("div", "todo-card-top");
  top.appendChild(statusBtn);
  top.appendChild(titleEl);
  top.appendChild(actions);

  const meta = el("div", "todo-card-meta");
  meta.appendChild(createPriorityChip(todo.priorityId));
  if (todo.estimatedTime) {
    const t = el("span", "time-chip");
    t.innerHTML = IC.clock + formatTime(todo.estimatedTime);
    meta.appendChild(t);
  }
  _getTodoContexts(todo).forEach((contextValue) => {
    meta.appendChild(el("span", "context-chip", escHtml(contextValue)));
  });
  if (todo.attachedTo)
    meta.appendChild(el("span", "attached-chip", `Rattaché: ${escHtml(todo.attachedTo)}`));
  const due = getDueBadge(todo.dueDate, todo.status);
  if (due) meta.appendChild(el("span", "due-badge " + due.cls, due.label));
  const recLabel = _recurrenceLabel(todo.recurrence);
  if (recLabel) meta.appendChild(el("span", "context-chip", recLabel));
  if (blocking.length)
    meta.appendChild(
      el("span", "dep-chip", IC.dep + ` Bloquée (${blocking.length})`),
    );
  if (viewMode === "list")
    meta.appendChild(
      el(
        "span",
        "status-pill status-" + todo.status,
        todo.status === "todo"
          ? "À faire"
          : todo.status === "inprogress"
            ? "En cours"
            : todo.status === "waitinginfo"
              ? "En attente d'info"
            : "Terminé",
      ),
    );

  card.appendChild(top);
  if (descEl) card.appendChild(descEl);
  card.appendChild(meta);
  return card;
}

function bindEvents() {
  document
    .getElementById("btn-new-todo")
    .addEventListener("click", () => openTodoModal());

  document
    .getElementById("btn-purge-done")
    ?.addEventListener("click", purgeCompletedTodos);
  document
    .getElementById("btn-select-mode")
    ?.addEventListener("click", toggleSelectMode);

  // Bouton "Modèles" injecté dynamiquement à côté de "Nouvelle tâche"
  _injectTodoTemplateBtn();

  document
    .getElementById("btn-manage-priorities")
    .addEventListener("click", openPrioritiesModal);
  document.querySelectorAll(".status-filter").forEach((b) =>
    b.addEventListener("click", () => {
      filterStatus = b.dataset.s;
      renderFilters();
      render();
    }),
  );
  document.getElementById("btn-view-cols")?.addEventListener("click", () => {
    _setTodoViewMode("columns");
    render();
  });
  document.getElementById("btn-view-list")?.addEventListener("click", () => {
    _setTodoViewMode("list");
    render();
  });
  document.getElementById("btn-view-prio")?.addEventListener("click", () => {
    _setTodoViewMode("priority");
    render();
  });
  document.getElementById("btn-save-view")?.addEventListener("click", _openSaveViewModal);
  document.getElementById("btn-manage-views")?.addEventListener("click", _openManageSavedViewsModal);
}

function openTodoModal(existing, prefill = {}) {
  const isEdit = !!existing;
  let formReady = false;
  const parseEstimatedMinutes = (value) => {
    if (typeof parseEstimatedTimeExpression === "function") {
      return parseEstimatedTimeExpression(value);
    }
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) return { valid: false, minutes: 0 };
    return { valid: true, minutes: Math.floor(n) };
  };
  const priorities = getTodoPriorities();
  const allTodos = getTodos().filter((t) => !existing || t.id !== existing.id);
  const normalizeTags = (v) =>
    String(v || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .join("|");
  const normalizeDeps = (arr) => [...(arr || [])].sort().join("|");
  const buildState = () => ({
    title: document.getElementById("t-title")?.value.trim() || "",
    description: document.getElementById("t-desc")?.value.trim() || "",
    priorityId: document.getElementById("t-prio")?.value || "",
    status: document.getElementById("t-status")?.value || "todo",
    estimatedTime: parseEstimatedMinutes(document.getElementById("t-time")?.value || "").minutes,
    dueDate: document.getElementById("t-due")?.value || "",
    reminderAt: document.getElementById("t-rem")?.value || "",
    pinned: !!document.getElementById("t-pin")?.checked,
    context: _normalizeContextValue(document.getElementById("t-ctx")?.value),
    attachedTo: document.getElementById("t-attached")?.value.trim() || "",
    dependencies: normalizeDeps([...document.querySelectorAll("#t-deps input:checked")].map((c) => c.value)),
    tags: normalizeTags(document.getElementById("t-tags")?.value),
    projectId: document.getElementById("t-project")?.value || "",
    recurrence: _recurrenceForCompare(_readRecurrenceFromForm()),
  });
  const initialState = existing
    ? JSON.stringify({
      title: existing.title || "",
      description: existing.description || "",
      priorityId: existing.priorityId || "",
      status: existing.status || "todo",
      estimatedTime: Number(existing.estimatedTime) || 0,
      dueDate: existing.dueDate || "",
      reminderAt: existing.reminderAt || "",
      pinned: !!existing.pinned,
      context: existing.context || "",
      attachedTo: existing.attachedTo || "",
      dependencies: normalizeDeps(existing.dependencies || []),
      tags: normalizeTags((existing.tags || []).join(", ")),
      projectId: existing.projectId || "",
      recurrence: _recurrenceForCompare(existing.recurrence),
    })
    : "";
  // prefill vient d'un template (ignoré si on édite un todo existant)
  const pre = existing ? {} : prefill;
  const rec = _normalizeRecurrenceForForm(existing?.recurrence || pre.recurrence);
  const recType = rec.type || "none";
  const recWeekDays = rec.weeklyDays || [];
  const recNth = rec.nth ?? 2;
  const recWd = rec.weekday ?? 1;
  const content = el("div");
  content.innerHTML = `
    <div class="field"><label>Titre *</label><input type="text" id="t-title" value="${escHtml(existing?.title || pre.title || "")}" maxlength="120"></div>
    <div class="field"><label>Description</label><div id="t-desc-mount" data-md-initial="${escHtml(existing?.description || pre.description || '')}"></div></div>
    <div class="field-row">
      <div class="field"><label>Priorité</label><select id="t-prio">${priorities.map((p) => `<option value="${p.id}"${(existing?.priorityId || pre.priorityId) === p.id ? " selected" : ""}>${escHtml(p.label)}</option>`).join("")}</select></div>
      <div class="field"><label>Statut</label><select id="t-status"><option value="todo" ${existing?.status === "todo" ? "selected" : ""}>À faire</option><option value="inprogress" ${existing?.status === "inprogress" ? "selected" : ""}>En cours</option><option value="waitinginfo" ${existing?.status === "waitinginfo" ? "selected" : ""}>En attente d'info</option><option value="done" ${existing?.status === "done" ? "selected" : ""}>Terminé</option></select></div>
    </div>
    <div class="field-row">
      <div class="field"><label>Temps estimé (min)</label><input type="text" id="t-time" inputmode="decimal" value="${existing?.estimatedTime || pre.estimatedTime || ""}" placeholder="Ex: 60 ou 60*5"><div id="t-time-hint" style="font-size:.72rem;color:var(--text-3);margin-top:6px"></div></div>
      <div class="field"><label>Date d'échéance</label><input type="date" id="t-due" value="${existing?.dueDate || ""}"></div>
    </div>
    <div class="field-row">
      <div class="field"><label>Rappel précis (date + heure)</label><input type="datetime-local" id="t-rem" value="${escHtml(existing?.reminderAt || "")}"></div>
      <div class="field"><label>Épingler</label><label style="display:flex;align-items:center;gap:8px;padding:8px 0;cursor:pointer"><input type="checkbox" id="t-pin" ${existing?.pinned ? "checked" : ""} style="width:16px;height:16px;accent-color:var(--accent)"><span style="font-size:.85rem;color:var(--text-2)">⭐ Afficher sur la page d'accueil</span></label></div>
    </div>
    <div class="field"><label>Projet <span style="color:var(--text-3);font-size:.72rem">(recommandé)</span></label><select id="t-project"><option value="">— Aucun projet —</option></select><div style="font-size:.72rem;color:var(--text-3);margin-top:6px">Renseigne un projet ou un contexte pour mieux classer la tâche.</div></div>
    <div class="field"><label>Contexte <span style="color:var(--text-3);font-size:.72rem">(recommandé si pas de projet)</span></label><input type="text" id="t-ctx" placeholder="@bureau, @pc…" value="${escHtml(existing?.context || pre.context || "")}" maxlength="40"><div style="font-size:.72rem;color:var(--text-3);margin-top:6px">Tu peux saisir plusieurs contextes, séparés par des virgules (ex: @support, @DDSTABAT).</div></div>
    <div class="field"><label>Rattaché à <span style="color:var(--text-3);font-size:.72rem">(optionnel)</span></label><input type="text" id="t-attached" placeholder="Ex: personne ayant signalé l'anomalie" value="${escHtml(existing?.attachedTo || pre.attachedTo || "")}" maxlength="80"></div>
    <div class="field">
      <label>Récurrence</label>
      <select id="t-rec-type">
        <option value="none" ${recType === "none" ? "selected" : ""}>Aucune</option>
        <option value="daily" ${recType === "daily" ? "selected" : ""}>Tous les jours</option>
        <option value="weekly" ${recType === "weekly" ? "selected" : ""}>Chaque semaine (jours choisis)</option>
        <option value="monthly_nth_weekday" ${recType === "monthly_nth_weekday" ? "selected" : ""}>Chaque mois (Nᵉ jour de semaine)</option>
      </select>
      <div id="t-rec-week-wrap" style="display:none;margin-top:8px;gap:8px;flex-wrap:wrap;align-items:center">
        ${_RECUR_DAYS.map((d) => `<label style="display:inline-flex;align-items:center;gap:6px;padding:4px 8px;border:1px solid var(--border);border-radius:999px;margin-right:6px;margin-bottom:6px;cursor:pointer"><input type="checkbox" name="t-rec-weekday" value="${d.n}" ${recWeekDays.includes(d.n) ? "checked" : ""} style="accent-color:var(--accent)"><span style="font-size:.8rem">${d.l}</span></label>`).join("")}
      </div>
      <div id="t-rec-month-wrap" style="display:none;margin-top:8px">
        <div class="field-row" style="margin:0">
          <div class="field" style="margin:0"><label style="font-size:.75rem">Occurrence</label><select id="t-rec-nth"><option value="1" ${recNth === 1 ? "selected" : ""}>1er</option><option value="2" ${recNth === 2 ? "selected" : ""}>2e</option><option value="3" ${recNth === 3 ? "selected" : ""}>3e</option><option value="4" ${recNth === 4 ? "selected" : ""}>4e</option><option value="-1" ${recNth === -1 ? "selected" : ""}>Dernier</option></select></div>
          <div class="field" style="margin:0"><label style="font-size:.75rem">Jour</label><select id="t-rec-wd"><option value="1" ${recWd === 1 ? "selected" : ""}>Lundi</option><option value="2" ${recWd === 2 ? "selected" : ""}>Mardi</option><option value="3" ${recWd === 3 ? "selected" : ""}>Mercredi</option><option value="4" ${recWd === 4 ? "selected" : ""}>Jeudi</option><option value="5" ${recWd === 5 ? "selected" : ""}>Vendredi</option><option value="6" ${recWd === 6 ? "selected" : ""}>Samedi</option><option value="7" ${recWd === 7 ? "selected" : ""}>Dimanche</option></select></div>
        </div>
      </div>
    </div>
    <div class="field"><label>Dépend de <span style="color:var(--text-3);font-size:.72rem;font-weight:400;font-family:var(--font-sans)">(cette tâche est bloquée tant que celles-ci ne sont pas terminées)</span></label><div id="t-deps" style="max-height:160px;overflow-y:auto;border:1px solid var(--border);border-radius:var(--r-md);background:var(--bg-3);"></div></div>
    <div class="field"><label>Tags (virgule)</label><input type="text" id="t-tags" list="t-tags-list" value="${escHtml((existing?.tags || pre.tags || []).join(", "))}" placeholder="api, frontend…"><datalist id="t-tags-list"></datalist><div id="t-tags-suggestions" class="todo-tag-suggestions"></div></div>
    ${!existing && pre.name ? `<div style="font-size:.72rem;color:var(--text-3);margin-top:4px;font-family:var(--font-mono)">📋 Modèle : ${escHtml(pre.name)}</div>` : ""}`;

  const modalApi = createModal({
    title: existing ? "Modifier la tâche" : (pre.name ? `Nouvelle tâche — ${pre.name}` : "Nouvelle tâche"),
    confirmLabel: existing ? "Enregistrer" : "Créer",
    content,
    watchConfirm: true,
    isConfirmEnabled: () => {
      if (!formReady) return false;
      const state = buildState();
      const rawTime = document.getElementById("t-time")?.value || "";
      const parsedTime = parseEstimatedMinutes(rawTime);
      if (!state.title) return false;
      if (!state.projectId && !state.context) return false;
      if (rawTime.trim() && !parsedTime.valid) return false;
      if ((document.getElementById("t-rec-type")?.value || "none") === "weekly") {
        const hasOneDay = !!document.querySelector("input[name='t-rec-weekday']:checked");
        if (!hasOneDay) return false;
      }
      return !existing || JSON.stringify(state) !== initialState;
    },
    disabledConfirmTitle: existing
      ? "Titre requis, avec projet ou contexte, et au moins une modification"
      : "Le titre et un projet ou contexte sont requis",
    onConfirm: () => {
      const title = document.getElementById("t-title")?.value.trim();
      if (!title) {
        showToast("Titre requis");
        return;
      }
      const deps = [...document.querySelectorAll("#t-deps input:checked")].map(
        (c) => c.value,
      );
      const rawTime = document.getElementById("t-time")?.value || "";
      const parsedTime = parseEstimatedMinutes(rawTime);
      if (rawTime.trim() && !parsedTime.valid) {
        showToast("Temps estimé invalide. Exemples: 60, 60*5, (30+30)");
        return false;
      }
      const data = {
        title,
        description: document.getElementById("t-desc")?.value.trim() || "",
        priorityId: document.getElementById("t-prio")?.value,
        status: document.getElementById("t-status")?.value,
        estimatedTime: parsedTime.minutes,
        dueDate: document.getElementById("t-due")?.value || "",
        reminderAt: document.getElementById("t-rem")?.value || "",
        pinned: !!document.getElementById("t-pin")?.checked,
        context: _normalizeContextValue(document.getElementById("t-ctx")?.value),
        attachedTo: document.getElementById("t-attached")?.value.trim(),
        dependencies: deps,
        tags: document
          .getElementById("t-tags")
          ?.value.split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        projectId: document.getElementById("t-project")?.value || "",
        recurrence: _readRecurrenceFromForm(),
      };
      if (!data.projectId && !data.context) {
        showToast("Renseigne au moins un projet ou un contexte");
        return false;
      }
      if (existing) {
        updateTodo(existing.id, data);
        showToast("Tâche mise à jour");
      } else {
        createTodo(data);
        showToast("Tâche créée !");
      }
      render();
      renderFilters();
    },
  });

  setTimeout(() => {
    // Select projet
    const projSel = document.getElementById("t-project");
    if (projSel && typeof getProjects === "function") {
      getProjects().forEach((p) => {
        const opt = document.createElement("option");
        opt.value = p.id;
        opt.textContent = p.name;
        if ((existing?.projectId || pre.projectId) === p.id) opt.selected = true;
        projSel.appendChild(opt);
      });
    }

    const tagSuggestions = _collectTodoTagSuggestions();
    const tagList = document.getElementById("t-tags-list");
    if (tagList) {
      tagList.innerHTML = tagSuggestions.map((tag) => `<option value="${escHtml(tag)}"></option>`).join("");
    }
    _renderTodoTagSuggestions(
      document.getElementById("t-tags"),
      document.getElementById("t-tags-suggestions"),
      tagSuggestions,
    );

    // Markdown editor pour la description
    const descMount = document.getElementById("t-desc-mount");
    if (descMount && typeof createMarkdownEditor === "function") {
      const mdDesc = createMarkdownEditor({
        initialValue: descMount.dataset.mdInitial || "",
        minHeight: 90,
        placeholder: "Détails de la tâche…",
      });
      mdDesc.textarea.id = "t-desc";
      descMount.replaceWith(mdDesc.root);
    }

    const dw = document.getElementById("t-deps");
    if (dw) {
      if (!allTodos.length) {
        dw.innerHTML =
          '<div style="padding:12px;color:var(--text-3);font-size:.82rem;text-align:center">Aucune autre tâche disponible.</div>';
      } else {
        allTodos.forEach((t) => {
          const r = el("label", "");
          r.style.cssText =
            "cursor:pointer;display:flex;align-items:center;gap:10px;padding:9px 12px;border-bottom:1px solid var(--border);transition:background .12s;";
          r.addEventListener(
            "mouseenter",
            () => (r.style.background = "var(--bg-4)"),
          );
          r.addEventListener("mouseleave", () => (r.style.background = ""));
          const checked = (existing?.dependencies || []).includes(t.id)
            ? "checked"
            : "";
          const dotColor =
            t.status === "done"
              ? "var(--success)"
              : t.status === "inprogress"
                ? "var(--link-color)"
                : t.status === "waitinginfo"
                  ? "var(--warn-color)"
                : "var(--text-3)";
          const statusLabel =
            t.status === "done"
              ? "Terminé"
              : t.status === "inprogress"
                ? "En cours"
                : t.status === "waitinginfo"
                  ? "En attente d'info"
                : "À faire";
          r.innerHTML = `
            <input type="checkbox" value="${t.id}" ${checked} style="flex-shrink:0;width:15px;height:15px;cursor:pointer;accent-color:var(--accent)">
            <span style="flex:1;font-size:.85rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escHtml(t.title)}">${escHtml(t.title)}</span>
            <span style="font-family:var(--font-mono);font-size:.62rem;color:${dotColor};flex-shrink:0;background:${dotColor}18;padding:2px 6px;border-radius:100px">${statusLabel}</span>`;
          dw.appendChild(r);
        });
      }
    }
    const timeInput = document.getElementById("t-time");
    const timeHint = document.getElementById("t-time-hint");
    const refreshTimeHint = () => {
      const raw = timeInput?.value || "";
      if (!timeHint) return;
      if (!raw.trim()) {
        timeHint.textContent = "Minutes directes ou formule (ex: 60*5).";
        timeHint.style.color = "var(--text-3)";
        return;
      }
      const parsed = parseEstimatedMinutes(raw);
      if (!parsed.valid) {
        timeHint.textContent = "Formule invalide. Formats: 60, 60*5, (30+30).";
        timeHint.style.color = "var(--error)";
      } else {
        timeHint.textContent = `= ${parsed.minutes} min`;
        timeHint.style.color = "var(--success)";
      }
    };
    timeInput?.addEventListener("input", () => {
      refreshTimeHint();
      modalApi.refreshConfirmState();
    });
    refreshTimeHint();
    _bindRecurrenceUi(modalApi);
    formReady = true;
    modalApi.refreshConfirmState();
    document.getElementById("t-title")?.focus();
  }, 30);
}

function openPrioritiesModal() {
  const content = el("div");
  const rList = () => {
    const l = content.querySelector("#prio-list");
    if (!l) return;
    l.innerHTML = "";
    getTodoPriorities().forEach((p) => {
      const r = el("div", "");
      r.style = "display:flex;align-items:center;gap:8px;margin-bottom:8px;";
      r.innerHTML = `<span style="width:12px;height:12px;border-radius:50%;background:${_safeCssColor(p.color)};display:inline-block;flex-shrink:0"></span><span style="flex:1;font-size:.88rem">${escHtml(p.label)}</span><button type="button" class="btn-icon danger" data-pid="${p.id}">${IC.trash}</button>`;
      r.querySelector("[data-pid]").addEventListener("click", () => {
        deleteTodoPriority(p.id);
        rList();
        render();
        renderFilters();
      });
      l.appendChild(r);
    });
  };
  content.innerHTML = `<div id="prio-list"></div><div class="divider"></div><div class="field"><label>Nouvelle priorité</label><div style="display:flex;gap:8px;align-items:center"><input type="text" id="p-label" placeholder="Ex: Critique" maxlength="30" style="flex:1"><input type="color" id="p-color" value="#f0a030" style="width:36px;height:36px;padding:2px;border-radius:6px;cursor:pointer;border:1px solid var(--border)"><button class="btn btn-ghost btn-sm" id="p-add">Ajouter</button></div></div>`;
  createModal({
    title: "Gérer les priorités",
    content,
    onConfirm: () => {},
    confirmLabel: "Fermer",
    hideCancel: true,
  });
  setTimeout(() => {
    rList();
    document.getElementById("p-add")?.addEventListener("click", () => {
      const l = document.getElementById("p-label")?.value.trim();
      const c = document.getElementById("p-color")?.value;
      if (!l) {
        showToast("Nom requis");
        return;
      }
      addTodoPriority({ label: l, color: c });
      document.getElementById("p-label").value = "";
      rList();
      renderFilters();
      render();
    });
  }, 30);
}

// ── Vue priorité (drag & drop entre lanes) ───────────────

function renderPriorityBoard() {
  const priorities = getTodoPriorities();
  const todos = getFilteredTodos().filter((t) => t.status !== "done");
  const knownPriorityIds = new Set(priorities.map((p) => p.id));
  const uncategorizedTodos = todos.filter((t) => !t.priorityId || !knownPriorityIds.has(t.priorityId));

  document.getElementById("todos-view").innerHTML =
    '<div class="priority-board" id="prio-board"></div>';
  const board = document.getElementById("prio-board");

  priorities.forEach((p) => {
    const lane = el("div", "priority-lane");
    const tasksIn = todos.filter((t) => t.priorityId === p.id);

    const header = el("div", "priority-lane-header");
    header.style.cssText = `background:${_safeCssColor(p.color, 'var(--bg-3)')}18;color:${_safeCssColor(p.color)};border:1px solid ${_safeCssColor(p.color, 'var(--border)')}40;`;
    header.innerHTML = `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${_safeCssColor(p.color)};margin-right:6px"></span>${escHtml(p.label)} <span style="opacity:.6">(${tasksIn.length})</span>`;

    const list = el("div", "priority-lane-list");
    list.dataset.priority = p.id;

    tasksIn.forEach((t, i) => {
      const card = el(
        "div",
        "todo-card drag-item" + (t.status === "done" ? " is-done" : ""),
      );
      card.dataset.id = t.id;
      card.draggable = true;
      card.style.animationDelay = i * 20 + "ms";
      card.innerHTML = `
        <div class="todo-card-top">
          <div class="todo-title" data-title>${escHtml(t.title)}</div>
          <div class="todo-card-actions">
            <button class="btn-icon" data-edit>${IC.edit}</button>
            <button class="btn-icon danger" data-del>${IC.trash}</button>
          </div>
        </div>
        ${t.description ? `<div class="todo-desc todo-desc-md" data-md="${escHtml(t.description)}"></div>` : ""}
        <div class="todo-card-meta">
          ${t.estimatedTime ? `<span class="time-chip">${IC.clock}${formatTime(t.estimatedTime)}</span>` : ""}
          ${_getTodoContexts(t).map((contextValue) => `<span class="context-chip">${escHtml(contextValue)}</span>`).join("")}
          ${t.attachedTo ? `<span class="attached-chip">Rattaché: ${escHtml(t.attachedTo)}</span>` : ""}
          ${(() => {
            const d = getDueBadge(t.dueDate, t.status);
            return d
              ? `<span class="due-badge ${d.cls}">${d.label}</span>`
              : "";
          })()}
          <span class="status-pill status-${t.status}">${t.status === "todo" ? "À faire" : t.status === "inprogress" ? "En cours" : t.status === "waitinginfo" ? "En attente d'info" : "Terminé"}</span>
        </div>`;
      card
        .querySelector("[data-edit]")
        .addEventListener("click", () => openTodoModal(t));
      card.querySelector("[data-title]")?.addEventListener("click", (e) => {
        e.stopPropagation();
        openTodoModal(t);
      });
      card.querySelector("[data-del]").addEventListener("click", () =>
        confirmDialog(`Supprimer « ${t.title} » ?`, () => {
          deleteTodo(t.id);
          renderPriorityBoard();
          showToast("Tâche supprimée");
        }),
      );
      list.appendChild(card);
      // Rendu Markdown de la description
      if (t.description && typeof renderMarkdownInto === "function") {
        const mdEl = card.querySelector(".todo-desc-md");
        if (mdEl) renderMarkdownInto(mdEl, t.description);
      }
    });

    // Drag & drop entre lanes
    list.addEventListener("dragover", (e) => {
      e.preventDefault();
      lane.classList.add("drag-over-lane");
    });
    list.addEventListener("dragleave", () =>
      lane.classList.remove("drag-over-lane"),
    );
    list.addEventListener("drop", (e) => {
      e.preventDefault();
      lane.classList.remove("drag-over-lane");
      const id = document.querySelector(".drag-item.dragging")?.dataset.id;
      if (id && id !== "") {
        updateTodo(id, { priorityId: p.id });
        renderPriorityBoard();
        showToast(`Priorité → ${p.label}`);
      }
    });

    // Dragstart/end sur les cartes
    list.addEventListener("dragstart", (e) => {
      const card = e.target.closest(".drag-item");
      if (card) card.classList.add("dragging");
    });
    list.addEventListener("dragend", (e) => {
      const card = e.target.closest(".drag-item");
      if (card) card.classList.remove("dragging");
    });

    lane.appendChild(header);
    lane.appendChild(list);
    board.appendChild(lane);
  });

  if (uncategorizedTodos.length || !priorities.length) {
    const lane = el("div", "priority-lane");
    const header = el("div", "priority-lane-header");
    header.style.cssText = "background:var(--bg-3);color:var(--text-2);border:1px solid var(--border);";
    header.innerHTML = `Sans priorité <span style="opacity:.6">(${todos.length})</span>`;

    const list = el("div", "priority-lane-list");
    list.dataset.priority = "";

    (priorities.length ? uncategorizedTodos : todos).forEach((t, i) => {
      const card = buildTodoCard(t);
      card.style.animationDelay = i * 20 + "ms";
      list.appendChild(card);
    });

    list.addEventListener("dragover", (e) => {
      e.preventDefault();
      lane.classList.add("drag-over-lane");
    });
    list.addEventListener("dragleave", () => lane.classList.remove("drag-over-lane"));
    list.addEventListener("drop", (e) => {
      e.preventDefault();
      lane.classList.remove("drag-over-lane");
      const id = document.querySelector(".drag-item.dragging")?.dataset.id;
      if (id && id !== "") {
        updateTodo(id, { priorityId: "" });
        renderPriorityBoard();
        showToast("Priorité retirée");
      }
    });

    list.addEventListener("dragstart", (e) => {
      const card = e.target.closest(".drag-item");
      if (card) card.classList.add("dragging");
    });
    list.addEventListener("dragend", (e) => {
      const card = e.target.closest(".drag-item");
      if (card) card.classList.remove("dragging");
    });

    lane.appendChild(header);
    lane.appendChild(list);
    board.appendChild(lane);
  }
}

// ── Purge des tâches terminées ───────────────────────────

function purgeCompletedTodos() {
  const done = getTodos().filter((t) => t.status === "done");
  if (!done.length) {
    showToast("Aucune tâche terminée à supprimer");
    return;
  }
  confirmDialog(
    `Supprimer définitivement ${done.length} tâche${done.length > 1 ? "s" : ""} terminée${done.length > 1 ? "s" : ""} ?`,
    () => {
      done.forEach((t) => deleteTodo(t.id));
      render();
      renderFilters();
      showToast(`${done.length} tâche${done.length > 1 ? "s" : ""} supprimée${done.length > 1 ? "s" : ""}`, "success");
    },
  );
}

function _injectTodoTemplateBtn() {
  if (document.getElementById("btn-todo-templates")) return;
  const newBtn = document.getElementById("btn-new-todo");
  if (!newBtn) return;

  const btn = document.createElement("button");
  btn.id = "btn-todo-templates";
  btn.className = "btn btn-ghost btn-templates";
  btn.title = "Créer depuis un modèle";
  btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round">
    <rect x="2" y="2" width="5" height="5" rx="1"/><rect x="9" y="2" width="5" height="5" rx="1"/>
    <rect x="2" y="9" width="5" height="5" rx="1"/><rect x="9" y="9" width="5" height="5" rx="1"/>
  </svg> Modèles`;

  btn.addEventListener("click", () => {
    if (typeof openTemplatePicker === "function") {
      openTemplatePicker("todo", btn, (tpl) => openTodoModal(null, tpl));
    }
  });

  newBtn.insertAdjacentElement("beforebegin", btn);
}
