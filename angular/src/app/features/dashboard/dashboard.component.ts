import { CommonModule } from '@angular/common';
import { Component, DestroyRef, HostListener, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import {
  collectTreeNodes,
  completeTodo,
  createTodo,
  findTreeNode,
  trackActivity,
  updateTodo,
} from '../../core/domain/workspace-domain';
import type {
  ActivityLogEntry,
  FavoriteVisit,
  Project,
  RhFolder,
  RhNode,
  Todo,
  WorkspaceData,
} from '../../core/persistence/workspace-data';
import { WorkspaceStoreService } from '../../core/persistence/workspace-store.service';
import { FeedbackService } from '../../shared/feedback/feedback.service';
import { FocusTrapDirective } from '../../shared/a11y/focus-trap.directive';
import { GlobalSearchService } from '../../shared/search/global-search.service';
import { ResizableDialogDirective } from '../../shared/dialog/resizable-dialog.directive';
import { DatePickerComponent } from '../../shared/date-picker/date-picker.component';

export type DashboardReminderTab = 'today' | 'overdue' | 'pinned' | 'upcoming';

export interface DashboardReminderBuckets {
  today: Todo[];
  overdue: Todo[];
  pinned: Todo[];
  upcoming: Todo[];
}

export function dashboardLocalDate(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function dueTimestamp(todo: Todo): number | null {
  if (todo.reminderAt) {
    const reminder = Date.parse(todo.reminderAt);
    if (!Number.isNaN(reminder)) return reminder;
  }
  if (todo.dueDate) {
    const due = Date.parse(`${todo.dueDate}T23:59:59`);
    if (!Number.isNaN(due)) return due;
  }
  return null;
}

export function dashboardReminderBuckets(todos: readonly Todo[], now = Date.now()): DashboardReminderBuckets {
  const date = new Date(now);
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const end = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999).getTime();
  const today = dashboardLocalDate(date);
  const active = todos.filter((todo) => todo.status !== 'done');
  const byDue = (a: Todo, b: Todo): number => (dueTimestamp(a) ?? Number.POSITIVE_INFINITY) - (dueTimestamp(b) ?? Number.POSITIVE_INFINITY);

  return {
    today: active.filter((todo) => {
      const due = dueTimestamp(todo);
      return due !== null && due >= start && due <= end;
    }).sort(byDue),
    overdue: active.filter((todo) => !!todo.dueDate && todo.dueDate < today).sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || '')),
    pinned: active.filter((todo) => todo.pinned === true).sort(byDue),
    upcoming: active.filter((todo) => !!todo.reminderAt)
      .filter((todo) => {
        const due = todo.reminderAt ? Date.parse(todo.reminderAt) : Number.NaN;
        return !Number.isNaN(due) && due >= now && due <= now + 7 * 864e5;
      })
      .sort(byDue),
  };
}

