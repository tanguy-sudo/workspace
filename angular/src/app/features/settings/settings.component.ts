import { CommonModule } from '@angular/common';
import {
  Component,
  HostListener,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import {
  BACKUP_FREQUENCIES,
  DEFAULT_BACKUP_FOLDER,
  DEFAULT_BACKUP_FREQUENCY_HOURS,
  WorkspaceBackupService,
  type StorageQuota,
  backupFrequencyLabel,
} from '../../core/files/workspace-backup.service';
import { FileAccessService } from '../../core/files/file-access.service';
import { StoragePreferencesService, STORAGE_KEYS } from '../../core/persistence/storage-preferences.service';
import { WorkspaceStoreService } from '../../core/persistence/workspace-store.service';
import { FeedbackService } from '../../shared/feedback/feedback.service';
import { FocusTrapDirective } from '../../shared/a11y/focus-trap.directive';
import { PasswordVaultService } from '../../core/security/password-vault.service';
import { ResizableDialogDirective } from '../../shared/dialog/resizable-dialog.directive';

type VaultDialogKind = 'enable' | 'unlock' | 'change' | 'disable-unlock';

interface VaultDialog {
  kind: VaultDialogKind;
  title: string;
  description?: string;
  confirmLabel: string;
}

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [CommonModule, FocusTrapDirective, ResizableDialogDirective],
  templateUrl: './settings.component.html',
  styleUrl: './settings.component.css',
})
export class SettingsComponent {
  private readonly store = inject(WorkspaceStoreService);
  private readonly preferences = inject(StoragePreferencesService);
  private readonly files = inject(FileAccessService);
  private readonly backup = inject(WorkspaceBackupService);
  private readonly vault = inject(PasswordVaultService);
  private readonly feedback = inject(FeedbackService);

  protected readonly frequencies = BACKUP_FREQUENCIES;
  protected readonly status = this.store.status;
  protected readonly ready = this.store.ready;
  protected readonly userName = signal('');
  protected readonly siteName = signal('Workspace');
  protected readonly backupFolder = signal(DEFAULT_BACKUP_FOLDER);
  protected readonly frequency = signal(DEFAULT_BACKUP_FREQUENCY_HOURS);
  protected readonly quota = signal<StorageQuota | null>(null);
  protected readonly vaultDialog = signal<VaultDialog | null>(null);
  protected readonly vaultCurrent = signal('');
  protected readonly vaultNext = signal('');
  protected readonly vaultConfirm = signal('');
  protected readonly vaultBusy = signal(false);
  protected readonly vaultRefresh = signal(0);
  protected readonly lastBackupRefresh = signal(0);
  protected readonly vaultEnabled = computed(() => { this.vaultRefresh(); return this.vault.hasEnabledVault(); });
  protected readonly vaultUnlocked = computed(() => { this.vaultRefresh(); return this.vault.isUnlocked(); });

  private initialized = false;

  constructor() {
    effect(() => {
      const data = this.store.data();
      if (!data || this.initialized) return;
      this.initialized = true;
      this.userName.set(data.settings.userName?.trim() || '');
      this.siteName.set(data.settings.siteName?.trim() || 'Workspace');
      this.backupFolder.set(data.settings.backupFolder?.trim() || DEFAULT_BACKUP_FOLDER);
      const hours = Number(data.settings.autoBackupFrequencyHours);
      this.frequency.set(Number.isFinite(hours) && hours >= 0 ? hours : DEFAULT_BACKUP_FREQUENCY_HOURS);
      void this.refreshFolderLabel();
      void this.refreshQuota();
    });
    void this.store.init();
  }

  protected setUserName(event: Event): void { this.userName.set((event.target as HTMLInputElement).value); }
  protected setSiteName(event: Event): void { this.siteName.set((event.target as HTMLInputElement).value); }
  protected setFrequency(event: Event): void { this.frequency.set(Math.max(0, Number((event.target as HTMLSelectElement).value) || 0)); }

