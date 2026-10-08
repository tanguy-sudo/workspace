import type {
  ActivityLogEntry,
  JournalEntry,
  Project,
  ProjectNode,
  Snippet,
  SnippetFolder,
  Todo,
  TodoPriority,
  TodoRecurrence,
  TodoSavedView,
  TrashEntry,
  WorkspaceData,
  RhNode,
} from '../persistence/workspace-data';

export interface TreeNode {
  id: string;
  nodeType?: string;
  name?: string;
  children?: TreeNode[];
  [key: string]: unknown;
}

export type TreeDropPosition = 'before' | 'inside' | 'after';

export function walkTree(
  nodes: readonly TreeNode[] | undefined,
  visitor: (node: TreeNode, path: readonly string[]) => void,
  path: readonly string[] = [],
): void {
  for (const node of nodes ?? []) {
    visitor(node, path);
    if (node.nodeType === 'folder') {
      walkTree(node.children, visitor, [...path, node.name || 'dossier']);
    }
  }
}

export function countTreeNodes(
  nodes: readonly TreeNode[] | undefined,
  predicate: (node: TreeNode, path: readonly string[]) => boolean = () => true,
): number {
  let count = 0;
  walkTree(nodes, (node, path) => {
    if (predicate(node, path)) count += 1;
  });
  return count;
}

export function collectTreeNodes(
  nodes: readonly TreeNode[] | undefined,
  predicate: (node: TreeNode, path: readonly string[]) => boolean = () => true,
): TreeNode[] {
  const result: TreeNode[] = [];
  walkTree(nodes, (node, path) => {
    if (predicate(node, path)) result.push(node);
  });
  return result;
}

export function findTreeNode(root: TreeNode | null | undefined, id: string): TreeNode | null {
  if (!root) return null;
  if (root.id === id) return root;
  for (const child of root.children ?? []) {
    const found = findTreeNode(child, id);
    if (found) return found;
  }
  return null;
}

export function findTreeParent(root: TreeNode | null | undefined, id: string): TreeNode | null {
  if (!root?.children) return null;
  if (root.children.some((child) => child.id === id)) return root;
  for (const child of root.children) {
    const found = findTreeParent(child, id);
    if (found) return found;
  }
  return null;
}

export function projectChildren(projects: readonly Project[], parentId: string | null = null): Project[] {
  const normalizedParentId = parentId || null;
  return projects.filter((project) => (project.parentId || null) === normalizedParentId);
}

export function projectDescendants(projects: readonly Project[], projectId: string): Project[] {
  const descendants: Project[] = [];
  const pending = [projectId];
  const visited = new Set<string>();
  while (pending.length) {
    const parentId = pending.pop();
    if (!parentId || visited.has(parentId)) continue;
    visited.add(parentId);
    for (const project of projects) {
      if ((project.parentId || null) !== parentId) continue;
      if (visited.has(project.id)) continue;
      descendants.push(project);
      pending.push(project.id);
    }
  }
  return descendants;
}

export function projectAncestors(projects: readonly Project[], projectId: string): Project[] {
  const byId = new Map(projects.map((project) => [project.id, project]));
  const ancestors: Project[] = [];
  const seen = new Set<string>([projectId]);
  let current = byId.get(projectId);
  while (current?.parentId && !seen.has(current.parentId)) {
    seen.add(current.parentId);
    const parent = byId.get(current.parentId);
    if (!parent) break;
    ancestors.unshift(parent);
    current = parent;
  }
  return ancestors;
}

export interface ProjectItemCounts {
  folder: number;
  link: number;
  memo: number;
  code: number;
  info: number;
  password: number;
}

export function countProjectItems(project: Project): ProjectItemCounts {
  const counts: ProjectItemCounts = { folder: 0, link: 0, memo: 0, code: 0, info: 0, password: 0 };
  walkTree(project.children, (node) => {
    if (node.nodeType === 'folder') counts.folder += 1;
    else if (typeof node['type'] === 'string' && Object.prototype.hasOwnProperty.call(counts, node['type'])) {
      counts[node['type'] as keyof ProjectItemCounts] += 1;
    }
  });
  return counts;
}

export function createProjectId(name: string, projects: readonly Project[], makeId: () => string): string {
  const base = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || makeId();
  const normalized = base.slice(0, 60);
  return projects.some((project) => project.id === normalized) ? `${normalized}-${makeId().slice(0, 4)}` : normalized;
}

export function deleteProjectTree(data: WorkspaceData, projectId: string, deletedAt = Date.now()): WorkspaceData | null {
  const project = data.projects.find((candidate) => candidate.id === projectId);
  if (!project) return null;
  const ids = new Set([projectId, ...projectDescendants(data.projects, projectId).map((candidate) => candidate.id)]);
  const result = structuredClone(data);
  result.projects = result.projects.filter((candidate) => !ids.has(candidate.id));
  result.recentlyVisited = result.recentlyVisited.filter((visit) => !(visit.type === 'project' && ids.has(visit.id)));
  result.trash.push({ ...structuredClone(project), _trashType: 'project', _deletedAt: deletedAt });
  return result;
}

function projectRoot(project: Project): TreeNode {
  return { id: project.id, nodeType: 'folder', children: project.children };
}

function projectById(data: WorkspaceData, projectId: string): Project | null {
  return data.projects.find((project) => project.id === projectId) ?? null;
}

