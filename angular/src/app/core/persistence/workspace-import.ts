import { REQUIRED_WORKSPACE_SECTIONS, WORKSPACE_EXPORT_VERSION } from './workspace-data';
import type { WorkspaceData, WorkspaceExportMeta } from './workspace-data';
import { parseEstimatedTimeExpression } from '../domain/workspace-domain';

type JsonObject = Record<string, unknown>;

export type WorkspaceImportData = Partial<WorkspaceData> & JsonObject;

export interface WorkspaceImport {
  data: WorkspaceImportData;
  full: boolean;
  metadata?: WorkspaceExportMeta;
}

const LEGACY_FULL_SECTIONS = [
  'projects',
  'rh',
  'todos',
  'snippets',
  'snippetFolders',
  'favorites',
  'settings',
] as const;

const ITEM_TYPES = new Set(['link', 'memo', 'info', 'code', 'password']);
const TODO_STATUSES = new Set(['todo', 'waitinginfo', 'inprogress', 'in-progress', 'blocked', 'done']);
const KNOWN_KEYS = new Set<string>(REQUIRED_WORKSPACE_SECTIONS);
export const MAX_IMPORT_BYTES = 16 * 1024 * 1024;
export const MAX_IMPORT_STRING_LENGTH = 1_000_000;
export const MAX_IMPORT_DATA_URL_LENGTH = Math.ceil(4 * 1024 * 1024 * 4 / 3) + 128;
export const MAX_IMPORT_TREE_DEPTH = 64;
export const MIN_VAULT_ITERATIONS = 100_000;
export const MAX_VAULT_ITERATIONS = 1_000_000;

function isObject(value: unknown): value is JsonObject {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function hasOwn(value: JsonObject, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function fail(path: string, message: string): never {
  throw new Error(`Import invalide : ${path} ${message}`);
}

function object(value: unknown, path: string): JsonObject {
  if (!isObject(value)) fail(path, 'doit être un objet');
  return value;
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) fail(path, 'doit être un tableau');
  return value;
}

function string(value: unknown, path: string, nonEmpty = false, maxLength = MAX_IMPORT_STRING_LENGTH): string {
  if (typeof value !== 'string') fail(path, 'doit être une chaîne');
  if (nonEmpty && !value.trim()) fail(path, 'doit être renseigné');
  if (value.length > maxLength) fail(path, 'dépasse la longueur maximale');
  return value;
}

function optional(
  value: JsonObject,
  key: string,
  path: string,
  validate: (entry: unknown, entryPath: string) => void,
): void {
  if (hasOwn(value, key)) validate(value[key], `${path}.${key}`);
}

function stringArray(value: unknown, path: string): void {
  array(value, path).forEach((entry, index) => string(entry, `${path}[${index}]`));
}

function boolean(value: unknown, path: string): void {
  if (typeof value !== 'boolean') fail(path, 'doit être un booléen');
}

function timestamp(value: unknown, path: string): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    fail(path, 'doit être un timestamp valide');
  }
}

function base64(value: unknown, path: string, expectedBytes?: number, minimumBytes = 0): void {
  const encoded = string(value, path, true);
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) {
    fail(path, 'doit être du Base64 valide');
  }
  let bytes: string;
  try {
    bytes = atob(encoded);
  } catch {
    fail(path, 'doit être du Base64 valide');
  }
  if (bytes.length < minimumBytes) fail(path, 'est trop court');
  if (expectedBytes !== undefined && bytes.length !== expectedBytes) fail(path, 'a une taille inattendue');
}

function encryptedPayload(value: unknown, path: string): void {
  const payload = object(value, path);
  base64(payload['iv'], `${path}.iv`, 12);
  base64(payload['cipher'], `${path}.cipher`, undefined, 16);
}

function workspaceFile(value: unknown, path: string): void {
  const file = object(value, path);
  string(file['name'], `${path}.name`, true);
  string(file['mime'], `${path}.mime`);
  const size = file['size'];
  if (typeof size !== 'number' || !Number.isInteger(size) || size < 0 || size > 4 * 1024 * 1024) {
    fail(`${path}.size`, 'dépasse la limite autorisée');
  }
  const dataUrl = string(file['base64'], `${path}.base64`, false, MAX_IMPORT_DATA_URL_LENGTH);
  const comma = dataUrl.indexOf(',');
  if (!dataUrl.startsWith('data:') || comma < 0 || !dataUrl.slice(0, comma).includes(';base64')) {
    fail(`${path}.base64`, 'doit être une URL de données Base64');
  }
  const encoded = dataUrl.slice(comma + 1);
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) {
    fail(`${path}.base64`, 'doit être du Base64 valide');
  }
  let byteLength = 0;
  try {
    byteLength = atob(encoded).length;
  } catch {
    fail(`${path}.base64`, 'doit être du Base64 valide');
  }
  if (byteLength !== size) fail(`${path}.base64`, 'ne correspond pas à la taille déclarée');
}

function optionalStringFields(value: JsonObject, path: string, keys: readonly string[]): void {
  for (const key of keys) optional(value, key, path, (entry, entryPath) => string(entry, entryPath));
}

