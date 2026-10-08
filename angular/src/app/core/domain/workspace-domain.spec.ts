import fixture from '../../../../../fixtures/workspace-full.json';
import {
  buildNextRecurringTodo,
  createTodo,
  completeTodo,
  deleteTodo,
  reorderTodos,
  saveTodoSavedView,
  deleteTodoSavedView,
  addTodoPriority,
  deleteTodoPriority,
  collectTreeNodes,
  computeNextDateFromRecurrence,
  countTreeNodes,
  createJournalEntry,
  addRhNode,
  dropTreeNode,
  deleteRhNode,
  deleteJournalEntry,
  findTreeNode,
  moveTreeNode,
  normalizeTodoRecurrence,
  parseEstimatedTimeExpression,
  restoreFromTrash,
  trackActivity,
  trackVisit,
  updateJournalEntry,
  updateRhNode,
  getSnippetMixedOrder,
  getSnippetMixedEntries,
  reorderSnippetMixed,
  moveSnippetIntoFolder,
  deleteSnippetFolder,
  parseSnippetImport,
  addProjectNode,
  deleteProjectNode,
  dropProjectNode,
  findProjectNode,
  findProjectNodePath,
  moveProjectNode,
  projectItemCount,
  projectNodeMatchesType,
  reorderProjectChildren,
  updateProjectNode,
  countProjectItems,
  createProjectId,
  computeSmartPlan,
  deleteProjectTree,
  projectAncestors,
  projectChildren,
  projectDescendants,
} from './workspace-domain';
import type { Project, ProjectFolder, ProjectNode, Todo, WorkspaceData } from '../persistence/workspace-data';

