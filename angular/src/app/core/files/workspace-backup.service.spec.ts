import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import fixture from '../../../../../fixtures/workspace-full.json';
import { FileAccessService } from './file-access.service';
import {
  DEFAULT_BACKUP_FREQUENCY_HOURS,
  WorkspaceBackupService,
  formatBytes,
} from './workspace-backup.service';
import { StoragePreferencesService, STORAGE_KEYS } from '../persistence/storage-preferences.service';
import { WorkspaceStoreService } from '../persistence/workspace-store.service';
import type { WorkspaceData } from '../persistence/workspace-data';
import { FeedbackService } from '../../shared/feedback/feedback.service';

describe('WorkspaceBackupService', () => {
  let backup: WorkspaceBackupService;
  let data: ReturnType<typeof signal<WorkspaceData | null>>;
  let saveBlob: ReturnType<typeof vi.fn>;
  let preferences: StoragePreferencesService;

  beforeEach(() => {
    data = signal<WorkspaceData | null>(structuredClone(fixture.data) as WorkspaceData);
    saveBlob = vi.fn(async () => ({ saved: true, method: 'download' }));
    TestBed.configureTestingModule({
      providers: [
        WorkspaceBackupService,
        { provide: WorkspaceStoreService, useValue: { data: data.asReadonly(), init: async () => data(), flush: async () => undefined } },
        { provide: FileAccessService, useValue: { saveBlob } },
        StoragePreferencesService,
        { provide: FeedbackService, useValue: { showToast: vi.fn() } },
      ],
    });
    backup = TestBed.inject(WorkspaceBackupService);
    preferences = TestBed.inject(StoragePreferencesService);
    localStorage.clear();
  });

  it('writes the complete legacy-compatible JSON envelope', async () => {
    const result = await backup.saveWorkspaceBackup({ auto: true, preferPicker: false });
    expect(result.saved).toBe(true);
    expect(saveBlob).toHaveBeenCalledWith(expect.any(Blob), expect.stringContaining('auto-backup'), false);

    const blob = saveBlob.mock.calls[0][0] as Blob;
    const payload = JSON.parse(await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(blob);
    }));
    expect(payload._meta).toMatchObject({ app: 'Workspace Fixture', version: 6, auto: true, preferredBackupFolder: 'Downloads', autoBackupFrequencyHours: 24 });
    expect(payload.data).toEqual(fixture.data);
    expect(preferences.get(STORAGE_KEYS.lastBackup)).toMatch(/\d+/);
  });

  it('skips automatic backup while the configured interval is current', async () => {
    preferences.set(STORAGE_KEYS.lastBackup, String(Date.now()));

    await expect(backup.checkAutomaticBackup()).resolves.toBe(false);
    expect(saveBlob).not.toHaveBeenCalled();
  });

  it('uses the download fallback for a stale automatic backup', async () => {
    preferences.set(STORAGE_KEYS.lastBackup, '1');

    await expect(backup.checkAutomaticBackup()).resolves.toBe(true);
    expect(saveBlob).toHaveBeenCalledWith(expect.any(Blob), expect.any(String), false);
  });

  it('reports the serialized workspace size and a browser quota', async () => {
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: { estimate: async () => ({ quota: 1024 * 1024 }) },
    });

    const result = await backup.getStorageQuota();
    expect(result.bytes).toBeGreaterThan(0);
    expect(result.quota).toBe(1024 * 1024);
    expect(result.percent).toBeGreaterThan(0);
    expect(formatBytes(1024)).toBe('1 KB');
    expect(DEFAULT_BACKUP_FREQUENCY_HOURS).toBe(168);
  });
});
