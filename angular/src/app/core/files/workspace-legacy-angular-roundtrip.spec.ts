import Dexie from 'dexie';
import { JSDOM } from 'jsdom';
import type { BeforeParseWindow } from 'jsdom';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { TestBed } from '@angular/core/testing';
import emptyFixture from '../../../../../fixtures/workspace-empty.json';
import fullFixture from '../../../../../fixtures/workspace-full.json';
import vaultFixture from '../../../../../fixtures/workspace-with-vault.json';
import { WorkspaceBackupService } from './workspace-backup.service';
import { WorkspaceImportService } from './workspace-import.service';
import { WorkspaceDbService } from '../persistence/workspace-db.service';
import { completeWorkspaceData, WorkspaceStoreService } from '../persistence/workspace-store.service';
import {
  WORKSPACE_DATA_KEY,
  WORKSPACE_DB_NAME,
  WORKSPACE_DB_VERSION,
} from '../persistence/workspace-data';
import type { ProjectFolder, ProjectItem, RhFolder, WorkspaceData } from '../persistence/workspace-data';
import { PasswordVaultService } from '../security/password-vault.service';
import { workspaceJson } from '../export/workspace-export';

interface LegacyRoundTripApi {
  clear(): Promise<void>;
  flush(): Promise<void>;
  getData(): WorkspaceData;
  setData(data: WorkspaceData): void;
  exportAllJson(): Promise<void>;
  importFull(json: string, filename?: string): WorkspaceData;
  exportedBlob(): Blob | null;
  close(): void;
  writeAccess(): string;
  readBlob(blob: Blob): Promise<string>;
}

interface LegacyRoundTripWindow extends Window {
  WorkspaceDB_READY: Promise<unknown>;
  __legacyRoundTripApi?: LegacyRoundTripApi;
  eval(source: string): void;
}

function rawDb(): Dexie {
  const db = new Dexie(WORKSPACE_DB_NAME);
  db.version(WORKSPACE_DB_VERSION).stores({ kv: 'key' });
  return db;
}

async function writePersisted(data: WorkspaceData): Promise<void> {
  const db = rawDb();
  await db.table('kv').put({ key: WORKSPACE_DATA_KEY, value: structuredClone(data) });
  db.close();
}

async function readPersisted(): Promise<WorkspaceData> {
  const db = rawDb();
  const row = await db.table('kv').get(WORKSPACE_DATA_KEY);
  db.close();
  return row.value as WorkspaceData;
}

async function loadLegacyRuntime(writeLockAvailable = true): Promise<LegacyRoundTripApi> {
  const source = async (...parts: string[]): Promise<string> => readFile(resolve(process.cwd(), '..', ...parts), 'utf8');
  const [dbSource, safeStorageSource, storageSource, commonUtilsSource, convertersSource, importSource, exportSource] = await Promise.all([
    source('js', 'db.js'),
    source('js', 'safe-storage.js'),
    source('js', 'storage.js'),
    source('js', 'common-utils.js'),
    source('js', 'pages', 'export-converters.js'),
    source('js', 'pages', 'export-import.js'),
    source('js', 'pages', 'export.js'),
  ]);
  const dom = new JSDOM('<!doctype html><body></body>', {
    url: 'https://workspace.invalid/export.html',
    runScripts: 'dangerously',
    beforeParse: (target: BeforeParseWindow) => {
      Object.defineProperty(target, 'Dexie', { configurable: true, value: Dexie });
      Object.defineProperty(target, 'indexedDB', { configurable: true, value: globalThis.indexedDB });
      Object.defineProperty(target, 'IDBKeyRange', { configurable: true, value: globalThis.IDBKeyRange });
      Object.defineProperty((target as unknown as Window).navigator, 'locks', {
        configurable: true,
        value: { request: (_name: string, _options: unknown, callback: (lock: { name: string } | null) => Promise<void>) => callback(writeLockAvailable ? { name: 'workspace:data-write' } : null) },
      });
    },
  });
  const target = dom.window as unknown as LegacyRoundTripWindow;
  target.eval(dbSource);
  target.eval(safeStorageSource);
  target.eval(storageSource);
  target.eval(commonUtilsSource);
  target.eval(convertersSource);
  target.eval(importSource);
  target.eval(`
    bootPage = () => undefined;
    saveBlobAsFile = async (blob) => {
      window.__legacyExportedBlob = blob;
      return { saved: true, method: 'test' };
    };
    showToast = () => undefined;
    window.__legacyRoundTripApi = {
      clear: () => WorkspaceDB.clear(),
      flush: () => WorkspaceDB.flush(),
      getData: () => getData(),
      setData: (data) => setData(data),
      exportAllJson: () => exportAllJson(),
      exportedBlob: () => window.__legacyExportedBlob || null,
      importFull: (json, filename = 'workspace.json') => {
        const parsed = JSON.parse(json);
        let imported = normalizeImportPayload(parsed, filename);
        _validateImportData(imported, _looksLikeFullWorkspace(imported));
        imported = typeof _normalizeImportedWorkspaceData === 'function'
          ? _normalizeImportedWorkspaceData(imported)
          : imported;
        const next = _completeImportData(imported);
        _validateImportData(next, true);
        setData(next);
        return next;
      },
      close: () => window.close(),
      writeAccess: () => WorkspaceDB.writeAccess,
      readBlob: (blob) => new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsText(blob);
      }),
    };
  `);
  target.eval(exportSource);
  await target.WorkspaceDB_READY;
  return target.__legacyRoundTripApi as LegacyRoundTripApi;
}