function todoViewFilters(value: TodoSavedView['filters'] | null | undefined): TodoSavedView['filters'] {
  return {
    status: value?.status || 'all',
    priority: value?.priority || 'all',
    context: value?.context || 'all',
    project: value?.project || 'all',
    due: value?.due || 'all',
  };
}

export function findProjectNode(project: Project, nodeId: string): ProjectNode | null {
  const node = findTreeNode(projectRoot(project), nodeId);
  return node && node.id !== project.id ? node as ProjectNode : null;
}

export function findProjectNodePath(project: Project, nodeId: string): string[] | null {
  const walk = (nodes: readonly ProjectNode[], path: string[]): string[] | null => {
    for (const node of nodes) {
      const next = [...path, node.id];
      if (node.id === nodeId) return next;
      if (node.nodeType === 'folder') {
        const found = walk(node.children, next);
        if (found) return found;
      }
    }
    return null;
  };
  return nodeId === project.id ? [project.id] : walk(project.children, [project.id]);
}

export function projectItemCount(project: Project): number {
  return countTreeNodes(project.children, (node) => node.nodeType === 'item');
}

export function projectNodeMatchesType(node: ProjectNode, type: string): boolean {
  if (type === 'all') return true;
  if (node.nodeType === 'item') return node.type === type;
  return (node.children ?? []).some((child) => projectNodeMatchesType(child, type));
}

export function addProjectNode(
  data: WorkspaceData,
  projectId: string,
  parentId: string,
  node: ProjectNode,
): WorkspaceData | null {
  const result = structuredClone(data);
  const project = projectById(result, projectId);
  if (!project) return null;
  const root = projectRoot(project);
  const parent = parentId === projectId ? root : findTreeNode(root, parentId);
  if (!parent || parent.nodeType !== 'folder') return null;
  parent.children = [...(parent.children ?? []), structuredClone(node)];
  project.children = root.children as ProjectNode[];
  return result;
}

export function updateProjectNode(
  data: WorkspaceData,
  projectId: string,
  nodeId: string,
  changes: Partial<ProjectNode>,
): WorkspaceData | null {
  const result = structuredClone(data);
  const project = projectById(result, projectId);
  const node = project ? findProjectNode(project, nodeId) : null;
  if (!node) return null;
  Object.assign(node, changes);
  return result;
}

export function deleteProjectNode(
  data: WorkspaceData,
  projectId: string,
  nodeId: string,
  deletedAt = Date.now(),
): WorkspaceData | null {
  const result = structuredClone(data);
  const project = projectById(result, projectId);
  if (!project || nodeId === project.id) return null;
  const root = projectRoot(project);
  const node = findTreeNode(root, nodeId);
  const parent = findTreeParent(root, nodeId);
  if (!node || !parent) return null;
  parent.children = (parent.children ?? []).filter((child) => child.id !== nodeId);
  project.children = root.children as ProjectNode[];
  result.trash.push({
    ...structuredClone(node),
    _trashType: 'project-node',
    _projectId: project.id,
    _projectName: project.name,
    _nodeParentId: parent.id,
    _deletedAt: deletedAt,
  });
  return result;
}

export function moveProjectNode(
  data: WorkspaceData,
  projectId: string,
  nodeId: string,
  targetFolderId: string,
): WorkspaceData | null {
  const result = structuredClone(data);
  const project = projectById(result, projectId);
  if (!project || nodeId === targetFolderId) return null;
  const root = projectRoot(project);
  const source = findTreeNode(root, nodeId);
  const target = targetFolderId === projectId ? root : findTreeNode(root, targetFolderId);
  if (!source || !target || target.nodeType !== 'folder' || findTreeNode(source, targetFolderId)) return null;
  const parent = findTreeParent(root, nodeId);
  if (!parent) return null;
  parent.children = (parent.children ?? []).filter((child) => child.id !== nodeId);
  target.children = [...(target.children ?? []), source];
  project.children = root.children as ProjectNode[];
  return result;
}

export function dropProjectNode(
  data: WorkspaceData,
  projectId: string,
  nodeId: string,
  targetId: string,
  position: TreeDropPosition,
): WorkspaceData | null {
  const result = structuredClone(data);
  const project = projectById(result, projectId);
  if (!project) return null;
  const root = projectRoot(project);
  const next = dropTreeNode(root, nodeId, targetId, position);
  if (!next) return null;
  project.children = next.children as ProjectNode[];
  return result;
}

export function reorderProjectChildren(
  data: WorkspaceData,
  projectId: string,
  parentId: string,
  orderedIds: readonly string[],
): WorkspaceData | null {
  const result = structuredClone(data);
  const project = projectById(result, projectId);
  if (!project) return null;
  const root = projectRoot(project);
  const parent = parentId === projectId ? root : findTreeNode(root, parentId);
  if (!parent || parent.nodeType !== 'folder') return null;
  const byId = new Map((parent.children ?? []).map((child) => [child.id, child]));
  const ordered = orderedIds.map((id) => byId.get(id)).filter((node): node is TreeNode => Boolean(node));
  parent.children = [
    ...ordered,
    ...(parent.children ?? []).filter((child) => !orderedIds.includes(child.id)),
  ];
  project.children = root.children as ProjectNode[];
  return result;
}