export function dashboardWeekKey(date = new Date()): string {
  const current = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = current.getUTCDay() || 7;
  current.setUTCDate(current.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(current.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((current.getTime() - yearStart.getTime()) / 864e5) + 1) / 7);
  return `${current.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

interface DashboardLink {
  path: string[];
  queryParams?: Record<string, string>;
}

interface HealthStats {
  activeTodosWithoutProject: number;
  projectsWithoutCategory: number;
  waitingInfoTodos: number;
  staleProjects: number;
  taglessContent: number;
}

interface HealthCard extends DashboardLink {
  id: string;
  count: number;
  label: string;
  hint: string;
  tone: 'warn' | 'ok';
}

interface ReviewItem extends DashboardLink {
  title: string;
  detail: string;
  ok?: boolean;
}

interface RecentVisit {
  kind: 'visit';
  key: string;
  type: string;
  id: string;
  name: string;
  color?: string;
  ts: number;
}

interface RecentActivity {
  kind: 'activity';
  key: string;
  type: string;
  label: string;
  action: string;
  icon?: string;
  color?: string;
  ts: number;
}

type RecentItem = RecentVisit | RecentActivity;

interface ReminderDraft {
  title: string;
  when: string;
  priorityId: string;
  context: string;
  pinned: boolean;
}

interface TaskStats {
  total: number;
  done: number;
  doneWeek: number;
  overdue: number;
  active: number;
  progress: number;
  priorities: Array<{ id: string; label: string; color: string; count: number; percent: number }>;
}

const REMINDER_TABS: Array<{ id: DashboardReminderTab; label: string }> = [
  { id: 'today', label: "Aujourd'hui" },
  { id: 'overdue', label: 'En retard' },
  { id: 'pinned', label: 'Epingles' },
  { id: 'upcoming', label: 'A venir' },
];

const SHORTCUTS: Array<{ path: string[]; icon: string; name: string; sub: string }> = [
  { path: ['/rh'], icon: 'RH', name: 'RH', sub: 'Fiches et dossiers' },
  { path: ['/projects'], icon: 'P', name: 'Projets', sub: 'Liens, memos, code' },
  { path: ['/todos'], icon: 'T', name: 'Taches', sub: 'Todo et priorites' },
  { path: ['/snippets'], icon: '</>', name: 'Snippets', sub: 'Code reutilisable' },
  { path: ['/journal'], icon: 'J', name: 'Journal', sub: 'Notes du jour' },
  { path: ['/smart-planning'], icon: 'S', name: 'Planification', sub: 'Optimise ton temps' },
  { path: ['/export'], icon: '↓', name: 'Export', sub: 'Telecharger' },
];

function newId(prefix: string): string {
  return globalThis.crypto?.randomUUID?.() ?? `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function safeColor(value: string | undefined, fallback = '#64b0ff'): string {
  return /^#[0-9a-f]{6}$/i.test(value || '') ? value as string : fallback;
}

function emptyReminderDraft(priorityId = 'important'): ReminderDraft {
  return { title: '', when: '', priorityId, context: '', pinned: true };
}

function defaultReminderValue(now = new Date()): string {
  const date = new Date(now.getTime() + 60 * 60 * 1000);
  date.setSeconds(0, 0);
  date.setMinutes(Math.ceil(date.getMinutes() / 5) * 5);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatDate(value: string): string {
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : `${date.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })} ${date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
}

function formatTimeAgo(timestamp: number, now: number): string {
  const minutes = Math.floor((now - timestamp) / 60000);
  if (minutes < 1) return "A l'instant";
  if (minutes < 60) return `Il y a ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Il y a ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `Il y a ${days} j`;
  return new Date(timestamp).toLocaleDateString('fr-FR');
}

function findRhPath(root: RhFolder, targetId: string): string[] | null {
  const visit = (node: RhNode, path: string[]): string[] | null => {
    if (node.id === targetId) return path;
    if (node.nodeType !== 'folder') return null;
    for (const child of node.children ?? []) {
      const result = visit(child, [...path, child.id]);
      if (result) return result;
    }
    return null;
  };
  return visit(root, ['root']);
}

function buildHealthStats(data: WorkspaceData, now: number): HealthStats {
  const projects = data.projects.filter((project) => project['archived'] !== true);
  const activeTodos = data.todos.filter((todo) => todo.status !== 'done');
  const projectItems = projects.flatMap((project) => collectTreeNodes(project.children, (node) => node.nodeType === 'item'));
  const rhDocuments = collectTreeNodes([data.rh], (node) => node.nodeType === 'document');
  const staleThreshold = now - 21 * 864e5;
  return {
    activeTodosWithoutProject: activeTodos.filter((todo) => !todo.projectId).length,
    projectsWithoutCategory: projects.filter((project) => !(project.categories || []).length).length,
    waitingInfoTodos: activeTodos.filter((todo) => todo.status === 'waitinginfo').length,
    staleProjects: projects.filter((project) => (project.lastVisited || project.createdAt || 0) < staleThreshold).length,
    taglessContent: [
      ...projectItems.filter((node) => !(node['tags'] as string[] | undefined)?.length),
      ...rhDocuments.filter((node) => !(node['tags'] as string[] | undefined)?.length),
      ...data.snippets.filter((snippet) => !snippet.tags?.length),
    ].length,
  };
}

function buildReviewItems(stats: HealthStats): ReviewItem[] {
  const items: ReviewItem[] = [];
  if (stats.activeTodosWithoutProject) items.push({ title: `Classer ${stats.activeTodosWithoutProject} tache${stats.activeTodosWithoutProject > 1 ? 's' : ''} sans projet`, detail: 'Affecte-les a un projet ou garde une vraie inbox courte.', path: ['/todos'], queryParams: { project: 'none' } });
  if (stats.projectsWithoutCategory) items.push({ title: `Qualifier ${stats.projectsWithoutCategory} projet${stats.projectsWithoutCategory > 1 ? 's' : ''} sans categorie`, detail: 'Une categorie par projet suffit pour rendre les vues coherentes.', path: ['/projects'] });
  if (stats.waitingInfoTodos) items.push({ title: `Relancer ${stats.waitingInfoTodos} tache${stats.waitingInfoTodos > 1 ? 's' : ''} en attente d'info`, detail: 'Decide si la prochaine action est une relance, une note ou une cloture.', path: ['/todos'], queryParams: { status: 'waitinginfo' } });
  if (stats.staleProjects) items.push({ title: `Reevaluer ${stats.staleProjects} projet${stats.staleProjects > 1 ? 's' : ''} dormant${stats.staleProjects > 1 ? 's' : ''}`, detail: "Archive, relance ou reorganise les projets qui n'avancent plus.", path: ['/projects'] });
  if (stats.taglessContent) items.push({ title: `Tagger ${stats.taglessContent} contenu${stats.taglessContent > 1 ? 's' : ''} non qualifie${stats.taglessContent > 1 ? 's' : ''}`, detail: 'Commence par quelques tags stables: acces, batch, doc, compte, prod.', path: ['/snippets'] });
  return items.length ? items : [{ title: 'Aucun point bloquant cette semaine', detail: 'Le workspace est propre. Fais juste un passage rapide sur les taches actives.', path: ['/todos'], ok: true }];
}

function activityTypeLabel(type: string): string {
  return { todo: 'Tache', snippet: 'Snippet', rh: 'Document RH', project: 'Projet', journal: 'Journal' }[type] || type;
}

function activityActionLabel(action: string): string {
  return { create: 'Cree', update: 'Modifie', delete: 'Supprime' }[action] || action;
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, DatePickerComponent, FocusTrapDirective, FormsModule, ResizableDialogDirective, RouterLink],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.css',
})
export class DashboardComponent {
  protected readonly reminderTabs = REMINDER_TABS;
  protected readonly data = computed(() => this.store.data());
  protected readonly loading = computed(() => this.store.loading());
  protected readonly now = signal(Date.now());
  protected readonly reminderTab = signal<DashboardReminderTab>('today');
  protected readonly reminderDialog = signal(false);
  protected readonly recentExpanded = signal(false);
  protected reminderDraft: ReminderDraft = emptyReminderDraft();

