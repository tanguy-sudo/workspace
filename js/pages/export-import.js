// @ts-check
// ── pages/export-import.js ──
// Gestion de l'import de sauvegarde JSON.
// Dépendances : getData, setData, escHtml, showToast (globals)

// ── Point d'entrée ───────────────────────────────────────

function _isPlainObject(v) {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function _isFolderTree(v) {
  return _isPlainObject(v) && v.nodeType === "folder" && Array.isArray(v.children);
}

function _sanitizeArrayItemsWithId(items) {
  if (!Array.isArray(items)) return [];
  return items.filter((item) => _isPlainObject(item) && typeof item.id === "string" && item.id);
}

function _sanitizeObjectMap(value) {
  return _isPlainObject(value) ? value : null;
}

function _looksLikeFullWorkspace(v) {
  if (!_isPlainObject(v)) return false;
  const required = [
    "projects",
    "rh",
    "todos",
    "snippets",
    "snippetFolders",
    "favorites",
    "settings",
  ];
  return required.every((k) => Object.prototype.hasOwnProperty.call(v, k));
}

const MAX_IMPORT_BYTES = 16 * 1024 * 1024;
const MAX_IMPORT_STRING_LENGTH = 1_000_000;
const MAX_IMPORT_DATA_URL_LENGTH = Math.ceil((4 * 1024 * 1024 * 4) / 3) + 128;
const MAX_IMPORT_TREE_DEPTH = 64;
const MIN_VAULT_ITERATIONS = 100000;
const MAX_VAULT_ITERATIONS = 1000000;
let _importInProgress = false;

function _importFail(path, message) {
  throw new Error(`Import invalide : ${path} ${message}`);
}

function _importObject(value, path) {
  if (!_isPlainObject(value)) _importFail(path, "doit être un objet");
  return value;
}

function _importArray(value, path) {
  if (!Array.isArray(value)) _importFail(path, "doit être un tableau");
  return value;
}

function _importText(value, path, nonEmpty = false, maxLength = MAX_IMPORT_STRING_LENGTH) {
  if (typeof value !== "string") _importFail(path, "doit être une chaîne");
  if (nonEmpty && !value.trim()) _importFail(path, "doit être renseigné");
  if (value.length > maxLength) _importFail(path, "dépasse la longueur maximale");
  return value;
}

function _importNumber(value, path) {
  if (typeof value !== "number" || !Number.isFinite(value)) _importFail(path, "doit être un nombre fini");
  return value;
}

function _importOptionalStrings(value, path, keys) {
  keys.forEach((key) => {
    if (value[key] !== undefined) _importText(value[key], `${path}.${key}`);
  });
}

function _validateImportMetadata(value) {
  const metadata = _importObject(value, "_meta");
  _importText(metadata.app, "_meta.app", true);
  if (metadata.version !== 6) _importFail("_meta.version", "est une version non prise en charge");
  const exportedAt = _importText(metadata.exportedAt, "_meta.exportedAt", true);
  if (Number.isNaN(Date.parse(exportedAt))) _importFail("_meta.exportedAt", "doit être une date valide");
}

function _importStringArray(value, path) {
  _importArray(value, path).forEach((entry, index) => _importText(entry, `${path}[${index}]`));
}

function _importBase64(value, path, expectedBytes, minimumBytes = 0) {
  const encoded = _importText(value, path, true);
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) {
    _importFail(path, "doit être du Base64 valide");
  }
  let bytes;
  try {
    bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
  } catch (_) {
    _importFail(path, "doit être du Base64 valide");
  }
  if (bytes.length < minimumBytes) _importFail(path, "est trop court");
  if (expectedBytes !== undefined && bytes.length !== expectedBytes) _importFail(path, "a une taille inattendue");
  return bytes;
}

function _validateImportFile(value, path) {
  const file = _importObject(value, path);
  _importText(file.name, `${path}.name`, true);
  _importText(file.mime, `${path}.mime`);
  const size = _importNumber(file.size, `${path}.size`);
  if (!Number.isInteger(size) || size < 0 || size > 4 * 1024 * 1024) _importFail(`${path}.size`, "dépasse la limite autorisée");
  const dataUrl = _importText(file.base64, `${path}.base64`, false, MAX_IMPORT_DATA_URL_LENGTH);
  const comma = dataUrl.indexOf(",");
  if (!dataUrl.startsWith("data:") || comma < 0 || !dataUrl.slice(0, comma).includes(";base64")) {
    _importFail(`${path}.base64`, "doit être une URL de données Base64");
  }
  if (_importBase64(dataUrl.slice(comma + 1), `${path}.base64`).length !== size) {
    _importFail(`${path}.base64`, "ne correspond pas à la taille déclarée");
  }
}

function _validateImportEncrypted(value, path) {
  const payload = _importObject(value, path);
  _importBase64(payload.iv, `${path}.iv`, 12);
  _importBase64(payload.cipher, `${path}.cipher`, undefined, 16);
}

