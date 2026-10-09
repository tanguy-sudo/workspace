// ── storage.js ── CRUD persisté dans IndexedDB (via Dexie / js/db.js) ──
//
// L'API publique reste **synchrone** : les pages attendent WorkspaceDB_READY
// avant de démarrer (cf. chaque pages/*.js). Toutes les lectures se font
// sur le cache mémoire WorkspaceDB.cache ; les écritures sont répercutées
// dans IndexedDB de façon asynchrone et débouncée (cf. db.js).

const STORAGE_KEY = "workspace_data"; // conservé pour migration / rétrocompat

// ── Accès racine ─────────────────────────────────────

function getData() {
  const cached = typeof WorkspaceDB !== "undefined" ? WorkspaceDB.getSync() : null;
  const data = cached ? { ..._defaultData(), ...cached } : _defaultData();
  return typeof WorkspaceDB !== "undefined" && WorkspaceDB.canWrite?.() === false
    ? structuredClone(data)
    : data;
}

function setData(data) {
  if (typeof WorkspaceDB !== "undefined") {
    if (!WorkspaceDB.setSync(data) && typeof showToast === "function") {
      showToast("Lecture seule : une autre fenêtre détient le verrou d’écriture Workspace", "error");
    }
  } else {
    console.error("[storage] WorkspaceDB indisponible — écriture ignorée.");
  }
}

function _defaultData() {
  return {
    projects: [],
    rh: _newFolder("root", "RH"),
    todos: [],
    snippets: [],
    snippetFolders: _newFolder("root", "Snippets"),
    snippetMixedOrder: {},
    favorites: _newFolder("root", "Favoris"),
    recentlyVisited: [],
    journal: [],
    trash: [],
    settings: {
      ..._defaultSettings(),
    },
  };
}

function _defaultSettings() {
  return {
    theme: "dark",
    userName: "",
    siteName: "Workspace",
    backupFolder: "Téléchargements",
    autoBackupFrequencyHours: 168,
    todoSavedViews: [],
    weeklyReview: {
      lastCompletedWeek: "",
    },
    todoPriorities: [
      { id: "urgent", label: "Urgent", color: "#ff5f6e" },
      { id: "important", label: "Important", color: "#f0a030" },
      { id: "normal", label: "Normal", color: "#64b0ff" },
      { id: "basse", label: "Basse", color: "#3d5070" },
    ],
    templates: _defaultTemplates(),
  };
}

// ── Utilitaires arbres ────────────────────────────────────

function _newFolder(id, name) {
  return { id, name, nodeType: "folder", children: [], createdAt: Date.now() };
}

function _newItem(overrides) {
  return { id: uid(), nodeType: "item", createdAt: Date.now(), ...overrides };
}

/** Trouve un nœud par id dans un arbre */
function findNode(tree, id) {
  if (!tree) return null;
  if (tree.id === id) return tree;
  if (tree.children) {
    for (const c of tree.children) {
      const found = findNode(c, id);
      if (found) return found;
    }
  }
  return null;
}

/** Trouve le parent d'un nœud */
function findParent(tree, id) {
  if (!tree || !tree.children) return null;
  if (tree.children.some((c) => c.id === id)) return tree;
  for (const c of tree.children) {
    const found = findParent(c, id);
    if (found) return found;
  }
  return null;
}

/** Ajoute un nœud à un parent */
function addNodeToParent(tree, parentId, node) {
  const parent = findNode(tree, parentId);
  if (!parent || parent.nodeType !== "folder") return false;
  if (!parent.children) parent.children = [];
  parent.children.push(node);
  return true;
}

/** Supprime un nœud */
function removeNodeById(tree, id) {
  const parent = findParent(tree, id);
  if (!parent) return false;
  parent.children = parent.children.filter((c) => c.id !== id);
  return true;
}

/** Met à jour un nœud */
function updateNodeById(tree, id, changes) {
  const node = findNode(tree, id);
  if (!node) return false;
  Object.assign(node, changes);
  return true;
}

/** Compte les enfants d'un dossier */
function countChildren(folder) {
  if (!folder.children) return 0;
  return folder.children.length;
}

// ── Projets ───────────────────────────────────────────────

function getProjects() {
  return getData().projects;
}
function getProject(id) {
  return getData().projects.find((p) => p.id === id);
}

function createProject({ name, color, parentId = null, categories = [] }) {
  const data = getData();
  const id = slugify(name) || uid();
  // Éviter les doublons de slug
  const exists = data.projects.find((p) => p.id === id);
  const finalId = exists ? id + "-" + uid().slice(0, 4) : id;
  const project = {
    id: finalId,
    name,
    color,
    parentId: parentId || null,
    categories: [...new Set((categories || []).map((c) => String(c || "").trim()).filter(Boolean))],
    children: [], // mélange de items et folders
    createdAt: Date.now(),
    lastVisited: Date.now(),
  };
  data.projects.push(project);
  setData(data);
  return project;
}

function updateProject(id, changes) {
  const data = getData();
  const idx = data.projects.findIndex((p) => p.id === id);
  if (idx === -1) return null;
  data.projects[idx] = { ...data.projects[idx], ...changes };
  setData(data);
  return data.projects[idx];
}

function deleteProject(id) {
  const data = getData();
  const item = data.projects.find((p) => p.id === id);
  if (item) {
    const toDelete = new Set([id]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const p of data.projects) {
        if (!toDelete.has(p.id) && toDelete.has(p.parentId || "")) {
          toDelete.add(p.id);
          changed = true;
        }
      }
    }

    data.projects = data.projects.filter((p) => !toDelete.has(p.id));
    data.recentlyVisited = (data.recentlyVisited || []).filter(
      (v) => !(v.type === "project" && toDelete.has(v.id)),
    );
    _moveToTrash(data, item, "project");
  }
  setData(data);
}

function getProjectChildren(parentId = null) {
  const normalizedParentId = parentId || null;
  return getData().projects.filter((p) => (p.parentId || null) === normalizedParentId);
}

function getProjectDescendants(projectId) {
  const all = getData().projects || [];
  const descendants = [];
  const stack = [projectId];

  while (stack.length) {
    const current = stack.pop();
    for (const p of all) {
      if ((p.parentId || null) === current) {
        descendants.push(p);
        stack.push(p.id);
      }
    }
  }
  return descendants;
}

function getProjectAncestors(projectId) {
  const all = getData().projects || [];
  const map = new Map(all.map((p) => [p.id, p]));
  const ancestors = [];
  const seen = new Set();
  let cursor = map.get(projectId);

  while (cursor && cursor.parentId && !seen.has(cursor.parentId)) {
    seen.add(cursor.parentId);
    const parent = map.get(cursor.parentId);
    if (!parent) break;
    ancestors.unshift(parent);
    cursor = parent;
  }

  return ancestors;
}

function convertProjectFolderToSubProject(sourceProjectId, folderId, options = {}) {
  const data = getData();
  const sourceProject = (data.projects || []).find((p) => p.id === sourceProjectId);
  if (!sourceProject) return null;
  const targetParentId = options.parentId || sourceProjectId;
  const parentExists = (data.projects || []).some((p) => p.id === targetParentId);
  if (!parentExists) return null;

  const fakeRoot = {
    id: sourceProjectId,
    nodeType: "folder",
    children: sourceProject.children || [],
  };
  const folder = findNode(fakeRoot, folderId);
  if (!folder || folder.nodeType !== "folder") return null;

  const idBase = slugify(folder.name) || uid();
  const exists = (data.projects || []).find((p) => p.id === idBase);
  const finalId = exists ? idBase + "-" + uid().slice(0, 4) : idBase;

  const newProject = {
    id: finalId,
    name: folder.name,
    color: options.color || sourceProject.color,
    parentId: targetParentId,
    categories: [...new Set([...(sourceProject.categories || []), ...(options.categories || [])].map((c) => String(c || "").trim()).filter(Boolean))],
    children: [...(folder.children || [])],
    createdAt: folder.createdAt || Date.now(),
    lastVisited: Date.now(),
  };

  if (!removeNodeById(fakeRoot, folderId)) return null;
  sourceProject.children = fakeRoot.children;
  data.projects.push(newProject);
  setData(data);
  return newProject;
}