  protected readonly userName = computed(() => this.data()?.settings.userName?.trim() || 'Utilisateur');
  protected readonly siteName = computed(() => this.data()?.settings.siteName?.trim() || 'Workspace');
  protected readonly priorities = computed(() => this.data()?.settings.todoPriorities ?? []);
  protected readonly activeProjects = computed(() => (this.data()?.projects ?? []).filter((project) => project['archived'] !== true));
  protected readonly reminderBuckets = computed(() => dashboardReminderBuckets(this.data()?.todos ?? [], this.now()));
  protected readonly visibleReminders = computed(() => this.reminderBuckets()[this.reminderTab()]);
  protected readonly activeReminderCount = computed(() => {
    const buckets = this.reminderBuckets();
    return buckets.today.length + buckets.overdue.length + buckets.pinned.length;
  });
  protected readonly healthStats = computed(() => {
    const data = this.data();
    return data ? buildHealthStats(data, this.now()) : { activeTodosWithoutProject: 0, projectsWithoutCategory: 0, waitingInfoTodos: 0, staleProjects: 0, taglessContent: 0 };
  });
  protected readonly healthCards = computed<HealthCard[]>(() => {
    const stats = this.healthStats();
    const cards: HealthCard[] = [
      { id: 'inbox', count: stats.activeTodosWithoutProject, label: 'taches sans projet', hint: "Traite l'inbox avant qu'elle grossisse.", tone: stats.activeTodosWithoutProject ? 'warn' : 'ok', path: ['/todos'], queryParams: { project: 'none' } },
      { id: 'categories', count: stats.projectsWithoutCategory, label: 'projets sans categorie', hint: 'Ajoute une categorie pour fiabiliser le classement.', tone: stats.projectsWithoutCategory ? 'warn' : 'ok', path: ['/projects'], queryParams: {} },
      { id: 'waiting', count: stats.waitingInfoTodos, label: "taches en attente d'info", hint: "Relance ou note l'information manquante.", tone: stats.waitingInfoTodos ? 'warn' : 'ok', path: ['/todos'], queryParams: { status: 'waitinginfo' } },
      { id: 'stale', count: stats.staleProjects, label: 'projets dormants (> 21 j)', hint: "Verifie s'ils sont encore actifs ou a archiver.", tone: stats.staleProjects ? 'warn' : 'ok', path: ['/projects'], queryParams: {} },
      { id: 'tags', count: stats.taglessContent, label: 'contenus sans tag', hint: 'Ajoute quelques tags transverses pour accelerer la recherche.', tone: stats.taglessContent ? 'warn' : 'ok', path: ['/snippets'], queryParams: {} },
    ];
    return cards;
  });
  protected readonly reviewItems = computed(() => buildReviewItems(this.healthStats()));
  protected readonly reviewDone = computed(() => this.data()?.settings.weeklyReview?.lastCompletedWeek === dashboardWeekKey(new Date(this.now())));
  protected readonly taskStats = computed<TaskStats>(() => {
    const data = this.data();
    const todos = data?.todos ?? [];
    const active = todos.filter((todo) => todo.status !== 'done');
    const done = todos.length - active.length;
    const weekStart = Date.parse(new Date(this.now() - 7 * 864e5).toISOString().slice(0, 10));
    const doneWeek = todos.filter((todo) => todo.status === 'done' && (todo.updatedAt || todo.createdAt || 0) >= weekStart).length;
    const overdue = this.reminderBuckets().overdue.length;
    const priorities = this.priorities().map((priority) => {
      const count = active.filter((todo) => todo.priorityId === priority.id).length;
      return { ...priority, count, percent: active.length ? Math.round((count / active.length) * 100) : 0 };
    }).filter((priority) => priority.count > 0);
    return { total: todos.length, done, doneWeek, overdue, active: active.length, progress: todos.length ? Math.round((done / todos.length) * 100) : 0, priorities };
  });
  protected readonly heroStats = computed(() => {
    const buckets = this.reminderBuckets();
    const stats: Array<{ count: number; label: string; tone: '' | 'danger' | 'accent' }> = [];
    if (buckets.overdue.length) stats.push({ count: buckets.overdue.length, label: 'en retard', tone: 'danger' });
    if (buckets.today.length) stats.push({ count: buckets.today.length, label: "pour aujourd'hui", tone: 'accent' });
    stats.push({ count: this.activeProjects().length, label: this.activeProjects().length > 1 ? 'projets actifs' : 'projet actif', tone: '' });
    const journalCount = this.data()?.journal.length ?? 0;
    if (journalCount) stats.push({ count: journalCount, label: 'entrees journal', tone: '' });
    return stats;
  });
  protected readonly shortcuts = computed(() => {
    const data = this.data();
    const overdue = this.reminderBuckets().overdue.length;
    const today = this.reminderBuckets().today.length;
    const activeTodos = (data?.todos ?? []).filter((todo) => todo.status !== 'done').length;
    return SHORTCUTS.map((shortcut) => {
      let badge: number | string | null = null;
      if (shortcut.name === 'Projets' && this.activeProjects().length) badge = this.activeProjects().length;
      if (shortcut.name === 'Taches') badge = overdue ? `${overdue} retard` : today ? `${today} auj.` : activeTodos || null;
      if (shortcut.name === 'Snippets' && data?.snippets.length) badge = data.snippets.length;
      if (shortcut.name === 'Journal' && data?.journal.length) badge = data.journal.length;
      return { ...shortcut, badge };
    });
  });
  protected readonly recentItems = computed<RecentItem[]>(() => {
    const data = this.data();
    if (!data) return [];
    const visits: RecentVisit[] = data.recentlyVisited.map((visit: FavoriteVisit) => ({ kind: 'visit', key: `visit:${visit.type}:${visit.id}`, type: visit.type, id: visit.id, name: visit.name || visit.id, color: visit.color, ts: visit.visitedAt }));
    const activity: RecentActivity[] = data.activityLog.map((entry: ActivityLogEntry, index) => ({ kind: 'activity', key: `activity:${entry.ts}:${index}`, type: entry.type, action: entry.action, label: entry.label, icon: entry.icon, color: entry.color, ts: entry.ts }));
    return [...visits, ...activity].sort((a, b) => b.ts - a.ts).slice(0, 12);
  });
  protected readonly visibleRecentItems = computed(() => this.recentItems().slice(0, this.recentExpanded() ? 12 : 4));