describe('Workspace pure domain functions', () => {
  it('walks and counts fixture trees without DOM dependencies', () => {
    const data = fixture.data as WorkspaceData;
    const nodes = data.projects.flatMap((project) => project.children) as ProjectNode[];
    expect(countTreeNodes(nodes)).toBe(9);
    expect(collectTreeNodes(nodes, (node) => node.nodeType === 'item')).toHaveLength(5);
  });

  it('rejects cyclic moves and preserves order on valid moves', () => {
    const root = structuredClone(fixture.data.projects[0].children[0]) as unknown as ProjectFolder;
    const descendant = root.children[0].id;
    expect(moveTreeNode(root, root.id, descendant)).toBeNull();

    const moved = moveTreeNode(root, descendant, root.id);
    expect(moved?.children?.at(-1)?.id).toBe(descendant);
    expect(root.children[0].id).toBe(descendant);
  });

  it('reorders and nests nodes without mutating the source tree', () => {
    const root = structuredClone(fixture.data.projects[0].children[0]) as unknown as ProjectFolder;
    const originalOrder = root.children.map((child) => child.id);
    const first = root.children[0].id;
    const second = root.children[1].id;

    const before = dropTreeNode(root, second, first, 'before');
    expect(before?.children?.map((child) => child.id)).toEqual([second, first, ...originalOrder.slice(2)]);
    expect(root.children.map((child) => child.id)).toEqual(originalOrder);

    const inside = dropTreeNode(root, first, root.id, 'inside');
    expect(inside?.children?.some((child) => child.id === first)).toBe(true);
    expect(dropTreeNode(root, root.id, first, 'inside')).toBeNull();
    expect(dropTreeNode(root, first, first, 'after')).toBeNull();
    expect(dropTreeNode(root, first, 'missing', 'after')).toBeNull();
  });

  it('keeps the historical estimation parser behavior', () => {
    expect(parseEstimatedTimeExpression('(30+15)*2').minutes).toBe(90);
    expect(parseEstimatedTimeExpression('60/0').valid).toBe(false);
    expect(parseEstimatedTimeExpression('alert(1)').valid).toBe(false);
  });

  it('selects smart-plan candidates with the historical filters and date bounds', () => {
    const source = structuredClone(fixture.data) as WorkspaceData;
    source.todos = [
      { id: 'today', title: 'Today', status: 'todo', priorityId: 'urgent', context: 'bureau', estimatedTime: 30, dependencies: [], tags: [], dueDate: '2026-02-02', projectId: 'project-alpha', recurrence: null },
      { id: 'week', title: 'Week', status: 'todo', priorityId: 'important', context: 'bureau', estimatedTime: 60, dependencies: [], tags: [], dueDate: '2026-02-09', projectId: 'project-beta', recurrence: null },
      { id: 'overdue', title: 'Overdue', status: 'todo', priorityId: 'normal', context: 'bureau', estimatedTime: 15, dependencies: [], tags: [], dueDate: '2026-01-31', projectId: 'project-alpha', recurrence: null },
      { id: 'no-date', title: 'No date', status: 'todo', priorityId: 'basse', context: '', estimatedTime: 0, dependencies: [], tags: [], dueDate: '', recurrence: null },
      { id: 'after-week', title: 'After week', status: 'todo', priorityId: 'urgent', context: 'bureau', estimatedTime: 10, dependencies: [], tags: [], dueDate: '2026-02-10', projectId: 'project-beta', recurrence: null },
      { id: 'done', title: 'Done', status: 'done', priorityId: 'urgent', context: 'bureau', estimatedTime: 5, dependencies: [], tags: [], dueDate: '2026-02-02', recurrence: null },
      { id: 'blocked', title: 'Blocked', status: 'todo', priorityId: 'urgent', context: 'bureau', estimatedTime: 5, dependencies: ['missing'], tags: [], dueDate: '2026-02-02', recurrence: null },
    ] as Todo[];
    const now = new Date(2026, 1, 2, 12);

    expect(computeSmartPlan(source, 200, 'bureau', 'balanced', 'today', '', now).map((todo) => todo.id)).toEqual(['today']);
    expect(computeSmartPlan(source, 200, 'bureau', 'balanced', 'week', '', now).map((todo) => todo.id)).toEqual(['today', 'week', 'overdue']);
    expect(computeSmartPlan(source, 200, 'bureau', 'balanced', 'all', 'project-alpha', now).map((todo) => todo.id)).toEqual(['today', 'overdue', 'no-date']);
  });

  it('keeps focus, balanced and sprint ordering rules including unestimated tasks', () => {
    const source = structuredClone(fixture.data) as WorkspaceData;
    source.todos = [
      { id: 'urgent-long', title: 'Urgent long', status: 'todo', priorityId: 'urgent', estimatedTime: 120, dependencies: [], tags: [], recurrence: null },
      { id: 'important-short', title: 'Important short', status: 'todo', priorityId: 'important', estimatedTime: 20, dependencies: [], tags: [], recurrence: null },
      { id: 'normal-invalid', title: 'Invalid estimate', status: 'todo', priorityId: 'normal', estimatedTime: 'alert(1)', dependencies: [], tags: [], recurrence: null },
      { id: 'low-zero', title: 'Zero estimate', status: 'todo', priorityId: 'basse', estimatedTime: 0, dependencies: [], tags: [], recurrence: null },
      { id: 'low-negative', title: 'Negative estimate', status: 'todo', priorityId: 'basse', estimatedTime: -5, dependencies: [], tags: [], recurrence: null },
    ] as unknown as Todo[];
    const now = new Date(2026, 1, 2, 12);

    expect(computeSmartPlan(source, 30, '', 'focus', 'all', '', now).map((todo) => todo.id)).toEqual(['important-short']);
    expect(computeSmartPlan(source, 30, '', 'balanced', 'all', '', now).map((todo) => todo.id)).toEqual(['important-short', 'normal-invalid', 'low-zero']);
    expect(computeSmartPlan(source, 30, '', 'sprint', 'all', '', now).map((todo) => todo.id)).toEqual(['important-short', 'normal-invalid', 'low-zero']);
  });

  it('computes local recurrence dates for all supported recurrence types', () => {
    expect(computeNextDateFromRecurrence('2026-02-02', { type: 'daily' })).toBe('2026-02-03');
    expect(computeNextDateFromRecurrence('2026-12-31', { type: 'daily' })).toBe('2027-01-01');
    expect(computeNextDateFromRecurrence('2026-02-02', { type: 'weekly', weeklyDays: [5] })).toBe('2026-02-06');
    expect(computeNextDateFromRecurrence('2026-12-31', { type: 'weekly', weeklyDays: [1] })).toBe('2027-01-04');
    expect(computeNextDateFromRecurrence('2026-01-30', { type: 'monthly_nth_weekday', nth: -1, weekday: 5 })).toBe('2026-02-27');
    expect(normalizeTodoRecurrence({ type: 'weekly', weeklyDays: [5, 5, 0] })).toEqual({ type: 'weekly', weeklyDays: [5] });
  });

  it('builds the next recurring task without mutating the completed task', () => {
    const completed = structuredClone(fixture.data.todos[0]) as WorkspaceData['todos'][number];
    const next = buildNextRecurringTodo(completed, '2026-02-02', 'next-id');
    expect(next?.id).toBe('next-id');
    expect(next?.status).toBe('todo');
    expect(next?.dueDate).toBe('2026-02-03');
    expect(next?.createdAt).not.toBe(completed.createdAt);
    expect(completed.id).toBe('todo-daily');
  });

  it('keeps task CRUD, recurrence, order, views and priorities compatible', () => {
    const source = fixture.data as WorkspaceData;
    const todo = {
      id: 'todo-new',
      title: 'Nouvelle tâche',
      description: '',
      status: 'todo',
      priorityId: 'normal',
      context: '@bureau',
      attachedTo: '',
      estimatedTime: 60,
      dependencies: ['todo-daily'],
      tags: ['test'],
      dueDate: '2026-02-02',
      reminderAt: '2026-02-02T09:00',
      recurrence: { type: 'daily' as const },
      pinned: false,
      projectId: 'project-alpha',
      createdAt: 10,
    };
    const created = createTodo(source, todo);
    expect(created.todos.at(-1)?.id).toBe('todo-new');
    const completed = completeTodo(created, 'todo-new', '2026-02-02', 'todo-next');
    expect(completed?.todos.find((item) => item.id === 'todo-new')?.status).toBe('done');
    expect(completed?.todos.find((item) => item.id === 'todo-next')).toMatchObject({ dueDate: '2026-02-03', status: 'todo' });

    const reordered = reorderTodos(completed!, ['todo-next', 'todo-new']);
    expect(reordered.todos.slice(0, 2).map((item) => item.id)).toEqual(['todo-next', 'todo-new']);
    const view = saveTodoSavedView(reordered, {
      id: 'view-new', name: 'A faire', filters: { status: 'todo', priority: 'all', context: 'all', project: 'all', due: 'all' }, viewMode: 'list',
    });
    expect(view.settings.todoSavedViews.find((item) => item.id === 'view-new')).toMatchObject({ id: 'view-new', viewMode: 'list' });
    const withoutView = deleteTodoSavedView(view, 'view-new');
    expect(withoutView?.settings.todoSavedViews.some((item) => item.id === 'view-new')).toBe(false);
    const withPriority = addTodoPriority(withoutView!, { id: 'critical', label: 'Critique', color: '#ff0000' });
    expect(withPriority.settings.todoPriorities.at(-1)?.id).toBe('critical');
    const withoutPriority = deleteTodoPriority(withPriority, 'critical');
    expect(withoutPriority?.settings.todoPriorities.some((item) => item.id === 'critical')).toBe(false);
    const deleted = deleteTodo(withoutPriority!, 'todo-new', 123);
    expect(deleted?.trash.at(-1)).toMatchObject({ id: 'todo-new', _trashType: 'todo', _deletedAt: 123 });
    expect(deleted?.todos.find((item) => item.id === 'todo-next')?.dependencies).not.toContain('todo-new');
  });

  it('restores trash and caps visit/activity histories', () => {
    const source = fixture.data as WorkspaceData;
    const restored = restoreFromTrash(source, 'todo-deleted');
    expect(restored?.todos.some((todo) => todo.id === 'todo-deleted')).toBe(true);
    expect(source.todos.some((todo) => todo.id === 'todo-deleted')).toBe(false);

    let visited = source;
    for (let index = 0; index < 14; index += 1) visited = trackVisit(visited, 'project', `p-${index}`, `P${index}`, undefined, index);
    expect(visited.recentlyVisited).toHaveLength(12);
    const withActivity = trackActivity(visited, { type: 'todo', action: 'update', label: 'Task' }, 1);
    expect(withActivity.activityLog[0].ts).toBe(1);
  });

  it('creates, updates and moves journal entries to trash without mutation', () => {
    const source = fixture.data as WorkspaceData;
    const created = {
      id: 'journal-new', title: 'Nouvelle note', content: '# Notes', mood: 'good', tags: ['test'], createdAt: 10, updatedAt: 10,
    };
    const withEntry = createJournalEntry(source, created);
    expect(withEntry.journal.some((entry) => entry.id === 'journal-new')).toBe(true);
    expect(source.journal.some((entry) => entry.id === 'journal-new')).toBe(false);

    const updated = updateJournalEntry(withEntry, 'journal-new', { content: 'Mis a jour' }, 20);
    expect(updated?.journal.find((entry) => entry.id === 'journal-new')?.updatedAt).toBe(20);
    const removed = deleteJournalEntry(updated as WorkspaceData, 'journal-new', 30);
    expect(removed?.journal.some((entry) => entry.id === 'journal-new')).toBe(false);
    expect(removed?.trash.find((entry) => entry.id === 'journal-new')).toMatchObject({ _trashType: 'journal', _deletedAt: 30 });
  });

  it('mutates RH nodes and restores deleted documents with their parent', () => {
    const source = fixture.data as WorkspaceData;
    const folder: WorkspaceData['rh']['children'][number] = {
      id: 'rh-new-folder', nodeType: 'folder', name: 'Nouveau dossier', children: [], createdAt: 40,
    };
    const withFolder = addRhNode(source, 'root', folder);
    expect(withFolder?.rh.children.at(-1)?.id).toBe('rh-new-folder');
    expect(source.rh.children.some((node) => node.id === 'rh-new-folder')).toBe(false);

    const document = { id: 'rh-new-document', nodeType: 'document' as const, title: 'Nouveau document', note: '', tags: [], file: null };
    const withDocument = addRhNode(withFolder as WorkspaceData, 'rh-new-folder', document);
    const changed = updateRhNode(withDocument as WorkspaceData, 'rh-new-document', { title: 'Document modifie', pinned: true });
    expect(changed?.rh.children.at(-1)?.['unknown']).toBeUndefined();
    expect((findTreeNode(changed!.rh, 'rh-new-document') as Record<string, unknown>)['pinned']).toBe(true);

    const deleted = deleteRhNode(changed as WorkspaceData, 'rh-new-document', 50);
    expect(deleted?.trash.at(-1)).toMatchObject({ id: 'rh-new-document', _trashType: 'rh', _rhParentId: 'rh-new-folder', _deletedAt: 50 });
    const restored = restoreFromTrash(deleted as WorkspaceData, 'rh-new-document');
    expect(findTreeNode(restored!.rh, 'rh-new-document')?.['title']).toBe('Document modifie');
    expect(restored?.trash.some((entry) => entry.id === 'rh-new-document')).toBe(false);
  });

  it('preserves the historical mixed snippet order and supports moves', () => {
    const source = fixture.data as WorkspaceData;
    expect(getSnippetMixedOrder(source)).toEqual(['f:snippet-tools', 's:snippet-markdown']);
    expect(getSnippetMixedOrder(source, 'snippet-tools')).toEqual(['f:snippet-sql-folder', 's:snippet-json']);
    expect(getSnippetMixedOrder(source, 'snippet-sql-folder')).toEqual(['s:snippet-sql-item']);
    expect(getSnippetMixedEntries(source, 'snippet-tools').map((entry) => entry.item.id)).toEqual(['snippet-sql-folder', 'snippet-json']);

    const reordered = reorderSnippetMixed(source, 'snippet-tools', 's:snippet-json', 'f:snippet-sql-folder', true);
    expect(getSnippetMixedOrder(reordered!, 'snippet-tools')).toEqual(['s:snippet-json', 'f:snippet-sql-folder']);
    expect(getSnippetMixedOrder(source, 'snippet-tools')).toEqual(['f:snippet-sql-folder', 's:snippet-json']);

    const moved = moveSnippetIntoFolder(source, 'snippet-json', 'snippet', 'snippet-tools', 'snippet-sql-folder');
    expect(moved?.snippets.find((snippet) => snippet.id === 'snippet-json')?.folderId).toBe('snippet-sql-folder');
    expect(getSnippetMixedOrder(moved!, 'snippet-sql-folder')).toContain('s:snippet-json');
  });

  it('reads project scopes, ancestors and recursive item counts without mutation', () => {
    const source = fixture.data as WorkspaceData;
    expect(projectChildren(source.projects).map((project) => project.id)).toEqual(['project-alpha']);
    expect(projectAncestors(source.projects, 'project-gamma').map((project) => project.id)).toEqual(['project-alpha', 'project-beta']);
    expect(projectDescendants(source.projects, 'project-alpha').map((project) => project.id)).toEqual(['project-beta', 'project-gamma']);
    expect(countProjectItems(source.projects[0])).toEqual({ folder: 3, link: 1, memo: 1, code: 1, info: 1, password: 1 });
    expect(createProjectId('Projet Alpha', source.projects, () => 'generated-id')).toBe('projet-alpha');

    const cyclic = [
      { id: 'a', name: 'A', parentId: 'b', categories: [], children: [] },
      { id: 'b', name: 'B', parentId: 'a', categories: [], children: [] },
    ] as Project[];
    expect(projectDescendants(cyclic, 'a').map((project) => project.id)).toEqual(['b']);
    expect(projectAncestors(cyclic, 'a').map((project) => project.id)).toEqual(['b']);
    expect(createProjectId('A'.repeat(80), [], () => 'generated-id')).toHaveLength(60);
    expect(createProjectId('Projet Alpha', [{ ...source.projects[0], id: 'projet-alpha' }], () => 'generated-id')).toMatch(/^projet-alpha-/);
  });

  it('deletes a project subtree into the existing trash contract', () => {
    const source = fixture.data as WorkspaceData;
    const result = deleteProjectTree(source, 'project-alpha', 123);
    expect(result?.projects.map((project) => project.id)).toEqual([]);
    expect(result?.recentlyVisited.every((visit) => visit.type !== 'project')).toBe(true);
    expect(result?.trash.at(-1)).toMatchObject({ id: 'project-alpha', _trashType: 'project', _deletedAt: 123 });
    expect(source.projects).toHaveLength(3);
  });

  it('mutates project nodes while preserving order, paths and unknown fields', () => {
    const source = fixture.data as WorkspaceData;
    const folder = { id: 'new-folder', nodeType: 'folder' as const, name: 'Nouveau', children: [] };
    const added = addProjectNode(source, 'project-alpha', 'project-alpha', folder);
    expect(added?.projects[0].children.at(-1)?.id).toBe('new-folder');
    expect(findProjectNodePath(added!.projects[0], 'item-alpha-code')).toEqual([
      'project-alpha', 'folder-alpha-docs', 'folder-alpha-api', 'item-alpha-code',
    ]);
    expect(projectItemCount(added!.projects[0])).toBe(5);
    expect(projectNodeMatchesType(added!.projects[0].children[0], 'code')).toBe(true);

    const updated = updateProjectNode(added!, 'project-alpha', 'new-folder', {
      name: 'Renomme',
      futureNodeField: { keep: true },
    });
    expect(findProjectNode(updated!.projects[0], 'new-folder')).toMatchObject({
      name: 'Renomme', futureNodeField: { keep: true },
    });

    const moved = moveProjectNode(updated!, 'project-alpha', 'item-alpha-code', 'new-folder');
    expect(findProjectNode(moved!.projects[0], 'new-folder')?.['children']).toHaveLength(1);
    const reordered = reorderProjectChildren(moved!, 'project-alpha', 'project-alpha', ['new-folder']);
    expect(reordered?.projects[0].children.at(0)?.id).toBe('new-folder');
    const dropped = dropProjectNode(reordered!, 'project-alpha', 'new-folder', 'folder-alpha-docs', 'before');
    expect(dropped?.projects[0].children.at(0)?.id).toBe('new-folder');

    const deleted = deleteProjectNode(dropped!, 'project-alpha', 'new-folder', 123);
    expect(findProjectNode(deleted!.projects[0], 'new-folder')).toBeNull();
    expect(deleted?.trash.at(-1)).toMatchObject({ id: 'new-folder', _trashType: 'project-node', _nodeParentId: 'project-alpha', _deletedAt: 123 });
    expect(source.projects[0].children.at(-1)?.id).toBe('folder-alpha-security');
  });

  it('rejects invalid snippet imports without creating records', () => {
    expect(parseSnippetImport('{"title":"","code":"x","language":"js","tags":[]}', 'bad.json', null, () => 'id')).toBeNull();
    expect(parseSnippetImport('{"title":"Valid","code":"x","language":"js","tags":[]}', 'valid.json', null, () => 'id')).toEqual([
      expect.objectContaining({ id: 'id', title: 'Valid', folderId: null }),
    ]);
    expect(parseSnippetImport('console.log(1)', 'example.js', 'snippet-tools', () => 'id')).toEqual([
      expect.objectContaining({ id: 'id', language: 'javascript', folderId: 'snippet-tools' }),
    ]);
  });

  it('removes a snippet folder and reparents its contents', () => {
    const source = structuredClone(fixture.data) as WorkspaceData;
    const deleted = deleteSnippetFolder(source, 'snippet-sql-folder');

    expect(deleted?.snippetFolders.children[0].children).toEqual([]);
    expect(deleted?.snippets.find((snippet) => snippet.id === 'snippet-sql-item')?.folderId).toBe('snippet-tools');
    expect(deleted?.snippetMixedOrder['snippet-tools']).toContain('s:snippet-sql-item');
    expect(source.snippetFolders.children[0].children[0].id).toBe('snippet-sql-folder');
  });
});