/** Champs communs aux feuilles d'arbre (item projet, document RH). */
function leafExtras(node: JsonObject, path: string): void {
  optional(node, 'tags', path, stringArray);
  optional(node, 'file', path, (entry, entryPath) => { if (entry !== null) workspaceFile(entry, entryPath); });
  optional(node, 'pinned', path, (entry, entryPath) => boolean(entry, entryPath));
  optional(node, 'createdAt', path, timestamp);
}

function recurrence(value: unknown, path: string): void {
  if (value === null) return;
  const entry = object(value, path);
  const type = string(entry['type'], `${path}.type`);
  if (type === 'daily') return;
  if (type === 'weekly') {
    const days = array(entry['weeklyDays'], `${path}.weeklyDays`);
    if (!days.length) fail(`${path}.weeklyDays`, 'ne doit pas être vide');
    const seen = new Set<number>();
    days.forEach((day, index) => {
      if (typeof day !== 'number' || !Number.isInteger(day) || day < 1 || day > 7 || seen.has(day)) {
        fail(`${path}.weeklyDays[${index}]`, 'est invalide');
      }
      seen.add(day);
    });
    return;
  }
  if (type === 'monthly_nth_weekday') {
    const nth = entry['nth'];
    const weekday = entry['weekday'];
    if (typeof nth !== 'number' || !Number.isInteger(nth) || ![1, 2, 3, 4, -1].includes(nth)) {
      fail(`${path}.nth`, 'est invalide');
    }
    if (typeof weekday !== 'number' || !Number.isInteger(weekday) || weekday < 1 || weekday > 7) {
      fail(`${path}.weekday`, 'est invalide');
    }
    return;
  }
  fail(`${path}.type`, 'est inconnu');
}

function projectItem(value: unknown, path: string, sparse: boolean): void {
  const item = object(value, path);
  string(item['id'], `${path}.id`, true);
  if (item['nodeType'] !== 'item') fail(`${path}.nodeType`, 'doit valoir item');
  if (hasOwn(item, 'type')) {
    const type = string(item['type'], `${path}.type`, true);
    if (!ITEM_TYPES.has(type)) fail(`${path}.type`, 'est inconnu');
  } else if (!sparse) {
    fail(`${path}.type`, 'est obligatoire');
  }
  if (hasOwn(item, 'title')) string(item['title'], `${path}.title`);
  else if (hasOwn(item, 'name')) string(item['name'], `${path}.name`);
  else fail(`${path}.title`, 'est obligatoire');
  optionalStringFields(item, path, ['category', 'url', 'login', 'password', 'note', 'code', 'language']);
  leafExtras(item, path);
  optional(item, 'secretEncrypted', path, (entry, entryPath) => {
    if (entry === null) return;
    if (item['type'] !== 'password') fail(entryPath, 'est réservé aux items password');
    encryptedPayload(entry, entryPath);
  });
  if (hasOwn(item, 'children')) fail(`${path}.children`, 'est interdit pour un item');
}

type TreeValidator = (
  value: unknown,
  path: string,
  sparse: boolean,
  seen: Set<string>,
  ancestors: Set<string>,
) => void;

function treeNode(
  value: unknown,
  path: string,
  sparse: boolean,
  seen: Set<string>,
  ancestors: Set<string>,
  validate: TreeValidator,
): void {
  const node = object(value, path);
  if (ancestors.size >= MAX_IMPORT_TREE_DEPTH) fail(path, 'dépasse la profondeur maximale');
  const id = string(node['id'], `${path}.id`, true);
  if (ancestors.has(id)) fail(path, 'contient une boucle');
  if (seen.has(id)) fail(path, 'contient un identifiant dupliqué');
  seen.add(id);
  validate(node, path, sparse, seen, new Set(ancestors).add(id));
}

/** Branche commune aux dossiers des quatre arbres (projets, RH, snippets, favoris). */
function folderNode(
  node: JsonObject,
  path: string,
  sparse: boolean,
  seen: Set<string>,
  ancestors: Set<string>,
  validate: TreeValidator,
): void {
  if (node['nodeType'] !== 'folder') fail(`${path}.nodeType`, 'est inconnu');
  if (!hasOwn(node, 'name') && !sparse) fail(`${path}.name`, 'est obligatoire');
  optional(node, 'name', path, (entry, entryPath) => string(entry, entryPath));
  optional(node, 'createdAt', path, timestamp);
  if (!hasOwn(node, 'children') && sparse) return;
  array(node['children'], `${path}.children`).forEach((child, index) => {
    treeNode(child, `${path}.children[${index}]`, sparse, seen, ancestors, validate);
  });
}

function projectNode(value: unknown, path: string, sparse: boolean, seen: Set<string>, ancestors: Set<string>): void {
  const node = object(value, path);
  if (node['nodeType'] === 'item') {
    projectItem(node, path, sparse);
    return;
  }
  folderNode(node, path, sparse, seen, ancestors, projectNode);
}

function rhNode(value: unknown, path: string, sparse: boolean, seen: Set<string>, ancestors: Set<string>): void {
  const node = object(value, path);
  if (node['nodeType'] === 'document') {
    if (!hasOwn(node, 'title') && !hasOwn(node, 'name') && !sparse) fail(`${path}.title`, 'est obligatoire');
    if (hasOwn(node, 'title')) string(node['title'], `${path}.title`);
    else if (hasOwn(node, 'name')) string(node['name'], `${path}.name`);
    optionalStringFields(node, path, ['url', 'date', 'note']);
    leafExtras(node, path);
    if (hasOwn(node, 'children')) fail(`${path}.children`, 'est interdit pour un document');
    return;
  }
  folderNode(node, path, sparse, seen, ancestors, rhNode);
}

