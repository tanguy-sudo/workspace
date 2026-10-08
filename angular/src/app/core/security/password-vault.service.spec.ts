import { TestBed } from '@angular/core/testing';
import fixture from '../../../../../fixtures/workspace-with-vault.json';
import { PasswordVaultService, VAULT_DEFAULT_ITERATIONS } from './password-vault.service';
import { WorkspaceDbService } from '../persistence/workspace-db.service';
import { WorkspaceStoreService } from '../persistence/workspace-store.service';
import { WORKSPACE_DATA_KEY, WORKSPACE_DB_NAME, WORKSPACE_DB_VERSION } from '../persistence/workspace-data';
import { StoragePreferencesService } from '../persistence/storage-preferences.service';
import { validateWorkspaceImport } from '../persistence/workspace-import';
import Dexie from 'dexie';

describe('PasswordVaultService', () => {
  let vault: PasswordVaultService;
  let dbService: WorkspaceDbService;

  beforeEach(async () => {
    await Dexie.delete(WORKSPACE_DB_NAME);
    sessionStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        WorkspaceDbService,
        WorkspaceStoreService,
        StoragePreferencesService,
        PasswordVaultService,
      ],
    });
    dbService = TestBed.inject(WorkspaceDbService);
    const db = new Dexie(WORKSPACE_DB_NAME);
    db.version(WORKSPACE_DB_VERSION).stores({ kv: 'key' });
    await db.table('kv').put({ key: WORKSPACE_DATA_KEY, value: fixture.data });
    db.close();
    vault = TestBed.inject(PasswordVaultService);
    await TestBed.inject(WorkspaceStoreService).init();
  });

  afterEach(async () => {
    dbService.ngOnDestroy();
    await Dexie.delete(WORKSPACE_DB_NAME);
    sessionStorage.clear();
  });

  it('uses the stored iteration count and opens the historical fixture', async () => {
    expect(vault.hasEnabledVault()).toBe(true);
    expect(vault.isUnlocked()).toBe(false);

    await vault.unlock('fixture-master-password');
    expect(vault.isUnlocked()).toBe(true);
    await expect(vault.readSecret('vault-project-a', 'vault-item-a')).resolves.toEqual({
      login: 'fixture-user-a',
      password: 'fixture-password-a',
    });
  });

  it('does not reveal a secret for a wrong password', async () => {
    await expect(vault.unlock('wrong-password')).rejects.toThrow('Invalid master password');
    expect(sessionStorage.getItem('workspace-vault-key-v1')).toBeNull();
  });

  it('keeps encrypted storage on write and supports password rotation', async () => {
    await vault.unlock('fixture-master-password');
    await vault.writeSecret('vault-project-a', 'vault-item-a', {
      login: 'updated-login',
      password: 'updated-password',
    });
    expect(await vault.readSecret('vault-project-a', 'vault-item-a')).toEqual({
      login: 'updated-login',
      password: 'updated-password',
    });
    await vault.changePassword('fixture-master-password', 'next-password');
    vault.lock();
    await expect(vault.unlock('fixture-master-password')).rejects.toThrow('Invalid master password');
    await vault.unlock('next-password');
    await expect(vault.readSecret('vault-project-a', 'vault-item-a')).resolves.toEqual({
      login: 'updated-login',
      password: 'updated-password',
    });
  });

  it('encrypts a new secret without exposing cleartext storage', async () => {
    await vault.unlock('fixture-master-password');
    const encrypted = await vault.encryptSecret({ login: 'new-login', password: 'new-password' });

    expect(encrypted).toEqual({ iv: expect.any(String), cipher: expect.any(String) });
    expect(encrypted.cipher).not.toContain('new-password');
  });

  it('can activate and disable the historical cleartext representation explicitly', async () => {
    const store = TestBed.inject(WorkspaceStoreService);
    const data = store.data();
    if (!data) throw new Error('fixture not loaded');
    store.update((draft) => {
      delete draft.settings.secretVault;
      for (const project of draft.projects) {
        const passwordItem = project.children.flatMap((node) =>
          node.nodeType === 'folder' ? node.children : [node],
        )[0];
        if (passwordItem.nodeType !== 'item') throw new Error('fixture item missing');
        passwordItem.login = passwordItem.id === 'vault-item-a' ? 'clear-login' : 'clear-login-b';
        passwordItem.password = passwordItem.id === 'vault-item-a' ? 'clear-password' : 'clear-password-b';
        delete passwordItem.secretEncrypted;
      }
    });

    const result = await vault.enable('new-master-password');
    expect(result.migratedCount).toBe(2);
    expect(vault.isUnlocked()).toBe(true);
    expect(await vault.readSecret('vault-project-a', 'vault-item-a')).toEqual({
      login: 'clear-login',
      password: 'clear-password',
    });

    await expect(vault.disable()).resolves.toEqual({ migratedCount: 2 });
    expect(vault.isUnlocked()).toBe(false);
    const disabled = store.data();
    if (!disabled) throw new Error('fixture data missing');
    expect(disabled.settings.secretVault).toBeUndefined();
  });

  it('migrates trashed password items in both directions so exports stay importable', async () => {
    const store = TestBed.inject(WorkspaceStoreService);
    store.update((draft) => {
      delete draft.settings.secretVault;
      for (const project of draft.projects) {
        for (const node of project.children.flatMap((child) => child.nodeType === 'folder' ? child.children : [child])) {
          if (node.nodeType !== 'item') continue;
          node.login = 'clear-login';
          node.password = 'clear-password';
          delete node.secretEncrypted;
        }
      }
      draft.trash.push({
        id: 'trashed-password', nodeType: 'item', type: 'password', title: 'Mot de passe supprime',
        login: 'trash-login', password: 'trash-password',
        _trashType: 'project-node', _deletedAt: 1764806400000,
        _projectId: 'vault-project-a', _nodeParentId: 'vault-folder-a',
      } as never);
    });

    // enable() doit chiffrer aussi la corbeille, sinon l'export porterait un secret en clair coffre actif.
    expect((await vault.enable('new-master-password')).migratedCount).toBe(3);
    const trashed = () => store.data()?.trash.find((entry) => entry.id === 'trashed-password') as Record<string, unknown>;
    expect(trashed()['secretEncrypted']).toEqual({ iv: expect.any(String), cipher: expect.any(String) });
    expect(trashed()['password']).toBe('');
    expect(() => validateWorkspaceImport(store.data())).not.toThrow();

    // disable() doit dechiffrer la corbeille, sinon l'export porterait un secret chiffre sans coffre.
    expect((await vault.disable()).migratedCount).toBe(3);
    expect(trashed()['secretEncrypted']).toBeUndefined();
    expect(trashed()['password']).toBe('trash-password');
    expect(() => validateWorkspaceImport(store.data())).not.toThrow();
  });

  it('keeps the historical default iteration fallback explicit', () => {
    expect(VAULT_DEFAULT_ITERATIONS).toBe(250000);
  });
});
