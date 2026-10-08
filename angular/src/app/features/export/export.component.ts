import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FileAccessService } from '../../core/files/file-access.service';
import { WorkspaceBackupService, type StorageQuota } from '../../core/files/workspace-backup.service';
import { WorkspaceImportService, type WorkspaceImportMode } from '../../core/files/workspace-import.service';
import {
  buildExportSections,
  createZip,
  todayStamp,
  workspaceJson,
  workspaceMarkdown,
  workspaceZipFiles,
  type WorkspaceExportFormat,
  type WorkspaceExportSection,
} from '../../core/export/workspace-export';
import type { WorkspaceImport } from '../../core/persistence/workspace-import';
import { WorkspaceStoreService } from '../../core/persistence/workspace-store.service';
import { FeedbackService } from '../../shared/feedback/feedback.service';

@Component({
  selector: 'app-export',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './export.component.html',
  styleUrl: './export.component.css',
})
export class ExportComponent {
  private readonly store = inject(WorkspaceStoreService);
  private readonly files = inject(FileAccessService);
  private readonly backup = inject(WorkspaceBackupService);
  private readonly imports = inject(WorkspaceImportService);
  private readonly feedback = inject(FeedbackService);

  protected readonly data = computed(() => this.store.data());
  protected readonly loading = computed(() => this.store.loading());
  protected readonly quota = signal<StorageQuota | null>(null);
  protected readonly quotaError = signal(false);
  protected readonly pendingImport = signal<{ filename: string; imported: WorkspaceImport } | null>(null);
  protected readonly importMode = signal<WorkspaceImportMode>('merge');
  protected readonly importing = signal(false);
  protected readonly sections = computed(() => {
    const data = this.data();
    return data ? buildExportSections(data) : [];
  });
  protected readonly totalCount = computed(() => {
    const data = this.data();
    if (!data) return 0;
    return data.todos.length + data.snippets.length + data.journal.length + data.projects.length
      + countTreeItems(data.rh) + countTreeItems(data.favorites);
  });

  constructor() {
    void this.store.init().then(() => this.refreshQuota());
  }

  protected sectionIcon(id: string): string {
    const value = { todos: '✓', settings: '⚙', projects: '▦', snippets: 'CODE', journal: 'J', rh: 'RH', favorites: '★' }[id] || '•';
    return value;
  }

  protected async exportSection(section: WorkspaceExportSection, format: WorkspaceExportFormat): Promise<void> {
    try {
      await this.store.flush();
      let content: Blob;
      const extension = format === 'md' ? 'md' : format;
      if (format === 'json') content = jsonBlob(section.data);
      else if (format === 'md') content = textBlob(section.markdown || '_Aucune donnée._', 'text/markdown;charset=utf-8');
      else if (format === 'csv') content = textBlob(section.csv || '', 'text/csv;charset=utf-8');
      else if (section.zip?.length) content = createZip(section.zip);
      else {
        this.feedback.showToast('Aucun contenu à inclure dans le ZIP', 'error');
        return;
      }

      await this.save(content, `workspace-${section.filename}-${todayStamp()}.${extension}`, `${section.title} exporté(e)`);
    } catch (error) {
      this.feedback.showToast(isQuotaError(error) ? 'Stockage insuffisant pour finaliser l’export' : 'Erreur lors de l’export', 'error');
    }
  }

  protected async exportAll(format: 'json' | 'md' | 'zip'): Promise<void> {
    try {
      if (!this.data()) {
        this.feedback.showToast('Données indisponibles', 'error');
        return;
      }
      await this.store.flush();
      const data = this.data();
      if (!data) {
        this.feedback.showToast('Données indisponibles', 'error');
        return;
      }
      let content: Blob;
      if (format === 'json') content = jsonBlobFromText(workspaceJson(data));
      else if (format === 'md') content = textBlob(workspaceMarkdown(data), 'text/markdown;charset=utf-8');
      else content = createZip(workspaceZipFiles(data));
      const labels = { json: 'Sauvegarde JSON', md: 'Sauvegarde Markdown', zip: 'Archive ZIP' };
      await this.save(content, `workspace-complet-${todayStamp()}.${format}`, `${labels[format]} téléchargée`);
    } catch (error) {
      this.feedback.showToast(isQuotaError(error) ? 'Stockage insuffisant pour finaliser l’export' : 'Erreur lors de l’export', 'error');
    }
  }

  protected async readImport(event: Event): Promise<void> {
    if (this.importing()) return;
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    this.clearImport();
    if (!file) return;

    try {
      const imported = await this.imports.readFile(file);
      this.pendingImport.set({ filename: file.name, imported });
      this.importMode.set('merge');
    } catch (error) {
      this.feedback.showToast(this.importErrorMessage(error), 'error');
    }
  }

  protected setImportMode(mode: WorkspaceImportMode): void {
    if (mode === 'overwrite' && !this.pendingImport()?.imported.full) return;
    this.importMode.set(mode);
  }

  protected clearImport(): void {
    this.pendingImport.set(null);
    this.importMode.set('merge');
  }

  protected async applyImport(): Promise<void> {
    const pending = this.pendingImport();
    if (!pending || this.importing()) return;
    const mode = this.importMode();
    this.importing.set(true);
    try {
      if (mode === 'overwrite') {
        const confirmed = await this.feedback.confirm({
          title: 'Remplacer le workspace ?',
          message: 'Une sauvegarde complète sera créée avant le remplacement. Continuer ?',
          confirmLabel: 'Sauvegarder et importer',
          cancelLabel: 'Annuler',
          destructive: true,
        });
        if (!confirmed) return;
      }
      await this.imports.apply(pending.imported, mode);
      this.clearImport();
      void this.refreshQuota();
      this.feedback.showToast(mode === 'overwrite' ? 'Workspace remplacé' : 'Import fusionné', 'success');
    } catch (error) {
      this.feedback.showToast(this.importErrorMessage(error), 'error');
    } finally {
      this.importing.set(false);
    }
  }

  private async save(blob: Blob, filename: string, successMessage: string): Promise<void> {
    try {
      const result = await this.files.saveBlob(blob, filename, true);
      if (result.saved) this.feedback.showToast(successMessage, 'success');
      else if (!result.cancelled) this.feedback.showToast('Erreur lors de l’export', 'error');
    } catch (error) {
      this.feedback.showToast(isQuotaError(error) ? 'Stockage insuffisant pour finaliser l’export' : 'Erreur lors de l’export', 'error');
    }
  }

  private async refreshQuota(): Promise<void> {
    try {
      this.quota.set(await this.backup.getStorageQuota());
    } catch {
      this.quotaError.set(true);
    }
  }

  private importErrorMessage(error: unknown): string {
    return error instanceof Error && error.message ? error.message : 'Import impossible';
  }
}

function jsonBlob(value: unknown): Blob {
  return jsonBlobFromText(JSON.stringify(value, null, 2));
}

function jsonBlobFromText(value: string): Blob {
  return new Blob([value], { type: 'application/json' });
}

function textBlob(value: string, type: string): Blob {
  return new Blob([value], { type });
}

function isQuotaError(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'name' in error && error.name === 'QuotaExceededError';
}

interface CountTreeNode {
  nodeType?: string;
  children?: readonly CountTreeNode[];
}

function countTreeItems(node: CountTreeNode): number {
  return (node.children || []).reduce((count, child) => count + (child.nodeType === 'folder' ? countTreeItems(child) : 1), 0);
}