function touchProject(id) {
  const data = getData();
  const p = data.projects.find((p) => p.id === id);
  if (p) {
    p.lastVisited = Date.now();
    setData(data);
  }
}

// ── Catégories de projet ──────────────────────────────────

function addProjectCategory(projectId, catName) {
  const data = getData();
  const p = data.projects.find((p) => p.id === projectId);
  if (!p) return;
  if (!p.categories) p.categories = [];
  if (!p.categories.includes(catName)) p.categories.push(catName);
  setData(data);
}

function removeProjectCategory(projectId, catName) {
  const data = getData();
  const p = data.projects.find((p) => p.id === projectId);
  if (!p) return;
  p.categories = (p.categories || []).filter((c) => c !== catName);
  setData(data);
}

// ── Nœuds dans un projet (items + folders) ────────────────

function addProjectNode(projectId, parentId, node) {
  const data = getData();
  const project = data.projects.find((p) => p.id === projectId);
  if (!project) return null;
  // La racine du projet utilise project.children directement
  const tree = {
    id: projectId,
    children: project.children,
    nodeType: "folder",
  };
  addNodeToParent(tree, parentId || projectId, node);
  project.children = tree.children;
  setData(data);
  if (node.nodeType === 'item') trackActivity('project','create',`Item « ${node.title||node.name} »`,{id:node.id,projectId,icon:'▦',color:'var(--accent)'});
  return node;
}

function updateProjectNode(projectId, nodeId, changes) {
  const data = getData();
  const project = data.projects.find((p) => p.id === projectId);
  if (!project) return null;
  const fakeRoot = {
    id: projectId,
    children: project.children,
    nodeType: "folder",
  };
  updateNodeById(fakeRoot, nodeId, changes);
  project.children = fakeRoot.children;
  setData(data);
}

function deleteProjectNode(projectId, nodeId) {
  const data = getData();
  const project = data.projects.find((p) => p.id === projectId);
  if (!project) return;
  const fakeRoot = {
    id: projectId,
    children: project.children,
    nodeType: "folder",
  };
  const node   = findNode(fakeRoot, nodeId);
  const parent = findParent(fakeRoot, nodeId);
  if (node) {
    removeNodeById(fakeRoot, nodeId);
    project.children = fakeRoot.children;
    _moveToTrash(data, {
      ...node,
      _projectId:   projectId,
      _projectName: project.name,
      _nodeParentId: parent?.id || projectId,
    }, "project-node");
  }
  setData(data);
}

function getProjectNode(projectId, nodeId) {
  const project = getProject(projectId);
  if (!project) return null;
  if (nodeId === projectId)
    return {
      id: projectId,
      children: project.children,
      nodeType: "folder",
      name: project.name,
    };
  const fakeRoot = {
    id: projectId,
    children: project.children,
    nodeType: "folder",
  };
  return findNode(fakeRoot, nodeId);
}

// ── RH ────────────────────────────────────────────────────


/** Déplace un nœud RH vers un dossier cible. */
function moveRhNode(nodeId, targetFolderId) {
  if (nodeId === targetFolderId) return false;
  const data = getData();
  const tree = data.rh;
  // Empêcher de déplacer dans un descendant de lui-même
  const nodeItself = findNode(tree, nodeId);
  if (nodeItself && findNode(nodeItself, targetFolderId)) return false;
  const node = findNode(tree, nodeId);
  if (!node) return false;
  if (!removeNodeById(tree, nodeId)) return false;
  if (!addNodeToParent(tree, targetFolderId, node)) {
    // Rollback : remettre dans root si l'ajout échoue
    tree.children = tree.children || [];
    tree.children.push(node);
  }
  setData(data);
  return true;
}

/** Déplace un nœud de projet vers un dossier cible. */
function moveProjectNode(projectId, nodeId, targetFolderId) {
  if (nodeId === targetFolderId) return false;
  const data  = getData();
  const proj  = (data.projects || []).find((p) => p.id === projectId);
  if (!proj) return false;
  const fakeRoot = { id: projectId, nodeType: "folder", children: proj.children || [] };
  const nodeItself = findNode(fakeRoot, nodeId);
  if (nodeItself && findNode(nodeItself, targetFolderId)) return false;
  const node = findNode(fakeRoot, nodeId);
  if (!node) return false;
  if (!removeNodeById(fakeRoot, nodeId)) return false;
  const target = targetFolderId === projectId ? fakeRoot : findNode(fakeRoot, targetFolderId);
  if (!target || target.nodeType !== "folder") {
    fakeRoot.children.push(node);
  } else {
    target.children = target.children || [];
    target.children.push(node);
  }
  proj.children = fakeRoot.children;
  setData(data);
  return true;
}

function getRhRoot() {
  return getData().rh;
}
function getRhNode(id) {
  return findNode(getRhRoot(), id);
}

function addRhNode(parentId, node) {
  const data = getData();
  if (!data.rh) data.rh = _newFolder("root", "RH");
  addNodeToParent(data.rh, parentId, node);
  setData(data);
  if (node.nodeType === 'document') trackActivity('rh','create',`Document « ${node.title||node.name} »`,{id:node.id,icon:'📄'});
  return node;
}

function updateRhNode(id, changes) {
  const data = getData();
  updateNodeById(data.rh, id, changes);
  setData(data);
  const _urh = findNode(data.rh, id);
  if (_urh?.nodeType === 'document' && !('pinned' in changes)) trackActivity('rh','update',`Document « ${_urh.title||_urh.name} »`,{id,icon:'📄'});
}

function deleteRhNode(id) {
  const data = getData();
  const node = findNode(data.rh, id);
  if (node) {
    const parent = findParent(data.rh, id);
    removeNodeById(data.rh, id);
    data.recentlyVisited = (data.recentlyVisited || []).filter(
      (v) => !(v.type === "rh" && v.id === id),
    );
    _moveToTrash(data, { ...node, _rhParentId: parent?.id || "root" }, "rh");
  }
  setData(data);
}

function touchRhFolder(id) {
  trackVisit("rh", id, getRhNode(id)?.name || "Dossier RH");
}

// ── Todos ─────────────────────────────────────────────────

function getTodos() {
  return getData().todos;
}
function getTodo(id) {
  return getData().todos.find((t) => t.id === id);
}

function _toIsoDow(d) {
  const js = d.getDay();
  return js === 0 ? 7 : js;
}

function _parseIsoDateLocal(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso || ""))) return null;
  const [y, m, d] = String(iso).split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  if (Number.isNaN(dt.getTime())) return null;
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
  return dt;
}

function _formatIsoDateLocal(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function _addDaysLocal(d, days) {
  const out = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  out.setDate(out.getDate() + days);
  return out;
}

function _normalizeTodoRecurrence(recurrence) {
  if (!recurrence || typeof recurrence !== "object") return null;
  const type = String(recurrence.type || "none");
  if (type === "none") return null;

  if (type === "daily") {
    return { type: "daily" };
  }

  if (type === "weekly") {
    const weeklyDays = [...new Set((Array.isArray(recurrence.weeklyDays) ? recurrence.weeklyDays : [])
      .map((n) => Number(n))
      .filter((n) => Number.isInteger(n) && n >= 1 && n <= 7))]
      .sort((a, b) => a - b);
    if (!weeklyDays.length) return null;
    return { type: "weekly", weeklyDays };
  }

  if (type === "monthly_nth_weekday") {
    const nth = Number(recurrence.nth);
    const weekday = Number(recurrence.weekday);
    const validNth = [1, 2, 3, 4, -1];
    if (!validNth.includes(nth)) return null;
    if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7) return null;
    return { type: "monthly_nth_weekday", nth, weekday };
  }

  return null;
}