function _validateImportNode(value, path, kind, seen, ancestors) {
  const node = _importObject(value, path);
  if (ancestors.size >= MAX_IMPORT_TREE_DEPTH) _importFail(path, "dépasse la profondeur maximale");
  const id = _importText(node.id, `${path}.id`, true);
  if (ancestors.has(id)) _importFail(path, "contient une boucle");
  if (seen.has(id)) _importFail(path, "contient un identifiant dupliqué");
  seen.add(id);
  const nodeType = _importText(node.nodeType, `${path}.nodeType`);
  if (nodeType === "folder") {
    _importText(node.name, `${path}.name`);
    const nextAncestors = new Set(ancestors);
    nextAncestors.add(id);
    _importArray(node.children, `${path}.children`).forEach((child, index) => _validateImportNode(child, `${path}.children[${index}]`, kind, seen, nextAncestors));
    return;
  }
  if (kind === "projects") {
    if (nodeType !== "item") _importFail(`${path}.nodeType`, "est inconnu");
    if (node.title !== undefined) _importText(node.title, `${path}.title`);
    else _importText(node.name, `${path}.name`, true);
    if (node.type === undefined) _importFail(`${path}.type`, "est obligatoire");
    if (!["link", "memo", "info", "code", "password"].includes(_importText(node.type, `${path}.type`))) _importFail(`${path}.type`, "est inconnu");
    _importOptionalStrings(node, path, ["category", "url", "login", "password", "note", "code", "language"]);
    _validateImportLeafExtras(node, path);
    if (node.secretEncrypted !== undefined && node.secretEncrypted !== null) {
      if (node.type !== "password") _importFail(`${path}.secretEncrypted`, "est réservé aux items password");
      _validateImportEncrypted(node.secretEncrypted, `${path}.secretEncrypted`);
    }
    if (node.children !== undefined) _importFail(`${path}.children`, "est interdit pour un item");
    return;
  }
  const validLeaf = kind === "rh" ? nodeType === "document" : kind === "favorites" ? nodeType === "link" : false;
  if (!validLeaf) _importFail(`${path}.nodeType`, "est inconnu");
  _importText(node.title ?? node.name, `${path}.${node.title !== undefined ? "title" : "name"}`, true);
  if (kind === "favorites") _importText(node.url, `${path}.url`);
  _importOptionalStrings(node, path, ["url", "date", "note"]);
  _validateImportLeafExtras(node, path);
  if (node.children !== undefined) _importFail(`${path}.children`, "est interdit pour un document ou un lien");
}

/** Champs communs aux feuilles d'arbre (item projet, document RH, lien favori). */
function _validateImportLeafExtras(node, path) {
  if (node.tags !== undefined) _importStringArray(node.tags, `${path}.tags`);
  if (node.pinned !== undefined && typeof node.pinned !== "boolean") _importFail(`${path}.pinned`, "doit être un booléen");
  if (node.createdAt !== undefined) _importNumber(node.createdAt, `${path}.createdAt`);
  if (node.file !== undefined && node.file !== null) _validateImportFile(node.file, `${path}.file`);
}

function _validateImportRoot(value, path, kind) {
  const root = _importObject(value, path);
  if (_importText(root.nodeType, `${path}.nodeType`) !== "folder") _importFail(`${path}.nodeType`, "doit valoir folder");
  _importText(root.id, `${path}.id`, true);
  _importText(root.name, `${path}.name`);
  const seen = new Set([root.id]);
  const ancestors = new Set([root.id]);
  _importArray(root.children, `${path}.children`).forEach((child, index) => {
    _validateImportNode(child, `${path}.children[${index}]`, kind, seen, ancestors);
  });
}

function _validateImportArray(value, path) {
  const entries = _importArray(value, path);
  const ids = new Set();
  entries.forEach((entry, index) => {
    const item = _importObject(entry, `${path}[${index}]`);
    const id = _importText(item.id, `${path}[${index}].id`, true);
    if (ids.has(id)) _importFail(`${path}[${index}]`, "contient un identifiant dupliqué");
    ids.add(id);
  });
}

function _validateImportTodo(value, path) {
  const todo = _importObject(value, path);
  _importText(todo.id, `${path}.id`, true);
  _importText(todo.title, `${path}.title`, true);
  if (todo.status !== undefined) {
    if (!["todo", "waitinginfo", "inprogress", "in-progress", "blocked", "done"].includes(_importText(todo.status, `${path}.status`))) {
      _importFail(`${path}.status`, "est inconnu");
    }
  } else if (todo.done !== undefined) {
    if (typeof todo.done !== "boolean") _importFail(`${path}.done`, "doit être un booléen");
  } else {
    _importFail(`${path}.status`, "est obligatoire");
  }
  _importOptionalStrings(todo, path, ["description", "note", "priorityId", "priority", "context", "attachedTo", "dueDate", "reminderAt", "projectId"]);
  if (todo.estimatedTime !== undefined) {
    const value = typeof parseEstimatedTimeExpression === "function"
      ? parseEstimatedTimeExpression(todo.estimatedTime)
      : { valid: typeof todo.estimatedTime === "number" && Number.isFinite(todo.estimatedTime) && todo.estimatedTime >= 0 };
    if (!value.valid) _importFail(`${path}.estimatedTime`, "doit être une durée valide");
  }
  if (todo.dependencies !== undefined) _importStringArray(todo.dependencies, `${path}.dependencies`);
  if (todo.tags !== undefined) _importStringArray(todo.tags, `${path}.tags`);
  if (todo.recurrence !== undefined && todo.recurrence !== null) {
    const recurrence = _importObject(todo.recurrence, `${path}.recurrence`);
    const type = _importText(recurrence.type, `${path}.recurrence.type`);
    if (type === "daily") {
      // No additional fields.
    } else if (type === "weekly") {
      const days = _importArray(recurrence.weeklyDays, `${path}.recurrence.weeklyDays`);
      const seen = new Set();
      days.forEach((day, index) => {
        if (!Number.isInteger(day) || day < 1 || day > 7 || seen.has(day)) _importFail(`${path}.recurrence.weeklyDays[${index}]`, "est invalide");
        seen.add(day);
      });
      if (!days.length) _importFail(`${path}.recurrence.weeklyDays`, "ne doit pas être vide");
    } else if (type === "monthly_nth_weekday") {
      if (![1, 2, 3, 4, -1].includes(recurrence.nth) || !Number.isInteger(recurrence.weekday) || recurrence.weekday < 1 || recurrence.weekday > 7) _importFail(`${path}.recurrence`, "est invalide");
    } else {
      _importFail(`${path}.recurrence.type`, "est inconnu");
    }
  }
  if (todo.pinned !== undefined && typeof todo.pinned !== "boolean") _importFail(`${path}.pinned`, "doit être un booléen");
  ["createdAt", "updatedAt"].forEach((key) => { if (todo[key] !== undefined) _importNumber(todo[key], `${path}.${key}`); });
}

