import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import fixture from '../../../../../fixtures/workspace-full.json';
import { JournalComponent } from './journal.component';
import type { WorkspaceData } from '../../core/persistence/workspace-data';
import { WorkspaceStoreService } from '../../core/persistence/workspace-store.service';
import { StoragePreferencesService } from '../../core/persistence/storage-preferences.service';
import { FeedbackService } from '../../shared/feedback/feedback.service';
import { FileAccessService } from '../../core/files/file-access.service';

describe('JournalComponent', () => {
  const source = structuredClone(fixture.data) as WorkspaceData;
  let data: ReturnType<typeof signal<WorkspaceData | null>>;
  let store: { data: ReturnType<typeof data.asReadonly>; loading: () => boolean; update: (mutator: (draft: WorkspaceData) => void) => WorkspaceData | null; init: () => Promise<WorkspaceData | null> };

  beforeEach(() => {
    data = signal<WorkspaceData | null>(structuredClone(source));
    store = {
      data: data.asReadonly(),
      loading: () => false,
      init: async () => data(),
      update: (mutator) => {
        const draft = structuredClone(data() as WorkspaceData);
        mutator(draft);
        data.set(draft);
        return draft;
      },
    };
    TestBed.configureTestingModule({
      imports: [JournalComponent],
      providers: [
        { provide: WorkspaceStoreService, useValue: store },
        { provide: StoragePreferencesService, useValue: { get: () => null, remove: () => true } },
        { provide: FeedbackService, useValue: { confirm: async () => false, showToast: () => undefined } },
        { provide: FileAccessService, useValue: { saveBlob: async () => ({ saved: true, method: 'download' }) } },
      ],
    });
  });

  it('renders historical entries and local metadata', async () => {
    const fixtureRef = TestBed.createComponent(JournalComponent);
    fixtureRef.detectChanges();
    await fixtureRef.whenStable();
    expect(fixtureRef.nativeElement.querySelector('#journal-title')?.textContent).toContain('Journal');
    expect(fixtureRef.nativeElement.querySelectorAll('.entry-list-item').length).toBe(1);
    expect(fixtureRef.nativeElement.querySelector('.title-input')?.value).toBe('Recette initiale');
    expect(fixtureRef.nativeElement.querySelector('.date-line')?.textContent).toContain('2026');
  });

  it('filters locally and persists an edited title without reload', async () => {
    data.update((current) => {
      current!.journal.push({ id: 'journal-entry-2', title: 'Deuxieme entree', content: 'Second contenu', mood: 'neutral', tags: [], createdAt: 1767571200000, updatedAt: 1767571200000 });
      return current;
    });
    const fixtureRef = TestBed.createComponent(JournalComponent);
    fixtureRef.detectChanges();
    await fixtureRef.whenStable();
    const search = fixtureRef.nativeElement.querySelector('input[type="search"]') as HTMLInputElement;
    search.value = 'absent';
    search.dispatchEvent(new Event('input'));
    fixtureRef.detectChanges();
    expect(fixtureRef.nativeElement.querySelectorAll('.entry-list-item')).toHaveLength(0);

    search.value = '';
    search.dispatchEvent(new Event('input'));
    fixtureRef.detectChanges();
    const title = fixtureRef.nativeElement.querySelector('.title-input') as HTMLInputElement;
    title.value = 'Titre modifie';
    title.dispatchEvent(new Event('input'));
    fixtureRef.componentInstance['saveNow']();
    const secondEntry = fixtureRef.nativeElement.querySelectorAll('.entry-list-item')[1] as HTMLButtonElement;
    secondEntry.click();
    expect(data()!.journal.find((entry) => entry.id === 'journal-entry-2')?.title).toBe('Titre modifie');
  });

  it('lists journal templates and creates an entry from one', async () => {
    const fixtureRef = TestBed.createComponent(JournalComponent);
    fixtureRef.detectChanges();
    await fixtureRef.whenStable();

    expect(fixtureRef.componentInstance['templates']().some((template) => template.name === 'Template fixture')).toBe(true);
    fixtureRef.componentInstance['applyTemplate'](fixtureRef.componentInstance['templates']().find((template) => template.id === 'fixture-template')!);

    const created = data()!.journal.find((entry) => entry.title?.startsWith('Fixture '));
    expect(created).toMatchObject({ title: expect.stringMatching(/^Fixture /), content: '## Notes\n\n- ', mood: 'neutral', tags: ['fixture'] });
  });

  it('creates and edits a journal template', async () => {
    const fixtureRef = TestBed.createComponent(JournalComponent);
    fixtureRef.detectChanges();
    await fixtureRef.whenStable();

    fixtureRef.componentInstance['openNewTemplate']();
    fixtureRef.componentInstance['templateDraft'] = {
      name: 'Point du jour', icon: '!', title: 'Point {{date}}', content: '## Notes', mood: 'good', tags: 'travail, idee',
    };
    fixtureRef.componentInstance['submitTemplate']();
    const created = data()!.settings.templates.find((template) => template.name === 'Point du jour');
    expect(created).toMatchObject({ type: 'journal', title: 'Point {{date}}', content: '## Notes', tags: ['travail', 'idee'] });

    fixtureRef.componentInstance['openEditTemplate'](fixtureRef.componentInstance['templates']().find((template) => template.id === created!.id)!);
    fixtureRef.componentInstance['templateDraft'].name = 'Point du jour modifie';
    fixtureRef.componentInstance['submitTemplate']();
    expect(data()!.settings.templates.find((template) => template.id === created!.id)?.name).toBe('Point du jour modifie');
  });
});
