import Dexie from 'dexie';
import fixture from '../../../../../fixtures/workspace-full.json';
import { WorkspaceDbService } from './workspace-db.service';
import {
  BACKUP_DIR_HANDLE_KEY,
  LEGACY_STORAGE_KEY,
  WORKSPACE_DATA_KEY,
  WORKSPACE_DB_NAME,
  WORKSPACE_DB_VERSION,
} from './workspace-data';
import type { WorkspaceData } from './workspace-data';

function openRawDb(): Dexie {
  const db = new Dexie(WORKSPACE_DB_NAME);
  db.version(WORKSPACE_DB_VERSION).stores({ kv: 'key' });
  return db;
}

describe('WorkspaceDbService', () => {
  let service: WorkspaceDbService;

  beforeEach(async () => {
    await Dexie.delete(WORKSPACE_DB_NAME);
    localStorage.clear();
    service = new WorkspaceDbService();
  });

  afterEach(async () => {
    service.ngOnDestroy();
    await Dexie.delete(WORKSPACE_DB_NAME);
    localStorage.clear();
  });

  it('opens the legacy database and writes the latest opaque value', async () => {
    const source = structuredClone(fixture.data) as WorkspaceData;
    const db = openRawDb();
    await db.table('kv').put({ key: WORKSPACE_DATA_KEY, value: source });
    db.close();

    await service.init();
    expect(service.getSync()).toEqual(source);

    const updated = { ...source, futureSection: { preserved: true } };
    service.setSync(updated);
    await service.flush();

    const reopened = openRawDb();
    const row = await reopened.table('kv').get(WORKSPACE_DATA_KEY);
    reopened.close();
    expect(row.value).toEqual(updated);
  });

  it('grants one writer and refuses writes from a concurrent window', async () => {
    const source = structuredClone(fixture.data) as WorkspaceData;
    const db = openRawDb();
    await db.table('kv').put({ key: WORKSPACE_DATA_KEY, value: source });
    db.close();

    await service.init();
    const request = vi.spyOn(navigator.locks, 'request').mockImplementation((_name, _options, callback) => {
      void callback(null);
      return Promise.resolve(undefined);
    });
    const secondWindow = new WorkspaceDbService();
    await secondWindow.init();
    expect(service.canWrite()).toBe(true);
    expect(secondWindow.canWrite()).toBe(false);
    expect(secondWindow.setSync({ overwritten: true })).toBe(false);

    const reopened = openRawDb();
    expect((await reopened.table('kv').get(WORKSPACE_DATA_KEY))?.value).toEqual(source);
    reopened.close();
    secondWindow.ngOnDestroy();
    request.mockRestore();
  });

  it('migrates the raw localStorage value only when the data row is absent', async () => {
    const legacy = {
      projects: [],
      todos: [],
      unknownLegacySection: { keep: 'value' },
    };
    localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify(legacy));

    await service.init();

    expect(service.getSync()).toEqual(legacy);
    const db = openRawDb();
    const row = await db.table('kv').get(WORKSPACE_DATA_KEY);
    db.close();
    expect(row.value).toEqual(legacy);
    expect(localStorage.getItem(LEGACY_STORAGE_KEY)).toBe(JSON.stringify(legacy));
  });

  it('does not read or duplicate the legacy value after a repeated startup', async () => {
    const legacy = { projects: [], settings: { theme: 'dark' } };
    localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify(legacy));

    await service.init();
    service.ngOnDestroy();

    const secondService = new WorkspaceDbService();
    const getItem = vi.spyOn(Storage.prototype, 'getItem');
    await secondService.init();

    expect(secondService.legacyMigrationState()).toBe('already-present');
    expect(secondService.getSync()).toEqual(legacy);
    expect(getItem).not.toHaveBeenCalledWith(LEGACY_STORAGE_KEY);

    getItem.mockRestore();
    secondService.ngOnDestroy();
  });

  it('reports invalid legacy JSON without deleting it or changing an existing row', async () => {
    const existing = { projects: [{ id: 'existing' }], settings: { theme: 'dark' } };
    const db = openRawDb();
    await db.table('kv').put({ key: WORKSPACE_DATA_KEY, value: existing });
    db.close();
    localStorage.setItem(LEGACY_STORAGE_KEY, '{invalid');

    await service.init();

    expect(service.legacyMigrationState()).toBe('already-present');
    expect(service.getSync()).toEqual(existing);
    expect(localStorage.getItem(LEGACY_STORAGE_KEY)).toBe('{invalid');
  });

  it('reports invalid JSON when no IndexedDB row exists', async () => {
    localStorage.setItem(LEGACY_STORAGE_KEY, '{invalid');

    await service.init();

    expect(service.legacyMigrationState()).toBe('invalid-json');
    expect(service.legacyMigrationError()).toBe('Legacy Workspace data is not valid JSON');
    const db = openRawDb();
    expect(await db.table('kv').get(WORKSPACE_DATA_KEY)).toBeUndefined();
    db.close();
  });

  it('reports blocked localStorage without failing the Angular startup', async () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('Storage blocked');
    });

    await service.init();

    expect(service.legacyMigrationState()).toBe('storage-unavailable');
    expect(service.legacyMigrationError()).toBe('Legacy browser storage is unavailable');
    expect(service.getSync()).toBeNull();
    getItem.mockRestore();
  });

  it('keeps backup directory handles in the legacy key-value store', async () => {
    await service.init();
    const handle = { kind: 'directory', name: 'Workspace backups' } as unknown as FileSystemDirectoryHandle;

    await service.setBackupDirectoryHandle(handle);
    expect(await service.getBackupDirectoryHandle()).toEqual(handle);

    const db = openRawDb();
    expect(await db.table('kv').get(BACKUP_DIR_HANDLE_KEY)).toEqual({
      key: BACKUP_DIR_HANDLE_KEY,
      value: handle,
    });
    db.close();

    await service.setBackupDirectoryHandle(null);
    expect(await service.getBackupDirectoryHandle()).toBeNull();
  });

  it('surfaces persistence failures without logging the value', async () => {
    await service.init();
    service.setSync({ broken: () => 'not cloneable' });

    await expect(service.flush()).rejects.toBeTruthy();
    expect(service.persistenceError()).toBe('Workspace persistence is unavailable');
  });
});