function _nthWeekdayOfMonth(year, monthIndex, nth, isoWeekday) {
  if (nth === -1) {
    const last = new Date(year, monthIndex + 1, 0);
    const shift = (_toIsoDow(last) - isoWeekday + 7) % 7;
    return new Date(year, monthIndex + 1, -shift);
  }

  const first = new Date(year, monthIndex, 1);
  const offset = (isoWeekday - _toIsoDow(first) + 7) % 7;
  const day = 1 + offset + (nth - 1) * 7;
  const candidate = new Date(year, monthIndex, day);
  if (candidate.getMonth() !== monthIndex) return null;
  return candidate;
}

function _computeNextDateFromRecurrence(anchorDateIso, recurrence) {
  const normalized = _normalizeTodoRecurrence(recurrence);
  const anchor = _parseIsoDateLocal(anchorDateIso);
  if (!normalized || !anchor) return null;

  if (normalized.type === "daily") {
    return _formatIsoDateLocal(_addDaysLocal(anchor, 1));
  }

  if (normalized.type === "weekly") {
    for (let step = 1; step <= 14; step += 1) {
      const candidate = _addDaysLocal(anchor, step);
      if (normalized.weeklyDays.includes(_toIsoDow(candidate))) {
        return _formatIsoDateLocal(candidate);
      }
    }
    return null;
  }

  if (normalized.type === "monthly_nth_weekday") {
    for (let i = 0; i < 18; i += 1) {
      const y = anchor.getFullYear();
      const m = anchor.getMonth() + i;
      const yy = y + Math.floor(m / 12);
      const mm = ((m % 12) + 12) % 12;
      const candidate = _nthWeekdayOfMonth(
        yy,
        mm,
        normalized.nth,
        normalized.weekday,
      );
      if (!candidate) continue;
      if (candidate.getTime() > anchor.getTime()) {
        return _formatIsoDateLocal(candidate);
      }
    }
  }

  return null;
}

function _shiftReminderToDate(reminderAt, dateIso) {
  if (!dateIso || !reminderAt) return "";
  const m = String(reminderAt).match(/T(\d{2}:\d{2})/);
  if (!m) return "";
  return `${dateIso}T${m[1]}`;
}

function _spawnNextRecurringTodo(data, completedTodo) {
  const recurrence = _normalizeTodoRecurrence(completedTodo?.recurrence);
  if (!recurrence) return null;

  const todayIso = _todayISO();
  const reminderDate = String(completedTodo.reminderAt || "").slice(0, 10);
  const anchorDate = completedTodo.dueDate || reminderDate || todayIso;

  let nextDate = _computeNextDateFromRecurrence(anchorDate, recurrence);
  if (!nextDate) return null;

  // Si la tâche est clôturée en retard, on avance jusqu'à la première occurrence future.
  let guard = 0;
  while (nextDate <= todayIso && guard < 400) {
    nextDate = _computeNextDateFromRecurrence(nextDate, recurrence);
    if (!nextDate) return null;
    guard += 1;
  }

  const nextTodo = {
    ...completedTodo,
    id: uid(),
    status: "todo",
    dueDate: completedTodo.dueDate ? nextDate : "",
    reminderAt: completedTodo.reminderAt
      ? _shiftReminderToDate(completedTodo.reminderAt, nextDate)
      : "",
    recurrence,
    createdAt: Date.now(),
  };

  if (!nextTodo.dueDate && !nextTodo.reminderAt) {
    nextTodo.dueDate = nextDate;
  }

  data.todos.push(nextTodo);
  return nextTodo;
}

function createTodo({
  title,
  description = "",
  priorityId = "normal",
  context = "",
  attachedTo = "",
  estimatedTime = 0,
  dependencies = [],
  tags = [],
  dueDate = "",
  reminderAt = "",
  recurrence = null,
  pinned = false,
  status = "todo",
  projectId = "",
}) {
  const data = getData();
  const normalizedEstimatedTime = _normalizeEstimatedTimeMinutes(estimatedTime);
  const todo = {
    id: uid(),
    title,
    description,
    status,
    priorityId,
    context,
    attachedTo: String(attachedTo || "").trim(),
    estimatedTime: normalizedEstimatedTime,
    dependencies,
    tags,
    dueDate,
    reminderAt,
    recurrence: _normalizeTodoRecurrence(recurrence),
    pinned: !!pinned,
    projectId: projectId || "",
    createdAt: Date.now(),
  };
  data.todos.push(todo);
  setData(data);
  trackActivity('todo','create',`Tâche « ${todo.title} »`,{id:todo.id,icon:'✓'});
  return todo;
}

function updateTodo(id, changes) {
  const data = getData();
  const idx = data.todos.findIndex((t) => t.id === id);
  if (idx === -1) return null;

  const before = data.todos[idx];
  const merged = { ...before, ...changes };
  if (Object.prototype.hasOwnProperty.call(changes, "attachedTo")) {
    merged.attachedTo = String(changes.attachedTo || "").trim();
  }
  if (Object.prototype.hasOwnProperty.call(changes, "estimatedTime")) {
    merged.estimatedTime = _normalizeEstimatedTimeMinutes(changes.estimatedTime);
  }
  if (Object.prototype.hasOwnProperty.call(changes, "recurrence")) {
    merged.recurrence = _normalizeTodoRecurrence(changes.recurrence);
  }
  data.todos[idx] = merged;

  if (before.status !== "done" && merged.status === "done") {
    _spawnNextRecurringTodo(data, merged);
  }

  setData(data);
  const _ut = merged;
  if (_ut && changes.status !== 'done') trackActivity('todo','update',`Tâche « ${_ut.title} »`,{id,icon:'✓'});
  return _ut;
}

function deleteTodo(id) {
  const data = getData();
  const item = data.todos.find((t) => t.id === id);
  if (item) {
    data.todos = data.todos.filter((t) => t.id !== id);
    data.todos.forEach((t) => {
      t.dependencies = (t.dependencies || []).filter((d) => d !== id);
    });
    _moveToTrash(data, item, "todo");
  }
  setData(data);
}

// ── Rappels & priorités d'affichage ─────────────────────

function togglePinTodo(id) {
  const t = getTodo(id);
  if (!t) return null;
  return updateTodo(id, { pinned: !t.pinned });
}

function setTodoReminder(id, reminderAt) {
  return updateTodo(id, { reminderAt: reminderAt || "" });
}

/** Date "YYYY-MM-DD" du jour (locale) */
function _todayISO() {
  const d = new Date();
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tz).toISOString().slice(0, 10);
}

/** Timestamp d'échéance d'une tâche (priorité au reminderAt précis, sinon fin de la dueDate) */
function _todoDueTs(t) {
  if (t.reminderAt) {
    const ts = Date.parse(t.reminderAt);
    if (!isNaN(ts)) return ts;
  }
  if (t.dueDate) {
    // fin de journée si date pure
    const ts = Date.parse(t.dueDate + "T23:59:59");
    if (!isNaN(ts)) return ts;
  }
  return null;
}

function getPinnedTodos() {
  return getTodos()
    .filter((t) => t.pinned && t.status !== "done")
    .sort((a, b) => (_todoDueTs(a) ?? Infinity) - (_todoDueTs(b) ?? Infinity));
}

function getDueTodayTodos() {
  const today = _todayISO();
  const start = Date.parse(today + "T00:00:00");
  const end = Date.parse(today + "T23:59:59");
  return getTodos()
    .filter((t) => t.status !== "done")
    .filter((t) => {
      const ts = _todoDueTs(t);
      if (ts == null) return false;
      return ts >= start && ts <= end;
    })
    .sort((a, b) => (_todoDueTs(a) ?? 0) - (_todoDueTs(b) ?? 0));
}

