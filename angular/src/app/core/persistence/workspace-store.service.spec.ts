import { TestBed } from '@angular/core/testing';
import Dexie from 'dexie';
import fixture from '../../../../../fixtures/workspace-full.json';
import { WorkspaceDbService } from './workspace-db.service';
import { WorkspaceStoreService } from './workspace-store.service';
import { WORKSPACE_DATA_KEY, WORKSPACE_DB_NAME, WORKSPACE_DB_VERSION } from './workspace-data';
import type { WorkspaceData } from './workspace-data';

describe('WorkspaceStoreService', () => {
  let store: WorkspaceStoreService;
  let dbService: WorkspaceDbService;

  beforeEach(async () => {
    await Dexie.delete(WORKSPACE_DB_NAME);
    TestBed.configureTestingModule({ providers: [WorkspaceDbService, WorkspaceStoreService] });
    store = TestBed.inject(WorkspaceStoreService);
    dbService = TestBed.inject(WorkspaceDbService);
    const db = new Dexie(WORKSPACE_DB_NAME);
    db.version(WORKSPACE_DB_VERSION).stores({ kv: 'key' });
    await db.table('kv').put({ key: WORKSPACE_DATA_KEY, value: fixture.data });
    db.close();
  });

  afterEach(async () => {
    dbService.ngOnDestroy();
    await Dexie.delete(WORKSPACE_DB_NAME);
  });

  it('exposes loading, ready and error state around the typed root', async () => {
    expect(store.status()).toBe('idle');
    const promise = store.init();
    expect(store.loading()).toBe(true);
    await promise;

    expect(store.ready()).toBe(true);
    expect(store.error()).toBeNull();
    expect(store.data()?.projects[0].id).toBe('project-alpha');
  });

  it('shares the in-flight initialization with concurrent callers', async () => {
    const first = store.init();
    const second = store.init();

    expect(await second).toEqual(await first);
    expect(store.ready()).toBe(true);
  });

  it('mutates through one API and keeps unknown sections', async () => {
    await store.init();
    store.update((draft) => {
      draft['futureSection'] = { keep: true };
      draft.settings.theme = 'light';
    });
    await store.flush();

    expect(store.data()?.settings.theme).toBe('light');
    expect(store.data()?.['futureSection']).toEqual({ keep: true });

    const db = new Dexie(WORKSPACE_DB_NAME);
    db.version(WORKSPACE_DB_VERSION).stores({ kv: 'key' });
    const row = await db.table('kv').get(WORKSPACE_DATA_KEY);
    db.close();
    expect((row.value as WorkspaceData)['futureSection']).toEqual({ keep: true });
  });

  it('fills missing legacy root sections without dropping extra fields', async () => {
    dbService.ngOnDestroy();
    await Dexie.delete(WORKSPACE_DB_NAME);
    const db = new Dexie(WORKSPACE_DB_NAME);
    db.version(WORKSPACE_DB_VERSION).stores({ kv: 'key' });
    await db.table('kv').put({
      key: WORKSPACE_DATA_KEY,
      value: { projects: [], settings: { theme: 'dark' }, oldField: 'preserve' },
    });
    db.close();

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [WorkspaceDbService, WorkspaceStoreService] });
    store = TestBed.inject(WorkspaceStoreService);
    dbService = TestBed.inject(WorkspaceDbService);
    await store.init();

    expect(store.ready()).toBe(true);
    expect(store.data()?.['oldField']).toBe('preserve');
    expect(store.data()?.todos).toEqual([]);
    expect(store.data()?.settings.theme).toBe('dark');
  });

  it('creates a usable empty workspace when no persisted data exists', async () => {
    dbService.ngOnDestroy();
    await Dexie.delete(WORKSPACE_DB_NAME);

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [WorkspaceDbService, WorkspaceStoreService] });
    store = TestBed.inject(WorkspaceStoreService);
    dbService = TestBed.inject(WorkspaceDbService);
    await store.init();

    expect(store.ready()).toBe(true);
    expect(store.data()).toMatchObject({ projects: [], todos: [], snippets: [], journal: [], recentlyVisited: [], activityLog: [] });
    expect(store.data()?.settings.weeklyReview).toEqual({ lastCompletedWeek: '' });
  });
});