function snippetFolderNode(value: unknown, path: string, sparse: boolean, seen: Set<string>, ancestors: Set<string>): void {
  folderNode(object(value, path), path, sparse, seen, ancestors, snippetFolderNode);
}

function favoriteNode(value: unknown, path: string, sparse: boolean, seen: Set<string>, ancestors: Set<string>): void {
  const node = object(value, path);
  if (node['nodeType'] === 'link') {
    for (const key of ['name', 'url']) {
      if (!hasOwn(node, key) && !sparse) fail(`${path}.${key}`, 'est obligatoire');
    }
    optionalStringFields(node, path, ['name', 'url']);
    if (hasOwn(node, 'children')) fail(`${path}.children`, 'est interdit pour un lien');
    return;
  }
  folderNode(node, path, sparse, seen, ancestors, favoriteNode);
}

function treeRoot(value: unknown, path: string, validate: TreeValidator): void {
  const root = object(value, path);
  if (root['nodeType'] !== 'folder') fail(`${path}.nodeType`, 'doit valoir folder');
  string(root['id'], `${path}.id`, true);
  string(root['name'], `${path}.name`, true);
  const seen = new Set<string>([root['id'] as string]);
  const ancestors = new Set<string>([root['id'] as string]);
  array(root['children'], `${path}.children`).forEach((child, index) => {
    treeNode(child, `${path}.children[${index}]`, false, seen, ancestors, validate);
  });
}

function project(value: unknown, path: string, sparse: boolean): void {
  const entry = object(value, path);
  string(entry['id'], `${path}.id`, true);
  string(entry['name'], `${path}.name`, true);
  optional(entry, 'parentId', path, (item, itemPath) => { if (item !== null) string(item, itemPath); });
  optional(entry, 'categories', path, stringArray);
  optional(entry, 'color', path, (item, itemPath) => string(item, itemPath));
  optional(entry, 'favorite', path, (item, itemPath) => boolean(item, itemPath));
  optional(entry, 'lockToChildren', path, (item, itemPath) => boolean(item, itemPath));
  optional(entry, 'createdAt', path, timestamp);
  optional(entry, 'lastVisited', path, timestamp);
  if (!hasOwn(entry, 'children') && !sparse) fail(`${path}.children`, 'est obligatoire');
  if (!hasOwn(entry, 'children')) return;
  const seen = new Set<string>([entry['id'] as string]);
  const ancestors = new Set<string>([entry['id'] as string]);
  array(entry['children'], `${path}.children`).forEach((child, index) => {
    treeNode(child, `${path}.children[${index}]`, sparse, seen, ancestors, projectNode);
  });
}

function todo(value: unknown, path: string, sparse: boolean): void {
  const entry = object(value, path);
  string(entry['id'], `${path}.id`, true);
  string(entry['title'], `${path}.title`, true);
  if (hasOwn(entry, 'status')) {
    const status = string(entry['status'], `${path}.status`);
    if (!TODO_STATUSES.has(status)) fail(`${path}.status`, 'est inconnu');
  } else if (hasOwn(entry, 'done')) {
    boolean(entry['done'], `${path}.done`);
  } else if (!sparse) {
    fail(`${path}.status`, 'est obligatoire');
  }
  optionalStringFields(entry, path, [
    'description', 'note', 'priorityId', 'priority', 'context', 'attachedTo', 'dueDate', 'reminderAt', 'projectId',
  ]);
  optional(entry, 'estimatedTime', path, (item, itemPath) => {
    const parsed = parseEstimatedTimeExpression(item);
    if (!parsed.valid) fail(itemPath, 'doit être une durée valide');
  });
  optional(entry, 'dependencies', path, stringArray);
  optional(entry, 'tags', path, stringArray);
  optional(entry, 'recurrence', path, recurrence);
  optional(entry, 'pinned', path, (item, itemPath) => boolean(item, itemPath));
  optional(entry, 'createdAt', path, timestamp);
  optional(entry, 'updatedAt', path, timestamp);
}

function snippet(value: unknown, path: string, sparse: boolean): void {
  const entry = object(value, path);
  string(entry['id'], `${path}.id`, true);
  if (hasOwn(entry, 'title')) string(entry['title'], `${path}.title`, true);
  else string(entry['name'], `${path}.name`, true);
  if (hasOwn(entry, 'code')) string(entry['code'], `${path}.code`);
  else string(entry['content'], `${path}.content`);
  optional(entry, 'language', path, (item, itemPath) => string(item, itemPath));
  optional(entry, 'tags', path, stringArray);
  optional(entry, 'favorite', path, (item, itemPath) => boolean(item, itemPath));
  optional(entry, 'folderId', path, (item, itemPath) => { if (item !== null) string(item, itemPath); });
  optional(entry, 'createdAt', path, timestamp);
}

