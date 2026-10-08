import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Component, DestroyRef, HostListener, computed, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import {
  addSnippet,
  deleteSnippet,
  deleteSnippetFolder,
  getSnippetMixedEntries,
  moveSnippetIntoFolder,
  parseSnippetImport,
  reorderSnippetMixed,
  updateSnippet,
} from '../../core/domain/workspace-domain';
import type { Snippet, SnippetFolder, WorkspaceData } from '../../core/persistence/workspace-data';
import { StoragePreferencesService, STORAGE_KEYS } from '../../core/persistence/storage-preferences.service';
import type { TreeDropEvent } from '../../shared/tree/tree-dnd.service';
import { TreeDndService } from '../../shared/tree/tree-dnd.service';
import { WorkspaceStoreService } from '../../core/persistence/workspace-store.service';
import { FeedbackService } from '../../shared/feedback/feedback.service';
import { FocusTrapDirective } from '../../shared/a11y/focus-trap.directive';
import { MarkdownEditorComponent } from '../../shared/rendering/markdown-editor.component';
import { ResizableDialogDirective } from '../../shared/dialog/resizable-dialog.directive';
import { SafeMarkdownComponent } from '../../shared/rendering/safe-markdown.component';
import { SandboxPreviewComponent } from '../../shared/rendering/sandbox-preview.component';

function newId(): string { return globalThis.crypto?.randomUUID?.() ?? `snippet-${Date.now()}-${Math.random().toString(36).slice(2)}`; }
const SNIPPET_LANGUAGES = ['javascript', 'typescript', 'python', 'markdown', 'bash', 'sql', 'html', 'css', 'json', 'yaml', 'dockerfile', 'rust', 'go', 'java', 'php', 'ruby', 'plaintext'];

type CreateDialog = 'folder' | 'snippet' | null;

interface SnippetDraft {
  title: string;
  code: string;
  language: string;
  tags: string;
  folderId: string;
}

function emptySnippetDraft(folderId = 'root'): SnippetDraft { return { title: '', code: '', language: 'plaintext', tags: '', folderId }; }

function snippetFolderOptions(root: SnippetFolder): Array<{ id: string; name: string; depth: number }> {
  const options = [{ id: 'root', name: root.name, depth: 0 }];
  const walk = (folders: SnippetFolder[], depth: number): void => {
    for (const folder of folders) {
      options.push({ id: folder.id, name: folder.name, depth });
      walk(folder.children ?? [], depth + 1);
    }
  };
  walk(root.children ?? [], 1);
  return options;
}

function folderPath(root: SnippetFolder, id: string | null): string[] {
  if (!id || id === 'root') return ['root'];
  const walk = (folder: SnippetFolder, path: string[]): string[] | null => {
    if (folder.id === id) return path;
    for (const child of folder.children ?? []) { const found = walk(child, [...path, child.id]); if (found) return found; }
    return null;
  };
  return walk(root, ['root']) ?? ['root'];
}

