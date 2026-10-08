import { signal } from '@angular/core';
import { convertToParamMap, provideRouter, ActivatedRoute, Router } from '@angular/router';
import { of } from 'rxjs';
import { TestBed } from '@angular/core/testing';
import fixture from '../../../../../fixtures/workspace-full.json';
import { STORAGE_KEYS } from '../../core/persistence/storage-preferences.service';
import type { WorkspaceData } from '../../core/persistence/workspace-data';
import { WorkspaceStoreService } from '../../core/persistence/workspace-store.service';
import { FeedbackService } from '../../shared/feedback/feedback.service';
import { SnippetsComponent } from './snippets.component';

describe('SnippetsComponent', () => {
  let data: ReturnType<typeof signal<WorkspaceData | null>>;
  let store: { data: ReturnType<typeof data.asReadonly>; loading: ReturnType<typeof signal<boolean>>; init: () => Promise<WorkspaceData | null>; update: (mutator: (draft: WorkspaceData) => void) => WorkspaceData | null };
  let feedback: { confirm: ReturnType<typeof vi.fn>; showToast: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    localStorage.clear();
    data = signal<WorkspaceData | null>(structuredClone(fixture.data) as WorkspaceData);
    store = { data: data.asReadonly(), loading: signal(false), init: async () => data(), update: (mutator) => { const draft = structuredClone(data()!); mutator(draft); data.set(draft); return draft; } };
    feedback = { confirm: vi.fn(async () => false), showToast: vi.fn() };
    const params = convertToParamMap({ path: 'snippet-tools', focus: 'snippet-json' });
    TestBed.configureTestingModule({
      imports: [SnippetsComponent],
      providers: [
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { queryParamMap: of(params), snapshot: { queryParamMap: params } } },
        { provide: WorkspaceStoreService, useValue: store },
        { provide: FeedbackService, useValue: feedback },
      ],
    });
  });

  it('restores historical mixed order and focused snippet route', async () => {
    const fixtureRef = TestBed.createComponent(SnippetsComponent);
    fixtureRef.detectChanges();
    await fixtureRef.whenStable();
    const cards = fixtureRef.nativeElement.querySelectorAll('.snippet-card');
    expect(cards).toHaveLength(1);
    expect(cards[0].querySelector('h2')?.textContent).toContain('Parser JSON');
    expect(fixtureRef.nativeElement.querySelector('.breadcrumbs')?.textContent).toContain('Outils');
  });

  it('filters snippets and exposes a real route', async () => {
    const fixtureRef = TestBed.createComponent(SnippetsComponent);
    fixtureRef.detectChanges();
    await fixtureRef.whenStable();
    const search = fixtureRef.nativeElement.querySelector('input[type="search"]') as HTMLInputElement;
    search.value = 'absent';
    search.dispatchEvent(new Event('input'));
    fixtureRef.detectChanges();
    expect(fixtureRef.nativeElement.querySelectorAll('.snippet-card')).toHaveLength(0);
    expect(TestBed.inject(Router)).toBeTruthy();
  });

  it('remembers collapsed snippets across component recreation', async () => {
    const first = TestBed.createComponent(SnippetsComponent);
    first.detectChanges();
    await first.whenStable();

    first.componentInstance['toggleCollapsed']('snippet-json');
    first.detectChanges();
    expect(first.nativeElement.querySelector('.snippet-card')?.classList.contains('collapsed')).toBe(true);
    expect(localStorage.getItem(STORAGE_KEYS.snippetsCollapsed)).toBe('["snippet-json"]');
    first.destroy();

    const second = TestBed.createComponent(SnippetsComponent);
    second.detectChanges();
    await second.whenStable();
    expect(second.nativeElement.querySelector('.snippet-card')?.classList.contains('collapsed')).toBe(true);

    second.componentInstance['toggleCollapsed']('snippet-json');
    second.detectChanges();
    expect(second.nativeElement.querySelector('.snippet-card')?.classList.contains('collapsed')).toBe(false);
    expect(localStorage.getItem(STORAGE_KEYS.snippetsCollapsed)).toBe('[]');
  });

  it('uses the document copy fallback when Clipboard API is unavailable', async () => {
    const fixtureRef = TestBed.createComponent(SnippetsComponent);
    fixtureRef.detectChanges();
    await fixtureRef.whenStable();
    const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');
    const execCommand = vi.fn().mockReturnValue(true);
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand });
    const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    try {
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
      await fixtureRef.componentInstance['copy']('SELECT 1');

      expect(execCommand).toHaveBeenCalledWith('copy');
      expect(document.querySelector('textarea')).toBeNull();
    } finally {
      if (originalExecCommand) Object.defineProperty(document, 'execCommand', originalExecCommand);
      else Reflect.deleteProperty(document, 'execCommand');
      if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard);
    }
  });

  it('creates a folder through the custom dialog', async () => {
    const fixtureRef = TestBed.createComponent(SnippetsComponent);
    fixtureRef.detectChanges();
    await fixtureRef.whenStable();

    fixtureRef.componentInstance['createFolder']();
    fixtureRef.detectChanges();
    const input = fixtureRef.nativeElement.querySelector('input[name="snippet-folder-name"]') as HTMLInputElement;
    input.value = 'Commandes';
    fixtureRef.componentInstance['setFolderName']({ target: input } as unknown as Event);
    fixtureRef.componentInstance['submitCreateFolder']();
    fixtureRef.detectChanges();

    expect(fixtureRef.nativeElement.querySelector('[role="dialog"]')).toBeNull();
    expect(data()!.snippetFolders.children[0].children.some((folder) => folder.name === 'Commandes')).toBe(true);
  });

  it('deletes selected snippets and folders as a batch', async () => {
    const fixtureRef = TestBed.createComponent(SnippetsComponent);
    fixtureRef.detectChanges();
    await fixtureRef.whenStable();

    fixtureRef.componentInstance['toggleSelectionMode']();
    fixtureRef.componentInstance['toggleSelection']('snippet-json');
    fixtureRef.componentInstance['toggleSelection']('snippet-sql-folder');
    feedback.confirm.mockResolvedValue(true);
    await fixtureRef.componentInstance['deleteSelected']();

    expect(data()!.snippets.some((snippet) => snippet.id === 'snippet-json')).toBe(false);
    expect(data()!.trash).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'snippet-json', _trashType: 'snippet' })]));
    expect(data()!.snippetFolders.children[0].children.some((folder) => folder.id === 'snippet-sql-folder')).toBe(false);
    expect(data()!.snippets.find((snippet) => snippet.id === 'snippet-sql-item')?.folderId).toBe('snippet-tools');
    expect(fixtureRef.componentInstance['selectionMode']()).toBe(false);
  });

  it('creates a snippet through the custom dialog', async () => {
    const fixtureRef = TestBed.createComponent(SnippetsComponent);
    fixtureRef.detectChanges();
    await fixtureRef.whenStable();

    fixtureRef.componentInstance['createSnippet']();
    fixtureRef.detectChanges();
    const title = fixtureRef.nativeElement.querySelector('input[name="snippet-title"]') as HTMLInputElement;
    const tags = fixtureRef.nativeElement.querySelector('input[name="snippet-tags"]') as HTMLInputElement;
    const folder = fixtureRef.nativeElement.querySelector('select[name="snippet-folder"]') as HTMLSelectElement;
    const code = fixtureRef.nativeElement.querySelector('textarea[name="snippet-code"]') as HTMLTextAreaElement;
    title.value = 'Commande utile';
    tags.value = 'shell, ops';
    folder.value = 'snippet-sql-folder';
    code.value = 'echo ok';
    fixtureRef.componentInstance['setSnippetDraft']('title', { target: title } as unknown as Event);
    fixtureRef.componentInstance['setSnippetDraft']('tags', { target: tags } as unknown as Event);
    fixtureRef.componentInstance['setSnippetDraft']('folderId', { target: folder } as unknown as Event);
    fixtureRef.componentInstance['setSnippetDraft']('code', { target: code } as unknown as Event);
    fixtureRef.componentInstance['submitCreateSnippet']();
    fixtureRef.detectChanges();

    expect(fixtureRef.nativeElement.querySelector('[role="dialog"]')).toBeNull();
    expect(data()!.snippets).toEqual(expect.arrayContaining([expect.objectContaining({ title: 'Commande utile', code: 'echo ok', tags: ['shell', 'ops'], folderId: 'snippet-sql-folder' })]));
  });
});