function _validateImportJournal(value, path) {
  const entry = _importObject(value, path);
  _importText(entry.id, `${path}.id`, true);
  if (entry.content === undefined && entry.note === undefined) _importFail(`${path}.content`, "est obligatoire");
  _importOptionalStrings(entry, path, ["content", "note", "title", "mood"]);
  if (entry.tags !== undefined) _importStringArray(entry.tags, `${path}.tags`);
  ["createdAt", "updatedAt"].forEach((key) => { if (entry[key] !== undefined) _importNumber(entry[key], `${path}.${key}`); });
}

function _validateImportHistory(value, path, kind) {
  const entries = _importArray(value, path);
  const ids = new Set();
  entries.forEach((entry, index) => {
    const entryPath = `${path}[${index}]`;
    const record = _importObject(entry, entryPath);
    const id = _importText(record.id, `${entryPath}.id`, true);
    if (ids.has(id)) _importFail(entryPath, "contient un identifiant dupliqué");
    ids.add(id);
    if (kind === "todo") _validateImportTodo(record, entryPath);
    else if (kind === "journal") _validateImportJournal(record, entryPath);
    else {
      if (kind === "snippet") {
        _importText(record.title ?? record.name, `${entryPath}.${record.title !== undefined ? "title" : "name"}`, true);
        _importText(record.code ?? record.content, `${entryPath}.${record.code !== undefined ? "code" : "content"}`);
        _importOptionalStrings(record, entryPath, ["language"]);
        if (record.tags !== undefined) _importStringArray(record.tags, `${entryPath}.tags`);
        if (record.favorite !== undefined && typeof record.favorite !== "boolean") _importFail(`${entryPath}.favorite`, "doit être un booléen");
        if (record.folderId !== undefined && record.folderId !== null) _importText(record.folderId, `${entryPath}.folderId`);
      }
    }
  });
}

function _validateImportTrashEntry(value, path) {
  const entry = _importObject(value, path);
  _importText(entry.id, `${path}.id`, true);
  const type = _importText(entry._trashType, `${path}._trashType`, true);
  _importNumber(entry._deletedAt, `${path}._deletedAt`);
  const payload = { ...entry };
  delete payload._trashType;
  delete payload._deletedAt;
  if (type === "todo") _validateImportTodo(payload, path);
  else if (type === "snippet") _validateImportHistory([payload], path, "snippet");
  else if (type === "journal") _validateImportJournal(payload, path);
  else if (type === "project") _validateImportProject(payload, path, true);
  else if (type === "project-node") {
    _importText(entry._projectId, `${path}._projectId`, true);
    if (entry._nodeParentId !== undefined) _importText(entry._nodeParentId, `${path}._nodeParentId`, true);
    delete payload._projectId;
    delete payload._projectName;
    delete payload._nodeParentId;
    _validateImportNode(payload, path, "projects", new Set(), new Set());
  } else if (type === "rh") {
    if (entry._rhParentId !== undefined) _importText(entry._rhParentId, `${path}._rhParentId`, true);
    delete payload._rhParentId;
    _validateImportNode(payload, path, "rh", new Set(), new Set());
  } else _importFail(`${path}._trashType`, "est inconnu");
}

function _validateImportProject(value, path, full = false) {
  const project = _importObject(value, path);
  _importText(project.id, `${path}.id`, true);
  _importText(project.name, `${path}.name`, true);
  if (project.parentId !== undefined && project.parentId !== null) _importText(project.parentId, `${path}.parentId`, true);
  if (project.categories !== undefined) _importStringArray(project.categories, `${path}.categories`);
  ["favorite", "lockToChildren"].forEach((key) => { if (project[key] !== undefined && typeof project[key] !== "boolean") _importFail(`${path}.${key}`, "doit être un booléen"); });
  ["createdAt", "lastVisited"].forEach((key) => { if (project[key] !== undefined) _importNumber(project[key], `${path}.${key}`); });
  if (full && project.children === undefined) _importFail(`${path}.children`, "est obligatoire");
  if (project.children !== undefined) {
    const seen = new Set([project.id]);
    _importArray(project.children, `${path}.children`).forEach((child, index) => _validateImportNode(child, `${path}.children[${index}]`, "projects", seen, new Set([project.id])));
  }
}