/** Returns a new tree, or null when the move would be invalid. */
export function moveTreeNode(
  root: TreeNode,
  nodeId: string,
  targetFolderId: string,
): TreeNode | null {
  if (nodeId === targetFolderId) return null;
  const source = findTreeNode(root, nodeId);
  const target = targetFolderId === root.id ? root : findTreeNode(root, targetFolderId);
  if (!source || !target || target.nodeType !== 'folder') return null;
  if (findTreeNode(source, targetFolderId)) return null;

  const result = structuredClone(root);
  const resultSource = findTreeNode(result, nodeId);
  const resultParent = findTreeParent(result, nodeId);
  const resultTarget = targetFolderId === result.id ? result : findTreeNode(result, targetFolderId);
  if (!resultSource || !resultParent || !resultTarget) return null;

  resultParent.children = (resultParent.children ?? []).filter((child) => child.id !== nodeId);
  resultTarget.children = [...(resultTarget.children ?? []), resultSource];
  return result;
}

/** Returns a new tree, or null when the relative drop would be invalid. */
export function dropTreeNode(
  root: TreeNode,
  nodeId: string,
  targetId: string,
  position: TreeDropPosition,
): TreeNode | null {
  if (nodeId === targetId) return null;
  const source = findTreeNode(root, nodeId);
  const target = findTreeNode(root, targetId);
  if (!source || !target) return null;
  if (position === 'inside') return moveTreeNode(root, nodeId, targetId);

  const parent = findTreeParent(root, targetId);
  if (!parent) return null;
  if (findTreeNode(source, targetId)) return null;

  const result = structuredClone(root);
  const resultSource = findTreeNode(result, nodeId);
  const resultTarget = findTreeNode(result, targetId);
  const resultSourceParent = findTreeParent(result, nodeId);
  const resultParent = findTreeParent(result, targetId);
  if (!resultSource || !resultTarget || !resultSourceParent || !resultParent) return null;

  resultSourceParent.children = (resultSourceParent.children ?? []).filter((child) => child.id !== nodeId);
  const siblings = resultParent.children ?? [];
  const targetIndex = siblings.findIndex((child) => child.id === targetId);
  if (targetIndex < 0) return null;
  siblings.splice(position === 'before' ? targetIndex : targetIndex + 1, 0, resultSource);
  resultParent.children = siblings;
  return result;
}

export interface EstimatedTimeResult {
  valid: boolean;
  minutes: number;
  raw: string;
  error?: string;
  empty?: boolean;
  evaluated?: number;
}

export function parseEstimatedTimeExpression(input: unknown): EstimatedTimeResult {
  if (typeof input === 'number') {
    if (!Number.isFinite(input) || input < 0) {
      return { valid: false, minutes: 0, error: 'invalid-number', raw: String(input) };
    }
    return { valid: true, minutes: Math.floor(input), raw: String(input) };
  }

  const raw = String(input ?? '');
  const trimmed = raw.trim();
  if (!trimmed) return { valid: true, minutes: 0, raw, empty: true };
  if (!/^[0-9+\-*/().\s]+$/.test(trimmed)) {
    return { valid: false, minutes: 0, error: 'invalid-chars', raw };
  }

  let index = 0;
  const skipSpaces = (): void => {
    while (/\s/.test(trimmed[index] ?? '') && index < trimmed.length) index += 1;
  };
  const parseNumber = (): number | null => {
    skipSpaces();
    const start = index;
    let sawDigit = false;
    let sawDot = false;
    while (index < trimmed.length) {
      const char = trimmed[index];
      if (char >= '0' && char <= '9') {
        sawDigit = true;
        index += 1;
      } else if (char === '.' && !sawDot) {
        sawDot = true;
        index += 1;
      } else {
        break;
      }
    }
    if (!sawDigit) return null;
    const number = Number(trimmed.slice(start, index));
    return Number.isFinite(number) ? number : null;
  };
  const parsePrimary = (): number => {
    skipSpaces();
    if (trimmed[index] === '(') {
      index += 1;
      const value = parseSum();
      skipSpaces();
      if (trimmed[index] !== ')') throw new Error('missing-paren');
      index += 1;
      return value;
    }
    const number = parseNumber();
    if (number === null) throw new Error('invalid-number');
    return number;
  };
  const parseUnary = (): number => {
    skipSpaces();
    const operator = trimmed[index];
    if (operator === '+' || operator === '-') {
      index += 1;
      const value = parseUnary();
      return operator === '-' ? -value : value;
    }
    return parsePrimary();
  };
  const parseTerm = (): number => {
    let value = parseUnary();
    while (true) {
      skipSpaces();
      const operator = trimmed[index];
      if (operator !== '*' && operator !== '/') break;
      index += 1;
      const right = parseUnary();
      value = operator === '*' ? value * right : value / right;
    }
    return value;
  };
  const parseSum = (): number => {
    let value = parseTerm();
    while (true) {
      skipSpaces();
      const operator = trimmed[index];
      if (operator !== '+' && operator !== '-') break;
      index += 1;
      const right = parseTerm();
      value = operator === '+' ? value + right : value - right;
    }
    return value;
  };

  try {
    const result = parseSum();
    skipSpaces();
    if (index !== trimmed.length) return { valid: false, minutes: 0, error: 'trailing-chars', raw };
    if (!Number.isFinite(result) || result < 0) {
      return { valid: false, minutes: 0, error: 'out-of-range', raw };
    }
    return { valid: true, minutes: Math.floor(result), raw, evaluated: result };
  } catch {
    return { valid: false, minutes: 0, error: 'parse-error', raw };
  }
}

