import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import fixture from '../../../../../fixtures/workspace-full.json';
import type { WorkspaceData } from '../persistence/workspace-data';
import { parseWorkspaceImport, type WorkspaceImport } from '../persistence/workspace-import';
import { WorkspaceBackupService } from './workspace-backup.service';
import { WorkspaceImportService } from './workspace-import.service';
import { WorkspaceStoreService } from '../persistence/workspace-store.service';
import { PasswordVaultService } from '../security/password-vault.service';

describe('WorkspaceImportService', () => {
  let service: WorkspaceImportService;
  let data: ReturnType<typeof signal<WorkspaceData>>;
  let replace: ReturnType<typeof vi.fn>;
  let flush: ReturnType<typeof vi.fn>;
  let saveWorkspaceBackup: ReturnType<typeof vi.fn>;
  let invalidateSession: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    data = signal(structuredClone(fixture.data) as WorkspaceData);
    replace = vi.fn((next: WorkspaceData) => { data.set(next); return next; });
    flush = vi.fn(async () => undefined);
    saveWorkspaceBackup = vi.fn(async () => ({ saved: true, method: 'download' }));
    invalidateSession = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        WorkspaceImportService,
        { provide: WorkspaceStoreService, useValue: { data: data.asReadonly(), init: async () => data(), replace, flush } },
        { provide: WorkspaceBackupService, useValue: { saveWorkspaceBackup } },
        { provide: PasswordVaultService, useValue: { invalidateSession } },
      ],
    });
    service = TestBed.inject(WorkspaceImportService);
  });

  it('merges a valid section without replacing absent sections', async () => {
    const imported = parseWorkspaceImport(JSON.stringify([{ ...fixture.data.todos[0], title: 'Importée' }]), 'todos.json');
    await expect(service.apply(imported, 'merge')).resolves.toEqual({ mode: 'merge', full: false });

    expect(data().todos.find((todo) => todo.id === fixture.data.todos[0].id)?.title).toBe('Importée');
    expect(data().projects).toEqual(fixture.data.projects);
    expect(replace).toHaveBeenCalledTimes(1);
    expect(flush).toHaveBeenCalledTimes(1);
    expect(saveWorkspaceBackup).not.toHaveBeenCalled();
    expect(invalidateSession).toHaveBeenCalledTimes(1);
  });

  it('rejects invalid JSON before touching the store', async () => {
    await expect(service.readFile({
      name: 'broken.json',
      text: async () => '{invalid',
    } as unknown as File))
      .rejects.toThrow('Fichier JSON invalide');
    expect(replace).not.toHaveBeenCalled();
    expect(flush).not.toHaveBeenCalled();
  });

  it('requires and creates a backup before a complete overwrite', async () => {
    const imported = parseWorkspaceImport(JSON.stringify(fixture), 'workspace-full.json');
    await expect(service.apply(imported, 'overwrite')).resolves.toEqual({ mode: 'overwrite', full: true });

    expect(saveWorkspaceBackup).toHaveBeenCalledWith({ preferPicker: true });
    expect(replace).toHaveBeenCalledTimes(1);
    expect(data()).toEqual(fixture.data);
    expect(invalidateSession).toHaveBeenCalledTimes(1);
  });

  it('accepts a legacy complete export with missing newer optional fields', async () => {
    const legacy = {
      projects: fixture.data.projects,
      rh: fixture.data.rh,
      todos: [{ id: 'legacy-todo', title: 'Tache legacy', status: 'todo' }],
      snippets: [{ id: 'legacy-snippet', title: 'Snippet legacy', code: 'echo legacy' }],
      snippetFolders: fixture.data.snippetFolders,
      favorites: fixture.data.favorites,
      settings: { theme: 'dark' },
    };
    const imported = parseWorkspaceImport(JSON.stringify(legacy), 'workspace-legacy.json');

    await expect(service.apply(imported, 'overwrite')).resolves.toEqual({ mode: 'overwrite', full: true });
    expect(data().todos).toMatchObject([{ id: 'legacy-todo', title: 'Tache legacy', status: 'todo', dependencies: [], tags: [], recurrence: null }]);
    expect(data().snippets).toMatchObject([{ id: 'legacy-snippet', title: 'Snippet legacy', code: 'echo legacy', language: 'plaintext', tags: [], favorite: false, folderId: null }]);
  });

  it('does not write when the required overwrite backup is cancelled', async () => {
    saveWorkspaceBackup.mockResolvedValue({ saved: false, cancelled: true });
    const imported = parseWorkspaceImport(JSON.stringify(fixture), 'workspace-full.json');

    await expect(service.apply(imported, 'overwrite')).rejects.toThrow('sauvegarde préalable');
    expect(replace).not.toHaveBeenCalled();
    expect(flush).not.toHaveBeenCalled();
  });

  it('does not allow overwrite mode for a section import', async () => {
    const imported = parseWorkspaceImport(JSON.stringify([{ ...fixture.data.todos[0] }]), 'todos.json');

    await expect(service.apply(imported, 'overwrite')).rejects.toThrow('sauvegarde complète');
    expect(saveWorkspaceBackup).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  it('rolls back the in-memory state when persistence fails', async () => {
    const original = structuredClone(data());
    flush.mockRejectedValueOnce(new Error('persistence failure')).mockResolvedValueOnce(undefined);
    const imported: WorkspaceImport = parseWorkspaceImport(JSON.stringify([{ ...fixture.data.todos[0], title: 'Importée' }]), 'todos.json');

    await expect(service.apply(imported, 'merge')).rejects.toThrow('persistence failure');
    expect(data()).toEqual(original);
    expect(replace).toHaveBeenCalledTimes(2);
    expect(flush).toHaveBeenCalledTimes(2);
  });

  it('aborts when the workspace changes during the overwrite backup', async () => {
    const imported = parseWorkspaceImport(JSON.stringify(fixture), 'workspace-full.json');
    saveWorkspaceBackup.mockImplementation(async () => {
      data.update((current) => ({ ...current, todos: [] }));
      return { saved: true, method: 'download' };
    });

    await expect(service.apply(imported, 'overwrite')).rejects.toThrow('données ont changé');
    expect(replace).not.toHaveBeenCalled();
    expect(data().todos).toEqual([]);
  });
});