function _validateImportReferences(data) {
  const projects = data.projects || [];
  const projectIds = new Set(projects.map((project) => project.id));
  projects.forEach((project, index) => {
    if (project.parentId !== undefined && project.parentId !== null && !projectIds.has(project.parentId)) {
      _importFail(`projects[${index}].parentId`, "référence un projet absent");
    }
  });
  projects.forEach((project) => {
    const seen = new Set();
    let current = project.id;
    while (current) {
      if (seen.has(current)) _importFail("projects.parentId", "contient une boucle");
      seen.add(current);
      const parent = projects.find((candidate) => candidate.id === current)?.parentId;
      if (typeof parent !== "string" || !parent) break;
      current = parent;
    }
  });

  const todos = data.todos || [];
  const todoIds = new Set(todos.map((todo) => todo.id));
  todos.forEach((todo, index) => {
    (todo.dependencies || []).forEach((dependency, dependencyIndex) => {
      if (!todoIds.has(dependency)) _importFail(`todos[${index}].dependencies[${dependencyIndex}]`, "référence une tâche absente");
      if (dependency === todo.id) _importFail(`todos[${index}].dependencies[${dependencyIndex}]`, "ne peut pas se référencer elle-même");
    });
    if (todo.projectId && !projectIds.has(todo.projectId)) _importFail(`todos[${index}].projectId`, "référence un projet absent");
  });

  const folders = new Set();
  const direct = new Map();
  const collectFolder = (folder) => {
    folders.add(folder.id);
    direct.set(folder.id, new Set((folder.children || []).map((child) => `f:${child.id}`)));
    (folder.children || []).forEach((child) => collectFolder(child));
  };
  if (data.snippetFolders) {
    collectFolder(data.snippetFolders);
    direct.set("root", new Set(direct.get(data.snippetFolders.id) || []));
  }
  const snippets = new Set((data.snippets || []).map((snippet) => snippet.id));
  (data.snippets || []).forEach((snippet) => {
    const folderId = snippet.folderId || "root";
    if (!folders.has(folderId)) _importFail("snippets.folderId", "référence un dossier absent");
    const entries = direct.get(folderId) || new Set();
    entries.add(`s:${snippet.id}`);
    direct.set(folderId, entries);
  });
  Object.entries(data.snippetMixedOrder || {}).forEach(([folderId, entries]) => {
    if (!Array.isArray(entries)) return;
    entries.forEach((token, index) => {
      const [kind, id] = token.split(":", 2);
      const known = kind === "f" ? folders.has(id) : snippets.has(id);
      if (known && folders.has(folderId) && !(direct.get(folderId) || new Set()).has(token)) {
        _importFail(`snippetMixedOrder.${folderId}[${index}]`, "ne correspond pas au contenu direct du dossier");
      }
    });
  });

  const passwordItems = [];
  const collectPasswords = (node) => {
    if (!node || typeof node !== "object") return;
    if (node.nodeType === "item" && node.type === "password") passwordItems.push(node);
    if (node.nodeType === "folder" || node.nodeType === undefined) (node.children || []).forEach(collectPasswords);
  };
  projects.forEach((project) => collectPasswords(project));
  (data.trash || []).forEach((entry) => {
    if (entry._trashType === "project" || entry._trashType === "project-node") collectPasswords(entry);
  });
  const enabled = data.settings?.secretVault?.enabled === true;
  passwordItems.forEach((item) => {
    const encrypted = item.secretEncrypted !== undefined && item.secretEncrypted !== null;
    if (encrypted && !enabled) _importFail("projects", "contient un secret chiffré sans coffre actif");
    if (encrypted && (item.login || item.password)) _importFail("projects", "contient un secret en clair avec secretEncrypted");
    if (enabled && !encrypted && (item.login || item.password)) _importFail("projects", "contient un secret en clair avec coffre actif");
  });
}

