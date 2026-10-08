import { Injectable } from '@angular/core';

export const STORAGE_KEYS = {
  theme: 'workspace-theme',
  accent: 'workspace-accent',
  lastBackup: 'workspace-last-backup',
  smartPlan: 'workspace-smart-plan',
  projectsView: 'workspace-projects-view',
  projectsParent: 'workspace-projects-parent',
  snippetsView: 'workspace-snippets-view',
  snippetsCollapsed: 'workspace-snippets-collapsed',
  todosView: 'workspace-todos-view',
  reminderFired: 'workspace-reminder-fired-v1',
  notificationAsked: 'workspace-notif-asked',
  modalSizePrefix: 'workspace-modal-size-v1:',
  vaultKey: 'workspace-vault-key-v1',
  createJournal: 'workspace_create_journal',
  focusTodo: 'workspace_focus_todo',
} as const;

type StorageArea = 'local' | 'session';

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type ThemePreference = 'dark' | string;

@Injectable({ providedIn: 'root' })
export class StoragePreferencesService {
  get(key: string, fallback: string | null = null, area: StorageArea = 'local'): string | null {
    try {
      return this.storage(area)?.getItem(key) ?? fallback;
    } catch {
      return fallback;
    }
  }

  set(key: string, value: string, area: StorageArea = 'local'): boolean {
    try {
      this.storage(area)?.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  }

  remove(key: string, area: StorageArea = 'local'): boolean {
    try {
      this.storage(area)?.removeItem(key);
      return true;
    } catch {
      return false;
    }
  }

  getJson<T>(key: string, fallback: T, area: StorageArea = 'local'): T {
    const raw = this.get(key, null, area);
    if (!raw) return fallback;
    try {
      const value: unknown = JSON.parse(raw);
      return value === null || value === undefined ? fallback : value as T;
    } catch {
      return fallback;
    }
  }

  setJson(key: string, value: unknown, area: StorageArea = 'local'): boolean {
    try {
      return this.set(key, JSON.stringify(value), area);
    } catch {
      return false;
    }
  }

  /**
   * During coexistence settings.theme is canonical; localStorage is only the
   * early-boot fallback needed by legacy HTML before IndexedDB is ready.
   */
  resolveTheme(settingsTheme: string | undefined): ThemePreference {
    return settingsTheme || this.get(STORAGE_KEYS.theme, 'dark') || 'dark';
  }

  getModalSize(key: string): { width: number; height: number } | null {
    const value = this.getJson<{ w?: unknown; h?: unknown } | null>(
      STORAGE_KEYS.modalSizePrefix + key,
      null,
    );
    if (typeof value?.w !== 'number' || typeof value.h !== 'number') return null;
    return { width: value.w, height: value.h };
  }

  setModalSize(key: string, size: { width: number; height: number }): boolean {
    return this.setJson(STORAGE_KEYS.modalSizePrefix + key, {
      w: Math.round(size.width),
      h: Math.round(size.height),
    });
  }

  removeModalSize(key: string): boolean {
    return this.remove(STORAGE_KEYS.modalSizePrefix + key);
  }

  private storage(area: StorageArea): StorageLike | null {
    if (typeof window === 'undefined') return null;
    return area === 'session' ? window.sessionStorage : window.localStorage;
  }
}
