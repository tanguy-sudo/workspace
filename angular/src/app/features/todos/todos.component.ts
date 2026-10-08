import { CommonModule } from '@angular/common';
import { Component, HostListener, OnDestroy, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, ParamMap, Router } from '@angular/router';
import {
  addTodoPriority,
  buildNextRecurringTodo,
  completeTodo,
  createTodo,
  deleteTodo,
  deleteTodoPriority,
  deleteTodoSavedView,
  parseEstimatedTimeExpression,
  reorderTodos,
  saveTodoSavedView,
  trackActivity,
  updateTodo,
} from '../../core/domain/workspace-domain';
import type {
  KnownTodoStatus,
  Todo,
  TodoPriority,
  TodoRecurrence,
  TodoSavedView,
  TodoViewFilters,
  WorkspaceData,
  WorkspaceTemplate,
} from '../../core/persistence/workspace-data';
import { StoragePreferencesService, STORAGE_KEYS } from '../../core/persistence/storage-preferences.service';
import { WorkspaceStoreService } from '../../core/persistence/workspace-store.service';
import { FeedbackService } from '../../shared/feedback/feedback.service';
import { FocusTrapDirective } from '../../shared/a11y/focus-trap.directive';
import { MarkdownEditorComponent } from '../../shared/rendering/markdown-editor.component';
import { SafeMarkdownComponent } from '../../shared/rendering/safe-markdown.component';
import { ResizableDialogDirective } from '../../shared/dialog/resizable-dialog.directive';
import { DatePickerComponent } from '../../shared/date-picker/date-picker.component';

type TodoViewMode = 'columns' | 'list' | 'priority';
type TodoStatus = KnownTodoStatus;
type TodoDialog = 'todo' | 'priorities' | 'views' | 'templates' | 'templateForm' | 'bulk';

interface TodoDraft {
  title: string;
  description: string;
  priorityId: string;
  status: TodoStatus;
  estimatedTime: string;
  dueDate: string;
  reminderAt: string;
  pinned: boolean;
  projectId: string;
  context: string;
  attachedTo: string;
  recurrenceType: 'none' | 'daily' | 'weekly' | 'monthly_nth_weekday';
  recurrenceWeekdays: number[];
  recurrenceNth: 1 | 2 | 3 | 4 | -1;
  recurrenceWeekday: number;
  dependencies: string[];
  tags: string;
}

interface DropPreview {
  targetId: string;
  position: 'before' | 'after';
}

interface PriorityLane {
  id: string;
  label: string;
  color: string;
}

interface TodoTemplate {
  id: string;
  name: string;
  icon?: string;
  title?: string;
  rawTitle?: string;
  content?: string;
  description?: string;
  rawDescription?: string;
  priorityId?: string;
  estimatedTime?: number;
  context?: string;
  tags?: string[];
}

interface TodoTemplateDraft {
  name: string;
  icon: string;
  title: string;
  description: string;
  priorityId: string;
  estimatedTime: string;
  context: string;
  tags: string;
}

interface BulkTodoDraft {
  projectId: '__keep__' | '__none__' | string;
  status: '__keep__' | TodoStatus;
  priorityId: '__keep__' | string;
  context: string;
  clearContext: boolean;
  tags: string;
  tagsMode: 'keep' | 'replace' | 'add' | 'clear';
}

function emptyBulkTodoDraft(): BulkTodoDraft {
  return {
    projectId: '__keep__',
    status: '__keep__',
    priorityId: '__keep__',
    context: '',
    clearContext: false,
    tags: '',
    tagsMode: 'keep',
  };
}

function emptyTemplateDraft(priorityId = 'normal'): TodoTemplateDraft {
  return { name: '', icon: '📋', title: '', description: '', priorityId, estimatedTime: '', context: '', tags: '' };
}

const STATUSES: Array<{ id: TodoStatus; label: string }> = [
  { id: 'todo', label: 'À faire' },
  { id: 'waitinginfo', label: "En attente d'info" },
  { id: 'inprogress', label: 'En cours' },
  { id: 'done', label: 'Terminées' },
];

const WEEK_DAYS = [
  { id: 1, label: 'L' },
  { id: 2, label: 'Ma' },
  { id: 3, label: 'Me' },
  { id: 4, label: 'J' },
  { id: 5, label: 'V' },
  { id: 6, label: 'S' },
  { id: 7, label: 'D' },
];

const DEFAULT_PRIORITIES: TodoPriority[] = [
  { id: 'urgent', label: 'Urgent', color: '#ff5f6e' },
  { id: 'important', label: 'Important', color: '#f0a030' },
  { id: 'normal', label: 'Normal', color: '#64b0ff' },
  { id: 'basse', label: 'Basse', color: '#3d5070' },
];

const DEFAULT_TODO_TEMPLATES: TodoTemplate[] = [
  { id: 'tpl-bug', name: 'Correction de bug', icon: '🐛', title: 'Fix : ', priorityId: 'urgent', estimatedTime: 60, context: '@pc', tags: ['bug'] },
  { id: 'tpl-review', name: 'Revue de code', icon: '🔍', title: 'Review : ', priorityId: 'important', estimatedTime: 30, context: '@pc', tags: ['review'] },
  { id: 'tpl-doc', name: 'Documentation', icon: '📖', title: 'Doc : ', priorityId: 'normal', estimatedTime: 45, context: '', tags: ['doc'] },
  { id: 'tpl-prod', name: 'Mise en prod', icon: '🚀', title: 'Mise en prod : ', priorityId: 'important', estimatedTime: 90, context: '@pc', tags: ['prod', 'release'] },
  { id: 'tpl-ticket', name: 'Ticket incident / demande', icon: '🎫', title: 'Ticket : ', priorityId: 'important', estimatedTime: 45, context: '@support', tags: ['ticket', 'incident', 'support'] },
];