export function parseEstimatedTimeMinutes(input: unknown, fallback = 0): number {
  const result = parseEstimatedTimeExpression(input);
  return result.valid ? result.minutes : fallback;
}

function smartPlanDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function smartPlanMinutes(todo: Todo): number {
  // Missing, invalid, and non-positive estimates are treated as unestimated.
  return parseEstimatedTimeMinutes(todo.estimatedTime);
}

/** Selects tasks without mutating persisted workspace data. */
export function computeSmartPlan(
  data: WorkspaceData,
  availableMinutes: number,
  context = '',
  mode = 'balanced',
  dateFilter = 'all',
  projectId = '',
  now = new Date(),
): Todo[] {
  const capacity = Number.isFinite(availableMinutes) && availableMinutes > 0 ? Math.floor(availableMinutes) : 0;
  const todayStr = smartPlanDate(now);
  const weekEnd = new Date(now);
  weekEnd.setDate(now.getDate() + 7);
  const weekEndStr = smartPlanDate(weekEnd);
  const doneTodoIds = new Set(data.todos.filter((todo) => todo.status === 'done').map((todo) => todo.id));

  const candidates = data.todos.filter((todo) => {
    if (todo.status === 'done') return false;
    if ((Array.isArray(todo.dependencies) ? todo.dependencies : []).some((dependencyId) => !doneTodoIds.has(dependencyId))) return false;
    if (context && todo.context && todo.context !== context) return false;
    if (dateFilter === 'today' && todo.dueDate !== todayStr) return false;
    if (dateFilter === 'week' && (!todo.dueDate || todo.dueDate > weekEndStr)) return false;
    if (projectId && todo.projectId && todo.projectId !== projectId) return false;
    return true;
  });

  const priorityOrder = (data.settings.todoPriorities ?? []).map((priority) => priority.id);
  const byPriority = (a: Todo, b: Todo): number => priorityOrder.indexOf(a.priorityId || '') - priorityOrder.indexOf(b.priorityId || '');

  if (mode === 'focus') {
    candidates.sort(byPriority);
    const best = candidates.find((todo) => {
      const minutes = smartPlanMinutes(todo);
      return !minutes || minutes <= capacity;
    });
    return best ? [best] : [];
  }

  if (mode === 'sprint') {
    const withTime = candidates
      .filter((todo) => smartPlanMinutes(todo) > 0)
      .sort((a, b) => smartPlanMinutes(a) - smartPlanMinutes(b) || byPriority(a, b));
    const withoutTime = candidates.filter((todo) => smartPlanMinutes(todo) === 0);
    const plan: Todo[] = [];
    let remaining = capacity;
    for (const todo of withTime) {
      const minutes = smartPlanMinutes(todo);
      if (minutes <= remaining) {
        plan.push(todo);
        remaining -= minutes;
        if (remaining <= 0) break;
      }
    }
    withoutTime.slice(0, 2).forEach((todo) => plan.push(todo));
    return plan;
  }

  candidates.sort((a, b) => byPriority(a, b) || smartPlanMinutes(a) - smartPlanMinutes(b));
  const plan: Todo[] = [];
  const withoutTime: Todo[] = [];
  let remaining = capacity;

  for (const todo of candidates) {
    const minutes = smartPlanMinutes(todo);
    if (!minutes) withoutTime.push(todo);
    else if (minutes <= remaining) {
      plan.push(todo);
      remaining -= minutes;
      if (remaining <= 0) break;
    }
  }
  if (remaining > 0) withoutTime.slice(0, 2).forEach((todo) => plan.push(todo));
  return plan;
}

function isoDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
    ? date
    : null;
}

function localIsoDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function isoWeekday(date: Date): number {
  return date.getDay() === 0 ? 7 : date.getDay();
}

function addLocalDays(date: Date, days: number): Date {
  const copy = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  copy.setDate(copy.getDate() + days);
  return copy;
}

export function normalizeTodoRecurrence(value: unknown): TodoRecurrence | null {
  if (!value || typeof value !== 'object') return null;
  const recurrence = value as Record<string, unknown>;
  const type = String(recurrence['type'] ?? 'none');
  if (type === 'daily') return { type: 'daily' };
  if (type === 'weekly') {
    const weeklyDays = [...new Set(Array.isArray(recurrence['weeklyDays'])
      ? recurrence['weeklyDays'].map(Number).filter((day) => Number.isInteger(day) && day >= 1 && day <= 7)
      : [])].sort((a, b) => a - b);
    return weeklyDays.length ? { type: 'weekly', weeklyDays } : null;
  }
  if (type === 'monthly_nth_weekday') {
    const nth = Number(recurrence['nth']);
    const weekday = Number(recurrence['weekday']);
    if (![1, 2, 3, 4, -1].includes(nth) || !Number.isInteger(weekday) || weekday < 1 || weekday > 7) {
      return null;
    }
    return { type: 'monthly_nth_weekday', nth: nth as 1 | 2 | 3 | 4 | -1, weekday };
  }
  return null;
}

function nthWeekdayOfMonth(year: number, month: number, nth: number, weekday: number): Date | null {
  if (nth === -1) {
    const last = new Date(year, month + 1, 0);
    const shift = (isoWeekday(last) - weekday + 7) % 7;
    return new Date(year, month + 1, -shift);
  }
  const first = new Date(year, month, 1);
  const offset = (weekday - isoWeekday(first) + 7) % 7;
  const candidate = new Date(year, month, 1 + offset + (nth - 1) * 7);
  return candidate.getMonth() === month ? candidate : null;
}

