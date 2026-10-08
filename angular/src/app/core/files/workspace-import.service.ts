import { Injectable, inject } from '@angular/core';
import { WorkspaceBackupService } from './workspace-backup.service';
import {
  mergeWorkspaceImport,
  parseWorkspaceImport,
  validateWorkspaceImport,
} from '../persistence/workspace-import';
import type { WorkspaceData } from '../persistence/workspace-data';
import { MAX_IMPORT_BYTES, type WorkspaceImport } from '../persistence/workspace-import';
import { completeWorkspaceData, WorkspaceStoreService } from '../persistence/workspace-store.service';
import { PasswordVaultService } from '../security/password-vault.service';

export type WorkspaceImportMode = 'merge' | 'overwrite';

export interface WorkspaceImportResult {
  mode: WorkspaceImportMode;
  full: boolean;
}

@Injectable({ providedIn: 'root' })
export class WorkspaceImportService {
  private readonly backup = inject(WorkspaceBackupService);
  private readonly store = inject(WorkspaceStoreService);
  private readonly vault = inject(PasswordVaultService);
  private applying = false;

  async readFile(file: File): Promise<WorkspaceImport> {
    if (file.size > MAX_IMPORT_BYTES) throw new Error(`Fichier trop volumineux (maximum ${MAX_IMPORT_BYTES / 1024 / 1024} MiB)`);
    return parseWorkspaceImport(await file.text(), file.name);
  }

  async apply(imported: WorkspaceImport, mode: WorkspaceImportMode): Promise<WorkspaceImportResult> {
    if (this.applying) throw new Error('Un import est déjà en cours');
    this.applying = true;
    try {
      const current = await this.store.init();
      if (!current) throw new Error('Données Workspace indisponibles');
      if (mode === 'overwrite' && !imported.full) {
        throw new Error('Le remplacement nécessite une sauvegarde complète');
      }
      validateWorkspaceImport(imported.data, false);

      let candidate = mode === 'overwrite'
        ? imported.data
        : mergeWorkspaceImport(current, imported.data);
      let next = completeWorkspaceData(candidate);
      validateWorkspaceImport(next);

      let latest = current;
      if (mode === 'overwrite') {
        const beforeBackup = structuredClone(this.store.data() ?? current);
        const backup = await this.backup.saveWorkspaceBackup({ preferPicker: true });
        if (!backup.saved) throw new Error('Import annulé : la sauvegarde préalable est requise');
        const afterBackup = this.store.data();
        if (!afterBackup || JSON.stringify(afterBackup) !== JSON.stringify(beforeBackup)) {
          throw new Error('Import annulé : les données ont changé pendant la sauvegarde préalable');
        }
        latest = afterBackup;
        candidate = imported.data;
        next = completeWorkspaceData(candidate);
        validateWorkspaceImport(next);
      }

      const previous = structuredClone(latest);
      if (!this.store.replace(next)) throw new Error('Données Workspace indisponibles');
      try {
        await this.store.flush();
      } catch (error) {
        let restored = false;
        try {
          restored = !!this.store.replace(previous);
          await this.store.flush();
        } catch {
          restored = false;
        }
        if (!restored) throw new Error('Import échoué et restauration impossible');
        throw error;
      }
      this.vault.invalidateSession();
      return { mode, full: imported.full };
    } finally {
      this.applying = false;
    }
  }
}