function journal(value: unknown, path: string, sparse: boolean): void {
  const entry = object(value, path);
  string(entry['id'], `${path}.id`, true);
  if (hasOwn(entry, 'content')) string(entry['content'], `${path}.content`);
  else if (hasOwn(entry, 'note')) string(entry['note'], `${path}.note`);
  else if (!sparse) fail(`${path}.content`, 'est obligatoire');
  optional(entry, 'title', path, (item, itemPath) => string(item, itemPath));
  optional(entry, 'mood', path, (item, itemPath) => string(item, itemPath));
  optional(entry, 'tags', path, stringArray);
  optional(entry, 'createdAt', path, timestamp);
  optional(entry, 'updatedAt', path, timestamp);
}

function savedView(value: unknown, path: string): void {
  const entry = object(value, path);
  string(entry['id'], `${path}.id`, true);
  string(entry['name'], `${path}.name`);
  optional(entry, 'filters', path, (item, itemPath) => {
    const filters = object(item, itemPath);
    for (const key of ['status', 'priority', 'context', 'project', 'due']) {
      optional(filters, key, itemPath, (filter, filterPath) => string(filter, filterPath));
    }
  });
  optional(entry, 'viewMode', path, (item, itemPath) => string(item, itemPath));
  optional(entry, 'createdAt', path, timestamp);
  optional(entry, 'updatedAt', path, timestamp);
}

function settings(value: unknown, path: string): void {
  const entry = object(value, path);
  optionalStringFields(entry, path, ['theme', 'userName', 'siteName', 'backupFolder']);
  optional(entry, 'autoBackupFrequencyHours', path, (item, itemPath) => {
    if (typeof item !== 'number' || !Number.isFinite(item) || item < 0) fail(itemPath, 'doit être un nombre positif');
  });
  optional(entry, 'todoSavedViews', path, (item, itemPath) => {
    identifiedArray(item, itemPath, savedView, false);
  });
  optional(entry, 'weeklyReview', path, (item, itemPath) => {
    const review = object(item, itemPath);
    optional(review, 'lastCompletedWeek', itemPath, (value, valuePath) => string(value, valuePath));
  });
  optional(entry, 'todoPriorities', path, (item, itemPath) => {
    identifiedArray(item, itemPath, (priority, priorityPath) => {
      const record = object(priority, priorityPath);
      string(record['label'], `${priorityPath}.label`);
      string(record['color'], `${priorityPath}.color`);
    }, false);
  });
  optional(entry, 'templates', path, (item, itemPath) => {
    identifiedArray(item, itemPath, (template, templatePath) => {
      const record = object(template, templatePath);
      string(record['name'], `${templatePath}.name`);
      string(record['type'], `${templatePath}.type`);
    }, false);
  });
  optional(entry, 'secretVault', path, (item, itemPath) => {
    if (item === null) return;
    const vault = object(item, itemPath);
    boolean(vault['enabled'], `${itemPath}.enabled`);
    if (vault['salt'] !== undefined) base64(vault['salt'], `${itemPath}.salt`, 16);
    if (vault['iterations'] !== undefined && (typeof vault['iterations'] !== 'number' || !Number.isInteger(vault['iterations']) || vault['iterations'] < MIN_VAULT_ITERATIONS || vault['iterations'] > MAX_VAULT_ITERATIONS)) {
      fail(`${itemPath}.iterations`, `doit être un entier entre ${MIN_VAULT_ITERATIONS} et ${MAX_VAULT_ITERATIONS}`);
    }
    if (vault['verifier'] !== undefined) encryptedPayload(vault['verifier'], `${itemPath}.verifier`);
    if (vault['enabled'] && (!vault['salt'] || !vault['iterations'] || !vault['verifier'])) fail(itemPath, 'coffre actif incomplet');
  });
}

function trashEntry(value: unknown, path: string): void {
  const entry = object(value, path);
  string(entry['id'], `${path}.id`, true);
  const type = string(entry['_trashType'], `${path}._trashType`, true);
  timestamp(entry['_deletedAt'], `${path}._deletedAt`);
  const payload = { ...entry };
  delete payload['_trashType'];
  delete payload['_deletedAt'];
  if (type === 'todo') todo(payload, path, true);
  else if (type === 'snippet') snippet(payload, path, true);
  else if (type === 'journal') journal(payload, path, true);
  else if (type === 'project') project(payload, path, true);
  else if (type === 'project-node') {
    // `_nodeParentId` peut manquer sur les exports historiques ; la restauration
    // legacy retombe alors sur la racine du projet, donc on ne le rend pas obligatoire.
    string(entry['_projectId'], `${path}._projectId`, true);
    optional(entry, '_nodeParentId', path, (item, itemPath) => string(item, itemPath, true));
    delete payload['_projectId'];
    delete payload['_projectName'];
    delete payload['_nodeParentId'];
    projectNode(payload, path, false, new Set(), new Set());
  } else if (type === 'rh') {
    optional(entry, '_rhParentId', path, (item, itemPath) => string(item, itemPath, true));
    delete payload['_rhParentId'];
    treeNode(payload, path, false, new Set(), new Set(), rhNode);
  } else {
    fail(`${path}._trashType`, 'est inconnu');
  }
}