function newId(prefix: string): string {
  return globalThis.crypto?.randomUUID?.() ?? `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function emptyDraft(priorityId = 'normal'): TodoDraft {
  return {
    title: '', description: '', priorityId, status: 'todo', estimatedTime: '', dueDate: '', reminderAt: '',
    pinned: false, projectId: '', context: '', attachedTo: '', recurrenceType: 'none', recurrenceWeekdays: [],
    recurrenceNth: 2, recurrenceWeekday: 1, dependencies: [], tags: '',
  };
}

function contextValues(value: unknown): string[] {
  return [...new Set(String(value || '').split(',').map((item) => item.trim()).filter(Boolean))];
}

function tagsValue(value: unknown): string[] {
  return [...new Set(String(value || '').split(',').map((item) => item.trim()).filter(Boolean))];
}

function localDate(offset = 0): string {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + offset);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

function safeColor(value: string | undefined, fallback = '#64b0ff'): string {
  return /^#[0-9a-f]{6}$/i.test(value || '') ? value as string : fallback;
}

function priorityId(value: string | undefined, priorities: readonly TodoPriority[]): string {
  return value && priorities.some((priority) => priority.id === value) ? value : priorities[0]?.id || 'normal';
}

function statusLabel(status: string): string {
  if (status === 'all') return 'tous statuts';
  return STATUSES.find((entry) => entry.id === status)?.label || status;
}

function viewFilters(value: Partial<TodoViewFilters> | null | undefined): TodoViewFilters {
  return {
    status: value?.status || 'all',
    priority: value?.priority || 'all',
    context: value?.context || 'all',
    project: value?.project || 'all',
    due: value?.due || 'all',
  };
}

function interpolateTemplate(value: string | undefined): string {
  const now = new Date();
  return String(value || '')
    .replace(/\{\{date\}\}/gi, now.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))
    .replace(/\{\{time\}\}/gi, now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }));
}

function recurrenceDraft(value: TodoRecurrence | null | undefined): Pick<TodoDraft, 'recurrenceType' | 'recurrenceWeekdays' | 'recurrenceNth' | 'recurrenceWeekday'> {
  if (!value) return { recurrenceType: 'none', recurrenceWeekdays: [], recurrenceNth: 2, recurrenceWeekday: 1 };
  if (value.type === 'daily') return { recurrenceType: 'daily', recurrenceWeekdays: [], recurrenceNth: 2, recurrenceWeekday: 1 };
  if (value.type === 'weekly') return { recurrenceType: 'weekly', recurrenceWeekdays: [...value.weeklyDays], recurrenceNth: 2, recurrenceWeekday: 1 };
  return { recurrenceType: 'monthly_nth_weekday', recurrenceWeekdays: [], recurrenceNth: value.nth, recurrenceWeekday: value.weekday };
}

@Component({
  selector: 'app-todos',
  standalone: true,
  imports: [CommonModule, DatePickerComponent, FocusTrapDirective, FormsModule, MarkdownEditorComponent, ResizableDialogDirective, SafeMarkdownComponent],
  templateUrl: './todos.component.html',
  styleUrl: './todos.component.css',
})
export class TodosComponent implements OnDestroy {
  protected readonly statuses = STATUSES;
  protected readonly weekDays = WEEK_DAYS;
  protected readonly fullWeekDays = [
    { id: 1, label: 'Lundi' }, { id: 2, label: 'Mardi' }, { id: 3, label: 'Mercredi' }, { id: 4, label: 'Jeudi' },
    { id: 5, label: 'Vendredi' }, { id: 6, label: 'Samedi' }, { id: 7, label: 'Dimanche' },
  ];
  protected readonly dueFilters = [
    { id: 'all', label: 'Toutes' }, { id: 'overdue', label: 'En retard' }, { id: 'today', label: "Aujourd'hui" },
    { id: 'week', label: 'Cette semaine' }, { id: 'none', label: 'Sans échéance' },
  ];
  protected readonly data = computed(() => this.store.data());
  protected readonly loading = computed(() => this.store.loading());
  protected readonly viewMode = signal<TodoViewMode>('columns');
  protected readonly statusFilter = signal('all');
  protected readonly priorityFilter = signal('all');
  protected readonly contextFilter = signal('all');
  protected readonly projectFilter = signal('all');
  protected readonly dueFilter = signal('all');
  protected readonly selectionMode = signal(false);
  protected readonly selectedIds = signal(new Set<string>());
  protected readonly dialog = signal<TodoDialog | null>(null);
  protected readonly editingTodoId = signal<string | null>(null);
  protected readonly focusHighlight = signal<string | null>(null);
  protected readonly priorities = computed(() => this.data()?.settings.todoPriorities ?? DEFAULT_PRIORITIES);
  protected readonly projects = computed(() => this.data()?.projects ?? []);
  protected readonly allTodos = computed(() => this.data()?.todos ?? []);
  protected readonly contexts = computed(() => [...new Set(this.allTodos().flatMap((todo) => contextValues(todo.context)))].sort((a, b) => a.localeCompare(b, 'fr', { sensitivity: 'base' })));
  protected readonly filteredTodos = computed(() => this.allTodos().filter((todo) => this.matches(todo)));
  protected readonly listTodos = computed(() => this.filteredTodos().map((todo, index) => ({ todo, index })).sort((a, b) => this.priorityIndex(a.todo) - this.priorityIndex(b.todo) || a.index - b.index).map(({ todo }) => todo));
  protected readonly activeCount = computed(() => this.allTodos().filter((todo) => todo.status !== 'done').length);
  protected readonly savedViews = computed(() => this.data()?.settings.todoSavedViews ?? []);
  protected readonly templates = computed<TodoTemplate[]>(() => {
    const settings = this.data()?.settings;
    const stored = (settings?.templates ?? []).filter((template) => template.type === 'todo');
    const deleted = new Set(Array.isArray(settings?.['deletedTemplateIds']) ? settings['deletedTemplateIds'].filter((id): id is string => typeof id === 'string') : []);
    const templates = [
      ...stored,
      ...DEFAULT_TODO_TEMPLATES.filter((fallback) => !stored.some((template) => template.id === fallback.id) && !deleted.has(fallback.id)),
    ].filter((template) => !deleted.has(template.id));
    return templates.map((template) => ({
      id: template.id,
      name: template.name,
      icon: typeof template['icon'] === 'string' ? template['icon'] : '📋',
      rawTitle: typeof template['title'] === 'string' ? template['title'] : '',
      title: typeof template['title'] === 'string' ? interpolateTemplate(template['title']) : undefined,
      rawDescription: typeof template['description'] === 'string' ? template['description'] : typeof template['content'] === 'string' ? template['content'] : '',
      description: typeof template['description'] === 'string' ? interpolateTemplate(template['description']) : typeof template['content'] === 'string' ? interpolateTemplate(template['content']) : undefined,
      priorityId: typeof template['priorityId'] === 'string' ? template['priorityId'] : undefined,
      estimatedTime: typeof template['estimatedTime'] === 'number' ? template['estimatedTime'] : undefined,
      context: typeof template['context'] === 'string' ? template['context'] : undefined,
      tags: Array.isArray(template['tags']) ? template['tags'].filter((tag): tag is string => typeof tag === 'string') : undefined,
    }));
  });
  protected readonly dependencies = computed(() => this.allTodos().filter((todo) => todo.id !== this.editingTodoId()));
  protected readonly priorityLanes = computed<PriorityLane[]>(() => {
    const known = this.priorities().map((priority) => ({ id: priority.id, label: priority.label, color: priority.color }));
    const hasUnassigned = this.filteredTodos().some((todo) => todo.status !== 'done' && !this.priorities().some((priority) => priority.id === todo.priorityId));
    return hasUnassigned || !known.length ? [...known, { id: '', label: 'Sans priorité', color: '#7a94b8' }] : known;
  });

  protected todoDraft: TodoDraft = emptyDraft();
  protected priorityName = '';
  protected priorityColor = '#f0a030';
  protected viewName = '';
  protected bulkDraft: BulkTodoDraft = emptyBulkTodoDraft();
  protected templateDraft: TodoTemplateDraft = emptyTemplateDraft();
  protected readonly templateEditingId = signal<string | null>(null);

  private readonly store = inject(WorkspaceStoreService);
  private readonly preferences = inject(StoragePreferencesService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly feedback = inject(FeedbackService);
  private readonly queryParams = toSignal(this.route.queryParamMap, { initialValue: this.route.snapshot.queryParamMap });
  private appliedRouteKey = '';
  private restoredSessionFocus = false;
  private draggedId: string | null = null;
  private readonly dropPreview = signal<DropPreview | null>(null);
  private focusTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.viewMode.set(this.validViewMode(this.preferences.get(STORAGE_KEYS.todosView, 'columns') || 'columns'));
    effect(() => {
      const data = this.data();
      const query = this.queryParams();
      if (!data) return;
      const key = this.routeStateKey(query);
      if (key === this.appliedRouteKey) return;
      this.appliedRouteKey = key;
      this.applyRouteState(query, data);
    });
    void this.store.init();
  }

  protected setViewMode(mode: TodoViewMode): void {
    this.viewMode.set(mode);
    this.preferences.set(STORAGE_KEYS.todosView, mode);
    this.activeSavedViewId = null;
    this.syncUrl();
  }

  protected setFilter(filter: 'status' | 'priority' | 'context' | 'project' | 'due', value: string): void {
    if (filter === 'status') this.statusFilter.set(value);
    if (filter === 'priority') this.priorityFilter.set(value);
    if (filter === 'context') this.contextFilter.set(value);
    if (filter === 'project') this.projectFilter.set(value);
    if (filter === 'due') this.dueFilter.set(value);
    this.activeSavedViewId = null;
    this.syncUrl();
  }

  protected todosForStatus(status: TodoStatus): Todo[] { return this.filteredTodos().filter((todo) => todo.status === status); }
  protected todosForPriority(priorityId: string): Todo[] {
    return this.filteredTodos().filter((todo) => {
      if (todo.status === 'done') return false;
      const known = this.priorities().some((priority) => priority.id === todo.priorityId);
      return priorityId ? todo.priorityId === priorityId : !known;
    });
  }
  protected priorityFor(id: string | undefined): TodoPriority | null { return this.priorities().find((priority) => priority.id === id) ?? null; }
  protected safePriorityColor(color: string | undefined): string { return safeColor(color, '#7a94b8'); }
  protected projectName(id: string): string { return this.projects().find((project) => project.id === id)?.name || id; }
  protected todoContexts(todo: Todo): string[] { return contextValues(todo.context); }
  protected statusLabel(status: string): string { return statusLabel(status); }
  protected formatMinutes(minutes: number | undefined): string {
    if (!minutes) return '';
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return hours ? `${hours}h${rest ? `${rest}min` : ''}` : `${minutes}min`;
  }
  protected descriptionPreview(value: string): string { return value.length > 500 ? `${value.slice(0, 500).trim()}...` : value; }
  protected blockingCount(todo: Todo): number { return this.allTodos().filter((candidate) => (todo.dependencies ?? []).includes(candidate.id) && candidate.status !== 'done').length || 0; }
  protected isDrop(targetId: string, position: 'before' | 'after'): boolean { const preview = this.dropPreview(); return preview?.targetId === targetId && preview.position === position; }

  protected dueLabel(todo: Todo): { text: string; late: boolean } | null {
    if (!todo.dueDate || todo.status === 'done') return null;
    const today = localDate();
    if (todo.dueDate < today) return { text: 'En retard', late: true };
    if (todo.dueDate === today) return { text: "Aujourd'hui", late: false };
    if (todo.dueDate === localDate(1)) return { text: 'Demain', late: false };
    const date = new Date(`${todo.dueDate}T12:00:00`);
    return Number.isNaN(date.getTime()) ? null : { text: date.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }), late: false };
  }

  protected reminderLabel(todo: Todo): { text: string; late: boolean } | null {
    if (!todo.reminderAt) return null;
    const timestamp = Date.parse(todo.reminderAt);
    if (Number.isNaN(timestamp)) return null;
    const diff = timestamp - Date.now();
    const date = new Date(timestamp);
    const dateText = `${date.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })} ${date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
    if (diff < 0) return { text: `Rappel en retard · ${dateText}`, late: true };
    if (diff < 60 * 60 * 1000) return { text: `Rappel dans ${Math.max(1, Math.round(diff / 60000))} min`, late: false };
    return { text: `Rappel · ${dateText}`, late: false };
  }

  protected recurrenceLabel(value: TodoRecurrence | null | undefined): string {
    if (!value) return '';
    if (value.type === 'daily') return 'Récurrence: quotidien';
    if (value.type === 'weekly') return `Récurrence: hebdo (${value.weeklyDays.map((day) => WEEK_DAYS.find((entry) => entry.id === day)?.label).filter(Boolean).join(', ')})`;
    const nth = value.nth === -1 ? 'dernier' : `${value.nth}e`;
    return `Récurrence: ${nth} ${this.fullWeekDays.find((day) => day.id === value.weekday)?.label.toLowerCase() || 'jour'}`;
  }

  protected estimateHint(): string {
    if (!this.todoDraft.estimatedTime.trim()) return 'Minutes ou formule, ex. 60*5.';
    const parsed = parseEstimatedTimeExpression(this.todoDraft.estimatedTime);
    return parsed.valid ? `= ${parsed.minutes} min` : 'Formule invalide';
  }

  protected openNewTodo(): void {
    this.editingTodoId.set(null);
    this.todoDraft = emptyDraft(priorityId(undefined, this.priorities()));
    this.dialog.set('todo');
  }

  protected openTemplates(): void { this.templateEditingId.set(null); this.dialog.set('templates'); }

  protected openNewTemplate(): void {
    this.templateEditingId.set(null);
    this.templateDraft = emptyTemplateDraft(priorityId(undefined, this.priorities()));
    this.dialog.set('templateForm');
  }

  protected openEditTemplate(template: TodoTemplate): void {
    this.templateEditingId.set(template.id);
    this.templateDraft = {
      name: template.name,
      icon: template.icon || '📋',
      title: template.rawTitle || '',
      description: template.rawDescription || '',
      priorityId: priorityId(template.priorityId, this.priorities()),
      estimatedTime: template.estimatedTime ? String(template.estimatedTime) : '',
      context: template.context || '',
      tags: (template.tags || []).join(', '),
    };
    this.dialog.set('templateForm');
  }

  protected cancelTemplateForm(): void {
    this.templateEditingId.set(null);
    this.dialog.set('templates');
  }

  protected submitTemplate(): void {
    const name = this.templateDraft.name.trim();
    if (!name) { this.feedback.showToast('Nom du modèle requis', 'error'); return; }
    const parsedTime = parseEstimatedTimeExpression(this.templateDraft.estimatedTime);
    if (!parsedTime.valid) { this.feedback.showToast('Temps estimé invalide', 'error'); return; }

    const editingId = this.templateEditingId();
    const template: WorkspaceTemplate = {
      id: editingId || newId('template'),
      name,
      type: 'todo',
      icon: this.templateDraft.icon.trim() || '📋',
      title: this.templateDraft.title.trim(),
      description: this.templateDraft.description.trim(),
      priorityId: priorityId(this.templateDraft.priorityId, this.priorities()),
      estimatedTime: parsedTime.minutes,
      context: this.templateDraft.context.trim(),
      tags: tagsValue(this.templateDraft.tags),
    };
    const next = this.store.update((data) => {
      const current = data.settings.templates ?? [];
      data.settings.templates = current.some((candidate) => candidate.id === template.id)
        ? current.map((candidate) => candidate.id === template.id ? { ...candidate, ...template } : candidate)
        : [...current, template];
      const deleted = Array.isArray(data.settings['deletedTemplateIds'])
        ? data.settings['deletedTemplateIds'].filter((id): id is string => typeof id === 'string' && id !== template.id)
        : [];
      if (deleted.length) data.settings['deletedTemplateIds'] = deleted;
      else delete data.settings['deletedTemplateIds'];
    });
    if (!next) return;
    this.templateEditingId.set(null);
    this.dialog.set('templates');
    this.feedback.showToast(editingId ? 'Modèle mis à jour' : 'Modèle créé', 'success');
  }

  protected async removeTemplate(template: TodoTemplate): Promise<void> {
    if (!await this.feedback.confirm({ title: `Supprimer « ${template.name} » ?`, message: 'Le modèle sera supprimé définitivement.', confirmLabel: 'Supprimer', destructive: true })) return;
    const next = this.store.update((data) => {
      data.settings.templates = (data.settings.templates ?? []).filter((candidate) => candidate.id !== template.id);
      const deleted = Array.isArray(data.settings['deletedTemplateIds'])
        ? data.settings['deletedTemplateIds'].filter((id): id is string => typeof id === 'string')
        : [];
      if (!deleted.includes(template.id)) deleted.push(template.id);
      data.settings['deletedTemplateIds'] = deleted;
    });
    if (next) this.feedback.showToast('Modèle supprimé', 'success');
  }

  protected applyTemplate(template: TodoTemplate): void {
    this.editingTodoId.set(null);
    this.todoDraft = {
      ...emptyDraft(priorityId(template.priorityId, this.priorities())),
      title: interpolateTemplate(template.rawTitle ?? template.title),
      description: interpolateTemplate(template.rawDescription ?? template.description),
      estimatedTime: template.estimatedTime ? String(template.estimatedTime) : '',
      context: template.context || '',
      tags: (template.tags || []).join(', '),
    };
    this.dialog.set('todo');
  }

  protected openEditTodo(todo: Todo): void {
    const recurrence = recurrenceDraft(todo.recurrence);
    this.editingTodoId.set(todo.id);
    this.todoDraft = {
      title: todo.title, description: todo.description || '', priorityId: priorityId(todo.priorityId, this.priorities()), status: this.todoStatus(todo.status),
      estimatedTime: todo.estimatedTime ? String(todo.estimatedTime) : '', dueDate: todo.dueDate || '', reminderAt: todo.reminderAt || '', pinned: todo.pinned === true,
      projectId: todo.projectId || '', context: todo.context || '', attachedTo: todo.attachedTo || '', ...recurrence, dependencies: [...(todo.dependencies ?? [])], tags: (todo.tags ?? []).join(', '),
    };
    this.dialog.set('todo');
  }

  protected async submitTodo(): Promise<void> {
    const title = this.todoDraft.title.trim();
    if (!title) { this.feedback.showToast('Titre requis', 'error'); return; }
    const context = contextValues(this.todoDraft.context).join(', ');
    const projectId = this.projects().some((project) => project.id === this.todoDraft.projectId) ? this.todoDraft.projectId : '';
    if (!projectId && !context) { this.feedback.showToast('Renseigne au moins un projet ou un contexte', 'error'); return; }
    const parsedTime = parseEstimatedTimeExpression(this.todoDraft.estimatedTime);
    if (!parsedTime.valid) { this.feedback.showToast('Temps estimé invalide', 'error'); return; }
    if (this.todoDraft.dueDate && !validDate(this.todoDraft.dueDate)) { this.feedback.showToast("Date d'échéance invalide", 'error'); return; }
    if (this.todoDraft.reminderAt && Number.isNaN(Date.parse(this.todoDraft.reminderAt))) { this.feedback.showToast('Rappel invalide', 'error'); return; }
    const recurrence = this.readRecurrence();
    if (this.todoDraft.recurrenceType === 'weekly' && !recurrence) { this.feedback.showToast('Choisis au moins un jour de récurrence', 'error'); return; }
    const now = Date.now();
    const changes: Partial<Todo> = {
      title, description: this.todoDraft.description.trim(), priorityId: this.todoDraft.priorityId || priorityId(undefined, this.priorities()), status: this.todoDraft.status,
      estimatedTime: parsedTime.minutes, dueDate: this.todoDraft.dueDate, reminderAt: this.todoDraft.reminderAt, pinned: this.todoDraft.pinned,
      projectId, context, attachedTo: this.todoDraft.attachedTo.trim(), recurrence, dependencies: this.todoDraft.dependencies.filter((id) => id !== this.editingTodoId() && this.allTodos().some((todo) => todo.id === id)),
      tags: tagsValue(this.todoDraft.tags), updatedAt: now,
    };
    const editingId = this.editingTodoId();
    const createdId = editingId ? null : newId('todo');
    const changed = this.mutate((data) => {
      if (!editingId) {
        return createTodo(data, {
          id: createdId as string, title, description: this.todoDraft.description.trim(), status: this.todoDraft.status, priorityId: changes.priorityId,
          context, attachedTo: changes.attachedTo, estimatedTime: parsedTime.minutes, dependencies: changes.dependencies || [], tags: changes.tags || [],
          dueDate: this.todoDraft.dueDate, reminderAt: this.todoDraft.reminderAt, recurrence, pinned: this.todoDraft.pinned, projectId, createdAt: now,
        });
      }
      const current = data.todos.find((todo) => todo.id === editingId);
      let next = current ? updateTodo(data, editingId, changes) : null;
      if (next && current?.status !== 'done' && changes.status === 'done') {
        const completed = next.todos.find((todo) => todo.id === editingId);
        const recurring = completed ? buildNextRecurringTodo(completed, localDate(), newId('todo')) : null;
        if (recurring) next.todos.push(recurring);
      }
      return next;
    }, { type: 'todo', action: editingId ? 'update' : 'create', label: `Tâche « ${title} »`, id: editingId || createdId || undefined, icon: 'check' });
    if (!changed) return;
    this.closeDialog();
    this.feedback.showToast(editingId ? 'Tâche mise à jour' : 'Tâche créée', 'success');
  }

  protected toggleStatus(todo: Todo): void {
    const next = todo.status === 'done'
      ? updateTodo(this.data() as WorkspaceData, todo.id, { status: 'todo', updatedAt: Date.now() })
      : completeTodo(this.data() as WorkspaceData, todo.id, localDate(), newId('todo'));
    if (!next) return;
    this.apply(next, { type: 'todo', action: 'update', label: `Tâche « ${todo.title} »`, id: todo.id, icon: 'check' });
    this.feedback.showToast(todo.status === 'done' ? 'Tâche rouverte' : 'Tâche terminée', 'success');
  }

  protected selectCard(todo: Todo, event: MouseEvent): void {
    if (!this.selectionMode()) return;
    if ((event.target as HTMLElement | null)?.closest('button,input')) return;
    this.toggleSelection(todo.id);
  }

  protected toggleSelectionMode(): void { this.selectionMode.update((value) => !value); this.selectedIds.set(new Set()); }
  protected toggleSelection(id: string): void { this.selectedIds.update((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; }); }

  protected openBulkEdit(): void {
    if (!this.selectedIds().size) return;
    this.bulkDraft = emptyBulkTodoDraft();
    this.dialog.set('bulk');
  }

  protected submitBulkEdit(): void {
    const ids = [...this.selectedIds()];
    if (!ids.length) return;
    const draft = this.bulkDraft;
    const context = contextValues(draft.context).join(', ');
    const tags = tagsValue(draft.tags);
    const changed = this.mutate((data) => {
      let next = data;
      let touched = false;
      for (const id of ids) {
        const todo = next.todos.find((candidate) => candidate.id === id);
        if (!todo) continue;
        const changes: Partial<Todo> = { updatedAt: Date.now() };
        if (draft.projectId !== '__keep__') changes.projectId = draft.projectId === '__none__' ? '' : draft.projectId;
        if (draft.status !== '__keep__') changes.status = draft.status;
        if (draft.priorityId !== '__keep__') changes.priorityId = draft.priorityId;
        if (draft.clearContext) changes.context = '';
        else if (context) changes.context = context;
        if (draft.tagsMode === 'replace') changes.tags = tags;
        else if (draft.tagsMode === 'add') changes.tags = [...new Set([...(todo.tags ?? []), ...tags])];
        else if (draft.tagsMode === 'clear') changes.tags = [];
        const updated = updateTodo(next, id, changes);
        if (!updated) continue;
        next = updated;
        touched = true;
        if (todo.status !== 'done' && draft.status === 'done') {
          const completed = next.todos.find((candidate) => candidate.id === id);
          const recurring = completed ? buildNextRecurringTodo(completed, localDate(), newId('todo')) : null;
          if (recurring) next.todos.push(recurring);
        }
      }
      return touched ? next : null;
    }, { type: 'todo', action: 'update', label: `${ids.length} tâche(s) mise(s) à jour`, icon: 'check' });
    if (!changed) return;
    this.selectedIds.set(new Set());
    this.selectionMode.set(false);
    this.closeDialog();
    this.feedback.showToast('Mise à jour en masse appliquée', 'success');
  }

  protected async removeTodo(todo: Todo): Promise<void> {
    if (!await this.feedback.confirm({ title: `Supprimer « ${todo.title} » ?`, message: 'La tâche sera déplacée dans la corbeille.', confirmLabel: 'Supprimer', destructive: true })) return;
    const next = this.mutate((data) => deleteTodo(data, todo.id), { type: 'todo', action: 'delete', label: `Tâche « ${todo.title} »`, id: todo.id, icon: 'trash' });
    if (next) this.feedback.showToast('Tâche déplacée dans la corbeille', 'success');
  }

  protected async deleteSelected(): Promise<void> {
    const ids = [...this.selectedIds()];
    if (!ids.length) return;
    if (!await this.feedback.confirm({ title: `Supprimer ${ids.length} tâche${ids.length > 1 ? 's' : ''} ?`, message: 'Les tâches seront déplacées dans la corbeille.', confirmLabel: 'Supprimer', destructive: true })) return;
    const changed = this.mutate((data) => {
      let next = data;
      for (const id of ids) next = deleteTodo(next, id) || next;
      return next === data ? null : next;
    }, { type: 'todo', action: 'delete', label: `${ids.length} tâche(s) supprimée(s)`, icon: 'trash' });
    if (changed) { this.selectedIds.set(new Set()); this.selectionMode.set(false); this.feedback.showToast('Tâches déplacées dans la corbeille', 'success'); }
  }

  protected async purgeCompleted(): Promise<void> {
    const completed = this.allTodos().filter((todo) => todo.status === 'done');
    if (!completed.length) { this.feedback.showToast('Aucune tâche terminée', 'info'); return; }
    if (!await this.feedback.confirm({ title: `Supprimer ${completed.length} tâche${completed.length > 1 ? 's' : ''} terminée${completed.length > 1 ? 's' : ''} ?`, message: 'Les tâches seront déplacées dans la corbeille.', confirmLabel: 'Supprimer', destructive: true })) return;
    this.mutate((data) => {
      let next = data;
      for (const todo of completed) next = deleteTodo(next, todo.id) || next;
      return next;
    }, { type: 'todo', action: 'delete', label: `${completed.length} tâche(s) terminée(s) purgée(s)`, icon: 'trash' });
  }

  protected openPriorities(): void { this.priorityName = ''; this.priorityColor = '#f0a030'; this.dialog.set('priorities'); }
  protected submitPriority(): void {
    const label = this.priorityName.trim();
    if (!label) return;
    const base = label.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || newId('priority');
    let id = base;
    let suffix = 2;
    while (this.priorities().some((priority) => priority.id === id)) id = `${base}-${suffix++}`;
    const next = this.mutate((data) => addTodoPriority(data, { id, label, color: safeColor(this.priorityColor, '#f0a030') }));
    if (next) { this.priorityName = ''; this.feedback.showToast('Priorité ajoutée', 'success'); }
  }
  protected removePriority(priority: TodoPriority): void {
    const next = this.mutate((data) => deleteTodoPriority(data, priority.id));
    if (next && this.priorityFilter() === priority.id) { this.priorityFilter.set('all'); this.syncUrl(); }
  }

  protected openViews(): void { this.viewName = this.matchingSavedView()?.name || ''; this.dialog.set('views'); }
  protected matchingSavedView(): TodoSavedView | null {
    const current = this.viewState();
    return this.savedViews().find((view) => this.validViewMode(view.viewMode) === current.viewMode && JSON.stringify(viewFilters(view.filters)) === JSON.stringify(current.filters)) || null;
  }
  protected viewSummary(): string { return this.describeViewState(this.viewState()); }
  protected describeView(view: TodoSavedView): string { return this.describeViewState({ filters: viewFilters(view.filters), viewMode: this.validViewMode(view.viewMode) }); }
  protected submitView(): void {
    const name = this.viewName.trim();
    if (!name) return;
    const existing = this.matchingSavedView();
    const view: TodoSavedView = { id: existing?.id || newId('view'), name, filters: this.viewState().filters, viewMode: this.viewMode(), createdAt: existing?.createdAt };
    const next = this.mutate((data) => saveTodoSavedView(data, view));
    if (next) { this.activeSavedViewId = view.id; this.syncUrl(); this.feedback.showToast(existing ? 'Vue mise à jour' : 'Vue sauvegardée', 'success'); }
  }
  protected applySavedView(view: TodoSavedView): void {
    const filters = viewFilters(view.filters);
    this.statusFilter.set(filters.status); this.priorityFilter.set(filters.priority); this.contextFilter.set(filters.context);
    this.projectFilter.set(filters.project); this.dueFilter.set(filters.due); this.viewMode.set(this.validViewMode(view.viewMode));
    this.preferences.set(STORAGE_KEYS.todosView, this.viewMode()); this.activeSavedViewId = view.id; this.syncUrl(); this.closeDialog();
  }
  protected removeSavedView(view: TodoSavedView): void {
    const next = this.mutate((data) => deleteTodoSavedView(data, view.id));
    if (next && this.activeSavedViewId === view.id) { this.activeSavedViewId = null; this.syncUrl(); }
  }

  protected toggleDraftWeekday(day: number): void { this.todoDraft.recurrenceWeekdays = this.todoDraft.recurrenceWeekdays.includes(day) ? this.todoDraft.recurrenceWeekdays.filter((value) => value !== day) : [...this.todoDraft.recurrenceWeekdays, day].sort((a, b) => a - b); }
  protected toggleDraftDependency(id: string): void { this.todoDraft.dependencies = this.todoDraft.dependencies.includes(id) ? this.todoDraft.dependencies.filter((value) => value !== id) : [...this.todoDraft.dependencies, id]; }

  protected dragStart(event: DragEvent, todo: Todo): void { this.draggedId = todo.id; event.dataTransfer?.setData('text/plain', todo.id); if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'; }
  protected dragEnd(): void { this.draggedId = null; this.clearDropPreview(); }
  protected allowLaneDrop(event: DragEvent): void { if (this.draggedId) event.preventDefault(); }
  protected dragOverCard(event: DragEvent, targetId: string, surface: string): void {
    if (!this.draggedId || this.draggedId === targetId) return;
    event.preventDefault();
    if (surface !== 'list') return;
    const element = event.currentTarget as HTMLElement;
    const before = event.clientY - element.getBoundingClientRect().top < element.getBoundingClientRect().height / 2;
    this.dropPreview.set({ targetId, position: before ? 'before' : 'after' });
  }
  protected dragLeave(targetId: string): void { if (this.dropPreview()?.targetId === targetId) this.clearDropPreview(); }
  protected dropCard(event: DragEvent, targetId: string, surface: string, laneStatus?: TodoStatus, lanePriority?: string): void {
    event.preventDefault();
    if (surface === 'list') this.dropInList(targetId);
    else if (laneStatus) this.dropToStatus(event, laneStatus);
    else if (lanePriority !== undefined) this.dropToPriority(event, lanePriority);
  }
  protected dropAtListEnd(event: DragEvent): void { event.preventDefault(); if (!this.draggedId) return; this.reorderVisible(this.draggedId, null, false); this.dragEnd(); }
  protected dropInList(targetId: string): void {
    if (!this.draggedId) return;
    const preview = this.dropPreview();
    if (preview?.targetId !== targetId) { this.dragEnd(); return; }
    this.reorderVisible(this.draggedId, targetId, preview.position === 'before');
    this.dragEnd();
  }
  protected dropToStatus(event: DragEvent, status: TodoStatus): void {
    event.preventDefault();
    const source = this.draggedId;
    if (!source) return;
    const todo = this.allTodos().find((candidate) => candidate.id === source);
    if (todo && todo.status !== status) this.updateStatus(source, status);
    this.dragEnd();
  }
  protected dropToPriority(event: DragEvent, priority: string): void {
    event.preventDefault();
    const source = this.draggedId;
    if (!source) return;
    const todo = this.allTodos().find((candidate) => candidate.id === source);
    if (todo && (todo.priorityId || '') !== priority) {
      const label = priority ? this.priorityFor(priority)?.label || priority : 'Sans priorité';
      const updated = this.mutate((data) => updateTodo(data, source, { priorityId: priority, updatedAt: Date.now() }), { type: 'todo', action: 'update', label: `Tâche « ${todo.title} »`, id: source, icon: 'check' });
      if (updated) this.feedback.showToast(`Priorité → ${label}`, 'success');
    }
    this.dragEnd();
  }
  protected clearDropPreview(): void { this.dropPreview.set(null); }

  protected closeDialog(): void { this.dialog.set(null); this.editingTodoId.set(null); }

  @HostListener('document:keydown', ['$event'])
  protected onKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape' || !this.dialog()) return;
    event.preventDefault();
    if (this.dialog() === 'templateForm') this.cancelTemplateForm();
    else this.closeDialog();
  }

  ngOnDestroy(): void { this.clearFocusTimer(); }

  private activeSavedViewId: string | null = null;

  private matches(todo: Todo): boolean {
    if (this.statusFilter() !== 'all' && todo.status !== this.statusFilter()) return false;
    if (this.priorityFilter() !== 'all' && todo.priorityId !== this.priorityFilter()) return false;
    if (this.contextFilter() !== 'all' && !contextValues(todo.context).includes(this.contextFilter())) return false;
    if (this.projectFilter() === 'none' && !!todo.projectId) return false;
    if (this.projectFilter() !== 'all' && this.projectFilter() !== 'none' && todo.projectId !== this.projectFilter()) return false;
    const today = localDate();
    const weekEnd = localDate(7);
    if (this.dueFilter() === 'overdue' && (!todo.dueDate || todo.dueDate >= today)) return false;
    if (this.dueFilter() === 'today' && todo.dueDate !== today) return false;
    if (this.dueFilter() === 'week' && (!todo.dueDate || todo.dueDate > weekEnd)) return false;
    if (this.dueFilter() === 'none' && todo.dueDate) return false;
    return true;
  }

  private priorityIndex(todo: Todo): number { const index = this.priorities().findIndex((priority) => priority.id === todo.priorityId); return index < 0 ? 999 : index; }
  private todoStatus(status: string): TodoStatus { return STATUSES.some((entry) => entry.id === status) ? status as TodoStatus : 'todo'; }
  private readRecurrence(): TodoRecurrence | null {
    if (this.todoDraft.recurrenceType === 'daily') return { type: 'daily' };
    if (this.todoDraft.recurrenceType === 'weekly') return this.todoDraft.recurrenceWeekdays.length ? { type: 'weekly', weeklyDays: [...new Set(this.todoDraft.recurrenceWeekdays)].sort((a, b) => a - b) } : null;
    if (this.todoDraft.recurrenceType === 'monthly_nth_weekday') return { type: 'monthly_nth_weekday', nth: this.todoDraft.recurrenceNth, weekday: this.todoDraft.recurrenceWeekday };
    return null;
  }

  private updateStatus(id: string, status: TodoStatus): void {
    const todo = this.allTodos().find((candidate) => candidate.id === id);
    if (!todo) return;
    if (status === 'done' && todo.status !== 'done') this.apply(completeTodo(this.data() as WorkspaceData, id, localDate(), newId('todo')), { type: 'todo', action: 'update', label: `Tâche « ${todo.title} »`, id, icon: 'check' });
    else this.mutate((data) => updateTodo(data, id, { status, updatedAt: Date.now() }), { type: 'todo', action: 'update', label: `Tâche « ${todo.title} »`, id, icon: 'check' });
  }

  private reorderVisible(sourceId: string, targetId: string | null, before: boolean): void {
    const ids = this.listTodos().map((todo) => todo.id).filter((id) => id !== sourceId);
    if (targetId) { const index = ids.indexOf(targetId); if (index < 0) return; ids.splice(before ? index : index + 1, 0, sourceId); } else ids.push(sourceId);
    this.mutate((data) => reorderTodos(data, ids));
  }

  private viewState(): { filters: TodoViewFilters; viewMode: TodoViewMode } {
    return { filters: { status: this.statusFilter(), priority: this.priorityFilter(), context: this.contextFilter(), project: this.projectFilter(), due: this.dueFilter() }, viewMode: this.viewMode() };
  }
  private describeViewState(state: { filters: TodoViewFilters; viewMode: TodoViewMode }): string {
    const filters = state.filters;
    const labels = [statusLabel(filters.status || 'all')];
    if (filters.priority !== 'all') labels.push(`priorité ${this.priorityFor(filters.priority)?.label || filters.priority}`);
    if (filters.context !== 'all') labels.push(`contexte ${filters.context}`);
    if (filters.project === 'none') labels.push('sans projet'); else if (filters.project !== 'all') labels.push(this.projectName(filters.project));
    if (filters.due !== 'all') labels.push(this.dueFilters.find((due) => due.id === filters.due)?.label || filters.due);
    labels.push(state.viewMode === 'list' ? 'vue liste' : state.viewMode === 'priority' ? 'vue priorités' : 'vue colonnes');
    return labels.join(' · ');
  }
  private validViewMode(value: string | undefined): TodoViewMode { return value === 'list' || value === 'priority' ? value : 'columns'; }

  private routeStateKey(query: ParamMap): string { return ['savedView', 'status', 'priority', 'context', 'project', 'due', 'view', 'focus'].map((key) => `${key}=${query.get(key) || ''}`).join('&'); }
  private applyRouteState(query: ParamMap, data: WorkspaceData): void {
    const saved = query.get('savedView') ? (data.settings.todoSavedViews ?? []).find((view) => view.id === query.get('savedView')) : null;
    if (saved) {
      const filters = viewFilters(saved.filters);
      this.statusFilter.set(filters.status); this.priorityFilter.set(filters.priority); this.contextFilter.set(filters.context); this.projectFilter.set(filters.project); this.dueFilter.set(filters.due); this.viewMode.set(this.validViewMode(saved.viewMode)); this.activeSavedViewId = saved.id;
    } else {
      this.statusFilter.set(this.statusValue(query.get('status'))); this.priorityFilter.set(this.priorityValue(query.get('priority'), data)); this.contextFilter.set(query.get('context') || 'all'); this.projectFilter.set(this.projectValue(query.get('project'), data)); this.dueFilter.set(this.dueValue(query.get('due'))); this.viewMode.set(this.validViewMode(query.get('view') || this.viewMode())); this.activeSavedViewId = null;
    }
    let focus = query.get('focus');
    if (!focus && !this.restoredSessionFocus) { focus = this.preferences.get(STORAGE_KEYS.focusTodo, null, 'session'); this.preferences.remove(STORAGE_KEYS.focusTodo, 'session'); this.restoredSessionFocus = true; }
    const target = focus ? data.todos.find((todo) => todo.id === focus) : null;
    this.clearFocusTimer();
    this.focusHighlight.set(target ? target.id : null);
    if (target) this.scheduleFocus(target.id);
  }
  private statusValue(value: string | null): string { return value && STATUSES.some((entry) => entry.id === value) ? value : 'all'; }
  private priorityValue(value: string | null, data: WorkspaceData): string { return value === 'all' || !value ? 'all' : (data.settings.todoPriorities ?? []).some((priority) => priority.id === value) ? value : 'all'; }
  private projectValue(value: string | null, data: WorkspaceData): string { return value === 'none' || value === 'all' || !value ? value || 'all' : data.projects.some((project) => project.id === value) ? value : 'all'; }
  private dueValue(value: string | null): string { return this.dueFilters.some((due) => due.id === value) ? value as string : 'all'; }

  private syncUrl(): void {
    const state = this.viewState();
    void this.router.navigate([], { relativeTo: this.route, queryParams: {
      status: state.filters.status === 'all' ? null : state.filters.status, priority: state.filters.priority === 'all' ? null : state.filters.priority,
      context: state.filters.context === 'all' ? null : state.filters.context, project: state.filters.project === 'all' ? null : state.filters.project,
      due: state.filters.due === 'all' ? null : state.filters.due, view: state.viewMode === 'columns' ? null : state.viewMode, savedView: this.activeSavedViewId,
    } });
  }

  private apply(next: WorkspaceData | null, activity?: { type: string; action: string; label: string; id?: string; icon?: string }): void {
    if (!next) return;
    this.store.update((draft) => Object.assign(draft, activity ? trackActivity(next, activity) : next));
  }
  private mutate(mutator: (data: WorkspaceData) => WorkspaceData | null, activity?: { type: string; action: string; label: string; id?: string; icon?: string }): WorkspaceData | null {
    let changed = false;
    const updated = this.store.update((draft) => {
      const next = mutator(draft);
      if (!next) return;
      changed = true;
      Object.assign(draft, activity ? trackActivity(next, activity) : next);
    });
    return changed ? updated : null;
  }
  private scheduleFocus(id: string): void {
    this.clearFocusTimer();
    this.focusTimer = setTimeout(() => {
      this.focusTimer = null;
      const element = Array.from(document.querySelectorAll<HTMLElement>('[data-id]')).find((node) => node.dataset['id'] === id);
      element?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
      this.focusTimer = setTimeout(() => { if (this.focusHighlight() === id) this.focusHighlight.set(null); }, 1600);
    }, 0);
  }

  private clearFocusTimer(): void {
    if (this.focusTimer) clearTimeout(this.focusTimer);
    this.focusTimer = null;
  }
}
