import { Injectable, OnDestroy, signal } from '@angular/core';
import Dexie from 'dexie';
import type { Table } from 'dexie';
import {
  BACKUP_DIR_HANDLE_KEY,
  LEGACY_STORAGE_KEY,
  WORKSPACE_DATA_KEY,
  WORKSPACE_DB_NAME,
  WORKSPACE_DB_VERSION,
  WorkspaceData,
} from './workspace-data';

type WorkspaceValue = WorkspaceData | Record<string, unknown>;

export type LegacyMigrationState =
  | 'not-run'
  | 'already-present'
  | 'migrated'
  | 'no-legacy-data'
  | 'invalid-json'
  | 'invalid-value'
  | 'storage-unavailable'
  | 'persistence-error';

interface KvRow<T = unknown> {
  key: string;
  value: T;
}

/**
 * Compatibility adapter for the legacy `workspace` / `kv` database.
 * It deliberately stores opaque values instead of normalizing their fields.
 */
@Injectable({ providedIn: 'root' })
export class WorkspaceDbService implements OnDestroy {
  readonly persistenceError = signal<string | null>(null);
  readonly legacyMigrationState = signal<LegacyMigrationState>('not-run');
  readonly legacyMigrationError = signal<string | null>(null);
  readonly writeAccess = signal<'checking' | 'writer' | 'read-only'>('checking');
  readonly writeAccessError = signal<string | null>(null);

  private readonly db: Dexie;
  private readonly kv: Table<KvRow, string>;
  private cache: WorkspaceValue | null = null;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private persistPending = false;
  private flushPromise: Promise<void> | null = null;
  private initialized = false;
  private writeLockReady: Promise<void> | null = null;
  private releaseWriteLock: (() => void) | null = null;

  private readonly flushOnPageHide = (): void => {
    void this.flush().catch(() => undefined);
  };

  private readonly releaseOnPageHide = (event: PageTransitionEvent): void => {
    if (!event.persisted) void this.flush().finally(() => this.releaseWriteLock?.());
  };

  private readonly flushOnVisibilityChange = (): void => {
    if (document.visibilityState === 'hidden') {
      void this.flush().catch(() => undefined);
    }
  };