  protected saveSettings(): void {
    if (this.store.writeAccess() !== 'writer') {
      this.feedback.showToast('Lecture seule : une autre fenêtre détient le verrou d’écriture Workspace', 'error');
      return;
    }
    const updated = this.store.updateSettings({
      userName: this.userName().trim(),
      siteName: this.siteName().trim() || 'Workspace',
      backupFolder: this.backupFolder().trim() || DEFAULT_BACKUP_FOLDER,
      autoBackupFrequencyHours: this.frequency(),
    });
    if (!updated) {
      this.feedback.showToast('Paramètres indisponibles', 'error');
      return;
    }
    this.siteName.set(updated.settings.siteName?.trim() || 'Workspace');
    this.feedback.showToast('Paramètres enregistrés', 'success');
  }

  protected async pickBackupFolder(): Promise<void> {
    if (!this.files.canChooseBackupDirectory()) {
      this.feedback.showToast('Le navigateur ne supporte pas le choix de dossier natif', 'error');
      return;
    }
    const handle = await this.files.chooseBackupDirectory();
    if (!handle?.name) return;
    this.backupFolder.set(handle.name);
    this.store.updateSettings({ backupFolder: handle.name });
    this.feedback.showToast('Dossier par défaut enregistré', 'success');
  }

  protected async clearBackupFolder(): Promise<void> {
    await this.files.clearBackupDirectory();
    this.backupFolder.set(DEFAULT_BACKUP_FOLDER);
    this.store.updateSettings({ backupFolder: DEFAULT_BACKUP_FOLDER });
    this.feedback.showToast('Dossier par défaut réinitialisé', 'success');
  }

  protected async testBackup(): Promise<void> {
    try {
      const result = await this.backup.saveWorkspaceBackup({ auto: true, preferPicker: true });
      if (result.saved) {
        this.lastBackupRefresh.update((value) => value + 1);
        this.feedback.showToast('Sauvegarde automatique enregistrée', 'success');
      } else if (!result.cancelled) {
        this.feedback.showToast('Sauvegarde impossible', 'error');
      }
    } catch {
      this.feedback.showToast('Sauvegarde impossible', 'error');
    }
  }

  protected frequencyLabel(): string { return backupFrequencyLabel(this.frequency()); }