function identifiedArray(
  value: unknown,
  path: string,
  validate: (entry: unknown, entryPath: string, sparse: boolean) => void,
  sparse: boolean,
): void {
  const entries = array(value, path);
  const ids = new Set<string>();
  entries.forEach((entry, index) => {
    const entryPath = `${path}[${index}]`;
    const record = object(entry, entryPath);
    const id = string(record['id'], `${entryPath}.id`, true);
    if (ids.has(id)) fail(entryPath, 'contient un identifiant dupliqué');
    ids.add(id);
    validate(record, entryPath, sparse);
  });
}

interface SnippetReferences {
  folders: Set<string>;
  snippets: Set<string>;
  direct: Map<string, Set<string>>;
}

function snippetReferences(data: JsonObject): SnippetReferences | null {
  if (!hasOwn(data, 'snippets') || !hasOwn(data, 'snippetFolders')) return null;
  const root = object(data['snippetFolders'], 'snippetFolders');
  const folders = new Set<string>();
  const direct = new Map<string, Set<string>>();
  const collect = (folder: JsonObject, path: string): void => {
    const id = string(folder['id'], `${path}.id`, true);
    folders.add(id);
    const children = array(folder['children'], `${path}.children`);
    direct.set(id, new Set(children.map((child, index) => {
      const node = object(child, `${path}.children[${index}]`);
      return `f:${string(node['id'], `${path}.children[${index}].id`, true)}`;
    })));
    children.forEach((child, index) => {
      const node = object(child, `${path}.children[${index}]`);
      collect(node, `${path}.children[${index}]`);
    });
  };
  collect(root, 'snippetFolders');
  direct.set('root', new Set(direct.get(root['id'] as string) ?? []));
  const snippets = new Set<string>();
  array(data['snippets'], 'snippets').forEach((entry, index) => {
    const snippetEntry = object(entry, `snippets[${index}]`);
    const id = string(snippetEntry['id'], `snippets[${index}].id`, true);
    if (folders.has(id)) fail(`snippets[${index}].id`, 'réutilise un identifiant de dossier');
    snippets.add(id);
    const folderId = typeof snippetEntry['folderId'] === 'string' && snippetEntry['folderId'] ? snippetEntry['folderId'] : 'root';
    if (!folders.has(folderId)) fail(`snippets[${index}].folderId`, 'référence un dossier absent');
    const tokens = direct.get(folderId) ?? new Set<string>();
    tokens.add(`s:${id}`);
    direct.set(folderId, tokens);
  });
  return { folders, snippets, direct };
}

function mixedOrder(value: unknown, path: string, references: SnippetReferences | null): void {
  const order = object(value, path);
  for (const [folderId, entries] of Object.entries(order)) {
    const seen = new Set<string>();
    array(entries, `${path}.${folderId}`).forEach((entry, index) => {
      const token = string(entry, `${path}.${folderId}[${index}]`, true);
      if (!/^[fs]:.+$/.test(token) || seen.has(token)) fail(`${path}.${folderId}[${index}]`, 'est un token invalide');
      if (references && references.folders.has(folderId)) {
        const [kind, id] = token.split(':', 2);
        const known = kind === 'f' ? references.folders.has(id) : references.snippets.has(id);
        if (known && !(references.direct.get(folderId)?.has(token) ?? false)) {
          fail(`${path}.${folderId}[${index}]`, 'ne correspond pas au contenu direct du dossier');
        }
      }
      seen.add(token);
    });
  }
}

function collectPasswordItems(value: unknown, path: string, result: JsonObject[]): void {
  const node = object(value, path);
  if (node['nodeType'] === 'item' && node['type'] === 'password') result.push(node);
  if (node['nodeType'] === 'folder' || (node['nodeType'] === undefined && hasOwn(node, 'children'))) {
    array(node['children'], `${path}.children`).forEach((child, index) => {
      collectPasswordItems(child, `${path}.children[${index}]`, result);
    });
  }
}

