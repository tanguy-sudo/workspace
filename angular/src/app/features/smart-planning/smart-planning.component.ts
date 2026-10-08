import { CommonModule } from '@angular/common';
import { Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { completeTodo, computeSmartPlan, parseEstimatedTimeExpression, parseEstimatedTimeMinutes, updateTodo } from '../../core/domain/workspace-domain';
import type { Todo, TodoPriority, WorkspaceData } from '../../core/persistence/workspace-data';
import { StoragePreferencesService, STORAGE_KEYS } from '../../core/persistence/storage-preferences.service';
import { WorkspaceStoreService } from '../../core/persistence/workspace-store.service';
import { FeedbackService } from '../../shared/feedback/feedback.service';

type SmartPlanMode = 'balanced' | 'focus' | 'sprint';
type SmartPlanDateFilter = 'all' | 'today' | 'week';

interface SmartPlanParams {
  minutes: number;
  context: string;
  mode: SmartPlanMode;
  dateFilter: SmartPlanDateFilter;
  projectId: string;
}

const MODES: Array<{ id: SmartPlanMode; label: string; description: string }> = [
  { id: 'balanced', label: 'Équilibré', description: 'Priorité + temps optimisé' },
  { id: 'focus', label: 'Focus', description: 'Une seule tâche clé' },
  { id: 'sprint', label: 'Sprint', description: 'Max de tâches courtes' },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function newId(prefix: string): string {
  return globalThis.crypto?.randomUUID?.() ?? `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function localDate(offset = 0): string {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + offset);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function todoMinutes(todo: Todo): number {
  return parseEstimatedTimeMinutes(todo.estimatedTime);
}

function safeColor(value: string | undefined, fallback = '#7a94b8'): string {
  return /^#[0-9a-f]{6}$/i.test(value || '') ? value as string : fallback;
}

function validMode(value: unknown): SmartPlanMode {
  return value === 'focus' || value === 'sprint' ? value : 'balanced';
}

function validDateFilter(value: unknown): SmartPlanDateFilter {
  return value === 'today' || value === 'week' ? value : 'all';
}

@Component({
  selector: 'app-smart-planning',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './smart-planning.component.html',
  styleUrl: './smart-planning.component.css',
})
export class SmartPlanningComponent {
  protected readonly modes = MODES;
  protected readonly data = computed(() => this.store.data());
  protected readonly allTodos = computed(() => this.data()?.todos ?? []);
  protected readonly projects = computed(() => this.data()?.projects ?? []);
  protected readonly contexts = computed(() => [...new Set(this.allTodos().map((todo) => todo.context).filter((value): value is string => Boolean(value)))]);
  protected readonly plan = signal<Todo[]>([]);
  protected readonly planParams = signal<SmartPlanParams | null>(null);
  protected readonly sessionDoneIds = signal<Set<string>>(new Set());
  protected readonly resultVisible = signal(false);
  protected readonly restoredLabel = signal<string | null>(null);

  protected timeInput = '';
  protected context = '';
  protected projectId = '';
  protected dateFilter: SmartPlanDateFilter = 'all';
  protected mode: SmartPlanMode = 'balanced';

  protected readonly timeBar = computed(() => {
    const available = this.parseTime(this.timeInput).minutes;
    const used = this.plan().filter((todo) => !this.isSessionDone(todo.id)).reduce((sum, todo) => sum + todoMinutes(todo), 0);
    const percent = available > 0 ? Math.min(100, (used / available) * 100) : 0;
    return { available, used, remaining: Math.max(0, available - used), percent: Number(percent.toFixed(1)) };
  });

  private readonly store = inject(WorkspaceStoreService);
  private readonly preferences = inject(StoragePreferencesService);
  private readonly feedback = inject(FeedbackService);
  private readonly router = inject(Router);
  private restored = false;

  constructor() {
    effect(() => {
      const data = this.data();
      if (!data || this.restored) return;
      this.restored = true;
      this.restorePlan(data);
    });
    void this.store.init();
  }

  protected timeHint(): string {
    const raw = this.timeInput.trim();
    if (!raw) return 'Minutes directes ou formule (ex: 60*5).';
    const parsed = this.parseTime(this.timeInput);
    return parsed.valid ? `= ${parsed.minutes} min` : 'Formule invalide. Formats: 90, 60*5, (45+30).';
  }

  protected timeHintState(): 'empty' | 'valid' | 'invalid' {
    if (!this.timeInput.trim()) return 'empty';
    return this.parseTime(this.timeInput).valid ? 'valid' : 'invalid';
  }

  protected runPlan(): void {
    const parsed = this.parseTime(this.timeInput);
    if (this.timeInput.trim() && !parsed.valid) {
      this.feedback.showToast('Temps disponible invalide. Exemples: 90, 60*5, (45+30)');
      return;
    }
    if (!parsed.minutes) {
      this.feedback.showToast('Indique un temps disponible');
      return;
    }

    const data = this.data();
    if (!data) return;
    this.sessionDoneIds.set(new Set());
    this.restoredLabel.set(null);
    const params: SmartPlanParams = {
      minutes: parsed.minutes,
      context: this.context,
      mode: this.mode,
      dateFilter: this.dateFilter,
      projectId: this.projectId,
    };
    const nextPlan = computeSmartPlan(data, parsed.minutes, params.context, params.mode, params.dateFilter, params.projectId);
    this.planParams.set(params);
    this.plan.set(nextPlan);
    this.resultVisible.set(true);
    this.savePlan(params, nextPlan.map((todo) => todo.id));
  }

  protected resetPlan(): void {
    this.plan.set([]);
    this.planParams.set(null);
    this.sessionDoneIds.set(new Set());
    this.restoredLabel.set(null);
    this.resultVisible.set(false);
    this.preferences.remove(STORAGE_KEYS.smartPlan);
  }

  protected totalPlanMinutes(): number {
    return this.plan().reduce((sum, todo) => sum + todoMinutes(todo), 0);
  }

  protected modeLabel(): string {
    const mode = this.planParams()?.mode ?? this.mode;
    return MODES.find((option) => option.id === mode)?.label.toLowerCase() || mode;
  }

  protected displayedContext(): string { return this.planParams()?.context || ''; }

  protected formatTime(minutes: number): string {
    if (!minutes) return '';
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return hours ? `${hours}h${rest ? `${rest}min` : ''}` : `${minutes}min`;
  }

  protected todoMinutes(todo: Todo): number { return todoMinutes(todo); }

  protected priorityFor(id: string | undefined): TodoPriority | null {
    return this.data()?.settings.todoPriorities?.find((priority) => priority.id === id) ?? null;
  }

  protected safePriorityColor(color: string | undefined): string {
    return safeColor(color, '#7a94b8');
  }

  protected isSessionDone(id: string): boolean {
    return this.sessionDoneIds().has(id);
  }

  protected completeTask(todo: Todo): void {
    const data = this.data();
    if (!data) return;
    const next = todo.status === 'done'
      ? updateTodo(data, todo.id, { status: 'done', updatedAt: Date.now() })
      : completeTodo(data, todo.id, localDate(), newId('todo'));
    if (!next) return;
    const updated = this.store.update((draft) => Object.assign(draft, next));
    if (!updated) return;
    this.sessionDoneIds.update((ids) => new Set(ids).add(todo.id));
    this.plan.set(this.plan().map((item) => updated.todos.find((candidate) => candidate.id === item.id) ?? item));
    this.feedback.showToast('Tâche terminée !', 'success');
    this.patchSavedDoneIds();
  }

  protected openTask(todo: Todo): void {
    void this.router.navigate(['/todos'], { queryParams: { focus: todo.id, kind: 'todo' } });
  }

  private parseTime(value: unknown) {
    return parseEstimatedTimeExpression(value);
  }

  private savePlan(params: SmartPlanParams, planIds: string[]): void {
    this.preferences.setJson(STORAGE_KEYS.smartPlan, {
      params,
      planIds,
      doneIds: [...this.sessionDoneIds()],
      savedAt: new Date().toISOString(),
    });
  }

  private patchSavedDoneIds(): void {
    const saved = this.preferences.getJson<unknown>(STORAGE_KEYS.smartPlan, null);
    if (!isRecord(saved)) return;
    this.preferences.setJson(STORAGE_KEYS.smartPlan, { ...saved, doneIds: [...this.sessionDoneIds()] });
  }

  private restorePlan(data: WorkspaceData): void {
    const saved = this.preferences.getJson<unknown>(STORAGE_KEYS.smartPlan, null);
    if (!isRecord(saved) || !isRecord(saved['params']) || !Array.isArray(saved['planIds']) || !saved['planIds'].length) return;
    const params = saved['params'];
    const minutes = Number(params['minutes']);
    if (!Number.isFinite(minutes) || minutes <= 0) return;
    const planIds = saved['planIds'].filter((id): id is string => typeof id === 'string');
    const plan = planIds.map((id) => data.todos.find((todo) => todo.id === id)).filter((todo): todo is Todo => Boolean(todo));
    if (!plan.length) {
      this.preferences.remove(STORAGE_KEYS.smartPlan);
      return;
    }

    this.timeInput = String(minutes);
    this.context = typeof params['context'] === 'string' ? params['context'] : '';
    this.projectId = typeof params['projectId'] === 'string' ? params['projectId'] : '';
    this.dateFilter = validDateFilter(params['dateFilter']);
    this.mode = validMode(params['mode']);
    this.planParams.set({
      minutes,
      context: this.context,
      mode: this.mode,
      dateFilter: this.dateFilter,
      projectId: this.projectId,
    });
    this.sessionDoneIds.set(new Set(Array.isArray(saved['doneIds']) ? saved['doneIds'].filter((id): id is string => typeof id === 'string') : []));
    this.plan.set(plan);
    this.restoredLabel.set(this.restoreLabel(saved['savedAt']));
    this.resultVisible.set(true);
  }

  private restoreLabel(value: unknown): string | null {
    const date = new Date(String(value || ''));
    if (Number.isNaN(date.getTime())) return null;
    return date.toDateString() === new Date().toDateString()
      ? `aujourd'hui à ${date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`
      : `le ${date.toLocaleDateString('fr-FR')}`;
  }
}
