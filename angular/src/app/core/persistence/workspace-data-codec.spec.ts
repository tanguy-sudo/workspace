import fixture from '../../../../../fixtures/workspace-full.json';
import vaultFixture from '../../../../../fixtures/workspace-with-vault.json';
import legacyFixture from '../../../../../fixtures/workspace-legacy-local-storage.json';
import {
  parseWorkspaceExport,
  serializeWorkspaceExport,
} from './workspace-data-codec';
import {
  mergeWorkspaceImport,
  parseWorkspaceImport,
  validateWorkspaceImport,
} from './workspace-import';
import { completeWorkspaceData } from './workspace-store.service';
import type {
  FavoriteFolder,
  ProjectFolder,
  ProjectItem,
  RhFolder,
  WorkspaceData,
} from './workspace-data';
import { MAX_IMPORT_BYTES, MAX_IMPORT_STRING_LENGTH, MIN_VAULT_ITERATIONS, MAX_VAULT_ITERATIONS } from './workspace-import';

describe('Workspace data contract', () => {
  it('keeps every contract section and representative critical fields after a round-trip', () => {
    const source = structuredClone(fixture.data) as WorkspaceData;
    const sourceProject = source.projects[0];
    const sourceApiFolder = sourceProject.children[0] as ProjectFolder;
    const sourceApiItem = sourceApiFolder.children[0] as ProjectItem;

    const encoded = serializeWorkspaceExport(source);
    const roundTripped = parseWorkspaceExport(encoded).data;

    expect(roundTripped.projects).toHaveLength(source.projects.length);
    expect(roundTripped.projects[1].parentId).toBe(source.projects[1].parentId);
    expect(roundTripped.projects[0].children[0].id).toBe(sourceApiFolder.id);
    const roundTrippedApiFolder = roundTripped.projects[0].children[0] as ProjectFolder;
    const roundTrippedApiItem = roundTrippedApiFolder.children[0] as ProjectItem;
    expect(roundTrippedApiItem.id).toBe(sourceApiItem.id);
    expect(roundTrippedApiItem.file).toEqual(sourceApiItem.file);
    const roundTrippedRhTeam = (roundTripped.rh.children[0] as RhFolder);
    const roundTrippedRhOnboarding = roundTrippedRhTeam.children[0] as RhFolder;
    expect(roundTrippedRhOnboarding.children[0].id).toBe('rh-guide');
    expect(roundTripped.todos.find((todo) => todo.id === 'todo-weekly')?.recurrence).toEqual(
      source.todos.find((todo) => todo.id === 'todo-weekly')?.recurrence,
    );
    expect(roundTripped.snippetMixedOrder).toEqual(source.snippetMixedOrder);
    const roundTrippedFavorites = roundTripped.favorites.children[0] as FavoriteFolder;
    expect(roundTrippedFavorites.children[0].id).toBe('favorite-project');
    expect(roundTripped.journal[0].content).toBe(source.journal[0].content);
    expect(roundTripped.trash[0]._trashType).toBe('todo');
    expect(roundTripped.activityLog[0].action).toBe('create');
    expect(roundTripped.settings.todoSavedViews[0].filters).toEqual(
      source.settings.todoSavedViews[0].filters,
    );

    const vault = parseWorkspaceExport(
      serializeWorkspaceExport(vaultFixture.data as WorkspaceData),
    ).data;
    expect(vault.settings.secretVault?.iterations).toBe(250000);
    expect(vault.projects[0].children[0]).toMatchObject({
      id: 'vault-folder-a',
    });
    expect((vault.projects[0].children[0] as ProjectFolder).children[0]).toMatchObject({
      id: 'vault-item-a',
      secretEncrypted: { iv: expect.any(String), cipher: expect.any(String) },
    });
  });

  it('preserves fields unknown to the current Angular increment', () => {
    const source = structuredClone(fixture.data) as WorkspaceData;
    source['futureSection'] = { keep: ['this', 'value'] };
    source.projects[0]['futureProjectField'] = { keep: true };
    (source.projects[0].children[0] as ProjectFolder).children[0]['futureItemField'] = 'unchanged';

    const roundTripped = parseWorkspaceExport(serializeWorkspaceExport(source)).data;

    expect(roundTripped['futureSection']).toEqual({ keep: ['this', 'value'] });
    expect(roundTripped.projects[0]['futureProjectField']).toEqual({ keep: true });
    expect(
      (roundTripped.projects[0].children[0] as ProjectFolder).children[0]['futureItemField'],
    ).toBe('unchanged');
  });

  it('rejects an export when a required section is missing', () => {
    const source = structuredClone(fixture.data) as Partial<WorkspaceData>;
    delete source.activityLog;

    expect(() => serializeWorkspaceExport(source as WorkspaceData)).toThrow(/activityLog/);
  });

  it('recognizes complete and historical section imports', () => {
    expect(parseWorkspaceImport(JSON.stringify(fixture), 'workspace-full.json')).toMatchObject({ full: true });
    expect(parseWorkspaceImport(JSON.stringify(legacyFixture), 'workspace-legacy.json')).toMatchObject({
      full: true,
    });
    expect(parseWorkspaceImport(JSON.stringify(fixture.data.todos), 'workspace-todos.json')).toMatchObject({
      full: false,
      data: { todos: fixture.data.todos },
    });
    expect(parseWorkspaceImport(JSON.stringify([{ ...fixture.data.projects[1], parentId: 'not-in-section' }]), 'workspace-projects.json'))
      .toMatchObject({ full: false, data: { projects: [{ parentId: 'not-in-section' }] } });
    expect(parseWorkspaceImport(JSON.stringify({ snippets: fixture.data.snippets, folders: fixture.data.snippetFolders }), 'workspace-snippets.json'))
      .toMatchObject({ data: { snippets: fixture.data.snippets, snippetFolders: fixture.data.snippetFolders } });
    expect(parseWorkspaceImport(JSON.stringify({ snippets: fixture.data.snippets, folders: null }), 'workspace-snippets.json'))
      .toMatchObject({ data: { snippets: fixture.data.snippets } });
    expect(parseWorkspaceImport(JSON.stringify(fixture.data.settings), 'workspace-parametres.json'))
      .toMatchObject({ data: { settings: fixture.data.settings } });
  });

  it('rejects duplicate IDs, malformed types, cycles and altered vault payloads', () => {
    const duplicate = structuredClone(fixture.data.todos);
    duplicate.push(structuredClone(duplicate[0]));
    expect(() => validateWorkspaceImport({ todos: duplicate }, false)).toThrow(/identifiant dupliqué/);

    const malformed = structuredClone(fixture.data);
    (malformed.todos[0] as unknown as Record<string, unknown>)['tags'] = 'fixture';
    expect(() => validateWorkspaceImport(malformed)).toThrow(/todos\[0\]\.tags/);

    const alteredVault = structuredClone(vaultFixture.data);
    const project = alteredVault.projects[0] as unknown as { children: unknown[] };
    const folder = project.children[0] as { children: unknown[] };
    const password = folder.children[0] as Record<string, unknown>;
    (password['secretEncrypted'] as Record<string, unknown>)['iv'] = 'invalid';
    expect(() => validateWorkspaceImport(alteredVault)).toThrow(/secretEncrypted\.iv/);
  });

  it('rejects oversized imports and unsafe vault work factors', () => {
    expect(() => parseWorkspaceImport('x'.repeat(MAX_IMPORT_BYTES + 1), 'workspace.json')).toThrow(/trop volumineux/);
    expect(() => parseWorkspaceImport(JSON.stringify([{ id: 'todo', title: 'x'.repeat(MAX_IMPORT_STRING_LENGTH + 1), status: 'todo' }]), 'todos.json'))
      .toThrow(/longueur maximale/);

    const oversizedIterations = structuredClone(vaultFixture.data) as WorkspaceData;
    oversizedIterations.settings.secretVault!.iterations = MAX_VAULT_ITERATIONS + 1;
    expect(() => validateWorkspaceImport(oversizedIterations)).toThrow(/entre/);

    const weakIterations = structuredClone(vaultFixture.data) as WorkspaceData;
    weakIterations.settings.secretVault!.iterations = MIN_VAULT_ITERATIONS - 1;
    expect(() => validateWorkspaceImport(weakIterations)).toThrow(/entre/);
  });

  it('merges arrays by ID and retains sections absent from partial imports', () => {
    const current = structuredClone(fixture.data) as WorkspaceData;
    const imported = { todos: [{ ...current.todos[0], title: 'Updated' }] };
    const merged = mergeWorkspaceImport(current, imported);

    expect(merged.todos).toHaveLength(current.todos.length);
    expect(merged.todos[0].title).toBe('Updated');
    expect(merged.projects).toEqual(current.projects);
    expect(merged.settings).toEqual(current.settings);
  });

  it('preserves distinct visits and activity events during a merge', () => {
    const current = structuredClone(fixture.data) as WorkspaceData;
    const imported = {
      recentlyVisited: [
        { type: 'project', id: 'project-alpha', name: 'Projet Alpha', visitedAt: 10 },
        { type: 'todo', id: 'todo-daily', name: 'Boot', visitedAt: 11 },
      ],
      activityLog: [
        { type: 'todo', action: 'update', label: 'Autre événement', id: 'todo-daily', ts: 12 },
      ],
    };
    const merged = mergeWorkspaceImport(current, imported);

    expect(merged.recentlyVisited).toHaveLength(current.recentlyVisited.length + 1);
    expect(merged.recentlyVisited.find((entry) => entry.type === 'project' && entry.id === 'project-alpha')?.visitedAt).toBe(10);
    expect(merged.activityLog).toHaveLength(current.activityLog.length + 1);
  });

  it('completes legacy saved-view and task aliases without losing source fields', () => {
    const legacy = completeWorkspaceData({
      projects: [],
      rh: { id: 'root', name: 'RH', nodeType: 'folder', children: [] },
      todos: [{ id: 'legacy', title: 'Legacy', note: 'Description legacy', priority: 'normal' }],
      snippets: [{ id: 'snippet', title: 'Snippet', code: 'echo ok' }],
      snippetFolders: { id: 'root', name: 'Snippets', nodeType: 'folder', children: [] },
      favorites: { id: 'root', name: 'Favoris', nodeType: 'folder', children: [] },
      settings: { theme: 'dark', todoSavedViews: [{ id: 'view', name: 'View', filters: { status: 'all' } }] },
    });

    expect(legacy.todos[0]).toMatchObject({ description: 'Description legacy', priorityId: 'normal', dependencies: [], tags: [], recurrence: null });
    expect(legacy.todos[0]['note']).toBe('Description legacy');
    expect(legacy.snippets[0]).toMatchObject({ language: 'plaintext', tags: [], favorite: false, folderId: null });
    expect(legacy.settings.todoSavedViews[0].filters).toMatchObject({ status: 'all', priority: 'all', context: 'all', project: 'all', due: 'all' });
  });
});