function validateFullReferences(data: JsonObject): void {
  const projects = array(data['projects'], 'projects').map((entry, index) => object(entry, `projects[${index}]`));
  const projectIds = new Set(projects.map((project) => project['id'] as string));
  projects.forEach((project, index) => {
    const parentId = project['parentId'];
    if (parentId !== null && parentId !== undefined && !projectIds.has(parentId as string)) {
      fail(`projects[${index}].parentId`, 'référence un projet absent');
    }
  });
  for (const projectId of projectIds) {
    const seen = new Set<string>();
    let current = projectId;
    while (current) {
      if (seen.has(current)) fail('projects.parentId', 'contient une boucle');
      seen.add(current);
      const project = projects.find((entry) => entry['id'] === current);
      const parent = project?.['parentId'];
      if (typeof parent !== 'string' || !parent) break;
      current = parent;
    }
  }

  const todos = array(data['todos'], 'todos').map((entry, index) => object(entry, `todos[${index}]`));
  const todoIds = new Set(todos.map((todoEntry) => todoEntry['id'] as string));
  todos.forEach((todoEntry, index) => {
    for (const [dependencyIndex, dependency] of (Array.isArray(todoEntry['dependencies']) ? todoEntry['dependencies'] : []).entries()) {
      if (!todoIds.has(dependency)) fail(`todos[${index}].dependencies[${dependencyIndex}]`, 'référence une tâche absente');
      if (dependency === todoEntry['id']) fail(`todos[${index}].dependencies[${dependencyIndex}]`, 'ne peut pas se référencer elle-même');
    }
  });

  const projectRefs = new Set(projects.map((entry) => entry['id'] as string));
  todos.forEach((todoEntry, index) => {
    const projectId = todoEntry['projectId'];
    if (typeof projectId === 'string' && projectId && !projectRefs.has(projectId)) {
      fail(`todos[${index}].projectId`, 'référence un projet absent');
    }
  });

  const items: JsonObject[] = [];
  projects.forEach((project, index) => collectPasswordItems(project, `projects[${index}]`, items));
  array(data['trash'], 'trash').forEach((entry, index) => {
    const trashItem = object(entry, `trash[${index}]`);
    if (trashItem['_trashType'] === 'project' || trashItem['_trashType'] === 'project-node') {
      collectPasswordItems(trashItem, `trash[${index}]`, items);
    }
  });
  const settingsValue = object(data['settings'], 'settings');
  const vault = settingsValue['secretVault'];
  const enabled = isObject(vault) && vault['enabled'] === true;
  for (const item of items) {
    const encrypted = item['secretEncrypted'] !== undefined && item['secretEncrypted'] !== null;
    if (encrypted && !enabled) fail('projects', 'contient un secret chiffré sans coffre actif');
    if (encrypted && (item['login'] || item['password'])) fail('projects', 'contient un secret en clair avec secretEncrypted');
    if (enabled && !encrypted && (item['login'] || item['password'])) fail('projects', 'contient un secret en clair avec coffre actif');
  }
}

function validateData(value: unknown, strict: boolean): void {
  const data = object(value, 'data');
  if (strict) {
    const missing = REQUIRED_WORKSPACE_SECTIONS.filter((section) => !hasOwn(data, section));
    if (missing.length) fail('data', `sections manquantes : ${missing.join(', ')}`);
  }
  if (hasOwn(data, 'projects')) identifiedArray(data['projects'], 'projects', (entry, path, sparse) => project(entry, path, sparse), !strict);
  if (hasOwn(data, 'rh')) treeRoot(data['rh'], 'rh', rhNode);
  if (hasOwn(data, 'todos')) identifiedArray(data['todos'], 'todos', (entry, path, sparse) => todo(entry, path, sparse), !strict);
  if (hasOwn(data, 'snippets')) identifiedArray(data['snippets'], 'snippets', (entry, path, sparse) => snippet(entry, path, sparse), !strict);
  if (hasOwn(data, 'snippetFolders')) treeRoot(data['snippetFolders'], 'snippetFolders', snippetFolderNode);
  const references = snippetReferences(data);
  if (hasOwn(data, 'snippetMixedOrder')) mixedOrder(data['snippetMixedOrder'], 'snippetMixedOrder', references);
  if (hasOwn(data, 'favorites')) treeRoot(data['favorites'], 'favorites', favoriteNode);
  if (hasOwn(data, 'journal')) identifiedArray(data['journal'], 'journal', (entry, path, sparse) => journal(entry, path, sparse), !strict);
  if (hasOwn(data, 'trash')) identifiedArray(data['trash'], 'trash', (entry, path) => trashEntry(entry, path), false);
  if (hasOwn(data, 'recentlyVisited')) {
    const visits = array(data['recentlyVisited'], 'recentlyVisited');
    const keys = new Set<string>();
    visits.forEach((entry, index) => {
      const path = `recentlyVisited[${index}]`;
      const visit = object(entry, path);
      const type = string(visit['type'], `${path}.type`, true);
      const id = string(visit['id'], `${path}.id`, true);
      const key = `${type}:${id}`;
      if (keys.has(key)) fail(path, 'contient une visite dupliquée');
      keys.add(key);
      optionalStringFields(visit, path, ['name', 'color']);
      timestamp(visit['visitedAt'], `${path}.visitedAt`);
    });
  }
  if (hasOwn(data, 'activityLog')) {
    array(data['activityLog'], 'activityLog').forEach((entry, index) => {
      const path = `activityLog[${index}]`;
      const activity = object(entry, path);
      string(activity['type'], `${path}.type`, true);
      string(activity['action'], `${path}.action`, true);
      string(activity['label'], `${path}.label`, true);
      optionalStringFields(activity, path, ['id', 'projectId', 'icon', 'color']);
      timestamp(activity['ts'], `${path}.ts`);
    });
  }
  if (hasOwn(data, 'settings')) settings(data['settings'], 'settings');
  if (strict) validateFullReferences(data);
}

