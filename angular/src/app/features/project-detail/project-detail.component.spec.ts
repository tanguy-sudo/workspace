import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { convertToParamMap, provideRouter, ActivatedRoute, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { BehaviorSubject } from 'rxjs';
import fixture from '../../../../../fixtures/workspace-full.json';
import vaultFixture from '../../../../../fixtures/workspace-with-vault.json';
import { ProjectDetailComponent } from './project-detail.component';
import { routes } from '../../app.routes';
import { FileAccessService } from '../../core/files/file-access.service';
import { PasswordVaultService } from '../../core/security/password-vault.service';
import { WorkspaceStoreService } from '../../core/persistence/workspace-store.service';
import { FeedbackService } from '../../shared/feedback/feedback.service';
import type { ProjectItem, WorkspaceData } from '../../core/persistence/workspace-data';

describe('ProjectDetailComponent', () => {
  let data: ReturnType<typeof signal<WorkspaceData | null>>;
  let store: {
    data: ReturnType<typeof data.asReadonly>;
    loading: () => boolean;
    ready: () => boolean;
    init: () => Promise<WorkspaceData | null>;
    update: (mutator: (draft: WorkspaceData) => void) => WorkspaceData | null;
  };
  let feedback: { confirm: ReturnType<typeof vi.fn>; showToast: ReturnType<typeof vi.fn> };
  let files: { readAttachment: ReturnType<typeof vi.fn>; saveBlob: ReturnType<typeof vi.fn>; createObjectUrl: ReturnType<typeof vi.fn>; revokeObjectUrl: ReturnType<typeof vi.fn> };
  let vault: { hasEnabledVault: ReturnType<typeof vi.fn>; isUnlocked: ReturnType<typeof vi.fn>; readSecret: ReturnType<typeof vi.fn>; encryptSecret: ReturnType<typeof vi.fn>; unlock: ReturnType<typeof vi.fn> };
  let routeId: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
  let routeQuery: BehaviorSubject<ReturnType<typeof convertToParamMap>>;

  beforeEach(() => {
    data = signal<WorkspaceData | null>(structuredClone(fixture.data) as WorkspaceData);
    routeId = new BehaviorSubject(convertToParamMap({ id: 'project-alpha' }));
    routeQuery = new BehaviorSubject(convertToParamMap({}));
    store = {
      data: data.asReadonly(),
      loading: () => false,
      ready: () => true,
      init: async () => data(),
      update: (mutator) => {
        const draft = structuredClone(data()) as WorkspaceData;
        mutator(draft);
        data.set(draft);
        return draft;
      },
    };
    feedback = { confirm: vi.fn(async () => true), showToast: vi.fn() };
    files = {
      readAttachment: vi.fn(async (file: File) => ({ name: file.name, mime: file.type, size: file.size, base64: 'data:text/plain;base64,Zml4dHVyZQ==' })),
      saveBlob: vi.fn(async () => ({ saved: true, method: 'download' })),
      createObjectUrl: vi.fn(() => 'blob:fixture'),
      revokeObjectUrl: vi.fn(),
    };
    vault = {
      hasEnabledVault: vi.fn(() => false),
      isUnlocked: vi.fn(() => false),
      readSecret: vi.fn(),
      encryptSecret: vi.fn(),
      unlock: vi.fn(),
    };
    TestBed.configureTestingModule({
      imports: [ProjectDetailComponent],
      providers: [
        provideRouter(routes),
        { provide: ActivatedRoute, useValue: { paramMap: routeId.asObservable(), queryParamMap: routeQuery.asObservable(), snapshot: { paramMap: routeId.value, queryParamMap: routeQuery.value } } },
        { provide: WorkspaceStoreService, useValue: store },
        { provide: FileAccessService, useValue: files },
        { provide: PasswordVaultService, useValue: vault },
        { provide: FeedbackService, useValue: feedback },
      ],
    });
  });

  it('restores a deep folder and focus target from legacy query parameters', async () => {
    routeQuery.next(convertToParamMap({ path: 'folder-alpha-docs', focus: 'item-alpha-code', kind: 'item' }));
    const component = TestBed.createComponent(ProjectDetailComponent);
    component.detectChanges();
    await component.whenStable();

    expect(component.nativeElement.querySelector('#project-name')?.textContent).toContain('Projet Alpha');
    expect(component.nativeElement.querySelector('.project-meta')?.textContent).toContain('API');
    expect(component.nativeElement.querySelector('[data-project-node-id="item-alpha-code"]')).toBeTruthy();
  });

  it('renders safe item content, filters recursively and preserves linked todos', async () => {
    const component = TestBed.createComponent(ProjectDetailComponent);
    component.detectChanges();
    await component.whenStable();

    expect(component.nativeElement.querySelectorAll('.folder-card')).toHaveLength(2);
    expect(component.nativeElement.querySelectorAll('.item-card')).toHaveLength(0);
    component.componentInstance['navigateFolder']('folder-alpha-docs');
    component.componentInstance['toggleExpanded']('item-alpha-info');
    component.detectChanges();

    expect(component.nativeElement.querySelectorAll('.item-card')).toHaveLength(2);
    expect(component.nativeElement.querySelector('.linked-todos')?.textContent).toContain('Tâches liées');
    expect(component.nativeElement.querySelector('app-safe-markdown')).toBeTruthy();
    expect(component.componentInstance['safeItemUrl']('javascript:alert(1)')).toBeNull();
  });

  it('creates, moves, reorders and deletes project nodes through the store', async () => {
    const component = TestBed.createComponent(ProjectDetailComponent);
    component.detectChanges();
    await component.whenStable();

    component.componentInstance['itemDraft'] = {
      type: 'memo', title: 'Nouvel item', category: '', url: '', login: '', password: '', note: 'Note', code: '', language: '', tags: 'a, b, a', file: null,
    };
    component.componentInstance['dialog'].set({ kind: 'item', title: 'Ajouter un item' });
    await component.componentInstance['submitItem']();
    expect(data()!.projects[0].children.some((node) => node.nodeType === 'item' && node.title === 'Nouvel item')).toBe(true);

    const folder = data()!.projects[0].children.find((node) => node.nodeType === 'folder')!;
    component.componentInstance['moveNodeId'] = 'item-alpha-code';
    component.componentInstance['moveTargetId'] = folder.id;
    component.componentInstance['dialog'].set({ kind: 'move', title: 'Déplacer', nodeId: 'item-alpha-code' });
    component.componentInstance['submitMove']();
    expect((data()!.projects[0].children.find((node) => node.id === folder.id) as { children: unknown[] }).children).toContainEqual(expect.objectContaining({ id: 'item-alpha-code' }));

    await component.componentInstance['removeNode'](folder);
    expect(data()!.trash.at(-1)).toMatchObject({ id: folder.id, _trashType: 'project-node' });
  });

  it('keeps password items locked until the vault is unlocked', async () => {
    const source = structuredClone(vaultFixture.data) as WorkspaceData;
    data.set(source);
    routeId.next(convertToParamMap({ id: 'vault-project-a' }));
    vault.hasEnabledVault.mockReturnValue(true);
    vault.readSecret.mockResolvedValue({ login: 'fixture-login', password: 'fixture-secret' });

    const component = TestBed.createComponent(ProjectDetailComponent);
    component.detectChanges();
    await component.whenStable();
    component.componentInstance['navigateFolder']('vault-folder-a');
    component.componentInstance['toggleExpanded']('vault-item-a');
    component.detectChanges();

    expect(component.nativeElement.querySelector('.locked-secret')?.textContent).toContain('Contenu chiffré');
    expect(component.nativeElement.querySelector('.locked-secret')?.textContent).not.toContain('fixture-secret');
    const passwordItem = source.projects[0].children[0].nodeType === 'folder'
      ? source.projects[0].children[0].children[0] as ProjectItem
      : source.projects[0].children[0] as ProjectItem;
    expect(component.componentInstance['secretFor'](passwordItem)).toBeNull();
  });

  it('does not expose historical cleartext passwords while the vault is locked', async () => {
    vault.hasEnabledVault.mockReturnValue(true);
    const component = TestBed.createComponent(ProjectDetailComponent);
    component.detectChanges();
    await component.whenStable();

    component.componentInstance['navigateFolder']('folder-alpha-security');
    component.componentInstance['toggleExpanded']('item-alpha-password');
    component.detectChanges();

    expect(component.nativeElement.querySelector('.locked-secret')?.textContent).toContain('Contenu chiffré');
    expect(component.nativeElement.textContent).not.toContain('fixture-password-a');
    expect(component.nativeElement.querySelector('input[value="fixture-password-a"]')).toBeNull();
  });

  it('does not preview an attachment whose MIME type disagrees with its bytes', async () => {
    const component = TestBed.createComponent(ProjectDetailComponent);
    component.detectChanges();
    await component.whenStable();

    component.componentInstance['openAttachment']({
      name: 'hostile.pdf',
      mime: 'application/pdf',
      size: 25,
      base64: 'data:application/pdf;base64,PGh0bWw+PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0PjwvaHRtbD4=',
    });

    expect(component.nativeElement.querySelector('iframe')).toBeNull();
    expect(files.saveBlob).toHaveBeenCalled();
  });

  it('keeps project item expansion and selection reachable from the keyboard', async () => {
    const component = TestBed.createComponent(ProjectDetailComponent);
    component.detectChanges();
    await component.whenStable();
    component.componentInstance['navigateFolder']('folder-alpha-api');
    component.detectChanges();

    const item = component.nativeElement.querySelector('[data-project-node-id="item-alpha-code"] .item-summary') as HTMLElement;
    item.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    component.detectChanges();
    expect(component.componentInstance['isExpanded']('item-alpha-code')).toBe(true);

    component.componentInstance['selectionMode'].set(true);
    item.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    expect(component.componentInstance['selectedIds']()).toContain('item-alpha-code');
  });
});