describe('Workspace import edge cases', () => {
  it('accepts an activity event without id and keeps it distinct on merge', () => {
    const anonymous = { type: 'todo', action: 'update', label: 'Sans identifiant', ts: 50 };
    expect(() => validateWorkspaceImport({ activityLog: [anonymous] }, false)).not.toThrow();

    const current = structuredClone(fixture.data) as WorkspaceData;
    const merged = mergeWorkspaceImport(current, { activityLog: [anonymous, structuredClone(anonymous)] });

    expect(merged.activityLog).toHaveLength(current.activityLog.length + 1);
  });

  it('rejects duplicate visits sharing the same (type, id) and collapses them on merge', () => {
    const visit = { type: 'project', id: 'project-alpha', name: 'Projet Alpha', visitedAt: 20 };
    expect(() => validateWorkspaceImport({ recentlyVisited: [visit, { ...visit, visitedAt: 21 }] }, false))
      .toThrow(/visite dupliquée/);

    const current = structuredClone(fixture.data) as WorkspaceData;
    const merged = mergeWorkspaceImport(current, { recentlyVisited: [visit] });

    expect(merged.recentlyVisited.filter((entry) => entry.id === 'project-alpha')).toHaveLength(1);
    expect(merged.recentlyVisited).toHaveLength(current.recentlyVisited.length);
  });

  it('caps merged history at 12 visits and 40 activity events, keeping the most recent', () => {
    const current = structuredClone(fixture.data) as WorkspaceData;
    const merged = mergeWorkspaceImport(current, {
      recentlyVisited: Array.from({ length: 20 }, (_, index) => ({
        type: 'todo', id: `visit-${index}`, name: `Visite ${index}`, visitedAt: 2_000_000_000_000 + index,
      })),
      activityLog: Array.from({ length: 60 }, (_, index) => ({
        type: 'todo', action: 'update', label: `Evenement ${index}`, ts: 2_000_000_000_000 + index,
      })),
    });

    expect(merged.recentlyVisited).toHaveLength(12);
    expect(merged.recentlyVisited[0].id).toBe('visit-19');
    expect(merged.activityLog).toHaveLength(40);
    expect(merged.activityLog[0].label).toBe('Evenement 59');
  });

  it('normalizes the legacy done, estimatedTime, name and note aliases before validation', () => {
    const todos = parseWorkspaceImport(
      JSON.stringify([{ id: 'legacy-todo', title: 'Legacy', done: true, estimatedTime: '30 + 15', note: 'Note legacy' }]),
      'workspace-todos.json',
    );
    expect(todos.data.todos?.[0]).toMatchObject({ status: 'done', estimatedTime: 45, note: 'Note legacy' });

    const snippets = parseWorkspaceImport(
      JSON.stringify([{ id: 'legacy-snippet', name: 'Snippet legacy', content: 'echo ok' }]),
      'workspace-snippets.json',
    );
    expect(snippets.data.snippets?.[0]).toMatchObject({ title: 'Snippet legacy', code: 'echo ok' });

    const journal = parseWorkspaceImport(
      JSON.stringify([{ id: 'legacy-entry', note: 'Contenu legacy' }]),
      'workspace-journal.json',
    );
    expect(journal.data.journal?.[0]).toMatchObject({ content: 'Contenu legacy' });
  });

  it('validates every trash payload type, with or without historical restore metadata', () => {
    const projectNode = {
      id: 'trash-node', nodeType: 'item', type: 'memo', title: 'Memo supprime',
      _trashType: 'project-node', _deletedAt: 1764806400000,
      _projectId: 'project-alpha', _projectName: 'Projet Alpha', _nodeParentId: 'folder-api',
    };
    const rhNode = {
      id: 'trash-rh', nodeType: 'document', title: 'Document supprime',
      _trashType: 'rh', _deletedAt: 1764806400000, _rhParentId: 'rh-team',
    };
    const project = {
      id: 'trash-project', name: 'Projet supprime', children: [],
      _trashType: 'project', _deletedAt: 1764806400000,
    };
    expect(() => validateWorkspaceImport({ trash: [projectNode, rhNode, project] }, false)).not.toThrow();

    // Exports historiques : la metadonnee de parent peut manquer, la restauration legacy retombe sur la racine.
    const { _nodeParentId, ...nodeWithoutParent } = projectNode;
    const { _rhParentId, ...rhWithoutParent } = rhNode;
    expect(() => validateWorkspaceImport({ trash: [nodeWithoutParent, rhWithoutParent] }, false)).not.toThrow();

    const { _projectId, ...nodeWithoutProject } = projectNode;
    expect(() => validateWorkspaceImport({ trash: [nodeWithoutProject] }, false)).toThrow(/_projectId/);
    expect(() => validateWorkspaceImport({ trash: [{ ...project, _trashType: 'inconnu' }] }, false))
      .toThrow(/_trashType/);
  });

  it('merges trees without dropping branches absent from the imported file', () => {
    const current = structuredClone(fixture.data) as WorkspaceData;
    const merged = mergeWorkspaceImport(current, {
      rh: {
        id: 'root', name: 'RH', nodeType: 'folder',
        children: [{
          id: 'rh-team', nodeType: 'folder', name: 'Equipe renommee',
          children: [{ id: 'rh-notes', nodeType: 'document', title: 'Notes' }],
        }],
      } as unknown as WorkspaceData['rh'],
    });

    const team = merged.rh.children[0] as RhFolder;
    expect(team.name).toBe('Equipe renommee');
    expect(team.children.map((child) => child.id)).toEqual(['rh-onboarding', 'rh-notes']);
    const onboarding = team.children[0] as RhFolder;
    expect(onboarding.children[0].id).toBe('rh-guide');
    expect(merged.favorites).toEqual(current.favorites);
  });
});