function normalizeFilename(filename: string): string {
  return filename.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function isFull(value: JsonObject): boolean {
  return LEGACY_FULL_SECTIONS.every((section) => hasOwn(value, section));
}

function isCurrentFull(value: JsonObject): boolean {
  return REQUIRED_WORKSPACE_SECTIONS.every((section) => hasOwn(value, section));
}

function sectionFromArray(value: unknown[], filename: string): WorkspaceImportData {
  const name = normalizeFilename(filename);
  if (name.includes('todo')) return { todos: value as WorkspaceData['todos'] };
  if (name.includes('project') || name.includes('projet')) return { projects: value as WorkspaceData['projects'] };
  if (name.includes('journal')) return { journal: value as WorkspaceData['journal'] };
  if (name.includes('snippet')) return { snippets: value as WorkspaceData['snippets'] };
  throw new Error('Format de fichier non reconnu');
}

function sectionFromObject(value: JsonObject, filename: string): WorkspaceImportData {
  const name = normalizeFilename(filename);
  if (hasOwn(value, 'folders') || (hasOwn(value, 'snippets') && name.includes('snippet'))) {
    if (hasOwn(value, 'folders') && value['folders'] !== null && !isObject(value['folders'])) fail('folders', 'doit être un objet');
    const data: WorkspaceImportData = {};
    if (hasOwn(value, 'snippets')) data.snippets = value['snippets'] as WorkspaceData['snippets'];
    if (isObject(value['folders'])) data.snippetFolders = value['folders'] as WorkspaceData['snippetFolders'];
    if (!Object.keys(data).length) throw new Error('Format de fichier non reconnu');
    return data;
  }
  if (name.includes('param') || name.includes('setting')) return { settings: value as WorkspaceData['settings'] };
  if (name.includes('rh')) return { rh: value as WorkspaceData['rh'] };
  if (name.includes('favori') || name.includes('favorite')) return { favorites: value as WorkspaceData['favorites'] };
  if (name.includes('snippet')) return { snippetFolders: value as WorkspaceData['snippetFolders'] };
  if (Object.keys(value).some((key) => KNOWN_KEYS.has(key))) return value as WorkspaceImportData;
  throw new Error('Format de fichier non reconnu');
}

function validateMetadata(value: unknown): WorkspaceExportMeta {
  const metadata = object(value, '_meta');
  string(metadata['app'], '_meta.app', true);
  if (metadata['version'] !== WORKSPACE_EXPORT_VERSION) {
    throw new Error(`Version d'export Workspace non prise en charge : ${String(metadata['version'])}`);
  }
  const exportedAt = string(metadata['exportedAt'], '_meta.exportedAt', true);
  if (Number.isNaN(Date.parse(exportedAt))) fail('_meta.exportedAt', 'doit être une date valide');
  return metadata as WorkspaceExportMeta;
}

function normalizeImportData(data: WorkspaceImportData): WorkspaceImportData {
  const result = structuredClone(data);
  if (Array.isArray(result.todos)) {
    result.todos = result.todos.map((value) => {
      if (!isObject(value)) return value;
      const estimate = hasOwn(value, 'estimatedTime')
        ? parseEstimatedTimeExpression(value['estimatedTime'])
        : null;
      const normalized = { ...value };
      if (hasOwn(value, 'done') && !hasOwn(value, 'status') && typeof value['done'] === 'boolean') {
        normalized['status'] = value['done'] === true ? 'done' : 'todo';
      }
      return {
        ...normalized,
        ...(estimate?.valid ? { estimatedTime: estimate.minutes } : {}),
      };
    }) as WorkspaceData['todos'];
  }
  if (Array.isArray(result.snippets)) {
    result.snippets = result.snippets.map((value) => {
      if (!isObject(value)) return value;
      const snippet = { ...value };
      if (!hasOwn(value, 'title') && typeof value['name'] === 'string') snippet['title'] = value['name'];
      if (!hasOwn(value, 'code') && typeof value['content'] === 'string') snippet['code'] = value['content'];
      return snippet;
    }) as WorkspaceData['snippets'];
  }
  if (Array.isArray(result.journal)) {
    result.journal = result.journal.map((value) => {
      if (!isObject(value)) return value;
      const entry = { ...value };
      if (!hasOwn(value, 'content') && typeof value['note'] === 'string') entry['content'] = value['note'];
      return entry;
    }) as WorkspaceData['journal'];
  }
  if (isObject(result.settings) && isObject(result.settings['weeklyReview'])) {
    result.settings = {
      ...result.settings,
      weeklyReview: {
        ...result.settings['weeklyReview'],
      },
    } as WorkspaceData['settings'];
  }
  return result;
}

export function parseWorkspaceImport(raw: string, filename = ''): WorkspaceImport {
  if (new TextEncoder().encode(raw).byteLength > MAX_IMPORT_BYTES) throw new Error(`Fichier trop volumineux (maximum ${MAX_IMPORT_BYTES / 1024 / 1024} MiB)`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Fichier JSON invalide');
  }

  let value = parsed;
  let envelope = false;
  let metadata: WorkspaceExportMeta | undefined;
  if (isObject(parsed) && hasOwn(parsed, '_meta')) {
    if (!hasOwn(parsed, 'data')) throw new Error('Sauvegarde Workspace incomplète');
    metadata = validateMetadata(parsed['_meta']);
    value = parsed['data'];
    envelope = true;
  } else if (isObject(parsed) && hasOwn(parsed, 'data')) {
    value = parsed['data'];
  }

  let data: WorkspaceImportData;
  let full = false;
  if (isObject(value) && isFull(value)) {
    data = value as WorkspaceImportData;
    full = true;
  } else if (envelope) {
    throw new Error('Sauvegarde Workspace incomplète');
  } else if (Array.isArray(value)) {
    data = sectionFromArray(value, filename);
  } else if (isObject(value)) {
    data = sectionFromObject(value, filename);
  } else {
    throw new Error('Format de fichier non reconnu');
  }

  data = normalizeImportData(data);
  validateData(data, full && isCurrentFull(data));
  return { data, full, ...(metadata ? { metadata } : {}) };
}

function mergeById(current: unknown, imported: unknown): unknown[] {
  const result = Array.isArray(current) ? structuredClone(current) : [];
  const positions = new Map<string, number>();
  result.forEach((entry, index) => {
    if (isObject(entry) && typeof entry['id'] === 'string') positions.set(entry['id'], index);
  });
  for (const entry of Array.isArray(imported) ? imported : []) {
    const id = isObject(entry) && typeof entry['id'] === 'string' ? entry['id'] : '';
    const position = id ? positions.get(id) : undefined;
    if (position === undefined) {
      if (id) positions.set(id, result.length);
      result.push(structuredClone(entry));
    } else {
      const existing = result[position];
      result[position] = isObject(existing) && isObject(entry)
        ? mergeTree(existing, entry)
        : structuredClone(entry);
    }
  }
  return result;
}

function mergeTree(current: JsonObject, imported: JsonObject): JsonObject {
  const result = { ...structuredClone(current), ...structuredClone(imported) };
  if (Array.isArray(current['children']) && Array.isArray(imported['children'])) {
    result['children'] = mergeById(current['children'], imported['children']);
  }
  return result;
}

function mergeSettings(
  current: WorkspaceData['settings'],
  imported: Partial<WorkspaceData['settings']>,
): WorkspaceData['settings'] {
  const result = { ...structuredClone(current), ...structuredClone(imported) };
  for (const key of ['todoSavedViews', 'todoPriorities', 'templates'] as const) {
    if (hasOwn(imported, key) && Array.isArray(imported[key])) result[key] = mergeById(current[key], imported[key]) as never;
  }
  if (isObject(current['weeklyReview']) && isObject(imported['weeklyReview'])) {
    result.weeklyReview = {
      ...structuredClone(current['weeklyReview']),
      ...structuredClone(imported['weeklyReview']),
    };
  }
  return result;
}

function mergeVisits(current: WorkspaceData['recentlyVisited'], imported: unknown): WorkspaceData['recentlyVisited'] {
  const entries = new Map<string, WorkspaceData['recentlyVisited'][number]>();
  for (const entry of current) entries.set(`${entry.type}:${entry.id}`, structuredClone(entry));
  for (const entry of Array.isArray(imported) ? imported : []) {
    if (!isObject(entry)) continue;
    const key = `${entry['type']}:${entry['id']}`;
    entries.set(key, structuredClone(entry) as WorkspaceData['recentlyVisited'][number]);
  }
  return [...entries.values()].sort((left, right) => right.visitedAt - left.visitedAt).slice(0, 12);
}

function mergeActivity(current: WorkspaceData['activityLog'], imported: unknown): WorkspaceData['activityLog'] {
  const result = structuredClone(current);
  const seen = new Set(result.map((entry) => JSON.stringify(entry)));
  for (const entry of Array.isArray(imported) ? imported : []) {
    const key = JSON.stringify(entry);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(structuredClone(entry) as WorkspaceData['activityLog'][number]);
  }
  return result.sort((left, right) => right.ts - left.ts).slice(0, 40);
}

/** Merges a validated partial import without removing absent sections. */
export function mergeWorkspaceImport(current: WorkspaceData, imported: WorkspaceImportData): WorkspaceData {
  const result = structuredClone(current);
  const handled = new Set<string>();
  for (const key of ['projects', 'todos', 'snippets', 'journal', 'trash'] as const) {
    if (!hasOwn(imported, key)) continue;
    result[key] = mergeById(result[key], imported[key]) as never;
    handled.add(key);
  }
  if (hasOwn(imported, 'recentlyVisited')) {
    result.recentlyVisited = mergeVisits(result.recentlyVisited, imported['recentlyVisited']);
    handled.add('recentlyVisited');
  }
  if (hasOwn(imported, 'activityLog')) {
    result.activityLog = mergeActivity(result.activityLog, imported['activityLog']);
    handled.add('activityLog');
  }
  for (const key of ['rh', 'favorites', 'snippetFolders'] as const) {
    if (!hasOwn(imported, key)) continue;
    const currentTree = result[key] as unknown as JsonObject;
    const importedTree = imported[key];
    result[key] = isObject(importedTree)
      ? mergeTree(currentTree, importedTree) as never
      : structuredClone(importedTree) as never;
    handled.add(key);
  }
  if (hasOwn(imported, 'snippetMixedOrder')) {
    result.snippetMixedOrder = {
      ...result.snippetMixedOrder,
      ...(structuredClone(imported['snippetMixedOrder']) as Record<string, string[]>),
    };
    handled.add('snippetMixedOrder');
  }
  if (hasOwn(imported, 'settings')) {
    result.settings = mergeSettings(result.settings, imported['settings'] as Partial<WorkspaceData['settings']>);
    handled.add('settings');
  }
  for (const [key, value] of Object.entries(imported)) {
    if (!handled.has(key) && !KNOWN_KEYS.has(key)) result[key] = structuredClone(value);
  }
  return result;
}

export function validateWorkspaceImport(value: unknown, complete = true): void {
  validateData(value, complete);
}
