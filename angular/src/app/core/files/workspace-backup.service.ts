import { Injectable, inject } from '@angular/core';
import { FileAccessService, type FileSaveResult } from './file-access.service';
import { StoragePreferencesService, STORAGE_KEYS } from '../persistence/storage-preferences.service';
import { createWorkspaceExport } from '../persistence/workspace-data-codec';
import { WorkspaceStoreService } from '../persistence/workspace-store.service';
import type { WorkspaceData } from '../persistence/workspace-data';
import { FeedbackService } from '../../shared/feedback/feedback.service';

export const DEFAULT_BACKUP_FOLDER = 'Téléchargements';
export const DEFAULT_BACKUP_FREQUENCY_HOURS = 168;

export const BACKUP_FREQUENCIES = [
  { value: 0, label: 'Désactivée' },
  { value: 6, label: 'Toutes les 6 heures' },
  { value: 12, label: 'Toutes les 12 heures' },
  { value: 24, label: 'Tous les jours' },
  { value: 72, label: 'Tous les 3 jours' },
  { value: 168, label: 'Toutes les semaines' },
  { value: 336, label: 'Toutes les 2 semaines' },
  { value: 720, label: 'Tous les mois' },
] as const;

export interface StorageQuota {
  bytes: number;
  quota: number;
  percent: number;
  label: string;
  quotaLabel: string;
}

export function backupFrequencyLabel(hours: number): string {
  const known = BACKUP_FREQUENCIES.find((frequency) => frequency.value === hours);
  if (known) return known.label;
  if (!Number.isFinite(hours) || hours < 0) return 'Toutes les semaines';
  if (hours < 24) return `Toutes les ${hours} heures`;
  const days = Math.round(hours / 24);
  return days <= 1 ? 'Tous les jours' : `Tous les ${days} jours`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

@Injectable({ providedIn: 'root' })
export class WorkspaceBackupService {
  private readonly files = inject(FileAccessService);
  private readonly preferences = inject(StoragePreferencesService);
  private readonly store = inject(WorkspaceStoreService);
  private readonly feedback = inject(FeedbackService);

  async saveWorkspaceBackup(
    options: { auto?: boolean; preferPicker?: boolean } = {},
  ): Promise<FileSaveResult> {
    if (!await this.store.init()) throw new Error('Workspace data unavailable');
    await this.store.flush();
    const data = this.store.data();
    if (!data) throw new Error('Workspace data unavailable');

    const settings = data.settings ?? {};
    const siteName = String(settings.siteName || 'Workspace').trim() || 'Workspace';
    const frequency = this.frequency(settings.autoBackupFrequencyHours);
    const folder = String(settings.backupFolder || DEFAULT_BACKUP_FOLDER).trim() || DEFAULT_BACKUP_FOLDER;
    const auto = !!options.auto;
    const payload = createWorkspaceExport(data, {
      app: siteName,
      auto,
      preferredBackupFolder: folder,
      autoBackupFrequencyHours: frequency,
    });
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const filename = `${this.slugify(siteName)}-${auto ? 'auto-backup' : 'backup'}-${this.todayStamp()}.json`;
    const result = await this.files.saveBlob(blob, filename, options.preferPicker ?? true);
    if (result.saved && auto) this.preferences.set(STORAGE_KEYS.lastBackup, String(Date.now()));
    return result;
  }

  async checkAutomaticBackup(): Promise<boolean> {
    try {
      const data = await this.store.init();
      if (!data) return false;
      const frequency = this.frequency(data.settings?.autoBackupFrequencyHours);
      if (frequency === 0) return false;

      const last = Number(this.preferences.get(STORAGE_KEYS.lastBackup, '0'));
      if (Number.isFinite(last) && last > 0 && Date.now() - last < frequency * 60 * 60 * 1000) {
        return false;
      }

      const result = await this.saveWorkspaceBackup({ auto: true, preferPicker: false });
      if (!result.saved) return false;
      this.feedback.showToast('Sauvegarde automatique téléchargée', 'success');
      return true;
    } catch {
      return false;
    }
  }

  async getStorageQuota(): Promise<StorageQuota> {
    const data = await this.store.init();
    const bytes = this.serializedBytes(data ?? {});
    let quota = 0;
    try {
      const estimate = await navigator.storage?.estimate();
      quota = estimate?.quota || 0;
    } catch {
      quota = 0;
    }
    return {
      bytes,
      quota,
      percent: quota > 0 ? Math.min(100, (bytes / quota) * 100) : 0,
      label: formatBytes(bytes),
      quotaLabel: quota ? formatBytes(quota) : '—',
    };
  }

  private frequency(value: unknown): number {
    const hours = Number(value);
    return Number.isFinite(hours) && hours >= 0 ? hours : DEFAULT_BACKUP_FREQUENCY_HOURS;
  }

  private serializedBytes(data: WorkspaceData | Record<string, unknown>): number {
    try {
      return new Blob([JSON.stringify(data)]).size;
    } catch {
      return 0;
    }
  }

  private slugify(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'workspace';
  }

  private todayStamp(): string {
    const date = new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }
}