export function computeNextDateFromRecurrence(
  anchorDate: string,
  recurrence: unknown,
): string | null {
  const normalized = normalizeTodoRecurrence(recurrence);
  const anchor = isoDate(anchorDate);
  if (!normalized || !anchor) return null;
  if (normalized.type === 'daily') return localIsoDate(addLocalDays(anchor, 1));
  if (normalized.type === 'weekly') {
    for (let step = 1; step <= 14; step += 1) {
      const candidate = addLocalDays(anchor, step);
      if (normalized.weeklyDays.includes(isoWeekday(candidate))) return localIsoDate(candidate);
    }
    return null;
  }
  for (let offset = 0; offset < 18; offset += 1) {
    const month = anchor.getMonth() + offset;
    const candidate = nthWeekdayOfMonth(
      anchor.getFullYear() + Math.floor(month / 12),
      ((month % 12) + 12) % 12,
      normalized.nth,
      normalized.weekday,
    );
    if (candidate && candidate.getTime() > anchor.getTime()) return localIsoDate(candidate);
  }
  return null;
}

export function buildNextRecurringTodo(
  completed: Todo,
  today: string,
  nextId: string,
  createdAt = Date.now(),
): Todo | null {
  const recurrence = normalizeTodoRecurrence(completed.recurrence);
  const anchor = completed.dueDate || completed.reminderAt?.slice(0, 10) || today;
  let nextDate = computeNextDateFromRecurrence(anchor, recurrence);
  if (!nextDate) return null;
  let guard = 0;
  while (nextDate <= today && guard < 400) {
    nextDate = computeNextDateFromRecurrence(nextDate, recurrence);
    if (!nextDate) return null;
    guard += 1;
  }
  const next: Todo = {
    ...structuredClone(completed),
    id: nextId,
    status: 'todo',
    dueDate: completed.dueDate ? nextDate : completed.dueDate,
    reminderAt: completed.reminderAt ? `${nextDate}T${completed.reminderAt.match(/T(\d{2}:\d{2})/)?.[1] ?? '00:00'}` : completed.reminderAt,
    recurrence,
    createdAt,
  };
  if (!next.dueDate && !next.reminderAt) next.dueDate = nextDate;
  return next;
}

export function createTodo(data: WorkspaceData, todo: Todo): WorkspaceData {
  const result = structuredClone(data);
  result.todos.push(structuredClone(todo));
  return result;
}

export function updateTodo(data: WorkspaceData, id: string, changes: Partial<Todo>): WorkspaceData | null {
  const result = structuredClone(data);
  const todo = result.todos.find((candidate) => candidate.id === id);
  if (!todo) return null;
  Object.assign(todo, changes);
  return result;
}

export function completeTodo(
  data: WorkspaceData,
  id: string,
  today: string,
  nextId: string,
): WorkspaceData | null {
  const current = data.todos.find((todo) => todo.id === id);
  if (!current || current.status === 'done') return null;
  const result = updateTodo(data, id, { status: 'done' });
  if (!result) return null;
  const completed = result.todos.find((todo) => todo.id === id);
  const next = completed ? buildNextRecurringTodo(completed, today, nextId) : null;
  if (next) result.todos.push(next);
  return result;
}

export function deleteTodo(data: WorkspaceData, id: string, deletedAt = Date.now()): WorkspaceData | null {
  const result = structuredClone(data);
  const index = result.todos.findIndex((todo) => todo.id === id);
  if (index < 0) return null;
  const [todo] = result.todos.splice(index, 1);
  for (const remaining of result.todos) {
    remaining.dependencies = (remaining.dependencies ?? []).filter((dependencyId) => dependencyId !== id);
  }
  result.trash.push({ ...todo, _trashType: 'todo', _deletedAt: deletedAt });
  return result;
}

export function reorderTodos(data: WorkspaceData, orderedIds: readonly string[]): WorkspaceData {
  const result = structuredClone(data);
  const byId = new Map(result.todos.map((todo) => [todo.id, todo]));
  const seen = new Set<string>();
  const ordered = orderedIds.flatMap((todoId) => {
    const todo = byId.get(todoId);
    if (!todo || seen.has(todoId)) return [];
    seen.add(todoId);
    return [todo];
  });
  result.todos = [...ordered, ...result.todos.filter((todo) => !seen.has(todo.id))];
  return result;
}

export function saveTodoSavedView(data: WorkspaceData, view: TodoSavedView, updatedAt = Date.now()): WorkspaceData {
  const result = structuredClone(data);
  const normalized: TodoSavedView = {
    ...structuredClone(view),
    name: String(view.name || '').trim(),
    filters: {
      ...todoViewFilters(view.filters),
    },
    viewMode: view.viewMode || 'columns',
    createdAt: Number(view.createdAt) || updatedAt,
    updatedAt,
  };
  result.settings.todoSavedViews = [
    ...(result.settings.todoSavedViews ?? []).filter((candidate) => candidate.id !== normalized.id),
    normalized,
  ].sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }));
  return result;
}

export function deleteTodoSavedView(data: WorkspaceData, id: string): WorkspaceData | null {
  const result = structuredClone(data);
  const views = result.settings.todoSavedViews ?? [];
  const next = views.filter((view) => view.id !== id);
  if (next.length === views.length) return null;
  result.settings.todoSavedViews = next;
  return result;
}