function getOverdueTodos() {
  const today = _todayISO();
  return getTodos()
    .filter((t) => t.status !== "done")
    .filter((t) => !!t.dueDate && t.dueDate < today)
    .sort((a, b) => (a.dueDate || "").localeCompare(b.dueDate || ""));
}

function getUpcomingReminders(withinMs = 7 * 24 * 60 * 60 * 1000) {
  const now = Date.now();
  return getTodos()
    .filter((t) => t.status !== "done" && t.reminderAt)
    .map((t) => ({ todo: t, ts: Date.parse(t.reminderAt) }))
    .filter((r) => !isNaN(r.ts) && r.ts >= now && r.ts <= now + withinMs)
    .sort((a, b) => a.ts - b.ts);
}

function _sameDay(a, b) {
  const da = new Date(a),
    db = new Date(b);
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}

// ── Snippets ──────────────────────────────────────────────


/**
 * Réordonne les snippets selon la liste d'IDs fournie.
 * Les snippets absents de la liste sont placés à la fin.
 */

/** Réordonne les enfants directs d'un nœud RH. */
function reorderRhChildren(parentId, orderedIds) {
  const data = getData();
  const parent = parentId === "root" ? data.rh : findNode(data.rh, parentId);
  if (!parent) return;
  const byId = new Map((parent.children || []).map((c) => [c.id, c]));
  parent.children = [
    ...orderedIds.map((id) => byId.get(id)).filter(Boolean),
    ...(parent.children || []).filter((c) => !orderedIds.includes(c.id)),
  ];
  setData(data);
}

/** Réordonne les enfants directs d'un nœud de projet. */
function reorderProjectChildren(projectId, parentId, orderedIds) {
  const data = getData();
  const proj = (data.projects || []).find((p) => p.id === projectId);
  if (!proj) return;
  const fakeRoot = { id: projectId, nodeType: "folder", children: proj.children || [] };
  const parent = parentId === projectId ? fakeRoot : findNode(fakeRoot, parentId);
  if (!parent) return;
  const byId = new Map((parent.children || []).map((c) => [c.id, c]));
  parent.children = [
    ...orderedIds.map((id) => byId.get(id)).filter(Boolean),
    ...(parent.children || []).filter((c) => !orderedIds.includes(c.id)),
  ];
  proj.children = fakeRoot.children;
  setData(data);
}

/** Réordonne les enfants directs d'un dossier de favoris. */
function reorderFavChildren(parentId, orderedIds) {
  const data = getData();
  const parent = parentId === "root" ? data.favorites : findNode(data.favorites, parentId);
  if (!parent) return;
  const byId = new Map((parent.children || []).map((c) => [c.id, c]));
  parent.children = [
    ...orderedIds.map((id) => byId.get(id)).filter(Boolean),
    ...(parent.children || []).filter((c) => !orderedIds.includes(c.id)),
  ];
  setData(data);
}

/** Réordonne les sous-dossiers directs d'un dossier de snippets. */
function reorderSnippetFolderChildren(parentId, orderedIds) {
  const data = getData();
  if (!data.snippetFolders) return;
  const parent = parentId === "root"
    ? data.snippetFolders
    : findNode(data.snippetFolders, parentId);
  if (!parent) return;
  const byId = new Map((parent.children || []).map((c) => [c.id, c]));
  parent.children = [
    ...orderedIds.map((id) => byId.get(id)).filter(Boolean),
    ...(parent.children || []).filter((c) => !orderedIds.includes(c.id)),
  ];
  setData(data);
}

function reorderSnippets(orderedIds) {
  const data  = getData();
  const snips = data.snippets || [];
  const idxMap = new Map(orderedIds.map((id, i) => [id, i]));
  data.snippets = [
    ...orderedIds.map((id) => snips.find((s) => s.id === id)).filter(Boolean),
    ...snips.filter((s) => !idxMap.has(s.id)),
  ];
  setData(data);
}

function _snippetOrderFolderKey(folderId) {
  return folderId && folderId !== "root" ? folderId : "root";
}

/**
 * Retourne l'ordre mixte (dossiers + snippets) d'un dossier snippets.
 * Format des tokens: "f:<folderId>" | "s:<snippetId>"
 */
function getSnippetMixedOrder(folderId = "root") {
  const data = getData();
  const key = _snippetOrderFolderKey(folderId);
  const root = data.snippetFolders || getSnippetFoldersRoot();
  const parent = key === "root" ? root : findNode(root, key);
  if (!parent) return [];

  const directFolderIds = (parent.children || [])
    .filter((c) => c.nodeType === "folder")
    .map((c) => c.id);
  const parentSnippetFolderId = key === "root" ? null : key;
  const directSnippetIds = (data.snippets || [])
    .filter((s) => (s.folderId || null) === parentSnippetFolderId)
    .map((s) => s.id);

  const validTokens = [
    ...directFolderIds.map((id) => `f:${id}`),
    ...directSnippetIds.map((id) => `s:${id}`),
  ];
  const validSet = new Set(validTokens);
  const stored = ((data.snippetMixedOrder || {})[key] || []).filter((t) => validSet.has(t));
  const missing = validTokens.filter((t) => !stored.includes(t));
  return [...stored, ...missing];
}

/** Persist l'ordre mixte d'un dossier snippets. */
function setSnippetMixedOrder(folderId = "root", orderedTokens = []) {
  const data = getData();
  const key = _snippetOrderFolderKey(folderId);
  const current = getSnippetMixedOrder(key);
  const validSet = new Set(current);
  const compact = (orderedTokens || []).filter((t) => validSet.has(t));
  const missing = current.filter((t) => !compact.includes(t));
  if (!data.snippetMixedOrder) data.snippetMixedOrder = {};
  data.snippetMixedOrder[key] = [...compact, ...missing];
  setData(data);
}


/**
 * Déplace un dossier de snippets dans un autre dossier.
 * Protège contre les cycles (impossible de déposer dans un descendant).
 */
function moveSnippetFolder(srcFolderId, targetFolderId) {
  if (srcFolderId === targetFolderId) return false;
  const data = getData();
  const root = data.snippetFolders || getSnippetFoldersRoot();
  const srcNode = findNode(root, srcFolderId);
  if (!srcNode) return false;
  if (findNode(srcNode, targetFolderId)) return false; // anti-cycle
  if (!removeNodeById(root, srcFolderId)) return false;
  const target = targetFolderId === "root" ? root : findNode(root, targetFolderId);
  if (!target) { root.children = root.children || []; root.children.push(srcNode); }
  else { target.children = target.children || []; target.children.push(srcNode); }
  data.snippetFolders = root;
  setData(data);
  return true;
}

function getSnippets() {
  return getData().snippets;
}
function getSnippet(id) {
  return getData().snippets.find((s) => s.id === id);
}

function createSnippet({
  title,
  code,
  language,
  tags = [],
  favorite = false,
  folderId = null,
}) {
  const data = getData();
  const snippet = {
    id: uid(),
    title,
    code,
    language,
    tags,
    favorite,
    folderId: folderId && folderId !== "root" ? folderId : null,
    createdAt: Date.now(),
  };
  data.snippets.push(snippet);
  setData(data);
  trackActivity('snippet','create',`Snippet « ${snippet.title} »`,{id:snippet.id,icon:'</>',color:'var(--accent)'});
  return snippet;
}

function updateSnippet(id, changes) {
  const data = getData();
  const idx = data.snippets.findIndex((s) => s.id === id);
  if (idx === -1) return null;
  data.snippets[idx] = { ...data.snippets[idx], ...changes };
  setData(data);
  const _us = data.snippets[idx];
  if (_us) trackActivity('snippet','update',`Snippet « ${_us.title} »`,{id,icon:'</>',color:'var(--accent)'});
  return _us;
}

