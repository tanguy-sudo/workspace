import { Injectable, computed, inject, signal } from '@angular/core';
import { WorkspaceDbService } from './workspace-db.service';
import { assertWorkspaceData } from './workspace-data-codec';
import { parseEstimatedTimeMinutes } from '../domain/workspace-domain';
import type { TodoPriority, WorkspaceData } from './workspace-data';

export type WorkspaceStoreStatus = 'idle' | 'loading' | 'ready' | 'error';

const DEFAULT_TODO_PRIORITIES: TodoPriority[] = [
  { id: 'urgent', label: 'Urgent', color: '#ff5f6e' },
  { id: 'important', label: 'Important', color: '#f0a030' },
  { id: 'normal', label: 'Normal', color: '#64b0ff' },
  { id: 'basse', label: 'Basse', color: '#3d5070' },
];

function clone<T>(value: T): T {
  return structuredClone(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function legacyPriorityId(value: unknown, priorities: unknown[]): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const normalized = value.trim().toLowerCase();
  const match = priorities.find((entry) => {
    if (!isRecord(entry)) return false;
    return entry['id'] === value || String(entry['label'] || '').trim().toLowerCase() === normalized;
  });
  if (isRecord(match) && typeof match['id'] === 'string') return match['id'];
  const aliases: Record<string, string> = {
    urgent: 'urgent',
    important: 'important',
    normal: 'normal',
    basse: 'basse',
    low: 'basse',
    faible: 'basse',
  };
  return aliases[normalized] || value;
}

function normalizeProjectNodes(nodes: unknown[]): void {
  for (const value of nodes) {
    if (!isRecord(value)) continue;
    if (value['nodeType'] === 'folder') {
      if (Array.isArray(value['children'])) normalizeProjectNodes(value['children']);
      continue;
    }
    if (value['nodeType'] === 'item' && value['title'] === undefined && typeof value['name'] === 'string') {
      value['title'] = value['name'];
    }
  }
}

/** Default only fills missing root sections; it never strips unknown fields. */
export function completeWorkspaceData(value: Record<string, unknown>): WorkspaceData {
  const data = clone(value) as Partial<WorkspaceData> & Record<string, unknown>;
  data.projects ??= [];
  data.rh ??= { id: 'root', name: 'RH', nodeType: 'folder', children: [] };
  data.todos ??= [];
  data.snippets ??= [];
  data.snippetFolders ??= { id: 'root', name: 'Snippets', nodeType: 'folder', children: [] };
  data.snippetMixedOrder ??= {};
  data.favorites ??= { id: 'root', name: 'Favoris', nodeType: 'folder', children: [] };
  data.journal ??= [];
  data.trash ??= [];
  data.recentlyVisited ??= [];
  data.activityLog ??= [];
  data.settings ??= {
    todoSavedViews: [],
    weeklyReview: { lastCompletedWeek: '' },
    todoPriorities: [],
    templates: [],
  };
  if (isRecord(data.settings)) {
    const settings = data.settings as Record<string, unknown>;
    settings['todoSavedViews'] ??= [];
    settings['weeklyReview'] ??= { lastCompletedWeek: '' };
    settings['todoPriorities'] ??= structuredClone(DEFAULT_TODO_PRIORITIES);
    settings['templates'] ??= [];
    if (Array.isArray(settings['todoSavedViews'])) {
      settings['todoSavedViews'] = settings['todoSavedViews'].map((value) => {
        if (!isRecord(value)) return value;
        const filters = isRecord(value['filters']) ? value['filters'] : {};
        return {
          ...value,
          filters: {
            ...filters,
            status: filters['status'] ?? 'all',
            priority: filters['priority'] ?? 'all',
            context: filters['context'] ?? 'all',
            project: filters['project'] ?? 'all',
            due: filters['due'] ?? 'all',
          },
          viewMode: value['viewMode'] ?? 'columns',
        };
      });
    }
  }
  if (Array.isArray(data.projects)) {
    for (const project of data.projects) {
      if (isRecord(project) && Array.isArray(project['children'])) normalizeProjectNodes(project['children']);
    }
  }
  const priorities = isRecord(data.settings) && Array.isArray(data.settings['todoPriorities'])
    ? data.settings['todoPriorities']
    : [];
  if (Array.isArray(data.todos)) {
    data.todos = data.todos.map((value) => {
      if (!isRecord(value)) return value;
      const priorityId = value['priorityId'] ?? legacyPriorityId(value['priority'], priorities);
      return {
        ...value,
        description: value['description'] ?? value['note'] ?? '',
        ...(value['status'] === undefined ? { status: value['done'] === true ? 'done' : 'todo' } : {}),
        ...(priorityId === undefined ? {} : { priorityId }),
        ...(value['estimatedTime'] === undefined ? {} : { estimatedTime: parseEstimatedTimeMinutes(value['estimatedTime']) }),
        dependencies: value['dependencies'] ?? [],
        tags: value['tags'] ?? [],
        recurrence: value['recurrence'] ?? null,
      };
    }) as WorkspaceData['todos'];
  }
  if (Array.isArray(data.snippets)) {
    data.snippets = data.snippets.map((value) => {
      if (!isRecord(value)) return value;
      return {
        ...value,
        title: value['title'] ?? value['name'] ?? '',
        code: value['code'] ?? value['content'] ?? '',
        language: value['language'] ?? 'plaintext',
        tags: value['tags'] ?? [],
        favorite: value['favorite'] ?? false,
        folderId: value['folderId'] === 'root' ? null : value['folderId'] ?? null,
      };
    }) as WorkspaceData['snippets'];
  }
  if (Array.isArray(data.journal)) {
    data.journal = data.journal.map((value) => {
      if (!isRecord(value)) return value;
      return {
        ...value,
        content: value['content'] ?? value['note'] ?? '',
      };
    }) as WorkspaceData['journal'];
  }
  assertWorkspaceData(data);
  return data;
}

@Injectable({ providedIn: 'root' })
export class WorkspaceStoreService {
  private readonly db = inject(WorkspaceDbService);
  private readonly dataState = signal<WorkspaceData | null>(null);
  private readonly statusState = signal<WorkspaceStoreStatus>('idle');
  private readonly errorState = signal<string | null>(null);
  private initPromise: Promise<WorkspaceData | null> | null = null;

  readonly data = this.dataState.asReadonly();
  readonly status = this.statusState.asReadonly();
  readonly error = this.errorState.asReadonly();
  readonly loading = computed(() => this.statusState() === 'loading');
  readonly ready = computed(() => this.statusState() === 'ready');
  readonly writeAccess = this.db.writeAccess;
  readonly writeAccessError = this.db.writeAccessError;

  async init(): Promise<WorkspaceData | null> {
    if (this.statusState() === 'loading' && this.initPromise) return this.initPromise;
    if (this.statusState() === 'ready') return this.dataState();

    this.statusState.set('loading');
    this.errorState.set(null);
    this.initPromise = this.loadInitialData();
    return this.initPromise;
  }

  /** Runs one explicit mutation and persists the complete opaque root. */
  update(mutator: (draft: WorkspaceData) => void): WorkspaceData | null {
    const current = this.dataState();
    if (!current || this.statusState() !== 'ready' || !this.db.canWrite()) return null;

    const draft = clone(current);
    mutator(draft);
    assertWorkspaceData(draft);
    this.dataState.set(draft);
    this.db.setSync(draft);
    return draft;
  }

  /** Replaces the opaque root after an import has been validated. */
  replace(value: WorkspaceData): WorkspaceData | null {
    if (this.statusState() !== 'ready' || !this.db.canWrite()) return null;
    const next = clone(value);
    assertWorkspaceData(next);
    this.dataState.set(next);
    this.db.setSync(next);
    return next;
  }

  updateSettings(changes: Record<string, unknown>): WorkspaceData | null {
    return this.update((draft) => {
      draft.settings = { ...draft.settings, ...changes };
    });
  }

  async flush(): Promise<void> {
    await this.db.flush();
  }

  private async loadInitialData(): Promise<WorkspaceData | null> {
    try {
      const raw = await this.db.init();
      if (!raw) {
        if (this.db.legacyMigrationState() !== 'no-legacy-data') {
          throw new Error('Workspace data is unavailable');
        }
        const data = completeWorkspaceData({});
        this.dataState.set(data);
        this.db.setSync(data);
        this.statusState.set('ready');
        return data;
      }
      if (typeof raw !== 'object' || Array.isArray(raw)) {
        throw new Error('Workspace data is unavailable');
      }
      const data = completeWorkspaceData(raw as Record<string, unknown>);
      this.dataState.set(data);
      this.statusState.set('ready');
      return data;
    } catch {
      this.statusState.set('error');
      this.errorState.set('Workspace data could not be loaded');
      return null;
    }
  }
}
