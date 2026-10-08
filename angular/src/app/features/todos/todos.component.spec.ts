import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import fixture from '../../../../../fixtures/workspace-full.json';
import { routes } from '../../app.routes';
import { WorkspaceStoreService } from '../../core/persistence/workspace-store.service';
import { StoragePreferencesService } from '../../core/persistence/storage-preferences.service';
import { FeedbackService } from '../../shared/feedback/feedback.service';
import { TodosComponent } from './todos.component';
import type { WorkspaceData } from '../../core/persistence/workspace-data';

describe('TodosComponent', () => {
  let data: ReturnType<typeof signal<WorkspaceData | null>>;
  let query: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
  let store: {
    data: ReturnType<typeof data.asReadonly>;
    loading: () => boolean;
    init: () => Promise<WorkspaceData | null>;
    update: (mutator: (draft: WorkspaceData) => void) => WorkspaceData | null;
  };
  let preferences: { get: ReturnType<typeof vi.fn>; set: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> };
  let feedback: { confirm: ReturnType<typeof vi.fn>; showToast: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    data = signal<WorkspaceData | null>(structuredClone(fixture.data) as WorkspaceData);
    query = new BehaviorSubject(convertToParamMap({}));
    store = {
      data: data.asReadonly(),
      loading: () => false,
      init: async () => data(),
      update: (mutator) => {
        const draft = structuredClone(data()) as WorkspaceData;
        mutator(draft);
        data.set(draft);
        return draft;
      },
    };
    preferences = { get: vi.fn((_key: string, fallback: string | null = null) => fallback), set: vi.fn(() => true), remove: vi.fn(() => true) };
    feedback = { confirm: vi.fn(async () => true), showToast: vi.fn() };
    TestBed.configureTestingModule({
      imports: [TodosComponent],
      providers: [
        provideRouter(routes),
        { provide: ActivatedRoute, useValue: { paramMap: new BehaviorSubject(convertToParamMap({})).asObservable(), queryParamMap: query.asObservable(), snapshot: { paramMap: convertToParamMap({}), queryParamMap: query.value } } },
        { provide: WorkspaceStoreService, useValue: store },
        { provide: StoragePreferencesService, useValue: preferences },
        { provide: FeedbackService, useValue: feedback },
      ],
    });
  });

  it('renders the historical status filters and restores URL filters', async () => {
    query.next(convertToParamMap({ status: 'waitinginfo', project: 'project-beta', view: 'list', focus: 'todo-weekly', kind: 'todo' }));
    const component = TestBed.createComponent(TodosComponent);
    component.detectChanges();
    await component.whenStable();

    expect(component.nativeElement.querySelector('#todos-title')?.textContent).toContain('Tâches');
    expect(component.componentInstance['statusFilter']()).toBe('waitinginfo');
    expect(component.componentInstance['projectFilter']()).toBe('project-beta');
    expect(component.componentInstance['viewMode']()).toBe('list');
    expect(component.nativeElement.querySelector('[data-id="todo-weekly"]')).toBeTruthy();
    expect(component.nativeElement.querySelector('.todo-card.focused')?.getAttribute('data-id')).toBe('todo-weekly');
  });

  it('creates, completes, edits and deletes a recurring task', async () => {
    const component = TestBed.createComponent(TodosComponent);
    component.detectChanges();
    await component.whenStable();

    component.componentInstance['todoDraft'] = {
      title: 'Tâche récurrente', description: '**Détails**', priorityId: 'important', status: 'todo', estimatedTime: '60*5',
      dueDate: '2026-02-02', reminderAt: '2026-02-02T09:00', pinned: true, projectId: 'project-alpha', context: '', attachedTo: '',
      recurrenceType: 'daily', recurrenceWeekdays: [], recurrenceNth: 2, recurrenceWeekday: 1, dependencies: ['todo-daily'], tags: 'a, b, a',
    };
    component.componentInstance['dialog'].set('todo');
    await component.componentInstance['submitTodo']();
    const created = data()!.todos.find((todo) => todo.title === 'Tâche récurrente');
    expect(created).toMatchObject({ estimatedTime: 300, recurrence: { type: 'daily' }, tags: ['a', 'b'], projectId: 'project-alpha' });

    component.componentInstance['toggleStatus'](created!);
    const next = data()!.todos.find((todo) => todo.id !== created!.id && todo.title === 'Tâche récurrente');
    expect(data()!.todos.find((todo) => todo.id === created!.id)?.status).toBe('done');
    expect(next).toMatchObject({ status: 'todo' });

    component.componentInstance['openEditTodo'](next!);
    component.componentInstance['todoDraft'].title = 'Tâche modifiée';
    await component.componentInstance['submitTodo']();
    expect(data()!.todos.find((todo) => todo.id === next!.id)?.title).toBe('Tâche modifiée');

    await component.componentInstance['removeTodo'](next!);
    expect(data()!.trash.at(-1)).toMatchObject({ id: next!.id, _trashType: 'todo' });
  });

  it('saves and reopens a view, manages priorities and rejects invalid estimates', async () => {
    const component = TestBed.createComponent(TodosComponent);
    component.detectChanges();
    await component.whenStable();

    component.componentInstance['setViewMode']('list');
    component.componentInstance['setFilter']('status', 'todo');
    component.componentInstance['viewName'] = 'Inbox';
    component.componentInstance['dialog'].set('views');
    component.componentInstance['submitView']();
    const view = data()!.settings.todoSavedViews.find((saved) => saved.name === 'Inbox');
    expect(view).toMatchObject({ viewMode: 'list', filters: { status: 'todo' } });

    component.componentInstance['applySavedView'](view!);
    expect(component.componentInstance['statusFilter']()).toBe('todo');
    expect(component.componentInstance['viewMode']()).toBe('list');

    component.componentInstance['openPriorities']();
    component.componentInstance['priorityName'] = 'Critique';
    component.componentInstance['submitPriority']();
    const priority = data()!.settings.todoPriorities.find((item) => item.label === 'Critique');
    expect(priority).toBeTruthy();
    component.componentInstance['removePriority'](priority!);
    expect(data()!.settings.todoPriorities.some((item) => item.id === priority!.id)).toBe(false);

    component.componentInstance['todoDraft'] = { ...component.componentInstance['todoDraft'], title: 'Invalid', context: '@test', estimatedTime: 'alert(1)' };
    component.componentInstance['dialog'].set('todo');
    await component.componentInstance['submitTodo']();
    expect(data()!.todos.some((todo) => todo.title === 'Invalid')).toBe(false);
    expect(feedback.showToast).toHaveBeenCalledWith('Temps estimé invalide', 'error');
  });

  it('applies bulk updates and keeps recurring completion idempotent', async () => {
    const component = TestBed.createComponent(TodosComponent);
    component.detectChanges();
    await component.whenStable();

    component.componentInstance['toggleSelectionMode']();
    component.componentInstance['toggleSelection']('todo-daily');
    component.componentInstance['toggleSelection']('todo-weekly');
    component.componentInstance['openBulkEdit']();
    component.componentInstance['bulkDraft'] = {
      projectId: 'project-alpha', status: 'inprogress', priorityId: 'urgent', context: '', clearContext: false,
      tags: 'bulk', tagsMode: 'add',
    };
    component.componentInstance['submitBulkEdit']();
    expect(data()!.todos.find((todo) => todo.id === 'todo-daily')).toMatchObject({ projectId: 'project-alpha', status: 'inprogress', priorityId: 'urgent', tags: ['fixture', 'daily', 'bulk'] });
    expect(data()!.todos.find((todo) => todo.id === 'todo-weekly')).toMatchObject({ projectId: 'project-alpha', status: 'inprogress', priorityId: 'urgent' });

    const daily = data()!.todos.find((todo) => todo.id === 'todo-daily')!;
    component.componentInstance['toggleStatus'](daily);
    const afterFirst = data()!.todos.length;
    component.componentInstance['toggleStatus'](data()!.todos.find((todo) => todo.id === 'todo-daily')!);
    expect(data()!.todos.length).toBe(afterFirst);
  });

  it('keeps partial historical settings and default todo templates usable', async () => {
    const partial = structuredClone(fixture.data) as WorkspaceData;
    partial.settings = { theme: 'dark', todoPriorities: undefined, todoSavedViews: undefined, templates: undefined } as unknown as WorkspaceData['settings'];
    data.set(partial);
    query.next(convertToParamMap({ priority: 'urgent', savedView: 'missing-view' }));
    const component = TestBed.createComponent(TodosComponent);
    component.detectChanges();
    await component.whenStable();

    expect(component.componentInstance['priorities']().length).toBeGreaterThan(0);
    expect(component.componentInstance['templates']().some((template) => template.id === 'tpl-bug')).toBe(true);
    component.componentInstance['applyTemplate'](component.componentInstance['templates']()[0]);
    expect(component.componentInstance['dialog']()).toBe('todo');
  });

  it('creates, edits and deletes todo templates', async () => {
    const component = TestBed.createComponent(TodosComponent);
    component.detectChanges();
    await component.whenStable();

    component.componentInstance['openNewTemplate']();
    component.componentInstance['templateDraft'] = {
      name: 'Incident', icon: '!', title: 'Incident {{date}}', description: 'Suivi', priorityId: 'urgent',
      estimatedTime: '30*2', context: '@support', tags: 'incident, urgent',
    };
    component.componentInstance['submitTemplate']();
    const created = data()!.settings.templates.find((template) => template.name === 'Incident');
    expect(created).toMatchObject({ type: 'todo', title: 'Incident {{date}}', estimatedTime: 60, tags: ['incident', 'urgent'] });

    component.componentInstance['openEditTemplate'](component.componentInstance['templates']().find((template) => template.id === created!.id)!);
    component.componentInstance['templateDraft'].name = 'Incident modifié';
    component.componentInstance['submitTemplate']();
    expect(data()!.settings.templates.find((template) => template.id === created!.id)?.name).toBe('Incident modifié');

    feedback.confirm.mockResolvedValueOnce(true);
    await component.componentInstance['removeTemplate'](component.componentInstance['templates']().find((template) => template.id === created!.id)!);
    expect(data()!.settings.templates.some((template) => template.id === created!.id)).toBe(false);
  });

  it('updates a selected saved view when its legacy view mode is omitted', async () => {
    const source = structuredClone(fixture.data) as WorkspaceData;
    source.settings.todoSavedViews = [{ id: 'legacy-view', name: 'Legacy', filters: { status: 'all' } } as unknown as WorkspaceData['settings']['todoSavedViews'][number]];
    data.set(source);
    const component = TestBed.createComponent(TodosComponent);
    component.detectChanges();
    await component.whenStable();

    expect(component.componentInstance['matchingSavedView']()?.id).toBe('legacy-view');
    component.componentInstance['openViews']();
    component.componentInstance['viewName'] = 'Legacy renamed';
    component.componentInstance['submitView']();
    expect(data()!.settings.todoSavedViews).toHaveLength(1);
    expect(data()!.settings.todoSavedViews[0]).toMatchObject({ id: 'legacy-view', name: 'Legacy renamed', viewMode: 'columns' });
  });
});