function deleteSnippet(id) {
  const data = getData();
  const item = data.snippets.find((s) => s.id === id);
  if (item) {
    data.snippets = data.snippets.filter((s) => s.id !== id);
    _moveToTrash(data, item, "snippet");
  }
  setData(data);
}

// ── Dossiers de snippets (hiérarchie) ─────────────────────

function getSnippetFoldersRoot() {
  const data = getData();
  if (!data.snippetFolders) {
    data.snippetFolders = _newFolder("root", "Snippets");
    setData(data);
  }
  return data.snippetFolders;
}

function getSnippetFolder(id) {
  if (!id || id === "root") return getSnippetFoldersRoot();
  return findNode(getSnippetFoldersRoot(), id);
}

function addSnippetFolder(parentId, name) {
  const data = getData();
  if (!data.snippetFolders)
    data.snippetFolders = _newFolder("root", "Snippets");
  const folder = {
    id: uid(),
    nodeType: "folder",
    name,
    children: [],
    createdAt: Date.now(),
  };
  addNodeToParent(data.snippetFolders, parentId || "root", folder);
  setData(data);
  return folder;
}

function renameSnippetFolder(id, name) {
  const data = getData();
  if (!data.snippetFolders) return;
  updateNodeById(data.snippetFolders, id, { name });
  setData(data);
}

function updateSnippetFolder(id, changes) {
  const data = getData();
  if (!data.snippetFolders) return;
  updateNodeById(data.snippetFolders, id, changes);
  setData(data);
}

/** Supprime un dossier et déplace ses snippets + sous-dossiers vers le parent.
 *  Si removeContent=true, supprime aussi tous les snippets contenus. */
function deleteSnippetFolder(id, removeContent = false) {
  const data = getData();
  if (!data.snippetFolders) return;
  const folder = findNode(data.snippetFolders, id);
  if (!folder) return;
  const parent = findParent(data.snippetFolders, id);
  const parentId = parent ? parent.id : "root";

  // Collecter tous les ids de dossiers (folder + descendants)
  const descendantIds = [];
  (function collect(n) {
    descendantIds.push(n.id);
    (n.children || []).forEach(collect);
  })(folder);

  if (removeContent) {
    // Supprimer tous les snippets dont folderId est dans la liste
    data.snippets = data.snippets.filter(
      (s) => !descendantIds.includes(s.folderId),
    );
  } else {
    // Réaffecter les snippets au parent
    data.snippets.forEach((s) => {
      if (descendantIds.includes(s.folderId))
        s.folderId = parentId === "root" ? null : parentId;
    });
    // Remonter les sous-dossiers directs vers le parent
    if (parent) {
      (folder.children || []).forEach((child) => parent.children.push(child));
    }
  }

  // Retirer le dossier de son parent
  removeNodeById(data.snippetFolders, id);
  setData(data);
}

function moveSnippetToFolder(snippetId, folderId) {
  const data = getData();
  const s = data.snippets.find((x) => x.id === snippetId);
  if (!s) return false;
  if (folderId && folderId !== "root" && !findNode(data.snippetFolders || getSnippetFoldersRoot(), folderId))
    return false;
  s.folderId = folderId && folderId !== "root" ? folderId : null;
  setData(data);
  return true;
}

/** Construit le chemin (stack d'ids) de la racine jusqu'au dossier cible */
function buildSnippetFolderStack(targetId) {
  if (!targetId || targetId === "root") return ["root"];
  const root = getSnippetFoldersRoot();
  function search(node, target, path) {
    if (node.id === target) return [...path, node.id];
    for (const c of node.children || []) {
      if (c.nodeType !== "folder") continue;
      const found = search(c, target, [...path, node.id]);
      if (found) return found;
    }
    return null;
  }
  return search(root, targetId, []) || ["root"];
}

/** Liste plate { id, name, depth } de tous les dossiers (pour selects) */
function listAllSnippetFolders() {
  const root = getSnippetFoldersRoot();
  const out = [];
  (function walk(node, depth) {
    out.push({ id: node.id, name: node.name, depth });
    (node.children || [])
      .filter((c) => c.nodeType === "folder")
      .forEach((c) => walk(c, depth + 1));
  })(root, 0);
  return out;
}

// ── Favoris ───────────────────────────────────────────────


/** Déplace un favori (lien ou dossier) dans un dossier cible. */
function moveFavNode(nodeId, targetFolderId) {
  if (nodeId === targetFolderId) return false;
  const data = getData();
  const root = data.favorites;
  if (!root) return false;
  const srcNode = findNode(root, nodeId);
  if (!srcNode) return false;
  // Anti-cycle : ne pas déposer un dossier dans l'un de ses descendants
  if (srcNode.nodeType === "folder" && findNode(srcNode, targetFolderId)) return false;
  if (!removeNodeById(root, nodeId)) return false;
  const target = targetFolderId === "root" ? root : findNode(root, targetFolderId);
  if (!target || target.nodeType !== "folder") {
    root.children = root.children || [];
    root.children.push(srcNode);
  } else {
    target.children = target.children || [];
    target.children.push(srcNode);
  }
  setData(data);
  return true;
}

function getFavRoot() {
  return getData().favorites || _newFolder("root", "Favoris");
}

function saveFavRoot(root) {
  const data = getData();
  data.favorites = root;
  setData(data);
}

function addFavNode(parentId, node) {
  const data = getData();
  if (!data.favorites) data.favorites = _newFolder("root", "Favoris");
  const newNode = { id: uid(), ...node };
  if (node.nodeType === "folder") newNode.children = [];
  addNodeToParent(data.favorites, parentId, newNode);
  setData(data);
  return newNode;
}

function deleteFavNode(id) {
  const data = getData();
  removeNodeById(data.favorites, id);
  setData(data);
}

function renameFavNode(id, name) {
  const data = getData();
  updateNodeById(data.favorites, id, { name });
  setData(data);
}

function findFavNode(id) {
  return findNode(getFavRoot(), id);
}

// ── Settings ──────────────────────────────────────────────

function getSettings() {
  return { ..._defaultSettings(), ...(getData().settings || {}) };
}

function updateSettings(changes) {
  const data = getData();
  data.settings = {
    ..._defaultSettings(),
    ...(data.settings || {}),
    ...changes,
  };
  setData(data);
}

function getTodoPriorities() {
  return getSettings().todoPriorities || [];
}

function getTodoSavedViews() {
  return getSettings().todoSavedViews || [];
}

function saveTodoSavedView(view) {
  const views = getTodoSavedViews();
  const normalized = {
    id: view?.id || uid(),
    name: String(view?.name || "").trim(),
    filters: {
      status: view?.filters?.status || "all",
      priority: view?.filters?.priority || "all",
      context: view?.filters?.context || "all",
      project: view?.filters?.project || "all",
      due: view?.filters?.due || "all",
    },
    viewMode: view?.viewMode || "columns",
    createdAt: Number(view?.createdAt) || Date.now(),
    updatedAt: Date.now(),
  };
  const nextViews = views.filter((entry) => entry.id !== normalized.id);
  nextViews.push(normalized);
  updateSettings({ todoSavedViews: nextViews.sort((a, b) => a.name.localeCompare(b.name, "fr", { sensitivity: "base" })) });
  return normalized;
}

function deleteTodoSavedView(id) {
  updateSettings({ todoSavedViews: getTodoSavedViews().filter((view) => view.id !== id) });
}

function getWeeklyReviewState() {
  return {
    lastCompletedWeek: "",
    ...(getSettings().weeklyReview || {}),
  };
}

function updateWeeklyReviewState(changes) {
  updateSettings({
    weeklyReview: {
      ...getWeeklyReviewState(),
      ...(changes || {}),
    },
  });
}

function addTodoPriority({ label, color }) {
  const data = getData();
  const id = slugify(label) || uid();
  const priority = { id, label, color };
  data.settings.todoPriorities = [
    ...(data.settings.todoPriorities || []),
    priority,
  ];
  setData(data);
  return priority;
}