describe('Legacy and Angular data round-trips', () => {
  let legacy: LegacyRoundTripApi;
  let angularDb: WorkspaceDbService | undefined;

  beforeAll(async () => {
    legacy = await loadLegacyRuntime();
  });

  afterAll(() => {
    legacy.close();
  });

  beforeEach(async () => {
    localStorage.clear();
    await legacy.clear();
    angularDb = undefined;
  });

  afterEach(() => {
    angularDb?.ngOnDestroy();
    angularDb = undefined;
  });

  it('imports a modified legacy export into Angular without losing structure or attachments', async () => {
    const source = structuredClone(fullFixture.data) as WorkspaceData;
    const legacyData = structuredClone(source);
    legacyData.todos[0].title = 'Tâche modifiée dans legacy';
    legacy.setData(legacyData);
    await legacy.flush();

    await legacy.exportAllJson();
    const blob = legacy.exportedBlob();
    expect(blob).toBeTruthy();
    const json = await legacy.readBlob(blob as Blob);
    expect(JSON.parse(json).data).toEqual(legacyData);

    await legacy.clear();
    await writePersisted(completeWorkspaceData(structuredClone(fullFixture.data) as Record<string, unknown>));

    TestBed.configureTestingModule({
      providers: [
        WorkspaceDbService,
        WorkspaceStoreService,
        WorkspaceImportService,
        { provide: WorkspaceBackupService, useValue: { saveWorkspaceBackup: async () => ({ saved: true, method: 'download' }) } },
        { provide: PasswordVaultService, useValue: { invalidateSession: () => undefined } },
      ],
    });
    angularDb = TestBed.inject(WorkspaceDbService);
    const store = TestBed.inject(WorkspaceStoreService);
    const imports = TestBed.inject(WorkspaceImportService);
    await store.init();

    const parsed = await imports.readFile({ name: 'workspace-legacy.json', text: async () => json } as unknown as File);
    await imports.apply(parsed, 'overwrite');

    const persisted = await readPersisted();
    expect(persisted).toEqual(legacyData);
    const sourceRhTeam = source.rh.children[0] as RhFolder;
    const sourceRhOnboarding = sourceRhTeam.children[0] as RhFolder;
    const persistedRhTeam = persisted.rh.children[0] as RhFolder;
    const persistedRhOnboarding = persistedRhTeam.children[0] as RhFolder;
    expect(persistedRhTeam).toMatchObject({ id: 'rh-team' });
    expect(persistedRhOnboarding).toMatchObject({ id: 'rh-onboarding' });
    expect((persistedRhOnboarding.children[0] as Record<string, unknown>)['file']).toEqual(
      (sourceRhOnboarding.children[0] as Record<string, unknown>)['file'],
    );
  });

  it('opens legacy data in Angular, then imports the Angular modification back into legacy', async () => {
    const source = structuredClone(vaultFixture.data) as WorkspaceData;
    legacy.setData(source);
    await legacy.flush();

    TestBed.configureTestingModule({ providers: [WorkspaceDbService, WorkspaceStoreService] });
    angularDb = TestBed.inject(WorkspaceDbService);
    const store = TestBed.inject(WorkspaceStoreService);
    await store.init();
    expect(store.data()).toEqual(source);
    store.update((data) => {
      const todo = data.todos.find((candidate) => candidate.id === 'vault-todo');
      if (todo) todo.title = 'Coffre vérifié dans Angular';
    });
    await store.flush();

    const angularData = store.data() as WorkspaceData;
    const exported = workspaceJson(angularData);
    expect(JSON.parse(exported).data).toEqual(angularData);
    await legacy.clear();
    await writePersisted(completeWorkspaceData({}));
    const imported = legacy.importFull(exported, 'workspace-angular.json');
    await legacy.flush();

    const persisted = await readPersisted();
    expect(imported).toEqual(angularData);
    expect(persisted).toEqual(angularData);
    const sourcePasswordFolder = source.projects[0].children[0] as ProjectFolder;
    const sourcePassword = sourcePasswordFolder.children[0] as ProjectItem;
    const persistedPasswordFolder = persisted.projects[0].children[0] as ProjectFolder;
    const password = persistedPasswordFolder.children[0] as ProjectItem;
    expect(password).toMatchObject({ id: 'vault-item-a', secretEncrypted: sourcePassword['secretEncrypted'] });
    expect(persisted.settings.secretVault).toEqual(source.settings.secretVault);
  });

  it('keeps an empty workspace compatible in both directions', async () => {
    const source = structuredClone(emptyFixture.data) as WorkspaceData;
    legacy.setData(source);
    await legacy.flush();

    TestBed.configureTestingModule({ providers: [WorkspaceDbService, WorkspaceStoreService] });
    angularDb = TestBed.inject(WorkspaceDbService);
    const store = TestBed.inject(WorkspaceStoreService);
    await store.init();
    expect(store.data()).toEqual(source);

    const exported = workspaceJson(store.data() as WorkspaceData);
    await legacy.clear();
    const imported = legacy.importFull(exported, 'workspace-empty.json');
    await legacy.flush();

    expect(imported).toEqual(source);
    expect(await readPersisted()).toEqual(source);
  });

  it('rejects a malformed legacy import without changing the shared database', async () => {
    const source = structuredClone(fullFixture.data) as WorkspaceData;
    legacy.setData(source);
    await legacy.flush();
    const invalid = structuredClone(source);
    invalid.todos.push(structuredClone(invalid.todos[0]));

    expect(() => legacy.importFull(JSON.stringify({ data: invalid }), 'invalid.json')).toThrow(/identifiant dupliqué/);
    await legacy.flush();

    expect(await readPersisted()).toEqual(source);
  });

  it('keeps legacy read-only when Angular already owns the writer lock', async () => {
    const source = structuredClone(fullFixture.data) as WorkspaceData;
    await writePersisted(source);
    TestBed.configureTestingModule({ providers: [WorkspaceDbService, WorkspaceStoreService] });
    angularDb = TestBed.inject(WorkspaceDbService);
    const store = TestBed.inject(WorkspaceStoreService);
    await store.init();
    expect(angularDb.canWrite()).toBe(true);

    const readOnlyLegacy = await loadLegacyRuntime(false);
    try {
      readOnlyLegacy.setData({ overwritten: true } as unknown as WorkspaceData);
      await readOnlyLegacy.flush();

      expect(readOnlyLegacy.writeAccess()).toBe('read-only');
      expect(await readPersisted()).toEqual(source);
    } finally {
      readOnlyLegacy.close();
    }
  });
});