@Component({
  selector: 'app-snippets',
  standalone: true,
  imports: [CommonModule, FocusTrapDirective, FormsModule, MarkdownEditorComponent, ResizableDialogDirective, SafeMarkdownComponent, SandboxPreviewComponent],
  providers: [TreeDndService],
  templateUrl: './snippets.component.html',
  styleUrl: './snippets.component.css',
})
export class SnippetsComponent {
  protected readonly search = signal('');
  protected readonly language = signal('all');
  protected readonly onlyFavorites = signal(false);
  protected readonly path = signal(['root']);
  protected readonly selectedId = signal<string | null>(null);
  protected readonly collapsedIds = signal<string[]>([]);
  protected readonly expandedIds = signal<string[]>([]);
  protected readonly selectionMode = signal(false);
  protected readonly selectedIds = signal(new Set<string>());
  protected readonly createDialog = signal<CreateDialog>(null);
  protected readonly snippetLanguages = SNIPPET_LANGUAGES;
  protected folderName = '';
  protected snippetDraft: SnippetDraft = emptySnippetDraft();
  protected readonly data = computed(() => this.store.data());
  protected readonly root = computed(() => this.data()?.snippetFolders ?? { id: 'root', nodeType: 'folder', name: 'Snippets', children: [] } as SnippetFolder);
  protected readonly currentFolderId = computed(() => this.path().at(-1) === 'root' ? null : this.path().at(-1) ?? null);
  protected readonly snippetFolderOptions = computed(() => snippetFolderOptions(this.root()));
  protected readonly languages = computed(() => [...new Set(this.data()?.snippets.map((snippet) => snippet.language).filter(Boolean) ?? [])].sort());
  protected readonly folderNodes = computed(() => this.currentFolderId() ? this.currentFolder().children : this.root().children);
  protected readonly currentEntries = computed(() => getSnippetMixedEntries(this.data() ?? emptyData(), this.currentFolderId()));
  protected readonly filteredEntries = computed(() => this.currentEntries().filter((entry) => entry.type === 'folder' || this.matches(entry.item as Snippet)));
  protected readonly currentFolder = computed(() => folderAt(this.root(), this.currentFolderId()));
  protected readonly breadcrumbs = computed(() => this.path().map((id) => folderAt(this.root(), id)).filter(Boolean));
  private readonly store = inject(WorkspaceStoreService);
  private readonly route = inject(ActivatedRoute);
  private readonly params = toSignal(this.route.queryParamMap, { initialValue: this.route.snapshot.queryParamMap });
  private readonly router = inject(Router);
  private readonly feedback = inject(FeedbackService);
  private readonly preferences = inject(StoragePreferencesService);
  private readonly dnd = inject(TreeDndService);
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    const storedCollapsed = this.preferences.getJson<unknown>(STORAGE_KEYS.snippetsCollapsed, []);
    if (Array.isArray(storedCollapsed)) this.collapsedIds.set(storedCollapsed.filter((id): id is string => typeof id === 'string'));
    effect(() => {
      const query = this.params();
      const focus = query.get('focus');
      const folder = query.get('folder');
      const requested = query.get('path')?.split(',').filter(Boolean) ?? (folder ? [folder] : []);
      const data = this.data();
      if (!data) return;
      const target = focus ? data.snippets.find((snippet) => snippet.id === focus) : null;
      const nextPath = target ? folderPath(data.snippetFolders, target.folderId) : ['root', ...requested].filter((id) => Boolean(folderAt(data.snippetFolders, id)));
      this.path.set(nextPath.length ? nextPath : ['root']);
      this.selectedId.set(focus ?? null);
      this.expandedIds.set(nextPath.slice(1));
    });
    void this.store.init();
    this.destroyRef.onDestroy(() => undefined);
  }

  protected setSearch(event: Event): void { this.search.set((event.target as HTMLInputElement).value); }
  protected setLanguage(event: Event): void { this.language.set((event.target as HTMLSelectElement).value); }
  protected setLanguageValue(value: string): void { this.language.set(value); }
  protected toggleFavorites(): void { this.onlyFavorites.update((value) => !value); }
  protected toggleSelectionMode(): void { this.selectionMode.update((value) => !value); this.selectedIds.set(new Set()); }
  protected toggleSelection(id: string): void {
    this.selectedIds.update((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  protected activateFolderEntry(id: string, event: Event): void {
    if (this.selectionMode()) {
      event.preventDefault();
      if (!(event.target as HTMLElement | null)?.closest('input')) this.toggleSelection(id);
      return;
    }
    this.navigateFolder(id);
  }
  protected selectEntry(id: string, event: MouseEvent): void {
    if (!this.selectionMode() || (event.target as HTMLElement | null)?.closest('button, input, a')) return;
    this.toggleSelection(id);
  }
  protected toggleCollapsed(id: string): void {
    const next = this.collapsedIds().includes(id) ? this.collapsedIds().filter((value) => value !== id) : [...this.collapsedIds(), id];
    this.collapsedIds.set(next);
    this.preferences.setJson(STORAGE_KEYS.snippetsCollapsed, next);
  }
  protected activateFolder(node: import('../../core/domain/workspace-domain').TreeNode): void { this.navigateFolder(node.id); }
  protected navigateFolder(id: string): void { this.navigate(folderPath(this.root(), id)); }
  protected navigateTo(index: number): void { this.navigate(this.path().slice(0, index + 1)); }

  protected drop(event: TreeDropEvent): void {
    const source = this.currentEntries().find((entry) => entry.item.id === event.sourceId);
    const target = this.currentEntries().find((entry) => entry.item.id === event.targetId);
    if (!source || !target) return;
    const updated = this.store.update((draft) => {
      if (event.position === 'inside' && target.type === 'folder') {
        const next = moveSnippetIntoFolder(draft, event.sourceId, source.type, this.currentFolderId(), target.item.id);
        if (next) Object.assign(draft, next);
      } else {
        const next = reorderSnippetMixed(draft, this.currentFolderId(), `${source.type === 'folder' ? 'f' : 's'}:${event.sourceId}`, `${target.type === 'folder' ? 'f' : 's'}:${event.targetId}`, event.position === 'before');
        if (next) Object.assign(draft, next);
      }
    });
    if (updated) this.feedback.showToast('Ordre des snippets mis a jour', 'success');
  }

  protected isDrop(targetId: string, position: 'before' | 'inside' | 'after'): boolean { const preview = this.dnd.previewPosition(); return preview?.targetId === targetId && preview.position === position; }
  protected dragStart(event: DragEvent, sourceId: string, sourceType: 'folder' | 'snippet'): void { this.dnd.begin(sourceId, sourceType); event.dataTransfer?.setData('text/plain', sourceId); if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'; }
  protected dragOver(event: DragEvent, targetId: string, targetType: 'folder' | 'snippet'): void {
    const source = this.dnd.activeSource();
    if (!source || source.id === targetId) return;
    const position = this.dnd.pointerPosition(event, event.currentTarget as HTMLElement, targetType === 'folder');
    if (position === 'inside' && targetType !== 'folder') return;
    event.preventDefault();
    this.dnd.setPreview(targetId, position);
  }
  protected dragLeave(targetId: string): void { if (this.dnd.previewPosition()?.targetId === targetId) this.dnd.clearPreview(); }
  protected dropOn(event: DragEvent, targetId: string, targetType: 'folder' | 'snippet'): void {
    event.preventDefault();
    const preview = this.dnd.previewPosition();
    const source = this.dnd.activeSource();
    if (!preview || !source || (preview.position === 'inside' && targetType !== 'folder')) { this.dnd.cancel(); return; }
    this.drop({ sourceId: source.id, sourceType: source.type, targetId, position: preview.position });
    this.dnd.cancel();
  }
  protected dragEnd(): void { this.dnd.cancel(); }

  protected async deleteSelected(): Promise<void> {
    const ids = [...this.selectedIds()];
    if (!ids.length) return;
    const folderIds = ids.filter((id) => Boolean(findFolder(this.root(), id)));
    const snippetIds = ids.filter((id) => !folderIds.includes(id));
    const parts = [
      folderIds.length ? `${folderIds.length} dossier${folderIds.length > 1 ? 's' : ''}` : '',
      snippetIds.length ? `${snippetIds.length} snippet${snippetIds.length > 1 ? 's' : ''}` : '',
    ].filter(Boolean);
    if (!await this.feedback.confirm({ title: `Supprimer ${parts.join(' et ')} ?`, message: 'Les snippets seront déplacés dans la corbeille. Le contenu des dossiers sera remonté dans leur dossier parent.', confirmLabel: 'Supprimer', destructive: true })) return;

    let changed = false;
    this.store.update((draft) => {
      let next = draft;
      for (const id of folderIds) {
        const updated = deleteSnippetFolder(next, id);
        if (updated) { next = updated; changed = true; }
      }
      for (const id of snippetIds) {
        const updated = deleteSnippet(next, id);
        if (updated) { next = updated; changed = true; }
      }
      if (next !== draft) Object.assign(draft, next);
    });
    if (!changed) return;
    this.selectedIds.set(new Set());
    this.selectionMode.set(false);
    this.feedback.showToast('Éléments déplacés dans la corbeille', 'success');
  }

  protected createFolder(): void {
    this.folderName = '';
    this.createDialog.set('folder');
  }

  protected createSnippet(): void {
    this.snippetDraft = emptySnippetDraft(this.currentFolderId() ?? 'root');
    this.createDialog.set('snippet');
  }

  protected closeCreateDialog(): void { this.createDialog.set(null); }

  protected setFolderName(event: Event): void { this.folderName = (event.target as HTMLInputElement).value; }

  protected setSnippetDraft(field: keyof SnippetDraft, event: Event): void {
    this.snippetDraft = { ...this.snippetDraft, [field]: (event.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).value };
  }

  protected submitCreateFolder(): void {
    const name = this.folderName.trim();
    if (!name || this.createDialog() !== 'folder') return;
    const folder: SnippetFolder = { id: newId(), nodeType: 'folder', name: name.trim(), children: [], createdAt: Date.now() };
    this.store.update((draft) => { const parent = folderAt(draft.snippetFolders, this.currentFolderId()); if (parent) { parent.children.push(folder); draft.snippetMixedOrder[folderKey(this.currentFolderId())] = [...getSnippetMixedEntries(draft, this.currentFolderId()).map((entry) => entry.token), `f:${folder.id}`]; } });
    this.closeCreateDialog();
    this.feedback.showToast('Dossier cree', 'success');
  }

  protected submitCreateSnippet(): void {
    const title = this.snippetDraft.title.trim();
    if (!title || !this.snippetDraft.code || this.createDialog() !== 'snippet') return;
    const folderId = this.snippetDraft.folderId === 'root' ? null : this.snippetDraft.folderId;
    if (folderId && !findFolder(this.root(), folderId)) return;
    const snippet: Snippet = { id: newId(), title, code: this.snippetDraft.code, language: this.snippetDraft.language.trim() || 'plaintext', tags: this.snippetDraft.tags.split(',').map((tag) => tag.trim()).filter(Boolean), favorite: false, folderId };
    this.store.update((draft) => Object.assign(draft, addSnippet(draft, snippet)));
    this.closeCreateDialog();
    this.feedback.showToast('Snippet cree', 'success');
  }

  protected toggleFavorite(snippet: Snippet): void { this.store.update((draft) => { const next = updateSnippet(draft, snippet.id, { favorite: !snippet.favorite }); if (next) Object.assign(draft, next); }); }

  protected async editSnippet(snippet: Snippet): Promise<void> {
    const title = window.prompt('Titre', snippet.title);
    if (!title?.trim()) return;
    const code = window.prompt('Code', snippet.code);
    const language = window.prompt('Langage', snippet.language);
    const tags = window.prompt('Tags separes par des virgules', snippet.tags.join(', '));
    this.store.update((draft) => { const next = updateSnippet(draft, snippet.id, { title: title.trim(), code: code ?? snippet.code, language: language ?? snippet.language, tags: (tags ?? '').split(',').map((tag) => tag.trim()).filter(Boolean) }); if (next) Object.assign(draft, next); });
  }

  protected async removeSnippet(snippet: Snippet): Promise<void> {
    if (!await this.feedback.confirm({ title: `Supprimer ${snippet.title} ?`, message: 'Le snippet sera deplace dans la corbeille.', destructive: true })) return;
    this.store.update((draft) => { const next = deleteSnippet(draft, snippet.id); if (next) Object.assign(draft, next); });
  }

  protected async copy(code: string): Promise<void> {
    try {
      if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(code); this.feedback.showToast('Snippet copie', 'success'); return; }
      throw new Error('clipboard-unavailable');
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = code; textarea.style.position = 'fixed'; textarea.style.opacity = '0';
      document.body.appendChild(textarea); textarea.select();
      try { if (!document.execCommand('copy')) throw new Error('copy-failed'); this.feedback.showToast('Snippet copie', 'success'); }
      catch { this.feedback.showToast('Copie impossible', 'error'); }
      finally { textarea.remove(); }
    }
  }

  protected importFile(): void {
    const input = document.createElement('input'); input.type = 'file'; input.accept = '.json,.md,.markdown,.txt,.js,.ts,.py,.css,.html';
    input.onchange = () => { const file = input.files?.[0]; if (file) void this.importFileContent(file); };
    input.click();
  }

  protected async importFileContent(file: File): Promise<void> {
    const imported = parseSnippetImport(await file.text(), file.name, this.currentFolderId(), newId);
    if (!imported?.length) { this.feedback.showToast('Import invalide', 'error'); return; }
    this.store.update((draft) => imported.forEach((snippet) => Object.assign(draft, addSnippet(draft, snippet))));
    this.feedback.showToast(`${imported.length} snippet${imported.length > 1 ? 's' : ''} importe${imported.length > 1 ? 's' : ''}`, 'success');
  }

  @HostListener('document:keydown', ['$event'])
  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && this.createDialog()) {
      event.preventDefault();
      this.closeCreateDialog();
    }
  }

  private matches(snippet: Snippet): boolean {
    const query = this.search().trim().toLowerCase();
    return (!query || `${snippet.title} ${snippet.code} ${snippet.language} ${snippet.tags.join(' ')}`.toLowerCase().includes(query)) && (this.language() === 'all' || snippet.language === this.language()) && (!this.onlyFavorites() || snippet.favorite);
  }
  private navigate(path: string[]): void { this.path.set(path); this.selectedId.set(null); this.expandedIds.set(path.slice(1)); void this.router.navigate([], { relativeTo: this.route, queryParams: { path: path.slice(1).join(',') || null, folder: null, focus: null }, queryParamsHandling: 'merge' }); }
}

function folderKey(id: string | null): string { return id ?? 'root'; }
function folderAt(root: SnippetFolder, id: string | null): SnippetFolder { if (!id || id === 'root') return root; return findFolder(root, id) ?? root; }
function findFolder(root: SnippetFolder, id: string): SnippetFolder | null { if (root.id === id) return root; for (const child of root.children ?? []) { const found = findFolder(child, id); if (found) return found; } return null; }
function emptyData(): WorkspaceData { return { projects: [], rh: { id: 'root', name: 'RH', nodeType: 'folder', children: [] }, todos: [], snippets: [], snippetFolders: { id: 'root', name: 'Snippets', nodeType: 'folder', children: [] }, snippetMixedOrder: {}, favorites: { id: 'root', name: 'Favoris', nodeType: 'folder', children: [] }, journal: [], trash: [], recentlyVisited: [], activityLog: [], settings: { todoSavedViews: [], weeklyReview: { lastCompletedWeek: '' }, todoPriorities: [], templates: [] } }; }