  private readonly store = inject(WorkspaceStoreService);
  private readonly feedback = inject(FeedbackService);
  private readonly search = inject(GlobalSearchService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  constructor() {
    void this.store.init();
    const timer = setInterval(() => this.now.set(Date.now()), 60 * 1000);
    this.destroyRef.onDestroy(() => clearInterval(timer));
  }

  protected greeting(): string {
    return new Date(this.now()).getHours() < 18 ? 'Bonjour' : 'Bonsoir';
  }

  protected dateLabel(): string {
    const date = new Date(this.now());
    const day = date.toLocaleDateString('fr-FR', { weekday: 'long' });
    return `c'est ${day} ${date.getHours()}h${String(date.getMinutes()).padStart(2, '0')}`;
  }

  protected reviewStatus(): string {
    return this.reviewDone() ? `Revue marquee comme faite pour ${dashboardWeekKey(new Date(this.now()))}` : `Revue a faire pour ${dashboardWeekKey(new Date(this.now()))}`;
  }

  protected openSearch(): void { this.search.open(); }

  protected setReminderTab(tab: DashboardReminderTab): void { this.reminderTab.set(tab); }

  protected reminderCount(tab: DashboardReminderTab): number { return this.reminderBuckets()[tab].length; }

  protected reminderEmptyMessage(): string {
    return {
      today: "Aucune tache prevue aujourd'hui. Profitez-en !",
      overdue: 'Aucune tache en retard.',
      pinned: "Aucune tache epinglee. Cochez l'etoile sur une tache pour la fixer ici.",
      upcoming: 'Aucun rappel programme dans les 7 prochains jours.',
    }[this.reminderTab()];
  }

  protected priorityLabel(id: string | undefined): string {
    return this.priorities().find((priority) => priority.id === id)?.label || '';
  }

  protected priorityColor(id: string | undefined): string {
    return safeColor(this.priorities().find((priority) => priority.id === id)?.color, 'var(--text-3)');
  }

  protected reminderWhen(todo: Todo): { text: string; late: boolean } | null {
    if (todo.reminderAt) {
      const timestamp = Date.parse(todo.reminderAt);
      if (!Number.isNaN(timestamp)) {
        const difference = timestamp - this.now();
        if (difference < 0) return { text: `Retard · ${formatDateTime(todo.reminderAt)}`, late: true };
        if (difference < 60 * 60 * 1000) return { text: `Dans ${Math.max(1, Math.round(difference / 60000))} min`, late: false };
        return { text: `Rappel · ${formatDateTime(todo.reminderAt)}`, late: false };
      }
    }
    if (!todo.dueDate) return null;
    const today = dashboardLocalDate(new Date(this.now()));
    if (todo.dueDate < today) return { text: `En retard depuis ${formatDate(todo.dueDate)}`, late: true };
    if (todo.dueDate === today) return { text: "Aujourd'hui", late: false };
    return { text: formatDate(todo.dueDate), late: false };
  }

  protected openReminder(prefill: Partial<ReminderDraft> = {}): void {
    const priorityId = this.priorities().find((priority) => priority.id === 'important')?.id || this.priorities()[0]?.id || 'important';
    this.reminderDraft = { ...emptyReminderDraft(priorityId), when: defaultReminderValue(new Date(this.now())), ...prefill };
    this.reminderDialog.set(true);
  }

  protected closeReminder(): void { this.reminderDialog.set(false); }

  protected submitReminder(): void {
    const title = this.reminderDraft.title.trim();
    if (!title) { this.feedback.showToast('Titre requis', 'error'); return; }
    const when = this.reminderDraft.when.trim();
    if (when && Number.isNaN(Date.parse(when))) { this.feedback.showToast('Rappel invalide', 'error'); return; }
    const createdAt = this.now();
    const todo: Todo = {
      id: newId('todo'),
      title,
      description: '',
      status: 'todo',
      priorityId: this.reminderDraft.priorityId || 'important',
      context: this.reminderDraft.context.trim(),
      attachedTo: '',
      estimatedTime: 0,
      dependencies: [],
      tags: [],
      dueDate: when ? when.slice(0, 10) : '',
      reminderAt: when,
      recurrence: null,
      pinned: this.reminderDraft.pinned,
      projectId: '',
      createdAt,
      updatedAt: createdAt,
    };
    if (!this.mutate((data) => createTodo(data, todo), { type: 'todo', action: 'create', label: `Tache « ${title} »`, id: todo.id, icon: 'check' })) return;
    this.closeReminder();
    this.feedback.showToast('Rappel cree', 'success');
  }

  protected completeReminder(todo: Todo): void {
    const data = this.data();
    if (!data) return;
    const next = completeTodo(data, todo.id, dashboardLocalDate(new Date(this.now())), newId('todo'));
    if (!next) return;
    this.store.update((draft) => Object.assign(draft, trackActivity(next, { type: 'todo', action: 'update', label: `Tache « ${todo.title} »`, id: todo.id, icon: 'check' })));
    this.feedback.showToast('Tache terminee', 'success');
  }

  protected togglePin(todo: Todo): void {
    if (this.mutate((data) => updateTodo(data, todo.id, { pinned: todo.pinned !== true, updatedAt: this.now() }), { type: 'todo', action: 'update', label: `Tache « ${todo.title} »`, id: todo.id, icon: 'check' })) {
      this.feedback.showToast(todo.pinned ? 'Tache desepinglee' : 'Tache epinglee', 'success');
    }
  }

  protected openTodo(todo: Todo): void { void this.router.navigate(['/todos'], { queryParams: { focus: todo.id, kind: 'todo' } }); }

  protected completeReview(): void {
    const data = this.data();
    if (!data) return;
    const week = dashboardWeekKey(new Date(this.now()));
    this.store.update((draft) => { draft.settings.weeklyReview = { ...(draft.settings.weeklyReview || { lastCompletedWeek: '' }), lastCompletedWeek: week }; });
    this.feedback.showToast('Revue hebdomadaire marquee comme faite', 'success');
  }

  protected createWeeklyReviewTodo(): void {
    const data = this.data();
    if (!data) return;
    const week = dashboardWeekKey(new Date(this.now()));
    const items = this.reviewItems();
    const title = `Revue hebdo ${week}`;
    const todo: Todo = {
      id: newId('todo'), title, description: items.map((item) => `- ${item.title}\n  - ${item.detail}`).join('\n'), status: 'todo',
      priorityId: this.priorities().find((priority) => priority.id === 'important')?.id || this.priorities()[0]?.id || 'important', context: 'review', attachedTo: '', estimatedTime: 0,
      dependencies: [], tags: ['review', 'organisation'], dueDate: '', reminderAt: '', recurrence: null, pinned: false, projectId: '', createdAt: this.now(), updatedAt: this.now(),
    };
    if (this.mutate((current) => createTodo(current, todo), { type: 'todo', action: 'create', label: `Tache « ${title} »`, id: todo.id, icon: 'check' })) this.feedback.showToast('Tache de revue creee', 'success');
  }

  protected recentTarget(item: RecentVisit): Project | RhNode | null {
    const data = this.data();
    if (!data) return null;
    if (item.type === 'project') return data.projects.find((project) => project.id === item.id) ?? null;
    return findTreeNode(data.rh, item.id) as RhNode | null;
  }

  protected recentPath(item: RecentVisit): string[] { return item.type === 'project' ? ['/project', item.id] : ['/rh']; }

  protected recentQuery(item: RecentVisit): Record<string, string> {
    if (item.type === 'project') return {};
    const path = this.data() ? findRhPath(this.data()!.rh, item.id) : null;
    return path ? { path: path.slice(1).join(',') } : {};
  }

  protected timeAgo(timestamp: number): string { return formatTimeAgo(timestamp, this.now()); }

  protected missingRecent(): void { this.feedback.showToast('Cet element a ete supprime', 'error'); }

  protected activityActionLabel(action: string): string { return activityActionLabel(action); }
  protected activityTypeLabel(type: string): string { return activityTypeLabel(type); }

  @HostListener('document:keydown', ['$event'])
  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && this.reminderDialog()) {
      event.preventDefault();
      this.closeReminder();
      return;
    }
  }

  private mutate(mutator: (data: WorkspaceData) => WorkspaceData | null, activity?: Omit<ActivityLogEntry, 'ts'>): WorkspaceData | null {
    let changed = false;
    const updated = this.store.update((draft) => {
      const next = mutator(draft);
      if (!next) return;
      changed = true;
      Object.assign(draft, activity ? trackActivity(next, activity) : next);
    });
    return changed ? updated : null;
  }
}