  protected lastBackupLabel(): string {
    this.lastBackupRefresh();
    const timestamp = Number(this.preferences.get(STORAGE_KEYS.lastBackup, '0'));
    if (!timestamp) return 'Jamais';
    const date = new Date(timestamp);
    return Number.isNaN(date.getTime()) ? 'Jamais' : date.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  protected storageColor(percent: number): string {
    return percent > 80 ? 'var(--danger)' : percent > 50 ? 'var(--accent)' : 'var(--success)';
  }

  protected vaultStatus(): string {
    if (!this.vaultEnabled()) return 'Désactivé';
    return this.vaultUnlocked() ? 'Activé et déverrouillé' : 'Activé et verrouillé';
  }

  protected openEnableVault(): void {
    if (this.vaultEnabled()) return;
    this.openVaultDialog({ kind: 'enable', title: 'Activer le mot de passe maître', description: 'Ce mot de passe sera nécessaire pour relire les secrets exportés ou importés.', confirmLabel: 'Activer' });
  }

  protected openUnlockVault(): void {
    if (!this.vaultEnabled() || this.vaultUnlocked()) return;
    this.openVaultDialog({ kind: 'unlock', title: 'Déverrouiller la session', confirmLabel: 'Déverrouiller' });
  }

  protected lockVault(): void {
    this.vault.lock();
    this.refreshVault();
    this.feedback.showToast('Session verrouillée', 'success');
  }

  protected openChangeVault(): void {
    if (!this.vaultEnabled()) return;
    this.openVaultDialog({ kind: 'change', title: 'Changer le mot de passe maître', description: 'Les secrets existants seront rechiffrés avec le nouveau mot de passe.', confirmLabel: 'Changer' });
  }

  protected openDisableVault(): void {
    if (!this.vaultEnabled()) return;
    if (this.vaultUnlocked()) {
      void this.confirmDisableVault();
      return;
    }
    this.openVaultDialog({ kind: 'disable-unlock', title: 'Confirmer le déverrouillage', confirmLabel: 'Déverrouiller' });
  }

  protected setVaultCurrent(event: Event): void { this.vaultCurrent.set((event.target as HTMLInputElement).value); }
  protected setVaultNext(event: Event): void { this.vaultNext.set((event.target as HTMLInputElement).value); }
  protected setVaultConfirm(event: Event): void { this.vaultConfirm.set((event.target as HTMLInputElement).value); }

  protected cancelVaultDialog(): void {
    if (!this.vaultBusy()) this.closeVaultDialog();
  }

  protected async submitVaultDialog(): Promise<void> {
    const dialog = this.vaultDialog();
    if (!dialog || this.vaultBusy()) return;
    const current = this.vaultCurrent();
    const next = this.vaultNext();
    const confirmation = this.vaultConfirm();

    if (!current || (dialog.kind === 'enable' && current !== confirmation)) {
      this.feedback.showToast(dialog.kind === 'enable' ? 'Les mots de passe ne correspondent pas' : 'Le mot de passe est requis', 'error');
      return;
    }
    if (dialog.kind === 'change' && (!next || next !== confirmation || next === current)) {
      this.feedback.showToast(next === current ? 'Le nouveau mot de passe doit être différent' : 'Les mots de passe ne correspondent pas', 'error');
      return;
    }

    this.vaultBusy.set(true);
    try {
      if (dialog.kind === 'enable') {
        const result = await this.vault.enable(current);
        this.closeVaultDialog();
        this.refreshVault();
        this.feedback.showToast(`Mot de passe maître activé${result.migratedCount ? ` (${result.migratedCount} item(s) migré(s))` : ''}`, 'success');
      } else if (dialog.kind === 'unlock' || dialog.kind === 'disable-unlock') {
        await this.vault.unlock(current);
        this.closeVaultDialog();
        this.refreshVault();
        if (dialog.kind === 'disable-unlock') await this.confirmDisableVault();
        else this.feedback.showToast('Session déverrouillée', 'success');
      } else {
        await this.vault.changePassword(current, next);
        this.closeVaultDialog();
        this.refreshVault();
        this.feedback.showToast('Mot de passe maître modifié', 'success');
      }
    } catch {
      this.feedback.showToast(dialog.kind === 'enable' ? 'Activation impossible' : 'Mot de passe maître invalide ou opération impossible', 'error');
    } finally {
      this.vaultBusy.set(false);
    }
  }

  @HostListener('document:keydown', ['$event'])
  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && this.vaultDialog()) {
      event.preventDefault();
      this.cancelVaultDialog();
    }
  }

  private openVaultDialog(dialog: VaultDialog): void {
    this.vaultCurrent.set('');
    this.vaultNext.set('');
    this.vaultConfirm.set('');
    this.vaultDialog.set(dialog);
  }

  private closeVaultDialog(): void {
    this.vaultDialog.set(null);
    this.vaultCurrent.set('');
    this.vaultNext.set('');
    this.vaultConfirm.set('');
  }

  private refreshVault(): void { this.vaultRefresh.update((value) => value + 1); }

  private async refreshFolderLabel(): Promise<void> {
    if (this.backupFolder() !== DEFAULT_BACKUP_FOLDER) return;
    const label = await this.files.getBackupDirectoryLabel();
    if (this.backupFolder() === DEFAULT_BACKUP_FOLDER) this.backupFolder.set(label);
  }

  private async refreshQuota(): Promise<void> { this.quota.set(await this.backup.getStorageQuota()); }

  private async confirmDisableVault(): Promise<void> {
    const accepted = await this.feedback.confirm({
      title: 'Désactiver le mot de passe maître ?',
      message: 'Cette action remet les identifiants et mots de passe en clair dans le stockage.',
      confirmLabel: 'Désactiver',
      destructive: true,
    });
    if (!accepted) return;
    try {
      const result = await this.vault.disable();
      this.refreshVault();
      this.feedback.showToast(`Mot de passe maître désactivé${result.migratedCount ? ` (${result.migratedCount} item(s) restauré(s))` : ''}`, 'success');
    } catch {
      this.feedback.showToast('Désactivation impossible', 'error');
    }
  }
}