function deleteTodoPriority(id) {
  const data = getData();
  data.settings.todoPriorities = (data.settings.todoPriorities || []).filter(
    (p) => p.id !== id,
  );
  setData(data);
}

// ── Thème ─────────────────────────────────────────────────
// Stocké dans settings.theme (IndexedDB) — plus aucun usage de localStorage.

function getTheme() {
  return getSettings()?.theme || "dark";
}
function setTheme(t) {
  localStorage.setItem("workspace-theme", t);
  updateSettings({ theme: t });
}

// ── Recently Visited ──────────────────────────────────────

function trackVisit(type, id, name, color) {
  const data = getData();
  if (!data.recentlyVisited) data.recentlyVisited = [];
  // Retirer si déjà présent
  data.recentlyVisited = data.recentlyVisited.filter(
    (v) => !(v.type === type && v.id === id),
  );
  data.recentlyVisited.unshift({
    type,
    id,
    name,
    color,
    visitedAt: Date.now(),
  });
  // Garder max 12
  data.recentlyVisited = data.recentlyVisited.slice(0, 12);
  setData(data);
}

function getRecentlyVisited() {
  return getData().recentlyVisited || [];
}

function removeFromRecent(type, id) {
  const data = getData();
  if (!data.recentlyVisited) return;
  data.recentlyVisited = data.recentlyVisited.filter(
    (v) => !(v.type === type && v.id === id),
  );
  setData(data);
}