function _validateImportSettings(value, path) {
  const settings = _importObject(value, path);
  ["theme", "userName", "siteName", "backupFolder"].forEach((key) => {
    if (settings[key] !== undefined) _importText(settings[key], `${path}.${key}`);
  });
  if (settings.autoBackupFrequencyHours !== undefined) _importNumber(settings.autoBackupFrequencyHours, `${path}.autoBackupFrequencyHours`);
  if (settings.todoSavedViews !== undefined) {
    _validateImportArray(settings.todoSavedViews, `${path}.todoSavedViews`);
    settings.todoSavedViews.forEach((view, index) => {
      const record = _importObject(view, `${path}.todoSavedViews[${index}]`);
      _importText(record.name, `${path}.todoSavedViews[${index}].name`);
      if (record.filters !== undefined) _importObject(record.filters, `${path}.todoSavedViews[${index}].filters`);
    });
  }
  if (settings.todoPriorities !== undefined) {
    _validateImportArray(settings.todoPriorities, `${path}.todoPriorities`);
    settings.todoPriorities.forEach((priority, index) => {
      const record = _importObject(priority, `${path}.todoPriorities[${index}]`);
      _importText(record.label, `${path}.todoPriorities[${index}].label`);
      _importText(record.color, `${path}.todoPriorities[${index}].color`);
    });
  }
  if (settings.templates !== undefined) {
    _validateImportArray(settings.templates, `${path}.templates`);
    settings.templates.forEach((template, index) => {
      const record = _importObject(template, `${path}.templates[${index}]`);
      _importText(record.name, `${path}.templates[${index}].name`);
      _importText(record.type, `${path}.templates[${index}].type`);
    });
  }
  if (settings.weeklyReview !== undefined) {
    const review = _importObject(settings.weeklyReview, `${path}.weeklyReview`);
    if (review.lastCompletedWeek !== undefined) _importText(review.lastCompletedWeek, `${path}.weeklyReview.lastCompletedWeek`);
  }
  if (settings.secretVault !== undefined && settings.secretVault !== null) {
    const vault = _importObject(settings.secretVault, `${path}.secretVault`);
    if (typeof vault.enabled !== "boolean") _importFail(`${path}.secretVault.enabled`, "doit être un booléen");
    if (vault.salt !== undefined) _importBase64(vault.salt, `${path}.secretVault.salt`, 16);
    if (vault.iterations !== undefined && (!Number.isInteger(vault.iterations) || vault.iterations < MIN_VAULT_ITERATIONS || vault.iterations > MAX_VAULT_ITERATIONS)) _importFail(`${path}.secretVault.iterations`, `doit être un entier entre ${MIN_VAULT_ITERATIONS} et ${MAX_VAULT_ITERATIONS}`);
    if (vault.verifier !== undefined) _validateImportEncrypted(vault.verifier, `${path}.secretVault.verifier`);
    if (vault.enabled && (!vault.salt || !vault.iterations || !vault.verifier)) _importFail(`${path}.secretVault`, "coffre actif incomplet");
  }
}

function _validateImportData(data, full = false) {
  const value = _importObject(data, "data");
  if (full && !_looksLikeFullWorkspace(value)) _importFail("data", "sections principales manquantes");
  if (value.projects !== undefined) {
    const projects = _importArray(value.projects, "projects");
    const ids = new Set();
    projects.forEach((project, index) => {
      const id = _importText(_importObject(project, `projects[${index}]`).id, `projects[${index}].id`, true);
      if (ids.has(id)) _importFail(`projects[${index}]`, "contient un identifiant dupliqué");
      ids.add(id);
    });
    const seen = new Set(ids);
    projects.forEach((project, index) => {
      _validateImportProject(project, `projects[${index}]`, full);
      const item = _importObject(project, `projects[${index}]`);
      if (item.parentId !== undefined && item.parentId !== null && !ids.has(item.parentId)) _importFail(`projects[${index}].parentId`, "référence un projet absent");
    });
  }
  if (value.rh !== undefined) _validateImportRoot(value.rh, "rh", "rh");
  if (value.snippetFolders !== undefined) _validateImportRoot(value.snippetFolders, "snippetFolders", "snippets");
  if (value.favorites !== undefined) _validateImportRoot(value.favorites, "favorites", "favorites");
  if (value.todos !== undefined) _validateImportHistory(value.todos, "todos", "todo");
  if (value.snippets !== undefined) _validateImportHistory(value.snippets, "snippets", "snippet");
  if (value.journal !== undefined) _validateImportHistory(value.journal, "journal", "journal");
  if (value.recentlyVisited !== undefined) {
    const seen = new Set();
    _importArray(value.recentlyVisited, "recentlyVisited").forEach((entry, index) => {
      const path = `recentlyVisited[${index}]`;
      const record = _importObject(entry, path);
      const type = _importText(record.type, `${path}.type`, true);
      const id = _importText(record.id, `${path}.id`, true);
      const key = `${type}:${id}`;
      if (seen.has(key)) _importFail(path, "contient une visite dupliquée");
      seen.add(key);
      _importOptionalStrings(record, path, ["name", "color"]);
      _importNumber(record.visitedAt, `${path}.visitedAt`);
    });
  }
  if (value.activityLog !== undefined) {
    _importArray(value.activityLog, "activityLog").forEach((entry, index) => {
      const path = `activityLog[${index}]`;
      const record = _importObject(entry, path);
      _importText(record.type, `${path}.type`, true);
      _importText(record.action, `${path}.action`, true);
      _importText(record.label, `${path}.label`, true);
      _importOptionalStrings(record, path, ["id", "projectId", "icon", "color"]);
      _importNumber(record.ts, `${path}.ts`);
    });
  }
  if (value.snippetMixedOrder !== undefined) {
    const order = _importObject(value.snippetMixedOrder, "snippetMixedOrder");
    Object.entries(order).forEach(([key, entries]) => {
      _importArray(entries, `snippetMixedOrder.${key}`).forEach((token, index) => {
        if (!/^[fs]:.+$/.test(_importText(token, `snippetMixedOrder.${key}[${index}]`))) _importFail(`snippetMixedOrder.${key}[${index}]`, "est un token invalide");
      });
    });
  }
  if (value.trash !== undefined) {
    _importArray(value.trash, "trash").forEach((entry, index) => _validateImportTrashEntry(entry, `trash[${index}]`));
  }
  if (value.settings !== undefined) _validateImportSettings(value.settings, "settings");
  if (full) _validateImportReferences(value);
}

