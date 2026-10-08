import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import fixture from '../../../../../fixtures/workspace-full.json';
import { ProjectsComponent } from './projects.component';
import { routes } from '../../app.routes';
import { StoragePreferencesService } from '../../core/persistence/storage-preferences.service';
import { WorkspaceStoreService } from '../../core/persistence/workspace-store.service';
import { FeedbackService } from '../../shared/feedback/feedback.service';
import type { WorkspaceData } from '../../core/persistence/workspace-data';

describe('ProjectsComponent', () => {
  let data: ReturnType<typeof signal<WorkspaceData | null>>;
  let store: {
    data: ReturnType<typeof data.asReadonly>;
    status: ReturnType<typeof signal<'ready'>>;
    loading: () => boolean;
    init: () => Promise<WorkspaceData | null>;
    update: (mutator: (draft: WorkspaceData) => void) => WorkspaceData | null;
  };
  let feedback: { confirm: ReturnType<typeof vi.fn>; showToast: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    localStorage.clear();
    data = signal<WorkspaceData | null>(structuredClone(fixture.data) as WorkspaceData);
    store = {
      data: data.asReadonly(),
      status: signal<'ready'>('ready'),
      loading: () => false,
      init: async () => data(),
      update: (mutator) => {
        const draft = structuredClone(data()) as WorkspaceData;
        mutator(draft);
        data.set(draft);
        return draft;
      },
    };
    feedback = { confirm: vi.fn(async () => true), showToast: vi.fn() };
    TestBed.configureTestingModule({
      imports: [ProjectsComponent],
      providers: [
        provideRouter(routes),
        { provide: WorkspaceStoreService, useValue: store },
        StoragePreferencesService,
        { provide: FeedbackService, useValue: feedback },
      ],
    });
  });

  it('renders root projects and navigates to a child scope', async () => {
    const component = TestBed.createComponent(ProjectsComponent);
    component.detectChanges();
    await component.whenStable();

    expect(component.nativeElement.querySelector('#projects-title')?.textContent).toContain('Projets');
    expect(component.nativeElement.querySelectorAll('.project-card').length).toBe(2);
    expect(component.nativeElement.querySelector('.scope-label')?.textContent).toContain('Racine');

    component.componentInstance['navigateScope']('project-alpha');
    component.detectChanges();
    expect(component.nativeElement.querySelector('.scope-label')?.textContent).toContain('Projet Alpha');
    expect(component.nativeElement.querySelectorAll('.project-card').length).toBe(2);
    expect(component.nativeElement.querySelector('.breadcrumbs')?.textContent).toContain('Projet Alpha');
  });

  it('restores the parent scope from the URL', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/projects?parent=project-alpha');

    expect(TestBed.inject(Router).url).toBe('/projects?parent=project-alpha');
    expect(harness.routeNativeElement?.querySelector('.scope-label')?.textContent).toContain('Projet Alpha');
    expect(harness.routeNativeElement?.querySelectorAll('.project-card')).toHaveLength(2);
  });

  it('does not restore an old scope after the URL returns to the root', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/projects?parent=project-alpha');
    await harness.navigateByUrl('/projects');

    expect(harness.routeNativeElement?.querySelector('.scope-label')?.textContent).toContain('Racine');
    expect(harness.routeNativeElement?.querySelectorAll('.project-card')).toHaveLength(2);
  });

  it('persists view and favorite changes without changing project structure', async () => {
    const component = TestBed.createComponent(ProjectsComponent);
    component.detectChanges();
    await component.whenStable();
    const project = data()!.projects[0];

    component.componentInstance['toggleViewMode']();
    component.componentInstance['toggleFavorite'](project);

    expect(localStorage.getItem('workspace-projects-view')).toBe('list');
    expect(data()!.projects[0].favorite).toBe(true);
    expect(data()!.projects[0].children).toEqual(project.children);
  });

  it('moves a deleted project tree to trash after confirmation', async () => {
    const component = TestBed.createComponent(ProjectsComponent);
    component.detectChanges();
    await component.whenStable();

    await component.componentInstance['removeProject'](data()!.projects[0]);

    expect(data()!.projects.map((project) => project.id)).toEqual([]);
    expect(data()!.trash.at(-1)).toMatchObject({ id: 'project-alpha', _trashType: 'project' });
    expect(feedback.confirm).toHaveBeenCalled();
  });
});
