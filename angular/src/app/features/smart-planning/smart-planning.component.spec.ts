import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import fixture from '../../../../../fixtures/workspace-full.json';
import type { WorkspaceData } from '../../core/persistence/workspace-data';
import { STORAGE_KEYS, StoragePreferencesService } from '../../core/persistence/storage-preferences.service';
import { WorkspaceStoreService } from '../../core/persistence/workspace-store.service';
import { FeedbackService } from '../../shared/feedback/feedback.service';
import { SmartPlanningComponent } from './smart-planning.component';

describe('SmartPlanningComponent', () => {
  let data: ReturnType<typeof signal<WorkspaceData | null>>;
  let stored: Record<string, unknown>;
  let store: {
    data: ReturnType<typeof data.asReadonly>;
    init: () => Promise<WorkspaceData | null>;
    update: (mutator: (draft: WorkspaceData) => void) => WorkspaceData | null;
  };
  let preferences: {
    getJson: ReturnType<typeof vi.fn>;
    setJson: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
  };
  let feedback: { showToast: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    data = signal<WorkspaceData | null>(structuredClone(fixture.data) as WorkspaceData);
    stored = {};
    store = {
      data: data.asReadonly(),
      init: async () => data(),
      update: (mutator) => {
        const draft = structuredClone(data()) as WorkspaceData;
        mutator(draft);
        data.set(draft);
        return draft;
      },
    };
    preferences = {
      getJson: vi.fn((key: string, fallback: unknown) => stored[key] ?? fallback),
      setJson: vi.fn((key: string, value: unknown) => { stored[key] = structuredClone(value); return true; }),
      remove: vi.fn((key: string) => { delete stored[key]; return true; }),
    };
    feedback = { showToast: vi.fn() };
    TestBed.configureTestingModule({
      imports: [SmartPlanningComponent],
      providers: [
        provideRouter([]),
        { provide: WorkspaceStoreService, useValue: store },
        { provide: StoragePreferencesService, useValue: preferences },
        { provide: FeedbackService, useValue: feedback },
      ],
    });
  });

  it('renders the planner controls and persists a generated plan', async () => {
    const component = TestBed.createComponent(SmartPlanningComponent);
    component.detectChanges();
    await component.whenStable();

    expect(component.nativeElement.querySelector('#p-time')).toBeTruthy();
    expect(component.nativeElement.querySelector('#p-context')).toBeTruthy();
    expect(component.nativeElement.querySelector('#p-project')).toBeTruthy();
    expect(component.nativeElement.querySelector('#p-date')).toBeTruthy();

    component.componentInstance['timeInput'] = '60*2';
    component.componentInstance['runPlan']();

    expect(component.componentInstance['plan']().map((todo) => todo.id)).toEqual(['todo-daily', 'todo-unassigned']);
    expect(stored[STORAGE_KEYS.smartPlan]).toMatchObject({
      params: { minutes: 120, mode: 'balanced', dateFilter: 'all' },
      planIds: ['todo-daily', 'todo-unassigned'],
      doneIds: [],
    });
  });

  it('rejects invalid or empty time and keeps the reset contract', async () => {
    const component = TestBed.createComponent(SmartPlanningComponent);
    component.detectChanges();
    await component.whenStable();

    component.componentInstance['timeInput'] = 'alert(1)';
    component.componentInstance['runPlan']();
    expect(feedback.showToast).toHaveBeenCalledWith('Temps disponible invalide. Exemples: 90, 60*5, (45+30)');

    component.componentInstance['timeInput'] = '0';
    component.componentInstance['runPlan']();
    expect(feedback.showToast).toHaveBeenCalledWith('Indique un temps disponible');

    component.componentInstance['timeInput'] = '90';
    component.componentInstance['runPlan']();
    component.componentInstance['resetPlan']();
    expect(component.componentInstance['resultVisible']()).toBe(false);
    expect(preferences.remove).toHaveBeenCalledWith(STORAGE_KEYS.smartPlan);
  });

  it('restores the saved plan and completed session across component instances', async () => {
    stored[STORAGE_KEYS.smartPlan] = {
      params: { minutes: 90, context: 'bureau', mode: 'focus', dateFilter: 'today', projectId: 'project-alpha' },
      planIds: ['todo-daily'],
      doneIds: ['todo-daily'],
      savedAt: '2026-09-01T08:30:00.000Z',
    };
    const component = TestBed.createComponent(SmartPlanningComponent);
    component.detectChanges();
    await component.whenStable();

    expect(component.componentInstance['resultVisible']()).toBe(true);
    expect(component.componentInstance['plan']().map((todo) => todo.id)).toEqual(['todo-daily']);
    expect(component.componentInstance['sessionDoneIds']()).toEqual(new Set(['todo-daily']));
    expect(component.componentInstance['timeInput']).toBe('90');
    expect(component.componentInstance['mode']).toBe('focus');
    expect(component.nativeElement.querySelector('.plan-task-done')).toBeTruthy();
  });

  it('completes a task through the shared recurrence domain function and navigates to todos', async () => {
    const component = TestBed.createComponent(SmartPlanningComponent);
    component.detectChanges();
    await component.whenStable();
    component.componentInstance['timeInput'] = '90';
    component.componentInstance['runPlan']();

    const current = data()!;
    const daily = current.todos.find((todo) => todo.id === 'todo-daily')!;
    component.componentInstance['completeTask'](daily);

    expect(data()!.todos.find((todo) => todo.id === 'todo-daily')?.status).toBe('done');
    expect(data()!.todos.some((todo) => todo.id !== 'todo-daily' && todo.title === daily.title)).toBe(true);
    expect(component.componentInstance['sessionDoneIds']()).toEqual(new Set(['todo-daily']));
    expect(stored[STORAGE_KEYS.smartPlan]).toMatchObject({ doneIds: ['todo-daily'] });

    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    component.componentInstance['openTask'](daily);
    expect(navigate).toHaveBeenCalledWith(['/todos'], { queryParams: { focus: 'todo-daily', kind: 'todo' } });
  });
});