function _completeImportData(data) {
  const defaults = typeof _defaultData === "function" ? _defaultData() : {
    projects: [], todos: [], snippets: [], journal: [], trash: [], recentlyVisited: [], activityLog: [],
    rh: { id: "root", name: "RH", nodeType: "folder", children: [] },
    snippetFolders: { id: "root", name: "Snippets", nodeType: "folder", children: [] },
    snippetMixedOrder: {}, favorites: { id: "root", name: "Favoris", nodeType: "folder", children: [] }, settings: {},
  };
  const normalized = typeof _normalizeImportedWorkspaceData === "function"
    ? _normalizeImportedWorkspaceData(data)
    : data;
  return {
    ...defaults,
    ...normalized,
    journal: (normalized.journal || []).map((entry) => ({ ...entry, content: entry.content ?? entry.note ?? "" })),
    activityLog: normalized.activityLog || [],
    settings: { ...(typeof _defaultSettings === "function" ? _defaultSettings() : {}), ...(normalized.settings || {}) },
  };
}

async function _saveImportBackup() {
  if (typeof saveBlobAsFile !== "function") return { saved: false };
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const payload = {
    _meta: { app: "Workspace", version: 6, exportedAt: new Date().toISOString(), preImport: true },
    data: getData(),
  };
  return saveBlobAsFile(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }), `workspace-pre-import-${stamp}.json`, { preferPicker: true });
}

