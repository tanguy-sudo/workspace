import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import fixture from '../../../../../fixtures/workspace-full.json';
import emptyFixture from '../../../../../fixtures/workspace-empty.json';
import type { Todo, WorkspaceData } from '../../core/persistence/workspace-data';
import { WorkspaceStoreService } from '../../core/persistence/workspace-store.service';
import { FeedbackService } from '../../shared/feedback/feedback.service';
import { GlobalSearchService } from '../../shared/search/global-search.service';
import { DashboardComponent, dashboardReminderBuckets, dashboardWeekKey } from './dashboard.component';

describe('DashboardComponent', () => {
  let data: ReturnType<typeof signal<WorkspaceData | null>>;
  let store: {
    data: ReturnType<typeof data.asReadonly>;
    loading: () => boolean;
    init: () => Promise<WorkspaceData | null>;
    update: (mutator: (draft: WorkspaceData) => void) => WorkspaceData | null;
  };
  let feedback: { showToast: ReturnType<typeof vi.fn> };
  let search: { open: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    data = signal<WorkspaceData | null>(structuredClone(fixture.data) as WorkspaceData);
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
    feedback = { showToast: vi.fn() };
    search = { open: vi.fn() };
    TestBed.configureTestingModule({
      imports: [DashboardComponent],
      providers: [
        provideRouter([]),
        { provide: WorkspaceStoreService, useValue: store },
        { provide: FeedbackService, useValue: feedback },
        { provide: GlobalSearchService, useValue: search },
      ],
    });
  });

  it('separates reminder buckets and ignores completed tasks', () => {
    const todos = [
      { id: 'today', title: 'Today', status: 'todo', dueDate: '2026-02-02', reminderAt: '2026-02-02T09:00', pinned: true },
      { id: 'overdue', title: 'Overdue', status: 'waitinginfo', dueDate: '2026-02-01', reminderAt: '', pinned: false },
      { id: 'upcoming', title: 'Upcoming', status: 'todo', dueDate: '', reminderAt: '2026-02-05T09:00', pinned: false },
      { id: 'done', title: 'Done', status: 'done', dueDate: '2026-02-02', reminderAt: '2026-02-02T09:00', pinned: true },
    ] as Todo[];
    const buckets = dashboardReminderBuckets(todos, new Date(2026, 1, 2, 12).getTime());

    expect(buckets.today.map((todo) => todo.id)).toEqual(['today']);
    expect(buckets.overdue.map((todo) => todo.id)).toEqual(['overdue']);
    expect(buckets.pinned.map((todo) => todo.id)).toEqual(['today']);
    expect(buckets.upcoming.map((todo) => todo.id)).toEqual(['upcoming']);
  });

  it('renders a usable dashboard for an empty workspace', async () => {
    data.set(structuredClone(emptyFixture.data) as WorkspaceData);
    const component = TestBed.createComponent(DashboardComponent);
    component.detectChanges();
    await component.whenStable();

    expect(component.nativeElement.querySelector('#dashboard-title')).toBeTruthy();
    expect(component.nativeElement.querySelector('.empty-message')?.textContent).toContain('Aucune tache');
    expect(component.nativeElement.querySelector('#task-stats-title')).toBeNull();
    expect(component.nativeElement.querySelectorAll('.health-card')).toHaveLength(5);
    expect(component.nativeElement.querySelector('.review-item.ok')).toBeTruthy();
  });

  it('renders filled sections and exposes Angular links', async () => {
    const component = TestBed.createComponent(DashboardComponent);
    component.componentInstance['now'].set(new Date(2026, 1, 2, 12).getTime());
    component.detectChanges();
    await component.whenStable();

    expect(component.nativeElement.querySelector('#dashboard-title')?.textContent).toContain('Fixture User');
    expect(component.nativeElement.querySelector('#task-stats-title')).toBeTruthy();
    expect(component.nativeElement.querySelectorAll('.shortcut-card')).toHaveLength(7);
    expect(component.nativeElement.querySelectorAll('.health-card')).toHaveLength(5);
    expect(component.nativeElement.querySelectorAll('.recent-card')).toHaveLength(4);
    expect(component.nativeElement.querySelector('.health-card[routerlink="/todos"]')).toBeNull();
    expect(component.nativeElement.querySelector('.health-card')?.getAttribute('href')).toContain('/todos');
  });

  it('marks the tasks shortcut badge as dangerous when tasks are overdue', async () => {
    const source = structuredClone(emptyFixture.data) as WorkspaceData;
    source.todos = [{
      id: 'overdue-task', title: 'En retard', status: 'todo', dueDate: '2026-01-01', dependencies: [], tags: [], recurrence: null,
    }];
    data.set(source);
    const component = TestBed.createComponent(DashboardComponent);
    component.componentInstance['now'].set(new Date(2026, 1, 2, 12).getTime());
    component.detectChanges();
    await component.whenStable();

    const tasks = [...component.nativeElement.querySelectorAll('.shortcut-card')].find((card) => card.textContent?.includes('Taches')) as HTMLElement;
    expect(tasks?.querySelector('.shortcut-badge')?.classList.contains('danger')).toBe(true);
  });

  it('creates, pins and completes reminders through the shared store', async () => {
    const component = TestBed.createComponent(DashboardComponent);
    component.componentInstance['now'].set(new Date(2026, 1, 2, 12).getTime());
    component.detectChanges();
    await component.whenStable();

    component.componentInstance['openReminder']();
    component.componentInstance['reminderDraft'] = {
      title: 'Appeler le client', when: '', priorityId: 'important', context: 'client', pinned: true,
    };
    component.componentInstance['submitReminder']();
    const created = data()!.todos.find((todo) => todo.title === 'Appeler le client');
    expect(created).toMatchObject({ context: 'client', pinned: true, status: 'todo' });

    component.componentInstance['togglePin'](created!);
    expect(data()!.todos.find((todo) => todo.id === created!.id)?.pinned).toBe(false);

    const daily = data()!.todos.find((todo) => todo.id === 'todo-daily')!;
    component.componentInstance['completeReminder'](daily);
    expect(data()!.todos.find((todo) => todo.id === daily.id)?.status).toBe('done');
    expect(data()!.todos.some((todo) => todo.id !== daily.id && todo.title === daily.title)).toBe(true);
    expect(feedback.showToast).toHaveBeenCalledWith('Tache terminee', 'success');
  });

  it('updates the weekly review and navigates reminder focus to tasks', async () => {
    const component = TestBed.createComponent(DashboardComponent);
    component.componentInstance['now'].set(new Date(2026, 1, 2, 12).getTime());
    component.detectChanges();
    await component.whenStable();

    expect(component.componentInstance['reviewDone']()).toBe(false);
    component.componentInstance['completeReview']();
    expect(data()!.settings.weeklyReview.lastCompletedWeek).toBe(dashboardWeekKey(new Date(2026, 1, 2, 12)));
    expect(component.componentInstance['reviewDone']()).toBe(true);

    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    component.componentInstance['openTodo'](data()!.todos[0]);
    expect(navigate).toHaveBeenCalledWith(['/todos'], { queryParams: { focus: 'todo-daily', kind: 'todo' } });
  });

  it('opens global search and reports missing recent targets', async () => {
    const source = structuredClone(emptyFixture.data) as WorkspaceData;
    source.recentlyVisited = [{ type: 'project', id: 'deleted-project', name: 'Projet supprime', visitedAt: Date.now() }];
    data.set(source);
    const component = TestBed.createComponent(DashboardComponent);
    component.detectChanges();
    await component.whenStable();

    component.componentInstance['openSearch']();
    expect(search.open).toHaveBeenCalledOnce();
    component.nativeElement.querySelector('.missing').click();
    expect(feedback.showToast).toHaveBeenCalledWith('Cet element a ete supprime', 'error');
  });
});
