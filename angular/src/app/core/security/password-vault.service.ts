import { Injectable, inject, signal } from '@angular/core';
import { StoragePreferencesService, STORAGE_KEYS } from '../persistence/storage-preferences.service';
import { WorkspaceStoreService } from '../persistence/workspace-store.service';
import { findTreeNode } from '../domain/workspace-domain';
import type {
  EncryptedPayload,
  ProjectItem,
  SecretVaultConfig,
  WorkspaceData,
} from '../persistence/workspace-data';

export const VAULT_VERIFIER_TEXT = 'workspace-vault-verifier-v1';
export const VAULT_DEFAULT_ITERATIONS = 250000;
export const VAULT_MIN_ITERATIONS = 100000;
export const VAULT_MAX_ITERATIONS = 1000000;

export interface PasswordSecret {
  login: string;
  password: string;
}

function bytesToBase64(value: ArrayBuffer | Uint8Array): string {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function cryptoBytes(value: Uint8Array): ArrayBuffer {
  return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer;
}

function passwordSecret(value: Partial<PasswordSecret> | null | undefined): PasswordSecret {
  return {
    login: value?.login || '',
    password: value?.password || '',
  };
}

function projectPasswordItems(data: WorkspaceData): ProjectItem[] {
  const items: ProjectItem[] = [];
  const walk = (nodes: unknown[]): void => {
    for (const value of nodes) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
      const node = value as Record<string, unknown>;
      if (node['nodeType'] === 'item' && node['type'] === 'password') items.push(node as unknown as ProjectItem);
      if (node['nodeType'] === 'folder' || Array.isArray(node['children'])) walk(node['children'] as unknown[] ?? []);
    }
  };
  for (const project of data.projects) walk(project.children);
  for (const entry of data.trash) {
    if (entry['_trashType'] === 'project' || entry['_trashType'] === 'project-node') walk([entry]);
  }
  return items;
}

@Injectable({ providedIn: 'root' })
export class PasswordVaultService {
  private readonly store = inject(WorkspaceStoreService);
  private readonly preferences = inject(StoragePreferencesService);
  private readonly unlockEpoch = signal(0);

  hasEnabledVault(): boolean {
    const config = this.store.data()?.settings.secretVault;
    return !!config?.enabled && !!config.salt && !!config.verifier?.iv && !!config.verifier.cipher;
  }

  isUnlocked(): boolean {
    this.unlockEpoch();
    return !!this.preferences.get(STORAGE_KEYS.vaultKey, null, 'session');
  }

  lock(): void {
    this.preferences.remove(STORAGE_KEYS.vaultKey, 'session');
    this.unlockEpoch.update((value) => value + 1);
  }

  invalidateSession(): void {
    this.lock();
  }

  async enable(password: string): Promise<{ migratedCount: number }> {
    const data = await this.requireData();
    const salt = this.randomBase64(16);
    const key = await this.deriveKey(password, salt, VAULT_DEFAULT_ITERATIONS);
    const items = projectPasswordItems(data);
    const encrypted = new Map<string, EncryptedPayload>();

    for (const item of items) {
      if (item.secretEncrypted) continue;
      encrypted.set(item.id, await this.encrypt(JSON.stringify(passwordSecret(item)), key));
    }
    const verifier = await this.encrypt(VAULT_VERIFIER_TEXT, key);

    this.store.update((draft) => {
      draft.settings.secretVault = {
        enabled: true,
        salt,
        iterations: VAULT_DEFAULT_ITERATIONS,
        verifier,
      };
      for (const item of projectPasswordItems(draft)) {
        const payload = encrypted.get(item.id);
        if (!payload) continue;
        item.secretEncrypted = payload;
        item.login = '';
        item.password = '';
      }
    });
    await this.store.flush();
    await this.storeSessionKey(key);
    return { migratedCount: encrypted.size };
  }

  async unlock(password: string): Promise<void> {
    const data = await this.requireData();
    const config = this.requireConfig(data);
    const key = await this.deriveKey(password, config.salt, this.iterations(config));
    try {
      const verifier = await this.decrypt(config.verifier, key);
      if (verifier !== VAULT_VERIFIER_TEXT) throw new Error('invalid-password');
    } catch {
      throw new Error('Invalid master password');
    }
    await this.storeSessionKey(key);
  }

  async readSecret(projectId: string, itemId: string): Promise<PasswordSecret> {
    const data = await this.requireData();
    const item = this.findProjectItem(data, projectId, itemId);
    if (!item) throw new Error('Password item not found');
    if (!item.secretEncrypted) return passwordSecret(item);
    return JSON.parse(await this.decrypt(item.secretEncrypted, await this.unlockedKey())) as PasswordSecret;
  }

  async writeSecret(projectId: string, itemId: string, secret: PasswordSecret): Promise<void> {
    const data = await this.requireData();
    const item = this.findProjectItem(data, projectId, itemId);
    if (!item) throw new Error('Password item not found');
    const payload = this.hasEnabledVault()
      ? await this.encrypt(JSON.stringify(passwordSecret(secret)), await this.unlockedKey())
      : null;

    this.store.update((draft) => {
      const draftItem = this.findProjectItem(draft, projectId, itemId);
      if (!draftItem) return;
      if (payload) {
        draftItem.secretEncrypted = payload;
        draftItem.login = '';
        draftItem.password = '';
      } else {
        draftItem.login = secret.login || '';
        draftItem.password = secret.password || '';
        delete draftItem.secretEncrypted;
      }
    });
    await this.store.flush();
  }

  async encryptSecret(secret: PasswordSecret): Promise<EncryptedPayload> {
    if (!this.hasEnabledVault()) throw new Error('Vault not configured');
    return this.encrypt(JSON.stringify(passwordSecret(secret)), await this.unlockedKey());
  }