export function addTodoPriority(data: WorkspaceData, priority: TodoPriority): WorkspaceData {
  const result = structuredClone(data);
  result.settings.todoPriorities = [...(result.settings.todoPriorities ?? []), structuredClone(priority)];
  return result;
}

export function deleteTodoPriority(data: WorkspaceData, id: string): WorkspaceData | null {
  const result = structuredClone(data);
  const priorities = result.settings.todoPriorities ?? [];
  const next = priorities.filter((priority) => priority.id !== id);
  if (next.length === priorities.length) return null;
  result.settings.todoPriorities = next;
  return result;
}

export function trackVisit(
  data: WorkspaceData,
  type: string,
  id: string,
  name: string,
  color?: string,
  visitedAt = Date.now(),
): WorkspaceData {
  const result = structuredClone(data);
  result.recentlyVisited = [
    { type, id, name, color, visitedAt },
    ...result.recentlyVisited.filter((entry) => !(entry.type === type && entry.id === id)),
  ].slice(0, 12);
  return result;
}

export function trackActivity(
  data: WorkspaceData,
  entry: Omit<ActivityLogEntry, 'ts'>,
  timestamp = Date.now(),
): WorkspaceData {
  const result = structuredClone(data);
  result.activityLog = [
    { ...entry, ts: timestamp } as ActivityLogEntry,
    ...result.activityLog,
  ].slice(0, 40);
  return result;
}

export function createJournalEntry(data: WorkspaceData, entry: JournalEntry): WorkspaceData {
  const result = structuredClone(data);
  result.journal.push(structuredClone(entry));
  return result;
}

export function updateJournalEntry(
  data: WorkspaceData,
  id: string,
  changes: Partial<Pick<JournalEntry, 'title' | 'content' | 'mood' | 'tags'>>,
  updatedAt = Date.now(),
): WorkspaceData | null {
  const result = structuredClone(data);
  const entry = result.journal.find((candidate) => candidate.id === id);
  if (!entry) return null;
  Object.assign(entry, changes, { updatedAt });
  return result;
}

export function deleteJournalEntry(data: WorkspaceData, id: string, deletedAt = Date.now()): WorkspaceData | null {
  const result = structuredClone(data);
  const index = result.journal.findIndex((entry) => entry.id === id);
  if (index < 0) return null;
  const [entry] = result.journal.splice(index, 1);
  result.trash.push({ ...entry, _trashType: 'journal', _deletedAt: deletedAt });
  return result;
}

export function addRhNode(data: WorkspaceData, parentId: string, node: RhNode): WorkspaceData | null {
  const result = structuredClone(data);
  const parent = parentId === 'root' ? result.rh : findTreeNode(result.rh, parentId);
  if (!parent || parent.nodeType !== 'folder') return null;
  parent.children = [...(parent.children ?? []), structuredClone(node)];
  return result;
}

export function updateRhNode(
  data: WorkspaceData,
  id: string,
  changes: Partial<RhNode>,
): WorkspaceData | null {
  const result = structuredClone(data);
  const node = findTreeNode(result.rh, id);
  if (!node) return null;
  Object.assign(node, changes);
  return result;
}

export function deleteRhNode(data: WorkspaceData, id: string, deletedAt = Date.now()): WorkspaceData | null {
  const result = structuredClone(data);
  const parent = findTreeParent(result.rh, id);
  if (!parent) return null;
  const children = parent.children ?? [];
  const index = children.findIndex((child) => child.id === id);
  if (index < 0) return null;
  const [node] = children.splice(index, 1);
  result.trash.push({ ...node, _trashType: 'rh', _rhParentId: parent.id, _deletedAt: deletedAt });
  return result;
}

export type SnippetMixedEntry =
  | { token: string; type: 'folder'; item: SnippetFolder }
  | { token: string; type: 'snippet'; item: Snippet };

function snippetFolder(root: SnippetFolder, id: string): SnippetFolder | null {
  if (root.id === id) return root;
  for (const child of root.children ?? []) {
    const found = snippetFolder(child, id);
    if (found) return found;
  }
  return null;
}

function snippetFolderParent(root: SnippetFolder, id: string): SnippetFolder | null {
  if ((root.children ?? []).some((child) => child.id === id)) return root;
  for (const child of root.children ?? []) {
    const found = snippetFolderParent(child, id);
    if (found) return found;
  }
  return null;
}

function snippetOrderKey(folderId: string | null): string {
  return folderId && folderId !== 'root' ? folderId : 'root';
}

export function getSnippetMixedOrder(data: WorkspaceData, folderId: string | null = null): string[] {
  const key = snippetOrderKey(folderId);
  const parent = key === 'root' ? data.snippetFolders : snippetFolder(data.snippetFolders, key);
  if (!parent) return [];
  const valid = [
    ...(parent.children ?? []).map((folder) => `f:${folder.id}`),
    ...data.snippets.filter((snippet) => (snippet.folderId || null) === (key === 'root' ? null : key)).map((snippet) => `s:${snippet.id}`),
  ];
  const validSet = new Set(valid);
  const stored = (data.snippetMixedOrder?.[key] ?? []).filter((token) => validSet.has(token));
  return [...stored, ...valid.filter((token) => !stored.includes(token))];
}

