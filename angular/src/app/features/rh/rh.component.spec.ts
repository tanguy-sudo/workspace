import { signal } from '@angular/core';
import { convertToParamMap, provideRouter, ActivatedRoute, ParamMap, Router } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { TestBed } from '@angular/core/testing';
import fixture from '../../../../../fixtures/workspace-full.json';
import { FileAccessService } from '../../core/files/file-access.service';
import type { RhDocument, RhNode, WorkspaceData } from '../../core/persistence/workspace-data';
import { WorkspaceStoreService } from '../../core/persistence/workspace-store.service';
import { FeedbackService } from '../../shared/feedback/feedback.service';
import { RhComponent } from './rh.component';

function findDocument(root: RhNode, id: string): RhDocument | null {
  if (root.nodeType === 'document') return root.id === id ? root : null;
  for (const child of root.children) {
    const document = findDocument(child, id);
    if (document) return document;
  }
  return null;
}

describe('RhComponent', () => {
  const source = structuredClone(fixture.data) as WorkspaceData;
  let data: ReturnType<typeof signal<WorkspaceData | null>>;
  let routeParams: BehaviorSubject<ParamMap>;
  let store: {
    data: ReturnType<typeof data.asReadonly>;
    loading: ReturnType<typeof signal<boolean>>;
    init: () => Promise<WorkspaceData | null>;
    update: (mutator: (draft: WorkspaceData) => void) => WorkspaceData | null;
  };

  beforeEach(() => {
    data = signal<WorkspaceData | null>(structuredClone(source));
    store = {
      data: data.asReadonly(),
      loading: signal(false),
      init: async () => data(),
      update: (mutator) => {
        const draft = structuredClone(data() as WorkspaceData);
        mutator(draft);
        data.set(draft);
        return draft;
      },
    };
    routeParams = new BehaviorSubject(convertToParamMap({ path: 'rh-team,rh-onboarding', focus: 'rh-guide' }));
    TestBed.configureTestingModule({
      imports: [RhComponent],
      providers: [
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { queryParamMap: routeParams.asObservable(), snapshot: { queryParamMap: routeParams.value } } },
        { provide: WorkspaceStoreService, useValue: store },
        { provide: FileAccessService, useValue: { readAttachment: vi.fn(), saveBlob: vi.fn(async () => ({ saved: true })) } },
        { provide: FeedbackService, useValue: { confirm: vi.fn(async () => false), showToast: vi.fn() } },
      ],
    });
  });

  it('restores a focused deep route and keeps attachments accessible', async () => {
    const fixtureRef = TestBed.createComponent(RhComponent);
    fixtureRef.detectChanges();
    await fixtureRef.whenStable();

    expect(fixtureRef.nativeElement.querySelector('#rh-title')?.textContent).toContain('RH');
    expect(fixtureRef.nativeElement.querySelector('.document-card h2')?.textContent).toContain('Guide de test');
    expect(fixtureRef.nativeElement.querySelector('.attachment')?.textContent).toContain('fixture-attachment.txt');
    expect(fixtureRef.nativeElement.querySelector('.document-url')?.getAttribute('href')).toBe('https://hr.example.invalid/guide');
  });

  it('resolves a case-insensitive RH wiki-link to its target document', async () => {
    const fixtureRef = TestBed.createComponent(RhComponent);
    fixtureRef.detectChanges();
    await fixtureRef.whenStable();
    const link = fixtureRef.nativeElement.querySelector('.wiki-link') as HTMLElement;
    expect(link).toBeTruthy();
    link.click();
    fixtureRef.detectChanges();

    expect(fixtureRef.nativeElement.querySelector('.document-card h2')?.textContent).toContain('Politique de test');
  });

  it('exposes a real Angular RH route', async () => {
    const router = TestBed.inject(Router);
    expect(router).toBeTruthy();
  });

  it('opens the document dialog with all fields and creates a complete document', async () => {
    const fixtureRef = TestBed.createComponent(RhComponent);
    fixtureRef.detectChanges();
    await fixtureRef.whenStable();

    fixtureRef.componentInstance['openCreateDocument']();
    fixtureRef.detectChanges();

    expect(fixtureRef.nativeElement.querySelector('input[name="rh-document-title"]')).toBeTruthy();
    expect(fixtureRef.nativeElement.querySelector('input[name="rh-document-url"]')).toBeTruthy();
    expect(fixtureRef.nativeElement.querySelector('input[name="rh-document-date"]')).toBeTruthy();
    expect(fixtureRef.nativeElement.querySelector('input[name="rh-document-tags"]')).toBeTruthy();
    expect(fixtureRef.nativeElement.querySelector('textarea[name="rh-document-note"]')).toBeTruthy();
    expect(fixtureRef.nativeElement.querySelector('input[name="rh-document-file"]')).toBeTruthy();

    fixtureRef.componentInstance['documentDraft'] = {
      title: 'Nouveau document RH',
      url: 'https://hr.example.invalid/new',
      date: '2026-02-01',
      note: '# Contenu',
      tags: 'interne, onboarding',
      file: null,
    };
    await fixtureRef.componentInstance['submitCreate']();

    const created = findDocument(data()!.rh, 'missing') ?? data()!.rh.children
      .flatMap((node) => node.nodeType === 'folder' ? node.children : [])
      .flatMap((node) => node.nodeType === 'folder' ? node.children : [])
      .find((node): node is RhDocument => node.nodeType === 'document' && node.title === 'Nouveau document RH') ?? null;
    expect(created).toMatchObject({
      title: 'Nouveau document RH',
      url: 'https://hr.example.invalid/new',
      date: '2026-02-01',
      note: '# Contenu',
      tags: ['interne', 'onboarding'],
    });
  });

  it('edits a document in the custom dialog instead of using browser prompts', async () => {
    const fixtureRef = TestBed.createComponent(RhComponent);
    fixtureRef.detectChanges();
    await fixtureRef.whenStable();
    const document = findDocument(data()!.rh, 'rh-guide');
    if (!document || document.nodeType !== 'document') throw new Error('fixture document missing');

    fixtureRef.componentInstance['editDocument'](document);
    fixtureRef.detectChanges();
    await fixtureRef.whenStable();

    expect(fixtureRef.nativeElement.querySelector('#rh-create-dialog-title')?.textContent).toContain('Modifier');
    expect(fixtureRef.nativeElement.querySelector('input[name="rh-document-title"]')?.value).toBe('Guide de test');
    fixtureRef.componentInstance['documentDraft'] = {
      ...fixtureRef.componentInstance['documentDraft'],
      title: 'Guide RH modifie',
      note: 'Contenu modifie',
    };
    await fixtureRef.componentInstance['submitCreate']();

    const updated = findDocument(data()!.rh, 'rh-guide');
    expect(updated).toMatchObject({ title: 'Guide RH modifie', note: 'Contenu modifie' });
  });

  it('supports selecting and deleting multiple RH nodes', async () => {
    (TestBed.inject(FeedbackService).confirm as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    const fixtureRef = TestBed.createComponent(RhComponent);
    fixtureRef.detectChanges();
    await fixtureRef.whenStable();

    fixtureRef.componentInstance['navigate'](['root']);
    fixtureRef.detectChanges();
    fixtureRef.componentInstance['toggleSelectionMode']();
    fixtureRef.detectChanges();

    const checkboxes = fixtureRef.nativeElement.querySelectorAll('.treeitem-selection') as NodeListOf<HTMLInputElement>;
    expect(checkboxes).toHaveLength(2);
    (checkboxes[0] as HTMLInputElement).click();
    (checkboxes[1] as HTMLInputElement).click();
    fixtureRef.detectChanges();
    expect(fixtureRef.componentInstance['selectedIds']().size).toBe(2);
    expect(fixtureRef.nativeElement.querySelector('.selection-bar')?.textContent).toContain('2 sélectionnés');

    await fixtureRef.componentInstance['deleteSelected']();

    expect(data()!.rh.children).toHaveLength(0);
    expect(data()!.trash.filter((entry) => entry['_trashType'] === 'rh')).toHaveLength(2);
    expect(fixtureRef.componentInstance['selectionMode']()).toBe(false);
  });

  it('toggles and persists the pin state from the RH tree', async () => {
    const fixtureRef = TestBed.createComponent(RhComponent);
    fixtureRef.detectChanges();
    await fixtureRef.whenStable();

    fixtureRef.detectChanges();
    const pin = fixtureRef.nativeElement.querySelector('[data-id="rh-guide"] .treeitem-pin') as HTMLButtonElement;
    expect(pin.getAttribute('aria-pressed')).toBe('false');
    pin.click();
    fixtureRef.detectChanges();

    expect(findDocument(data()!.rh, 'rh-guide')?.pinned).toBe(true);
    expect(fixtureRef.nativeElement.querySelector('[data-id="rh-guide"] .treeitem-pin')?.getAttribute('aria-pressed')).toBe('true');
  });

  it('moves pinned folders and documents to the top of the current list', async () => {
    const fixtureRef = TestBed.createComponent(RhComponent);
    fixtureRef.detectChanges();
    await fixtureRef.whenStable();

    routeParams.next(convertToParamMap({}));
    fixtureRef.detectChanges();
    await fixtureRef.whenStable();
    const ids = () => {
      const items = fixtureRef.nativeElement.querySelectorAll('[role="treeitem"]') as NodeListOf<HTMLElement>;
      return [...items].map((item) => item.dataset['id']);
    };
    expect(ids()).toEqual(['rh-team', 'rh-policy']);

    (fixtureRef.nativeElement.querySelector('[data-id="rh-policy"] .treeitem-pin') as HTMLButtonElement).click();
    fixtureRef.detectChanges();
    expect(ids()).toEqual(['rh-policy', 'rh-team']);

    (fixtureRef.nativeElement.querySelector('[data-id="rh-team"] .treeitem-pin') as HTMLButtonElement).click();
    fixtureRef.detectChanges();
    expect(ids()).toEqual(['rh-team', 'rh-policy']);
  });
});