// ── Utilitaires ───────────────────────────────────────────

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function slugify(str) {
  return (str || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function formatTime(minutes) {
  if (!minutes) return "";
  if (minutes < 60) return `${minutes}min`;
  const h = Math.floor(minutes / 60),
    m = minutes % 60;
  return m ? `${h}h${m}min` : `${h}h`;
}

function timeAgo(ts) {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "à l'instant";
  if (m < 60) return `il y a ${m}min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `il y a ${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `il y a ${d}j`;
  return new Date(ts).toLocaleDateString("fr-FR");
}

// ── Export / Import JSON ──────────────────────────────────

async function saveBlobAsFile(blob, filename, { preferPicker = true } = {}) {
  if (preferPicker && typeof window.showSaveFilePicker === "function") {
    try {
      const options = { suggestedName: filename };
      if (typeof window.WorkspaceDB?.getBackupDirectoryHandle === "function") {
        const dirHandle = await window.WorkspaceDB.getBackupDirectoryHandle();
        if (dirHandle) options.startIn = dirHandle;
      }
      const handle = await window.showSaveFilePicker(options);
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return { saved: true, method: "picker" };
    } catch (error) {
      if (error && error.name === "AbortError") {
        return { saved: false, cancelled: true, method: "picker" };
      }
      console.warn("[saveBlobAsFile] picker unavailable:", error);
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 100);
  return { saved: true, method: "download" };
}

async function exportData() {
  if (typeof WorkspaceDB !== "undefined" && WorkspaceDB.flush) WorkspaceDB.flush();
  const data = getData();
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const stamp = new Date().toISOString().slice(0, 10);
  const result = await saveBlobAsFile(blob, `workspace-${stamp}.json`, { preferPicker: true });
  if (result.saved) showToast("Sauvegarde JSON enregistrée", "success");
}

function importData(json, mode) {
  let imported;
  try {
    imported = JSON.parse(json);
  } catch {
    throw new Error("JSON invalide");
  }

  imported = _normalizeImportedWorkspaceData(imported);

  if (mode === "replace") {
    setData(imported);
  } else if (mode === "merge") {
    const current = getData();
    // Fusionner par id — ajoute ce qui n'existe pas
    if (imported.projects) {
      const existIds = new Set(current.projects.map((p) => p.id));
      imported.projects.forEach((p) => {
        if (!existIds.has(p.id)) current.projects.push(p);
      });
    }
    if (imported.todos) {
      const existIds = new Set(current.todos.map((t) => t.id));
      imported.todos.forEach((t) => {
        if (!existIds.has(t.id)) current.todos.push(t);
      });
    }
    if (imported.snippets) {
      const existIds = new Set(current.snippets.map((s) => s.id));
      imported.snippets.forEach((s) => {
        if (!existIds.has(s.id)) current.snippets.push(s);
      });
    }
    setData(current);
  } else if (mode === "section") {
    // Retourne les sections disponibles pour que l'UI laisse choisir
    return Object.keys(imported).filter((k) =>
      ["projects", "rh", "todos", "snippets"].includes(k),
    );
  }
  return true;
}

function importSection(json, section) {
  let imported;
  try {
    imported = JSON.parse(json);
  } catch {
    throw new Error("JSON invalide");
  }
  const current = getData();
  if (section === "projects" && imported.projects) {
    current.projects = imported.projects;
  }
  if (section === "rh" && imported.rh) {
    current.rh = imported.rh;
  }
  if (section === "todos" && imported.todos) {
    current.todos = _normalizeTodosEstimatedTimeList(imported.todos);
  }
  if (section === "snippets" && imported.snippets) {
    current.snippets = imported.snippets;
  }
  setData(current);
}

function _normalizeEstimatedTimeMinutes(value) {
  if (typeof parseEstimatedTimeExpression === "function") {
    const parsed = parseEstimatedTimeExpression(value);
    return parsed.valid ? parsed.minutes : 0;
  }
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

function _normalizeTodoEstimatedTime(todo) {
  if (!todo || typeof todo !== "object") return todo;
  return {
    ...todo,
    estimatedTime: _normalizeEstimatedTimeMinutes(todo.estimatedTime),
  };
}

function _normalizeTodosEstimatedTimeList(todos) {
  if (!Array.isArray(todos)) return [];
  return todos.map((todo) => _normalizeTodoEstimatedTime(todo));
}

function _normalizeImportedWorkspaceData(payload) {
  if (!payload || typeof payload !== "object") return payload;
  const normalized = { ...payload };
  if (Array.isArray(normalized.todos)) {
    normalized.todos = _normalizeTodosEstimatedTimeList(normalized.todos).map((todo) => ({
      ...todo,
      // Alias legacy `done` -> `status`. On ne fabrique jamais de statut quand
      // `done` est absent : la validation doit pouvoir refuser une tache sans statut.
      ...(todo.status === undefined && typeof todo.done === "boolean"
        ? { status: todo.done === true ? "done" : "todo" }
        : {}),
    }));
  }
  if (Array.isArray(normalized.snippets)) {
    normalized.snippets = normalized.snippets.map((snippet) => ({
      ...snippet,
      title: snippet.title ?? snippet.name ?? "",
      code: snippet.code ?? snippet.content ?? "",
    }));
  }
  if (Array.isArray(normalized.journal)) {
    normalized.journal = normalized.journal.map((entry) => ({
      ...entry,
      content: entry.content ?? entry.note ?? "",
    }));
  }
  return normalized;
}

// ── Stockage ─────────────────────────────────────────────

function getStorageUsage() {
  // Taille sérialisée des données en cache (synchrone).
  // Pour le quota réel du navigateur, voir getStorageQuotaAsync().
  const bytes =
    typeof WorkspaceDB !== "undefined" && WorkspaceDB.bytesUsed
      ? WorkspaceDB.bytesUsed()
      : new Blob([JSON.stringify(getData())]).size;
  return { bytes, label: _formatBytes(bytes) };
}

/** Quota IndexedDB réel (asynchrone). Renvoie { bytes, quota, percent, label, quotaLabel }. */
async function getStorageQuotaAsync() {
  const { bytes, label } = getStorageUsage();
  let quota = 0;
  try {
    if (navigator.storage && navigator.storage.estimate) {
      const est = await navigator.storage.estimate();
      quota = est.quota || 0;
    }
  } catch {}
  const percent = quota > 0 ? Math.min(100, (bytes / quota) * 100) : 0;
  return {
    bytes,
    quota,
    percent,
    label,
    quotaLabel: quota ? _formatBytes(quota) : "—",
  };
}

function _formatBytes(b) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`;
  return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

// ── Date d'échéance helpers ───────────────────────────────

function getDueBadge(dueDate, status) {
  if (!dueDate || status === "done") return null;
  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  if (dueDate < today) return { cls: "overdue", label: "En retard" };
  if (dueDate === today) return { cls: "today", label: "Aujourd'hui" };
  if (dueDate === tomorrow) return { cls: "upcoming", label: "Demain" };
  return {
    cls: "upcoming",
    label: new Date(dueDate + "T00:00:00").toLocaleDateString("fr-FR", {
      day: "2-digit",
      month: "short",
    }),
  };
}

// ── Réordonnancement ─────────────────────────────────────

function reorderTodos(orderedIds) {
  const data = getData();
  const byId = Object.fromEntries(data.todos.map((t) => [t.id, t]));
  const rest = data.todos.filter((t) => !orderedIds.includes(t.id));
  data.todos = [...orderedIds.map((id) => byId[id]).filter(Boolean), ...rest];
  setData(data);
}

// ── Journal ───────────────────────────────────────────────
// Journal de bord personnel : entrées datées, contenu Markdown libre.

function getJournalEntries() {
  const data = getData();
  if (!Array.isArray(data.journal)) {
    data.journal = [];
    setData(data);
  }
  return data.journal;
}

function getJournalEntry(id) {
  return getJournalEntries().find((e) => e.id === id) || null;
}

function createJournalEntry({
  title = "",
  content = "",
  mood = "",
  tags = [],
} = {}) {
  const data = getData();
  if (!Array.isArray(data.journal)) data.journal = [];
  const entry = {
    id: uid(),
    title: title || "",
    content: content || "",
    mood: mood || "",
    tags: tags || [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  data.journal.push(entry);
  setData(data);
  return entry;
}

function updateJournalEntry(id, changes) {
  const data = getData();
  const idx = (data.journal || []).findIndex((e) => e.id === id);
  if (idx === -1) return null;
  data.journal[idx] = {
    ...data.journal[idx],
    ...changes,
    updatedAt: Date.now(),
  };
  setData(data);
  return data.journal[idx];
}

function deleteJournalEntry(id) {
  const data = getData();
  const item = (data.journal || []).find((e) => e.id === id);
  if (item) {
    data.journal = (data.journal || []).filter((e) => e.id !== id);
    _moveToTrash(data, item, "journal");
  }
  setData(data);
}

// ════════════════════════════════════════════════════════════
// BACKUP AUTOMATIQUE
// ════════════════════════════════════════════════════════════

const _BACKUP_KEY = "workspace-last-backup";

/**
 * Vérifie si un backup automatique est nécessaire.
 * Déclenché depuis initPageCommon() à chaque chargement de page.
 * Télécharge silencieusement un JSON et met à jour le timestamp.
 */
async function autoBackupCheck() {
  try {
    const s = getSettings();
    const rawHours = Number(s?.autoBackupFrequencyHours);
    const freqHours = Number.isFinite(rawHours) && rawHours >= 0 ? rawHours : 168;
    if (freqHours === 0) return;
    const intervalMs = freqHours * 60 * 60 * 1000;

    const last = parseInt(localStorage.getItem(_BACKUP_KEY) || "0", 10);
    if (Date.now() - last < intervalMs) return;

    const siteName = (s?.siteName || "Workspace").trim() || "Workspace";
    const folderHint = (s?.backupFolder || "").trim();

    const payload = {
      _meta: {
        app: siteName,
        version: 6,
        exportedAt: new Date().toISOString(),
        auto: true,
        preferredBackupFolder: folderHint,
        autoBackupFrequencyHours: freqHours,
      },
      data: getData(),
    };

    const d     = new Date();
    const stamp =
      d.getFullYear() +
      "-" + String(d.getMonth() + 1).padStart(2, "0") +
      "-" + String(d.getDate()).padStart(2, "0");
    const siteSlug =
      (typeof slugify === "function" && slugify(siteName)) || "workspace";

    const result = await saveBlobAsFile(
      new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }),
      `${siteSlug}-auto-backup-${stamp}.json`,
      { preferPicker: false },
    );

    if (result.saved) {
      localStorage.setItem(_BACKUP_KEY, String(Date.now()));
      showToast("💾 Sauvegarde automatique téléchargée", "success");
    }
  } catch (e) {
    console.warn("[autoBackup]", e);
  }
}

async function saveWorkspaceBackup({ auto = false, preferPicker = true } = {}) {
  const s = getSettings();
  const siteName = (s?.siteName || "Workspace").trim() || "Workspace";
  const folderHint = (s?.backupFolder || "").trim();
  const d = new Date();
  const stamp =
    d.getFullYear() +
    "-" + String(d.getMonth() + 1).padStart(2, "0") +
    "-" + String(d.getDate()).padStart(2, "0");
  const siteSlug =
    (typeof slugify === "function" && slugify(siteName)) || "workspace";

  const payload = {
    _meta: {
      app: siteName,
      version: 6,
      exportedAt: new Date().toISOString(),
      auto: !!auto,
      preferredBackupFolder: folderHint,
      autoBackupFrequencyHours: Number(s?.autoBackupFrequencyHours) || 168,
    },
    data: getData(),
  };

  const result = await saveBlobAsFile(
    new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }),
    auto ? `${siteSlug}-auto-backup-${stamp}.json` : `${siteSlug}-backup-${stamp}.json`,
    { preferPicker },
  );

  if (result.saved) {
    if (auto) localStorage.setItem(_BACKUP_KEY, String(Date.now()));
    showToast(auto ? "💾 Sauvegarde automatique enregistrée" : "Sauvegarde enregistrée", "success");
  }
  return result;
}

async function chooseBackupDirectory() {
  if (typeof window.showDirectoryPicker !== "function") {
    showToast("Le navigateur ne supporte pas le choix de dossier natif.", "error");
    return null;
  }

  try {
    const handle = await window.showDirectoryPicker({ mode: "readwrite" });
    if (typeof window.WorkspaceDB?.setBackupDirectoryHandle === "function") {
      await window.WorkspaceDB.setBackupDirectoryHandle(handle);
    }
    return handle;
  } catch (e) {
    if (e && e.name !== "AbortError") console.warn("[chooseBackupDirectory]", e);
    return null;
  }
}

async function getBackupDirectoryLabel() {
  if (typeof window.WorkspaceDB?.getBackupDirectoryHandle !== "function") return "Téléchargements";
  const handle = await window.WorkspaceDB.getBackupDirectoryHandle();
  return handle?.name || "Téléchargements";
}


// ── Journal d'activité ────────────────────────────────────
// Enregistre les mutations (création, modification, suppression).

/**
 * Loggue une action utilisateur dans le journal d'activité.
 * @param {"todo"|"snippet"|"rh"|"project"|"journal"} type
 * @param {"create"|"update"|"delete"} action
 * @param {string} label  Libellé lisible (ex: "Tâche « Mon titre »")
 * @param {object} [opts] { id, projectId, icon, color }
 */
function trackActivity(type, action, label, opts = {}) {
  try {
    const data = getData();
    if (!data.activityLog) data.activityLog = [];
    data.activityLog.unshift({
      type, action, label,
      id:        opts.id,
      projectId: opts.projectId,
      icon:      opts.icon,
      color:     opts.color,
      ts: Date.now(),
    });
    data.activityLog = data.activityLog.slice(0, 40);
    setData(data);
  } catch (_) {}
}

function getActivityLog() {
  return getData().activityLog || [];
}

// ── Corbeille (soft-delete) ──────────────────────────────

const _TRASH_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 jours

/** Déplace un item dans data.trash (appelé depuis les fonctions delete). */
function _moveToTrash(data, item, type) {
  if (!Array.isArray(data.trash)) data.trash = [];
  data.trash.push({ ...item, _trashType: type, _deletedAt: Date.now() });
}

/** Retourne tous les éléments en corbeille, du plus récent au plus ancien. */
function getTrash() {
  return [...(getData().trash || [])].sort((a, b) => b._deletedAt - a._deletedAt);
}

/** Restaure un élément depuis la corbeille vers son tableau d'origine. */
function restoreFromTrash(id) {
  const data = getData();
  data.trash = data.trash || [];
  const idx = data.trash.findIndex((i) => i.id === id);
  if (idx === -1) return null;
  const { _trashType, _deletedAt, _rhParentId, ...item } = data.trash[idx];
  data.trash.splice(idx, 1);
  switch (_trashType) {
    case "todo":
      data.todos.push(item);
      break;
    case "project":
      data.projects.push(item);
      break;
    case "journal":
      data.journal = data.journal || [];
      data.journal.push(item);
      break;
    case "snippet":
      data.snippets.push(item);
      break;
    case "rh": {
      // Tente de ré-insérer dans le parent d'origine ; sinon à la racine
      const targetParentId = _rhParentId || "root";
      const added = addNodeToParent(data.rh, targetParentId, item);
      if (!added) addNodeToParent(data.rh, "root", item);
      break;
    }
    case "project-node": {
      const { _projectId, _projectName, _nodeParentId, ...node } = item;
      const proj = data.projects.find((p) => p.id === _projectId);
      if (proj) {
        const fakeRoot = { id: _projectId, children: proj.children, nodeType: "folder" };
        const added = addNodeToParent(fakeRoot, _nodeParentId, node);
        if (!added) addNodeToParent(fakeRoot, _projectId, node);
        proj.children = fakeRoot.children;
      }
      break;
    }
  }
  setData(data);
  return { ...item, _trashType };
}

/** Supprime définitivement un élément de la corbeille. */
function permanentlyDelete(id) {
  const data = getData();
  data.trash = (data.trash || []).filter((i) => i.id !== id);
  setData(data);
}

/** Vide toute la corbeille. */
function emptyTrash() {
  const data = getData();
  data.trash = [];
  setData(data);
}

/** Purge automatique des éléments de plus de 30 jours. */
function purgeOldTrash() {
  const data = getData();
  const before = (data.trash || []).length;
  const cutoff = Date.now() - _TRASH_TTL_MS;
  data.trash = (data.trash || []).filter((i) => i._deletedAt > cutoff);
  if (data.trash.length !== before) setData(data);
}

/** Nombre d'éléments actuellement en corbeille. */
function getTrashCount() {
  return (getData().trash || []).length;
}

// ── Templates ─────────────────────────────────────────────

function _defaultTemplates() {
  return [
    // ── Journal ──
    {
      id: "tpl-standup",
      name: "Standup",
      type: "journal",
      icon: "🗣️",
      title: "Standup {{date}}",
      content: "## ✅ Hier\n\n- \n\n## 🎯 Aujourd'hui\n\n- \n\n## 🚧 Blocages\n\n- ",
      mood: "good",
      tags: ["standup"],
    },
    {
      id: "tpl-retro",
      name: "Rétrospective",
      type: "journal",
      icon: "🔄",
      title: "Rétro — {{date}}",
      content: "## 💚 Ce qui a bien marché\n\n- \n\n## 🔴 Ce qui n'a pas marché\n\n- \n\n## 💡 À améliorer\n\n- \n\n## 🎯 Actions pour la suite\n\n- ",
      mood: "neutral",
      tags: ["retro"],
    },
    {
      id: "tpl-cr",
      name: "Compte-rendu",
      type: "journal",
      icon: "📝",
      title: "CR — {{date}}",
      content: "## 👥 Participants\n\n- \n\n## 📋 Ordre du jour\n\n- \n\n## 📌 Points abordés\n\n- \n\n## ✅ Décisions prises\n\n- \n\n## 🔜 Actions à suivre\n\n| Action | Responsable | Deadline |\n|--------|-------------|----------|\n| | | |",
      mood: "",
      tags: ["réunion"],
    },
    {
      id: "tpl-weekly",
      name: "Revue hebdo",
      type: "journal",
      icon: "📅",
      title: "Semaine du {{date}}",
      content: "## 🏆 Victoires de la semaine\n\n- \n\n## 📊 Avancement des projets\n\n- \n\n## 📚 Apprentissages\n\n- \n\n## 🎯 Objectifs semaine prochaine\n\n- ",
      mood: "good",
      tags: ["hebdo"],
    },
    // ── Tâches ──
    {
      id: "tpl-bug",
      name: "Correction de bug",
      type: "todo",
      icon: "🐛",
      title: "Fix : ",
      priorityId: "urgent",
      estimatedTime: 60,
      context: "@pc",
      tags: ["bug"],
    },
    {
      id: "tpl-review",
      name: "Revue de code",
      type: "todo",
      icon: "🔍",
      title: "Review : ",
      priorityId: "important",
      estimatedTime: 30,
      context: "@pc",
      tags: ["review"],
    },
    {
      id: "tpl-doc",
      name: "Documentation",
      type: "todo",
      icon: "📖",
      title: "Doc : ",
      priorityId: "normal",
      estimatedTime: 45,
      context: "",
      tags: ["doc"],
    },
    {
      id: "tpl-prod",
      name: "Mise en prod",
      type: "todo",
      icon: "🚀",
      title: "Mise en prod : ",
      priorityId: "important",
      estimatedTime: 90,
      context: "@pc",
      tags: ["prod", "release"],
    },
    {
      id: "tpl-ticket",
      name: "Ticket incident / demande",
      type: "todo",
      icon: "🎫",
      title: "Ticket : ",
      priorityId: "important",
      estimatedTime: 45,
      context: "@support",
      tags: ["ticket", "incident", "support"],
    },
  ];
}

/** Retourne tous les templates. */
function getTemplates() {
  return getSettings().templates || [];
}

/** Retourne les templates filtrés par type ("todo" | "journal"). */
function getTemplatesByType(type) {
  return getTemplates().filter((t) => t.type === type);
}

/** Crée un nouveau template et le stocke dans settings. */
function createTemplate(data) {
  const tpl = { id: uid(), ...data };
  updateSettings({ templates: [...getTemplates(), tpl] });
  return tpl;
}

/** Met à jour un template existant. */
function updateTemplate(id, changes) {
  updateSettings({
    templates: getTemplates().map((t) => (t.id === id ? { ...t, ...changes } : t)),
  });
}

/** Supprime un template. */
function deleteTemplate(id) {
  updateSettings({ templates: getTemplates().filter((t) => t.id !== id) });
}

/** Applique l'interpolation {{date}} et {{time}} sur les champs texte d'un template. */
function applyTemplateVars(tpl) {
  const now = new Date();
  const dateStr = now.toLocaleDateString("fr-FR", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });
  const timeStr = now.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  const replace = (s) =>
    (s || "").replace(/\{\{date\}\}/gi, dateStr).replace(/\{\{time\}\}/gi, timeStr);
  return {
    ...tpl,
    title:   replace(tpl.title),
    content: replace(tpl.content),
  };
}

/** S'assure que les templates par défaut sont présents (migration). */
function _ensureDefaultTemplates() {
  const existing = getTemplates();
  if (existing.length === 0) {
    updateSettings({ templates: _defaultTemplates() });
    return;
  }

  // Migration non destructive: ajoute uniquement les modèles par défaut absents.
  const defaultTemplates = _defaultTemplates();
  const existingIds = new Set(existing.map((tpl) => tpl.id));
  const missingDefaults = defaultTemplates.filter((tpl) => !existingIds.has(tpl.id));
  if (missingDefaults.length) {
    updateSettings({ templates: [...existing, ...missingDefaults] });
  }
}