function _cloneImportData(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeImportPayload(parsed, filename = "") {
  const raw = parsed?.data ?? parsed;
  const name = (filename || "").toLowerCase();

  // Export complet
  if (_looksLikeFullWorkspace(raw)) return raw;

  // Export section snippets (format { snippets, folders })
  if (_isPlainObject(raw) && (Array.isArray(raw.snippets) || _isFolderTree(raw.folders))) {
    const payload = {};
    if (Array.isArray(raw.snippets)) payload.snippets = raw.snippets;
    if (_isFolderTree(raw.folders)) payload.snippetFolders = raw.folders;
    if (Object.keys(payload).length) return payload;
  }

  // Exports section tableaux
  if (Array.isArray(raw)) {
    if (name.includes("todo")) return { todos: raw };
    if (name.includes("project") || name.includes("projet")) return { projects: raw };
    if (name.includes("journal")) return { journal: raw };
    if (name.includes("snippet")) return { snippets: raw };
  }

  // Exports section arbres (RH / Favoris / Dossiers snippets)
  if (_isFolderTree(raw)) {
    if (name.includes("favori") || name.includes("favorite")) return { favorites: raw };
    if (name.includes("rh")) return { rh: raw };
    if (name.includes("snippet")) return { snippetFolders: raw };
  }

  // Export section paramètres
  if (_isPlainObject(raw) && (name.includes("param") || name.includes("setting"))) {
    return { settings: raw };
  }

  // Payload déjà partiel mais valide (clé(s) connue(s))
  if (_isPlainObject(raw)) {
    const KNOWN_KEYS = [
      "projects",
      "rh",
      "todos",
      "snippets",
      "snippetFolders",
      "favorites",
      "settings",
      "journal",
      "snippetMixedOrder",
      "trash",
      "recentlyVisited",
      "activityLog",
    ];
    const hasKnown = KNOWN_KEYS.some((k) => Object.prototype.hasOwnProperty.call(raw, k));
    if (hasKnown) return raw;
  }

  throw new Error("Format de fichier non reconnu");
}

function bindImport() {
  const input = document.getElementById("import-file");
  if (!input) return;

  input.addEventListener("change", async (e) => {
    const file = /** @type {HTMLInputElement} */ (e.target).files?.[0];
    if (!file) { input.value = ""; return; }

    let parsed;
    try {
      if (file.size > MAX_IMPORT_BYTES) throw new Error(`Fichier trop volumineux (maximum ${MAX_IMPORT_BYTES / 1024 / 1024} MiB)`);
      const text = await file.text();
      if (new TextEncoder().encode(text).byteLength > MAX_IMPORT_BYTES) throw new Error(`Fichier trop volumineux (maximum ${MAX_IMPORT_BYTES / 1024 / 1024} MiB)`);
      parsed = JSON.parse(text);
    } catch (err) {
      showToast("Fichier invalide : " + err.message, "error");
      input.value = "";
      return;
    }
    input.value = "";

    let importedData;
    try {
      if (parsed && parsed._meta !== undefined) {
        if (!parsed.data) throw new Error("Sauvegarde Workspace incomplète");
        _validateImportMetadata(parsed._meta);
      }
      importedData = normalizeImportPayload(parsed, file.name);
      _validateImportData(importedData, _looksLikeFullWorkspace(importedData));
      importedData = typeof _normalizeImportedWorkspaceData === "function"
        ? _normalizeImportedWorkspaceData(importedData)
        : importedData;
    } catch (err) {
      showToast(err?.message || "Format de fichier non reconnu", "error");
      return;
    }

    const exportedAt = parsed._meta?.exportedAt
      ? new Date(parsed._meta.exportedAt).toLocaleString("fr-FR")
      : "date inconnue";

    showImportChoiceModal({
      filename: file.name,
      exportedAt,
      importedData,
      canOverwrite: _looksLikeFullWorkspace(importedData),
    });
  });
}

// ── Modal de choix ───────────────────────────────────────

function showImportChoiceModal({ filename, exportedAt, importedData, canOverwrite = false }) {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal" style="max-width:480px">
      <div class="modal-header">
        <span class="modal-title">Importer une sauvegarde</span>
        <button class="btn-icon btn-close" aria-label="Fermer">✕</button>
      </div>
      <div class="modal-body">
        <div class="import-file-info">
          <span class="export-fmt-badge json">JSON</span>
          <span>${escHtml(filename)}</span>
          <span class="import-file-date">exporté le ${escHtml(exportedAt)}</span>
        </div>
        <div class="import-choice-group">
          <label class="import-choice-label">
            <input type="radio" name="import-mode" value="merge" checked />
            <div class="import-choice-body">
              <strong>🔄 Fusionner</strong>
              <p>Les éléments importés sont ajoutés ou mis à jour (par identifiant).
                 Vos données actuelles non présentes dans le fichier sont conservées.</p>
            </div>
          </label>
          <label class="import-choice-label ${canOverwrite ? "" : "disabled"}">
            <input type="radio" name="import-mode" value="overwrite" />
            <div class="import-choice-body">
              <strong>⚠️ Écraser tout</strong>
              <p>Toutes vos données actuelles seront <strong>remplacées</strong> par
                 celles du fichier. Cette action est irréversible sans sauvegarde préalable.</p>
            </div>
          </label>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-ghost btn-cancel">Annuler</button>
        <button class="btn btn-primary btn-confirm">Importer</button>
      </div>
    </div>`;

  const close = () => {
    overlay.classList.remove("open");
    setTimeout(() => overlay.remove(), 220);
  };

  overlay.querySelector(".btn-close").addEventListener("click", close);
  overlay.querySelector(".btn-cancel").addEventListener("click", close);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });

  const confirmBtn = overlay.querySelector(".btn-confirm");
  const overwriteInput = overlay.querySelector("input[name='import-mode'][value='overwrite']");

  const syncConfirmState = () => {
    const mode =
      overlay.querySelector("input[name='import-mode']:checked")?.value ?? "merge";
    const invalidOverwrite = mode === "overwrite" && !canOverwrite;
    if (confirmBtn) {
      confirmBtn.disabled = invalidOverwrite;
      confirmBtn.title = invalidOverwrite
        ? "Le mode Écraser tout n'est disponible que pour une sauvegarde complète"
        : "";
    }
  };

  if (!canOverwrite) {
    if (overwriteInput) overwriteInput.disabled = true;
    const overwriteLabel = overwriteInput?.closest(".import-choice-label");
    if (overwriteLabel) {
      overwriteLabel.setAttribute("aria-disabled", "true");
      overwriteLabel.style.opacity = ".6";
      overwriteLabel.style.cursor = "not-allowed";
    }
  }

  overlay
    .querySelectorAll("input[name='import-mode']")
    .forEach((radio) => radio.addEventListener("change", syncConfirmState));
  syncConfirmState();

  confirmBtn?.addEventListener("click", async () => {
    if (_importInProgress) return;
    const mode =
      overlay.querySelector("input[name='import-mode']:checked")?.value ?? "merge";
    if (confirmBtn) confirmBtn.disabled = true;
    _importInProgress = true;
    const controls = overlay.querySelectorAll("button, input");
    controls.forEach((control) => { control.disabled = true; });
    try {
      if (mode === "overwrite" && !canOverwrite) {
        showToast("Le mode Écraser tout nécessite une sauvegarde complète Workspace", "error");
        return;
      }
      if (mode === "overwrite") {
        const beforeBackup = _cloneImportData(getData());
        if (typeof WorkspaceDB !== "undefined" && typeof WorkspaceDB.flush === "function") await WorkspaceDB.flush();
        const backup = await _saveImportBackup();
        if (!backup?.saved) {
          showToast("Import annulé : la sauvegarde préalable est requise", "error");
          return;
        }
        if (JSON.stringify(getData()) !== JSON.stringify(beforeBackup)) {
          showToast("Import annulé : les données ont changé pendant la sauvegarde préalable", "error");
          return;
        }
      }
      const previous = _cloneImportData(getData());
      const next = mode === "overwrite" ? _completeImportData(importedData) : mergeImport(getData(), importedData);
      _validateImportData(next, true);
      setData(next);
      try {
        if (typeof WorkspaceDB !== "undefined" && typeof WorkspaceDB.flush === "function") await WorkspaceDB.flush();
      } catch (error) {
        setData(previous);
        try {
          if (typeof WorkspaceDB !== "undefined" && typeof WorkspaceDB.flush === "function") await WorkspaceDB.flush();
        } catch (_) {
          throw new Error("Import échoué et restauration impossible");
        }
        throw error;
      }
      if (typeof lockSecretVaultSession === "function") lockSecretVaultSession();
      close();
      showToast(
        mode === "overwrite"
          ? "Données écrasées — rechargement…"
          : "Fusion effectuée — rechargement…",
        "success",
      );
      setTimeout(() => location.reload(), 800);
    } catch (err) {
      console.error("[import]", err);
      showToast("Erreur lors de l'import : " + err.message, "error");
    } finally {
      _importInProgress = false;
      if (overlay.isConnected) controls.forEach((control) => { control.disabled = false; });
    }
  });

  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add("open"));
}

// ── Logique de fusion ────────────────────────────────────

/**
 * Fusionne `imported` dans `current` :
 *  - Tableaux  → union par `id` (l'élément importé gagne en cas de conflit)
 *  - Arbres    → remplacement complet si présent dans `imported`
 *  - settings  → fusion clé par clé (imported gagne)
 * @param {object} current   Données actuelles du stockage.
 * @param {object} imported  Données issues du fichier JSON importé.
 * @returns {object}
 */
function mergeImport(current, imported) {
  const result = { ...current };

  // Clés tableaux : fusion par id
  const ARRAY_KEYS = ["todos", "snippets", "journal", "projects", "trash"];
  ARRAY_KEYS.forEach((key) => {
    if (!imported[key]) return;
    const existing = _sanitizeArrayItemsWithId(current[key]);
    const incoming = _sanitizeArrayItemsWithId(imported[key]);
    const byId = new Map(existing.map((item) => [item.id, item]));
    incoming.forEach((item) => byId.set(item.id, byId.has(item.id) ? _mergeTree(byId.get(item.id), item) : item));
    result[key] = Array.from(byId.values());
  });

  if (Array.isArray(imported.recentlyVisited)) {
    const visits = new Map((current.recentlyVisited || []).map((item) => [`${item.type}:${item.id}`, item]));
    imported.recentlyVisited.forEach((item) => visits.set(`${item.type}:${item.id}`, item));
    result.recentlyVisited = Array.from(visits.values()).sort((a, b) => b.visitedAt - a.visitedAt).slice(0, 12);
  }
  if (Array.isArray(imported.activityLog)) {
    const events = new Set((current.activityLog || []).map((item) => JSON.stringify(item)));
    result.activityLog = [...(current.activityLog || [])];
    imported.activityLog.forEach((item) => {
      const key = JSON.stringify(item);
      if (!events.has(key)) { result.activityLog.push(item); events.add(key); }
    });
    result.activityLog.sort((a, b) => b.ts - a.ts);
    result.activityLog = result.activityLog.slice(0, 40);
  }

  // Clés arbres : remplacement direct
  const TREE_KEYS = ["rh", "favorites", "snippetFolders"];
  TREE_KEYS.forEach((key) => {
    if (imported[key] != null && _isFolderTree(imported[key])) result[key] = _mergeTree(current[key], imported[key]);
  });

  const OBJECT_KEYS = ["snippetMixedOrder"];
  OBJECT_KEYS.forEach((key) => {
    const sanitized = _sanitizeObjectMap(imported[key]);
    if (sanitized) result[key] = { ...(_isPlainObject(current[key]) ? current[key] : {}), ...sanitized };
  });

  // Paramètres : fusion superficielle
  if (_isPlainObject(imported.settings)) {
    result.settings = { ...(current.settings ?? {}), ...imported.settings };
    ["todoSavedViews", "todoPriorities", "templates"].forEach((key) => {
      if (Array.isArray(imported.settings[key])) {
        result.settings[key] = _mergeById(current.settings?.[key], imported.settings[key]);
      }
    });
    if (_isPlainObject(current.settings?.weeklyReview) && _isPlainObject(imported.settings.weeklyReview)) {
      result.settings.weeklyReview = { ...current.settings.weeklyReview, ...imported.settings.weeklyReview };
    }
  }

  const handled = new Set([
    "projects", "rh", "todos", "snippets", "snippetFolders", "favorites", "settings",
    "journal", "snippetMixedOrder", "trash", "recentlyVisited", "activityLog",
  ]);
  Object.entries(imported).forEach(([key, value]) => {
    if (!handled.has(key)) result[key] = value;
  });

  return result;
}

function _mergeTree(current, imported) {
  if (!_isPlainObject(current)) return imported;
  const result = { ...current, ...imported };
  if (Array.isArray(current.children) && Array.isArray(imported.children)) {
    result.children = _mergeTreeNodes(current.children, imported.children);
  }
  return result;
}

function _mergeById(current, imported) {
  const result = Array.isArray(current) ? current.map((item) => ({ ...item })) : [];
  const positions = new Map(result.map((item, index) => [item.id, index]));
  (Array.isArray(imported) ? imported : []).forEach((item) => {
    if (!_isPlainObject(item) || typeof item.id !== "string") return;
    const position = positions.get(item.id);
    if (position === undefined) {
      positions.set(item.id, result.length);
      result.push({ ...item });
    } else {
      result[position] = _isPlainObject(result[position]) ? { ...result[position], ...item } : { ...item };
    }
  });
  return result;
}

function _mergeTreeNodes(current, imported) {
  const result = Array.isArray(current) ? current.map((item) => ({ ...item })) : [];
  const positions = new Map(result.map((item, index) => [item.id, index]));
  (Array.isArray(imported) ? imported : []).forEach((item) => {
    if (!_isPlainObject(item) || typeof item.id !== "string") return;
    const position = positions.get(item.id);
    if (position === undefined) {
      positions.set(item.id, result.length);
      result.push({ ...item });
    } else if (_isPlainObject(result[position])) {
      result[position] = _mergeTree(result[position], item);
    } else {
      result[position] = { ...item };
    }
  });
  return result;
}