  constructor() {
    this.db = new Dexie(WORKSPACE_DB_NAME);
    this.db.version(WORKSPACE_DB_VERSION).stores({ kv: 'key' });
    this.kv = this.db.table<KvRow, string>('kv');

    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', this.releaseOnPageHide);
      window.addEventListener('pagehide', this.flushOnPageHide);
      window.addEventListener('beforeunload', this.flushOnPageHide);
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.flushOnVisibilityChange);
    }
  }

  /** Loads IndexedDB once, falling back to the raw legacy localStorage value. */
  async init(): Promise<WorkspaceValue | null> {
    if (this.initialized) return this.cache;
    await this.acquireWriteLock();

    try {
      const row = await this.kv.get(WORKSPACE_DATA_KEY);
      if (row !== undefined) {
        this.cache = row.value as WorkspaceValue;
        this.legacyMigrationState.set('already-present');
      } else {
        const legacy = this.readLegacyValue();
        if (legacy.kind === 'value') {
            this.cache = legacy.value;
          if (this.canWrite()) {
            try {
              await this.kv.put({ key: WORKSPACE_DATA_KEY, value: legacy.value });
              this.legacyMigrationState.set('migrated');
            } catch {
              this.legacyMigrationState.set('persistence-error');
              this.legacyMigrationError.set('Workspace migration could not be persisted');
              throw new Error('Workspace migration could not be persisted');
            }
          } else {
            this.legacyMigrationState.set('no-legacy-data');
          }
        } else {
          this.legacyMigrationState.set(legacy.kind);
          this.legacyMigrationError.set(legacy.message);
        }
      }
      this.persistenceError.set(null);
    } catch {
      if (this.legacyMigrationState() === 'persistence-error') {
        this.persistenceError.set('Workspace migration could not be persisted');
      } else {
        this.persistenceError.set('Workspace persistence is unavailable');
      }
    }

    this.initialized = true;
    return this.cache;
  }

  getSync(): WorkspaceValue | null {
    return this.cache;
  }

  canWrite(): boolean {
    return this.writeAccess() === 'writer';
  }

  setSync(value: WorkspaceValue): boolean {
    if (!this.canWrite()) return false;
    this.cache = value;
    this.persistenceError.set(null);
    this.persistPending = true;
    this.schedulePersist();
    return true;
  }

  /** Flushes the latest cache value, with only one IndexedDB write in flight. */
  async flush(): Promise<void> {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    if (this.flushPromise) return this.flushPromise;

    const pendingFlush = this.drainPersistQueue();
    this.flushPromise = pendingFlush;
    try {
      await pendingFlush;
    } finally {
      if (this.flushPromise === pendingFlush) this.flushPromise = null;
    }
  }

  async getBackupDirectoryHandle(): Promise<FileSystemDirectoryHandle | null> {
    try {
      const row = await this.kv.get(BACKUP_DIR_HANDLE_KEY);
      return (row?.value as FileSystemDirectoryHandle | undefined) ?? null;
    } catch {
      this.persistenceError.set('Workspace persistence is unavailable');
      return null;
    }
  }

  async setBackupDirectoryHandle(handle: FileSystemDirectoryHandle | null): Promise<void> {
    if (!this.canWrite()) return;
    try {
      if (handle) {
        await this.kv.put({ key: BACKUP_DIR_HANDLE_KEY, value: handle });
      } else {
        await this.kv.delete(BACKUP_DIR_HANDLE_KEY);
      }
      this.persistenceError.set(null);
    } catch {
      this.persistenceError.set('Workspace persistence is unavailable');
    }
  }

  ngOnDestroy(): void {
    if (this.persistTimer) clearTimeout(this.persistTimer);
    if (typeof window !== 'undefined') {
      window.removeEventListener('pagehide', this.flushOnPageHide);
      window.removeEventListener('pagehide', this.releaseOnPageHide);
      window.removeEventListener('beforeunload', this.flushOnPageHide);
    }
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.flushOnVisibilityChange);
    }
    void this.flush().catch(() => undefined).finally(() => {
    void this.flush().catch(() => undefined).finally(() => {
      this.releaseWriteLock?.();
      this.db.close();
    });
    });
  }

  private async acquireWriteLock(): Promise<void> {
    if (this.writeLockReady) return this.writeLockReady;

    this.writeLockReady = new Promise<void>((resolve) => {
      let settled = false;
      const acquired = (): void => {
        if (settled) return;
        settled = true;
        resolve();
      };

      if (typeof navigator === 'undefined' || !navigator.locks) {
        this.writeAccess.set('read-only');
        this.writeAccessError.set('Exclusive browser locks are unavailable');
        acquired();
        return;
      }

      const hold = new Promise<void>((release) => { this.releaseWriteLock = release; });
      void navigator.locks.request('workspace:data-write', { mode: 'exclusive', ifAvailable: true }, async (lock) => {
        this.writeAccess.set(lock ? 'writer' : 'read-only');
        if (!lock) this.writeAccessError.set('Another Workspace window owns the write lock');
        acquired();
        if (lock) await hold;
      }).catch(() => {
        this.writeAccess.set('read-only');
        this.writeAccessError.set('Could not acquire the Workspace write lock');
        acquired();
      });
    });

    return this.writeLockReady;
  }

  private readLegacyValue():
    | { kind: 'value'; value: WorkspaceValue }
    | { kind: 'no-legacy-data'; message: null }
    | { kind: 'invalid-json'; message: string }
    | { kind: 'invalid-value'; message: string }
    | { kind: 'storage-unavailable'; message: string } {
    try {
      if (typeof localStorage === 'undefined') {
        return {
          kind: 'storage-unavailable',
          message: 'Legacy browser storage is unavailable',
        };
      }
      const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
      if (raw === null) return { kind: 'no-legacy-data', message: null };

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return { kind: 'invalid-json', message: 'Legacy Workspace data is not valid JSON' };
      }

      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return {
          kind: 'invalid-value',
          message: 'Legacy Workspace data must be a JSON object',
        };
      }
      return { kind: 'value', value: parsed as WorkspaceValue };
    } catch {
      return {
        kind: 'storage-unavailable',
        message: 'Legacy browser storage is unavailable',
      };
    }
  }

  private schedulePersist(): void {
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      void this.flush().catch(() => undefined);
    }, 80);
  }

  private async drainPersistQueue(): Promise<void> {
    while (this.persistPending) {
      this.persistPending = false;
      try {
        await this.kv.put({ key: WORKSPACE_DATA_KEY, value: this.cache });
      } catch (error) {
        this.persistPending = true;
        this.persistenceError.set('Workspace persistence is unavailable');
        throw error;
      }
    }
  }
}