export function getSnippetMixedEntries(data: WorkspaceData, folderId: string | null = null): SnippetMixedEntry[] {
  const folders = new Map<string, SnippetFolder>();
  const walk = (folder: SnippetFolder): void => {
    folders.set(folder.id, folder);
    folder.children?.forEach(walk);
  };
  walk(data.snippetFolders);
  const snippets = new Map(data.snippets.map((snippet) => [snippet.id, snippet]));
  return getSnippetMixedOrder(data, folderId).flatMap((token): SnippetMixedEntry[] => {
    const [type, id] = token.split(':', 2);
    const item = type === 'f' ? folders.get(id) : snippets.get(id);
    if (!item) return [];
    return type === 'f'
      ? [{ token, type: 'folder', item: item as SnippetFolder }]
      : [{ token, type: 'snippet', item: item as Snippet }];
  });
}

export function reorderSnippetMixed(
  data: WorkspaceData,
  folderId: string | null,
  sourceToken: string,
  targetToken: string,
  before: boolean,
): WorkspaceData | null {
  const order = getSnippetMixedOrder(data, folderId);
  if (sourceToken === targetToken || !order.includes(sourceToken) || !order.includes(targetToken)) return null;
  const result = structuredClone(data);
  const key = snippetOrderKey(folderId);
  const compact = order.filter((token) => token !== sourceToken);
  const targetIndex = compact.indexOf(targetToken);
  compact.splice(before ? targetIndex : targetIndex + 1, 0, sourceToken);
  result.snippetMixedOrder[key] = compact;
  return result;
}

export function moveSnippetIntoFolder(
  data: WorkspaceData,
  sourceId: string,
  sourceType: 'folder' | 'snippet',
  fromFolderId: string | null,
  targetFolderId: string | null,
): WorkspaceData | null {
  if (sourceId === targetFolderId) return null;
  const result = structuredClone(data);
  const targetKey = snippetOrderKey(targetFolderId);
  const target = targetKey === 'root' ? result.snippetFolders : snippetFolder(result.snippetFolders, targetKey);
  if (!target) return null;
  const sourceToken = `${sourceType === 'folder' ? 'f' : 's'}:${sourceId}`;

  if (sourceType === 'folder') {
    const source = snippetFolder(result.snippetFolders, sourceId);
    const parent = snippetFolderParent(result.snippetFolders, sourceId);
    if (!source || !parent || snippetFolder(source, targetKey)) return null;
    parent.children = parent.children.filter((child) => child.id !== sourceId);
    target.children = [...target.children, source];
  } else {
    const source = result.snippets.find((snippet) => snippet.id === sourceId);
    if (!source) return null;
    source.folderId = targetKey === 'root' ? null : targetKey;
  }

  const fromKey = snippetOrderKey(fromFolderId);
  result.snippetMixedOrder[fromKey] = getSnippetMixedOrder(result, fromFolderId).filter((token) => token !== sourceToken);
  const targetOrder = getSnippetMixedOrder(result, targetFolderId).filter((token) => token !== sourceToken);
  result.snippetMixedOrder[targetKey] = [...targetOrder, sourceToken];
  return result;
}

export function updateSnippet(data: WorkspaceData, id: string, changes: Partial<Snippet>): WorkspaceData | null {
  const result = structuredClone(data);
  const snippet = result.snippets.find((candidate) => candidate.id === id);
  if (!snippet) return null;
  Object.assign(snippet, changes);
  return result;
}

export function addSnippet(data: WorkspaceData, snippet: Snippet): WorkspaceData {
  const result = structuredClone(data);
  result.snippets.push(structuredClone(snippet));
  const key = snippetOrderKey(snippet.folderId);
  result.snippetMixedOrder[key] = [...getSnippetMixedOrder(result, snippet.folderId).filter((token) => token !== `s:${snippet.id}`), `s:${snippet.id}`];
  return result;
}

export function deleteSnippet(data: WorkspaceData, id: string, deletedAt = Date.now()): WorkspaceData | null {
  const result = structuredClone(data);
  const index = result.snippets.findIndex((snippet) => snippet.id === id);
  if (index < 0) return null;
  const [snippet] = result.snippets.splice(index, 1);
  const key = snippetOrderKey(snippet.folderId);
  result.snippetMixedOrder[key] = getSnippetMixedOrder(result, snippet.folderId).filter((token) => token !== `s:${id}`);
  result.trash.push({ ...snippet, _trashType: 'snippet', _deletedAt: deletedAt });
  return result;
}

