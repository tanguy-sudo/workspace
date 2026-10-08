import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import fixture from '../../../../../fixtures/workspace-full.json';
import { SettingsComponent } from './settings.component';
import { FileAccessService } from '../../core/files/file-access.service';
import { WorkspaceBackupService } from '../../core/files/workspace-backup.service';
import { StoragePreferencesService } from '../../core/persistence/storage-preferences.service';
import { WorkspaceStoreService } from '../../core/persistence/workspace-store.service';
import { PasswordVaultService } from '../../core/security/password-vault.service';
import { FeedbackService } from '../../shared/feedback/feedback.service';
import type { WorkspaceData } from '../../core/persistence/workspace-data';

describe('SettingsComponent', () => {
  let data: ReturnType<typeof signal<WorkspaceData | null>>;
  let store: {
    data: ReturnType<typeof data.asReadonly>;
    status: ReturnType<typeof signal<'ready'>>;
    ready: () => boolean;
    init: () => Promise<WorkspaceData | null>;
    updateSettings: (changes: Record<string, unknown>) => WorkspaceData;
  };
  let backup: { saveWorkspaceBackup: ReturnType<typeof vi.fn>; getStorageQuota: ReturnType<typeof vi.fn> };
  let feedback: { showToast: ReturnType<typeof vi.fn>; confirm: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    data = signal<WorkspaceData | null>(structuredClone(fixture.data) as WorkspaceData);
    store = {
      data: data.asReadonly(),
      status: signal<'ready'>('ready'),
      ready: () => true,
      init: async () => data(),
      updateSettings: (changes) => {
        const next = structuredClone(data()) as WorkspaceData;
        next.settings = { ...next.settings, ...changes };
        data.set(next);
        return next;
      },
    };
    backup = {
      saveWorkspaceBackup: vi.fn(async () => ({ saved: true, method: 'download' })),
      getStorageQuota: vi.fn(async () => ({ bytes: 100, quota: 1000, percent: 10, label: '100 B', quotaLabel: '1 KB' })),
    };
    feedback = { showToast: vi.fn(), confirm: vi.fn(async () => true) };
    TestBed.configureTestingModule({
      imports: [SettingsComponent],
      providers: [
        { provide: WorkspaceStoreService, useValue: store },
        { provide: WorkspaceBackupService, useValue: backup },
        { provide: FileAccessService, useValue: { canChooseBackupDirectory: () => false, getBackupDirectoryLabel: async () => 'Downloads', chooseBackupDirectory: vi.fn(), clearBackupDirectory: vi.fn(async () => undefined) } },
        { provide: PasswordVaultService, useValue: { hasEnabledVault: () => false, isUnlocked: () => false, lock: vi.fn(), enable: vi.fn(), unlock: vi.fn(), changePassword: vi.fn(), disable: vi.fn() } },
        StoragePreferencesService,
        { provide: FeedbackService, useValue: feedback },
      ],
    });
  });

  it('renders legacy settings and saves edited values through the workspace store', async () => {
    const component = TestBed.createComponent(SettingsComponent);
    component.detectChanges();
    await component.whenStable();

    expect(component.nativeElement.querySelector('#settings-title')?.textContent).toContain('Paramètres');
    expect((component.nativeElement.querySelectorAll('input[type="text"]')[0] as HTMLInputElement).value).toBe('Fixture User');
    expect(component.nativeElement.querySelector('.settings-value')?.textContent).toContain('Downloads');

    const site = component.nativeElement.querySelectorAll('input[type="text"]')[1] as HTMLInputElement;
    site.value = 'Workspace local';
    site.dispatchEvent(new Event('input'));
    component.componentInstance['saveSettings']();

    expect(data()!.settings.siteName).toBe('Workspace local');
    expect(feedback.showToast).toHaveBeenCalledWith('Paramètres enregistrés', 'success');
  });

  it('runs a manual automatic-backup test through the download fallback', async () => {
    const component = TestBed.createComponent(SettingsComponent);
    component.detectChanges();
    await component.whenStable();

    await component.componentInstance['testBackup']();
    expect(backup.saveWorkspaceBackup).toHaveBeenCalledWith({ auto: true, preferPicker: true });
    expect(feedback.showToast).toHaveBeenCalledWith('Sauvegarde automatique enregistrée', 'success');
  });
});
