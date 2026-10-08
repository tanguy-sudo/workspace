import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import fixture from '../../../../../fixtures/workspace-full.json';
import vaultFixture from '../../../../../fixtures/workspace-with-vault.json';
import type { WorkspaceData } from '../../core/persistence/workspace-data';
import { WorkspaceStoreService } from '../../core/persistence/workspace-store.service';
import { FileAccessService } from '../../core/files/file-access.service';
import { WorkspaceBackupService } from '../../core/files/workspace-backup.service';
import { WorkspaceImportService } from '../../core/files/workspace-import.service';
import { FeedbackService } from '../../shared/feedback/feedback.service';
import { ExportComponent } from './export.component';

describe('ExportComponent', () => {
  let data: ReturnType<typeof signal<WorkspaceData | null>>;
  let saveBlob: ReturnType<typeof vi.fn>;
  let feedback: { showToast: ReturnType<typeof vi.fn> };
  let quota: { getStorageQuota: ReturnType<typeof vi.fn> };
  let imports: { readFile: ReturnType<typeof vi.fn>; apply: ReturnType<typeof vi.fn> };
  let store: {
    data: ReturnType<typeof data.asReadonly>;
    loading: () => boolean;
    init: () => Promise<WorkspaceData | null>;
    flush: () => Promise<void>;
  };

  beforeEach(() => {
    data = signal<WorkspaceData | null>(structuredClone(fixture.data) as WorkspaceData);
    saveBlob = vi.fn(async () => ({ saved: true, method: 'download' }));
    feedback = { showToast: vi.fn() };
    quota = { getStorageQuota: vi.fn(async () => ({ bytes: 100, quota: 1000, percent: 10, label: '100 B', quotaLabel: '1 KB' })) };
    imports = { readFile: vi.fn(), apply: vi.fn(async () => ({ mode: 'merge', full: false })) };
    store = { data: data.asReadonly(), loading: () => false, init: async () => data(), flush: async () => undefined };
    TestBed.configureTestingModule({
      imports: [ExportComponent],
      providers: [
        { provide: WorkspaceStoreService, useValue: store },
        { provide: FileAccessService, useValue: { saveBlob } },
        { provide: WorkspaceBackupService, useValue: quota },
        { provide: WorkspaceImportService, useValue: imports },
        { provide: FeedbackService, useValue: feedback },
      ],
    });
  });

  it('renders all section formats and exports the complete JSON', async () => {
    const component = TestBed.createComponent(ExportComponent);
    component.detectChanges();
    await component.whenStable();

    expect(component.nativeElement.querySelector('#export-title')?.textContent).toContain('Export');
    expect(component.nativeElement.querySelectorAll('.export-card')).toHaveLength(7);
    expect(component.nativeElement.querySelectorAll('.format-button').length).toBe(17);
    await vi.waitFor(() => {
      component.detectChanges();
      expect(component.nativeElement.querySelector('.storage-card')?.textContent).toContain('100 B');
    });

    await component.componentInstance['exportAll']('json');
    expect(saveBlob).toHaveBeenCalledWith(expect.any(Blob), expect.stringMatching(/^workspace-complet-\d{4}-\d{2}-\d{2}\.json$/), true);
    expect(feedback.showToast).toHaveBeenCalledWith('Sauvegarde JSON téléchargée', 'success');
  });

  it('exports CSV and ZIP through the shared file fallback', async () => {
    const component = TestBed.createComponent(ExportComponent);
    component.detectChanges();
    await component.whenStable();
    const todos = component.nativeElement.querySelector('.export-card');
    await component.componentInstance['exportSection'](component.componentInstance['sections']()[0], 'csv');
    await component.componentInstance['exportAll']('zip');

    expect(todos.textContent).toContain('CSV');
    expect(saveBlob).toHaveBeenCalledTimes(2);
    expect(saveBlob.mock.calls[0][0]).toBeInstanceOf(Blob);
    expect(saveBlob.mock.calls[1][0]).toBeInstanceOf(Blob);
  });

  it('reports save failures without exposing vault content', async () => {
    data.set(structuredClone(vaultFixture.data) as WorkspaceData);
    saveBlob.mockRejectedValue(new Error('disk failure'));
    const component = TestBed.createComponent(ExportComponent);
    component.detectChanges();
    await component.whenStable();

    await component.componentInstance['exportAll']('md');
    expect(feedback.showToast).toHaveBeenCalledWith('Erreur lors de l’export', 'error');
    expect(component.nativeElement.textContent).not.toContain('fixture-secret');
  });

  it('reports a quota failure distinctly from a generic download failure', async () => {
    store.flush = vi.fn(async () => { throw Object.assign(new Error('quota'), { name: 'QuotaExceededError' }); });
    const component = TestBed.createComponent(ExportComponent);
    component.detectChanges();
    await component.whenStable();

    await component.componentInstance['exportAll']('json');
    expect(feedback.showToast).toHaveBeenCalledWith('Stockage insuffisant pour finaliser l’export', 'error');
  });

  it('shows the quota warning when local usage is high', async () => {
    quota.getStorageQuota.mockResolvedValue({ bytes: 800, quota: 1000, percent: 80, label: '800 B', quotaLabel: '1 KB' });
    const component = TestBed.createComponent(ExportComponent);
    component.detectChanges();
    await vi.waitFor(() => {
      component.detectChanges();
      expect(component.nativeElement.querySelector('.storage-warning')?.textContent).toContain('70 %');
    });
  });

  it('previews a valid import and applies it without a page reload', async () => {
    const imported = { data: { todos: [fixture.data.todos[0]] }, full: false };
    imports.readFile.mockResolvedValue(imported);
    const component = TestBed.createComponent(ExportComponent);
    component.detectChanges();
    await component.whenStable();

    const input = component.nativeElement.querySelector('.file-picker input') as HTMLInputElement;
    await component.componentInstance['readImport']({ target: { files: [{ name: 'todos.json' }] , value: '' } } as unknown as Event);
    expect(imports.readFile).toHaveBeenCalled();
    expect(component.componentInstance['pendingImport']()).toMatchObject({ filename: 'todos.json', imported });
    await component.componentInstance['applyImport']();
    expect(imports.apply).toHaveBeenCalledWith(imported, 'merge');
    expect(feedback.showToast).toHaveBeenCalledWith('Import fusionné', 'success');
    expect(input).toBeTruthy();
  });

  it('does not expose overwrite for a partial import', async () => {
    imports.readFile.mockResolvedValue({ data: { todos: [fixture.data.todos[0]] }, full: false });
    const component = TestBed.createComponent(ExportComponent);
    component.detectChanges();
    await component.whenStable();
    await component.componentInstance['readImport']({ target: { files: [{ name: 'todos.json' }], value: '' } } as unknown as Event);
    component.detectChanges();

    const overwrite = component.nativeElement.querySelector('input[value="overwrite"]') as HTMLInputElement;
    expect(overwrite.disabled).toBe(true);
    expect(component.nativeElement.textContent).toContain('Import partiel');
  });
});