export function deleteSnippetFolder(data: WorkspaceData, id: string): WorkspaceData | null {
  const result = structuredClone(data);
  const folder = snippetFolder(result.snippetFolders, id);
  const parent = snippetFolderParent(result.snippetFolders, id);
  if (!folder || !parent) return null;

  const descendantIds = new Set<string>();
  const collect = (current: SnippetFolder): void => {
    descendantIds.add(current.id);
    current.children?.forEach(collect);
  };
  collect(folder);

  const parentId = parent.id === 'root' ? null : parent.id;
  const parentKey = snippetOrderKey(parentId);
  const folderToken = `f:${id}`;
  const descendantFolderIds = [...descendantIds].filter((folderId) => folderId !== id);
  const movedFolderTokens = folder.children.map((child) => `f:${child.id}`);
  const movedSnippetIds = result.snippets.filter((snippet) => descendantIds.has(snippet.folderId ?? '')).map((snippet) => snippet.id);
  const movedTokens = new Set([folderToken, ...descendantFolderIds.map((folderId) => `f:${folderId}`), ...movedSnippetIds.map((snippetId) => `s:${snippetId}`)]);
  const parentOrder = getSnippetMixedOrder(result, parentId).filter((token) => !movedTokens.has(token));
  const targetIndex = Math.max(0, getSnippetMixedOrder(result, parentId).indexOf(folderToken));
  parentOrder.splice(Math.min(targetIndex, parentOrder.length), 0, ...movedFolderTokens, ...movedSnippetIds.map((snippetId) => `s:${snippetId}`));

  for (const key of Object.keys(result.snippetMixedOrder)) {
    result.snippetMixedOrder[key] = result.snippetMixedOrder[key].filter((token) => !movedTokens.has(token));
  }
  result.snippetMixedOrder[parentKey] = parentOrder;
  delete result.snippetMixedOrder[id];

  const parentIndex = parent.children.findIndex((child) => child.id === id);
  if (parentIndex < 0) return null;
  parent.children.splice(parentIndex, 1, ...folder.children);
  for (const snippet of result.snippets) {
    if (descendantIds.has(snippet.folderId ?? '')) snippet.folderId = parentId;
  }
  return result;
}

export function parseSnippetImport(
  content: string,
  filename: string,
  folderId: string | null,
  makeId: () => string,
): Snippet[] | null {
  const lowerName = filename.toLowerCase();
  if (lowerName.endsWith('.json')) {
    let parsed: unknown;
    try { parsed = JSON.parse(content); } catch { return null; }
    let records: unknown[];
    if (Array.isArray(parsed)) records = parsed;
    else if (parsed && typeof parsed === 'object' && Array.isArray((parsed as Record<string, unknown>)['snippets'])) records = (parsed as Record<string, unknown>)['snippets'] as unknown[];
    else records = [parsed];
    if (!records.length) return null;
    const sourceIds = records.map((record) => record && typeof record === 'object' ? (record as Record<string, unknown>)['id'] : undefined).filter((value): value is string => typeof value === 'string');
    if (new Set(sourceIds).size !== sourceIds.length) return null;
    try {
      return records.map((record) => {
        if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error('invalid-snippet');
        const value = record as Record<string, unknown>;
        if (typeof value['title'] !== 'string' || !value['title'].trim() || typeof value['code'] !== 'string' || typeof value['language'] !== 'string' || !Array.isArray(value['tags']) || !value['tags'].every((tag) => typeof tag === 'string')) throw new Error('invalid-snippet');
        return { ...structuredClone(value), id: makeId(), title: value['title'].trim(), code: value['code'], language: value['language'], tags: value['tags'], favorite: value['favorite'] === true, folderId: folderId || null } as unknown as Snippet;
      });
    } catch {
      return null;
    }
  }

  const title = filename.replace(/\.[^.]+$/, '').trim();
  if (!title || !content.trim()) return null;
  const language = lowerName.endsWith('.md') || lowerName.endsWith('.markdown') ? 'markdown' : lowerName.endsWith('.ts') ? 'typescript' : lowerName.endsWith('.js') ? 'javascript' : lowerName.endsWith('.py') ? 'python' : lowerName.endsWith('.css') ? 'css' : lowerName.endsWith('.html') ? 'html' : 'plaintext';
  return [{ id: makeId(), title, code: content, language, tags: [], favorite: false, folderId: folderId || null }];
}

function addChild(root: TreeNode, parentId: string, node: TreeNode): boolean {
  const parent = findTreeNode(root, parentId);
  if (!parent || parent.nodeType !== 'folder') return false;
  parent.children = [...(parent.children ?? []), node];
  return true;
}

export function restoreFromTrash(data: WorkspaceData, id: string): WorkspaceData | null {
  const result = structuredClone(data);
  const index = result.trash.findIndex((entry) => entry.id === id);
  if (index < 0) return null;
  const [entry] = result.trash.splice(index, 1) as [TrashEntry & Record<string, unknown>];
  const type = entry['_trashType'];
  const item: Record<string, unknown> = { ...entry };
  delete item['_trashType'];
  delete item['_deletedAt'];

  switch (type) {
    case 'todo': result.todos.push(item as unknown as Todo); break;
    case 'project': result.projects.push(item as unknown as WorkspaceData['projects'][number]); break;
    case 'journal': result.journal.push(item as unknown as WorkspaceData['journal'][number]); break;
    case 'snippet': result.snippets.push(item as unknown as WorkspaceData['snippets'][number]); break;
    case 'rh': {
      const parentId = String(entry['_rhParentId'] ?? 'root');
      delete item['_rhParentId'];
      if (!addChild(result.rh, parentId, item as TreeNode)) addChild(result.rh, 'root', item as TreeNode);
      break;
    }
    case 'project-node': {
      const projectId = String(item['_projectId'] ?? '');
      const parentId = String(item['_nodeParentId'] ?? projectId);
      const project = result.projects.find((candidate) => candidate.id === projectId);
      delete item['_projectId'];
      delete item['_projectName'];
      delete item['_nodeParentId'];
      if (project) {
        const root: TreeNode = { id: project.id, nodeType: 'folder', children: project.children };
        if (!addChild(root, parentId, item as TreeNode)) addChild(root, project.id, item as TreeNode);
        project.children = root.children as typeof project.children;
      }
      break;
    }
    default: return null;
  }
  return result;
}
