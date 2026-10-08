import Dexie from 'dexie';
import { TestBed } from '@angular/core/testing';
import fixture from '../../../../../fixtures/workspace-full.json';
import { WorkspaceDbService } from '../persistence/workspace-db.service';
import { WorkspaceStoreService } from '../persistence/workspace-store.service';
import {
  WORKSPACE_DATA_KEY,
  WORKSPACE_DB_NAME,
  WORKSPACE_DB_VERSION,
} from '../persistence/workspace-data';
import type { WorkspaceData } from '../persistence/workspace-data';
import { parseWorkspaceImport } from '../persistence/workspace-import';
import { WorkspaceBackupService } from './workspace-backup.service';
import { WorkspaceImportService } from './workspace-import.service';
import { PasswordVaultService } from '../security/password-vault.service';

/** Relit la valeur reellement persistee, sans passer par le store en memoire. */
async function readPersisted(): Promise<WorkspaceData> {
  const db = new Dexie(WORKSPACE_DB_NAME);
  db.version(WORKSPACE_DB_VERSION).stores({ kv: 'key' });
  const row = await db.table('kv').get(WORKSPACE_DATA_KEY);
  db.close();
  return row?.value as WorkspaceData;
}

describe('WorkspaceImportService against a real IndexedDB', () => {
  let service: WorkspaceImportService;
  let store: WorkspaceStoreService;
  let db: WorkspaceDbService;
  let source: WorkspaceData;

  beforeEach(async () => {
    await Dexie.delete(WORKSPACE_DB_NAME);
    localStorage.clear();
    source = structuredClone(fixture.data) as WorkspaceData;

    const seed = new Dexie(WORKSPACE_DB_NAME);
    seed.version(WORKSPACE_DB_VERSION).stores({ kv: 'key' });
    await seed.table('kv').put({ key: WORKSPACE_DATA_KEY, value: source });
    seed.close();

    TestBed.configureTestingModule({
      providers: [
        WorkspaceImportService,
        WorkspaceStoreService,
        WorkspaceDbService,
        { provide: WorkspaceBackupService, useValue: { saveWorkspaceBackup: async () => ({ saved: true, method: 'download' }) } },
        { provide: PasswordVaultService, useValue: { invalidateSession: () => undefined } },
      ],
    });
    db = TestBed.inject(WorkspaceDbService);
    store = TestBed.inject(WorkspaceStoreService);
    service = TestBed.inject(WorkspaceImportService);
    await store.init();
  });

  afterEach(async () => {
    db.ngOnDestroy();
    await Dexie.delete(WORKSPACE_DB_NAME);
    localStorage.clear();
  });

  it('persists a merged import that survives a fresh read', async () => {
    const imported = parseWorkspaceImport(
      JSON.stringify([{ ...source.todos[0], title: 'Importée sur disque' }]),
      'workspace-todos.json',
    );

    await service.apply(imported, 'merge');

    const persisted = await readPersisted();
    expect(persisted.todos.find((todo) => todo.id === source.todos[0].id)?.title).toBe('Importée sur disque');
    expect(persisted.todos).toHaveLength(source.todos.length);
    expect(persisted.projects).toEqual(source.projects);
  });

  it('leaves the stored workspace untouched when the first write fails', async () => {
    const flush = vi.spyOn(db, 'flush');
    flush.mockRejectedValueOnce(new Error('persistence failure'));
    const imported = parseWorkspaceImport(
      JSON.stringify([{ ...source.todos[0], title: 'Jamais persistée' }]),
      'workspace-todos.json',
    );

    await expect(service.apply(imported, 'merge')).rejects.toThrow('persistence failure');
    flush.mockRestore();

    // Etat memoire restaure, puis relecture depuis IndexedDB apres l'echec.
    // Le flush force toute ecriture encore en attente : sans rollback, la valeur
    // importee serait ecrite ici et les assertions echoueraient.
    await store.flush();
    expect(store.data()?.todos.find((todo) => todo.id === source.todos[0].id)?.title)
      .toBe(source.todos[0].title);
    const persisted = await readPersisted();
    expect(persisted.todos.find((todo) => todo.id === source.todos[0].id)?.title)
      .toBe(source.todos[0].title);
    expect(persisted).toEqual(store.data());
  });
});