  async changePassword(currentPassword: string, nextPassword: string): Promise<void> {
    const data = await this.requireData();
    const config = this.requireConfig(data);
    const iterations = this.iterations(config);
    const currentKey = await this.verifiedKey(currentPassword, config);
    const nextSalt = this.randomBase64(16);
    const nextKey = await this.deriveKey(nextPassword, nextSalt, iterations);
    const secrets = new Map<string, PasswordSecret>();
    for (const item of projectPasswordItems(data)) {
      secrets.set(item.id, item.secretEncrypted
        ? passwordSecret(JSON.parse(await this.decrypt(item.secretEncrypted, currentKey)))
        : passwordSecret(item));
    }
    const encrypted = new Map<string, EncryptedPayload>();
    for (const [id, secret] of secrets) {
      encrypted.set(id, await this.encrypt(JSON.stringify(secret), nextKey));
    }
    const verifier = await this.encrypt(VAULT_VERIFIER_TEXT, nextKey);

    this.store.update((draft) => {
      draft.settings.secretVault = { enabled: true, salt: nextSalt, iterations, verifier };
      for (const item of projectPasswordItems(draft)) {
        const payload = encrypted.get(item.id);
        if (!payload) continue;
        item.secretEncrypted = payload;
        item.login = '';
        item.password = '';
      }
    });
    await this.store.flush();
    await this.storeSessionKey(nextKey);
  }

  async disable(): Promise<{ migratedCount: number }> {
    const data = await this.requireData();
    const key = await this.unlockedKey();
    const secrets = new Map<string, PasswordSecret>();
    for (const item of projectPasswordItems(data)) {
      if (item.secretEncrypted) {
        secrets.set(item.id, passwordSecret(JSON.parse(await this.decrypt(item.secretEncrypted, key))));
      }
    }

    this.store.update((draft) => {
      for (const item of projectPasswordItems(draft)) {
        const secret = secrets.get(item.id);
        if (!secret) continue;
        item.login = secret.login;
        item.password = secret.password;
        delete item.secretEncrypted;
      }
      delete draft.settings.secretVault;
    });
    await this.store.flush();
    this.lock();
    return { migratedCount: secrets.size };
  }

  private async requireData(): Promise<WorkspaceData> {
    await this.store.init();
    const data = this.store.data();
    if (!data) throw new Error('Workspace data unavailable');
    return data;
  }

  private requireConfig(data: WorkspaceData): SecretVaultConfig {
    const config = data.settings.secretVault;
    if (!config?.enabled || !config.salt || !config.verifier) throw new Error('Vault not configured');
    return config;
  }

  private iterations(config: SecretVaultConfig): number {
    return Number.isInteger(config.iterations) && config.iterations >= VAULT_MIN_ITERATIONS && config.iterations <= VAULT_MAX_ITERATIONS
      ? config.iterations
      : VAULT_DEFAULT_ITERATIONS;
  }

  private async verifiedKey(password: string, config: SecretVaultConfig): Promise<CryptoKey> {
    const key = await this.deriveKey(password, config.salt, this.iterations(config));
    try {
      if (await this.decrypt(config.verifier, key) !== VAULT_VERIFIER_TEXT) throw new Error('invalid-password');
    } catch {
      throw new Error('Invalid master password');
    }
    return key;
  }

  private async unlockedKey(): Promise<CryptoKey> {
    const raw = this.preferences.get(STORAGE_KEYS.vaultKey, null, 'session');
    if (!raw) throw new Error('Vault locked');
    try {
      return await globalThis.crypto.subtle.importKey(
        'raw',
        cryptoBytes(base64ToBytes(raw)),
        { name: 'AES-GCM' },
        false,
        ['encrypt', 'decrypt'],
      );
    } catch {
      throw new Error('Vault locked');
    }
  }

  private async storeSessionKey(key: CryptoKey): Promise<void> {
    const raw = await globalThis.crypto.subtle.exportKey('raw', key);
    if (!this.preferences.set(STORAGE_KEYS.vaultKey, bytesToBase64(raw), 'session')) {
      throw new Error('Vault session storage unavailable');
    }
    this.unlockEpoch.update((value) => value + 1);
  }

  private async deriveKey(password: string, salt: string, iterations: number): Promise<CryptoKey> {
    const baseKey = await globalThis.crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(password),
      'PBKDF2',
      false,
      ['deriveKey'],
    );
    return globalThis.crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: cryptoBytes(base64ToBytes(salt)), iterations, hash: 'SHA-256' },
      baseKey,
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt'],
    );
  }

  private async encrypt(text: string, key: CryptoKey): Promise<EncryptedPayload> {
    const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
    const cipher = await globalThis.crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      cryptoBytes(new TextEncoder().encode(text)),
    );
    return { iv: bytesToBase64(iv), cipher: bytesToBase64(cipher) };
  }

  private async decrypt(payload: EncryptedPayload, key: CryptoKey): Promise<string> {
    const plain = await globalThis.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: cryptoBytes(base64ToBytes(payload.iv)) },
      key,
      cryptoBytes(base64ToBytes(payload.cipher)),
    );
    return new TextDecoder().decode(plain);
  }

  private findProjectItem(data: WorkspaceData, projectId: string, itemId: string): ProjectItem | null {
    const project = data.projects.find((candidate) => candidate.id === projectId);
    if (!project) return null;
    const root = { id: project.id, nodeType: 'folder', children: project.children };
    return findTreeNode(root, itemId) as ProjectItem | null;
  }

  private randomBase64(size: number): string {
    return bytesToBase64(globalThis.crypto.getRandomValues(new Uint8Array(size)));
  }

}
