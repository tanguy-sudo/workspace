/**
 * Persisted Workspace shapes shared by legacy-compatible Angular services.
 *
 * Index signatures are intentional: old and future clients may add fields
 * that this increment does not understand, but must not delete.
 */

export interface UnknownFields {
  [key: string]: unknown;
}

export type KnownProjectItemType = 'link' | 'memo' | 'info' | 'code' | 'password';
export type KnownTodoStatus = 'todo' | 'waitinginfo' | 'inprogress' | 'done';

export interface WorkspaceFile extends UnknownFields {
  name: string;
  mime: string;
  size: number;
  base64: string;
}

export interface EncryptedPayload extends UnknownFields {
  iv: string;
  cipher: string;
}

export interface ProjectFolder extends UnknownFields {
  id: string;
  nodeType: 'folder';
  name: string;
  children: ProjectNode[];
  pinned?: boolean;
  createdAt?: number;
}

export interface ProjectItem extends UnknownFields {
  id: string;
  nodeType: 'item';
  type: string;
  title: string;
  category?: string;
  url?: string;
  login?: string;
  password?: string;
  secretEncrypted?: EncryptedPayload | null;
  note?: string;
  code?: string;
  language?: string;
  tags?: string[];
  file?: WorkspaceFile | null;
  pinned?: boolean;
  createdAt?: number;
}

export type ProjectNode = ProjectFolder | ProjectItem;

export interface Project extends UnknownFields {
  id: string;
  name: string;
  color?: string;
  favorite?: boolean;
  lockToChildren?: boolean;
  parentId: string | null;
  categories: string[];
  children: ProjectNode[];
  createdAt?: number;
  lastVisited?: number;
}

export interface RhFolder extends UnknownFields {
  id: string;
  nodeType: 'folder';
  name: string;
  children: RhNode[];
  pinned?: boolean;
  createdAt?: number;
}

export interface RhDocument extends UnknownFields {
  id: string;
  nodeType: 'document';
  title: string;
  url?: string;
  date?: string;
  note?: string;
  tags?: string[];
  file?: WorkspaceFile | null;
  pinned?: boolean;
  createdAt?: number;
}

export type RhNode = RhFolder | RhDocument;

export interface SnippetFolder extends UnknownFields {
  id: string;
  nodeType: 'folder';
  name: string;
  children: SnippetFolder[];
  createdAt?: number;
}

export interface Snippet extends UnknownFields {
  id: string;
  title: string;
  code: string;
  language: string;
  tags: string[];
  favorite: boolean;
  folderId: string | null;
  createdAt?: number;
}

export interface FavoriteFolder extends UnknownFields {
  id: string;
  nodeType: 'folder';
  name: string;
  children: FavoriteNode[];
  createdAt?: number;
}

export interface FavoriteLink extends UnknownFields {
  id: string;
  nodeType: 'link';
  name: string;
  url: string;
}

export type FavoriteNode = FavoriteFolder | FavoriteLink;

export interface TodoDailyRecurrence extends UnknownFields {
  type: 'daily';
}

export interface TodoWeeklyRecurrence extends UnknownFields {
  type: 'weekly';
  weeklyDays: number[];
}

export interface TodoMonthlyRecurrence extends UnknownFields {
  type: 'monthly_nth_weekday';
  nth: 1 | 2 | 3 | 4 | -1;
  weekday: number;
}

export type TodoRecurrence =
  | TodoDailyRecurrence
  | TodoWeeklyRecurrence
  | TodoMonthlyRecurrence;

export interface Todo extends UnknownFields {
  id: string;
  title: string;
  description?: string;
  note?: string;
  status: string;
  priorityId?: string;
  priority?: string;
  context?: string;
  attachedTo?: string;
  estimatedTime?: number;
  dependencies: string[];
  tags: string[];
  dueDate?: string;
  reminderAt?: string;
  recurrence: TodoRecurrence | null;
  pinned?: boolean;
  projectId?: string;
  createdAt?: number;
  updatedAt?: number;
}

export interface FavoriteVisit extends UnknownFields {
  type: string;
  id: string;
  name?: string;
  color?: string;
  visitedAt: number;
}

export interface JournalEntry extends UnknownFields {
  id: string;
  title?: string;
  content: string;
  mood?: string;
  tags?: string[];
  createdAt?: number;
  updatedAt?: number;
}

export interface TrashEntry extends UnknownFields {
  id: string;
  _trashType: string;
  _deletedAt: number;
}

export interface ActivityLogEntry extends UnknownFields {
  type: string;
  action: string;
  label: string;
  id?: string;
  projectId?: string;
  icon?: string;
  color?: string;
  ts: number;
}

export interface TodoSavedView extends UnknownFields {
  id: string;
  name: string;
  filters: TodoViewFilters;
  viewMode?: string;
  createdAt?: number;
  updatedAt?: number;
}

export interface TodoViewFilters extends UnknownFields {
  status: string;
  priority: string;
  context: string;
  project: string;
  due: string;
}

export interface WeeklyReviewState extends UnknownFields {
  lastCompletedWeek: string;
}

export interface TodoPriority extends UnknownFields {
  id: string;
  label: string;
  color: string;
}

export interface WorkspaceTemplate extends UnknownFields {
  id: string;
  name: string;
  type: string;
}

export interface SecretVaultConfig extends UnknownFields {
  enabled: boolean;
  salt: string;
  iterations: number;
  verifier: EncryptedPayload;
}

export interface WorkspaceSettings extends UnknownFields {
  theme?: string;
  userName?: string;
  siteName?: string;
  backupFolder?: string;
  autoBackupFrequencyHours?: number;
  todoSavedViews: TodoSavedView[];
  weeklyReview: WeeklyReviewState;
  todoPriorities: TodoPriority[];
  templates: WorkspaceTemplate[];
  secretVault?: SecretVaultConfig;
}

export interface WorkspaceData extends UnknownFields {
  projects: Project[];
  rh: RhFolder;
  todos: Todo[];
  snippets: Snippet[];
  snippetFolders: SnippetFolder;
  snippetMixedOrder: Record<string, string[]>;
  favorites: FavoriteFolder;
  journal: JournalEntry[];
  trash: TrashEntry[];
  recentlyVisited: FavoriteVisit[];
  activityLog: ActivityLogEntry[];
  settings: WorkspaceSettings;
}

export interface WorkspaceExportMeta extends UnknownFields {
  app: string;
  version: number;
  exportedAt: string;
  auto?: boolean;
}

export interface WorkspaceExport extends UnknownFields {
  _meta: WorkspaceExportMeta;
  data: WorkspaceData;
}

export const WORKSPACE_DB_NAME = 'workspace';
export const WORKSPACE_DB_VERSION = 1;
export const WORKSPACE_KV_STORE = 'kv';
export const WORKSPACE_DATA_KEY = 'data';
export const BACKUP_DIR_HANDLE_KEY = 'backupDirHandle';
export const LEGACY_STORAGE_KEY = 'workspace_data';
export const WORKSPACE_EXPORT_VERSION = 6;

export const REQUIRED_WORKSPACE_SECTIONS = [
  'projects',
  'rh',
  'todos',
  'snippets',
  'snippetFolders',
  'snippetMixedOrder',
  'favorites',
  'journal',
  'trash',
  'recentlyVisited',
  'activityLog',
  'settings',
] as const;

export type WorkspaceSection = (typeof REQUIRED_WORKSPACE_SECTIONS)[number];
