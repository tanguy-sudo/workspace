import { CommonModule } from '@angular/common';
import { Component, HostListener, OnDestroy, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, type SafeResourceUrl, type SafeUrl } from '@angular/platform-browser';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import {
  addProjectNode,
  deleteProjectNode,
  dropProjectNode,
  findProjectNode,
  findProjectNodePath,
  findTreeNode,
  moveProjectNode,
  projectItemCount,
  projectNodeMatchesType,
  trackVisit,
  updateProjectNode,
} from '../../core/domain/workspace-domain';
import type {
  KnownProjectItemType,
  Project,
  ProjectFolder,
  ProjectItem,
  ProjectNode,
  Todo,
  WorkspaceData,
  WorkspaceFile,
} from '../../core/persistence/workspace-data';
import { FileAccessService } from '../../core/files/file-access.service';
import { PasswordVaultService, type PasswordSecret } from '../../core/security/password-vault.service';
import { WorkspaceStoreService } from '../../core/persistence/workspace-store.service';
import { FeedbackService } from '../../shared/feedback/feedback.service';
import { FocusTrapDirective } from '../../shared/a11y/focus-trap.directive';
import { MarkdownEditorComponent } from '../../shared/rendering/markdown-editor.component';
import { SafeMarkdownComponent } from '../../shared/rendering/safe-markdown.component';
import { safeUrl } from '../../shared/rendering/safe-rendering';
import { TreeDndService } from '../../shared/tree/tree-dnd.service';
import { ResizableDialogDirective } from '../../shared/dialog/resizable-dialog.directive';

const ITEM_TYPES: KnownProjectItemType[] = ['link', 'memo', 'info', 'code', 'password'];

interface ItemDraft {
  type: KnownProjectItemType;
  title: string;
  category: string;
  url: string;
  login: string;
  password: string;
  note: string;
  code: string;
  language: string;
  tags: string;
  file: WorkspaceFile | null;
}

interface ProjectDraft {
  name: string;
  color: string;
  categories: string;
}

type DialogKind = 'folder' | 'item' | 'project' | 'move';

interface DialogState {
  kind: DialogKind;
  title: string;
  nodeId?: string;
}

interface VaultDialogState {
  title: string;
  reason: string;
}

interface AttachmentPreview {
  file: WorkspaceFile;
  imageUrl: SafeUrl;
  frameUrl: SafeResourceUrl;
  kind: 'image' | 'pdf';
}

interface MoveTarget {
  id: string;
  label: string;
}

function id(): string {
  return globalThis.crypto?.randomUUID?.() ?? `project-node-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function projectColor(value: string | undefined): string {
  return /^#[0-9a-f]{6}$/i.test(value || '') ? value as string : '#64b0ff';
}

function itemType(value: string | undefined): KnownProjectItemType {
  return ITEM_TYPES.includes(value as KnownProjectItemType) ? value as KnownProjectItemType : 'memo';
}

function emptyItemDraft(): ItemDraft {
  return {
    type: 'link',
    title: '',
    category: '',
    url: '',
    login: '',
    password: '',
    note: '',
    code: '',
    language: 'javascript',
    tags: '',
    file: null,
  };
}

function dataUrlBlob(file: WorkspaceFile): Blob {
  const encoded = file.base64.split(',')[1] ?? '';
  const binary = atob(encoded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new Blob([bytes], { type: file.mime || 'application/octet-stream' });
}

function formatFileSize(bytes: number): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

@Component({
  selector: 'app-project-detail',
  standalone: true,
  imports: [CommonModule, FocusTrapDirective, FormsModule, MarkdownEditorComponent, ResizableDialogDirective, SafeMarkdownComponent],
  providers: [TreeDndService],
  templateUrl: './project-detail.component.html',
  styleUrl: './project-detail.component.css',
})
export class ProjectDetailComponent implements OnDestroy {
  protected readonly filters = [
    { id: 'all', label: 'Tout' },
    { id: 'link', label: 'Liens' },
    { id: 'memo', label: 'Mémos' },
    { id: 'info', label: 'Infos' },
    { id: 'code', label: 'Code' },
    { id: 'password', label: 'Mots de passe' },
  ] as const;
  protected readonly itemTypes = ITEM_TYPES;
  protected readonly folderStack = signal<string[]>([]);
  protected readonly activeFilter = signal<string>('all');
  protected readonly selectionMode = signal(false);
  protected readonly selectedIds = signal(new Set<string>());
  protected readonly expandedIds = signal(new Set<string>());
  protected readonly expandedNotes = signal(new Set<string>());
  protected readonly focusId = signal<string | null>(null);
  protected readonly focusHighlight = signal<string | null>(null);
  protected readonly dialog = signal<DialogState | null>(null);
  protected readonly vaultDialog = signal<VaultDialogState | null>(null);
  protected readonly vaultPassword = signal('');
  protected readonly revealedSecrets = signal(new Set<string>());
  protected readonly secrets = signal<Record<string, PasswordSecret>>({});
  protected readonly attachmentPreview = signal<AttachmentPreview | null>(null);
  protected readonly fullscreenItem = signal<ProjectItem | null>(null);
  protected folderName = '';
  protected itemDraft: ItemDraft = emptyItemDraft();
  protected projectDraft: ProjectDraft = { name: '', color: '#64b0ff', categories: '' };
  protected moveNodeId: string | null = null;
  protected moveTargetId = '';

  protected readonly projectId = computed(() => this.routeParams().get('id') ?? '');
  protected readonly project = computed(() => this.store.data()?.projects.find((candidate) => candidate.id === this.projectId()) ?? null);
  protected readonly loading = computed(() => this.store.loading());
  protected readonly ready = computed(() => this.store.ready());
  protected readonly currentFolder = computed(() => {
    const project = this.project();
    const currentId = this.folderStack().at(-1);
    if (!project || !currentId) return null;
    if (currentId === project.id) return { id: project.id, nodeType: 'folder' as const, name: project.name, children: project.children } as ProjectFolder;
    const node = findProjectNode(project, currentId);
    return node?.nodeType === 'folder' ? node : null;
  });
  protected readonly visibleNodes = computed(() => {
    const children = this.currentFolder()?.children ?? [];
    const filter = this.activeFilter();
    return children
      .filter((node) => projectNodeMatchesType(node, filter))
      .map((node, index) => ({ node, index }))
      .sort((a, b) => Number(b.node.pinned === true) - Number(a.node.pinned === true) || a.index - b.index)
      .map(({ node }) => node);
  });
  protected readonly breadcrumbs = computed(() => {
    const project = this.project();
    if (!project) return [];
    const crumbs: Array<{ id: string; name: string }> = [{ id: project.id, name: project.name }];
    for (const nodeId of this.folderStack().slice(1)) {
      const node = findProjectNode(project, nodeId);
      if (!node || node.nodeType !== 'folder') break;
      crumbs.push({ id: node.id, name: node.name });
    }
    return crumbs;
  });
  protected readonly itemCount = computed(() => {
    const project = this.project();
    return project ? projectItemCount(project) : 0;
  });
  protected readonly linkedTodos = computed(() => {
    const data = this.store.data();
    const project = this.project();
    if (!data || !project) return [];
    const priorityOrder = new Map((data.settings.todoPriorities ?? []).map((priority, index) => [priority.id, index]));
    return data.todos
      .filter((todo) => todo.projectId === project.id && todo.status !== 'done')
      .sort((a, b) => (priorityOrder.get(a.priorityId || '') ?? 999) - (priorityOrder.get(b.priorityId || '') ?? 999));
  });
  protected readonly projectCategories = computed(() => this.project()?.categories ?? []);
  protected readonly moveTargets = computed(() => {
    const project = this.project();
    const sourceId = this.moveNodeId;
    if (!project || !sourceId) return [];
    const source = findProjectNode(project, sourceId);
    const targets: MoveTarget[] = [{ id: project.id, label: project.name }];
    const walk = (nodes: readonly ProjectNode[], path: string[]): void => {
      for (const node of nodes) {
        if (node.nodeType !== 'folder' || node.id === sourceId || (source && findTreeNode(source, node.id))) continue;
        targets.push({ id: node.id, label: [...path, node.name].join(' / ') });
        walk(node.children, [...path, node.name]);
      }
    };
    walk(project.children, []);
    return targets;
  });

  private readonly store = inject(WorkspaceStoreService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly files = inject(FileAccessService);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly vault = inject(PasswordVaultService);
  private readonly feedback = inject(FeedbackService);
  private readonly dnd = inject(TreeDndService);
  private readonly routeParams = toSignal(this.route.paramMap, { initialValue: this.route.snapshot.paramMap });
  private readonly queryParams = toSignal(this.route.queryParamMap, { initialValue: this.route.snapshot.queryParamMap });
  private readonly vaultEpoch = signal(0);
  private readonly loadingSecretIds = new Set<string>();
  private focusTimer: ReturnType<typeof setTimeout> | null = null;
  private vaultUnlockResolver: ((value: boolean) => void) | null = null;
  private attachmentUrl: string | null = null;
  private visitedProjectId: string | null = null;

  constructor() {
    effect(() => {
      const project = this.project();
      const query = this.queryParams();
      if (!project) {
        if (this.ready() && this.projectId()) void this.router.navigate(['/projects']);
        return;
      }
       const focus = query.get('focus');
       const focusPath = focus ? findProjectNodePath(project, focus) : null;
       const nextFocus = focusPath ? focus : null;
       const requested = query.get('path')?.split(',').filter(Boolean) ?? (query.get('folder') ? [query.get('folder') as string] : []);
       const nextStack = focusPath?.length ? focusPath.slice(0, -1) : this.validFolderStack(project, requested);
       const previousFocus = this.focusId();
       this.folderStack.set(nextStack);
       this.focusId.set(nextFocus);
       if (nextFocus && nextFocus !== previousFocus) this.scheduleFocus(nextFocus);
       else if (!nextFocus && previousFocus) this.clearFocus();
       if (this.visitedProjectId !== project.id) {
         this.visitedProjectId = project.id;
         this.secrets.set({});
         this.revealedSecrets.set(new Set());
         this.store.update((data) => {
          const next = trackVisit(data, 'project', project.id, project.name, project.color);
          const visited = next.projects.find((candidate) => candidate.id === project.id);
          if (visited) visited.lastVisited = Date.now();
          Object.assign(data, next);
        });
      }
    });
    effect(() => {
      const project = this.project();
      this.vaultEpoch();
      if (!project) return;
      if (!this.vault.isUnlocked()) {
        this.secrets.set({});
        this.revealedSecrets.set(new Set());
        return;
      }
      for (const node of this.allProjectNodes(project.children)) {
        if (node.nodeType === 'item' && node.type === 'password' && node.secretEncrypted) void this.loadSecret(node);
      }
    });
    void this.store.init();
  }

  protected currentFolderName(): string { return this.currentFolder()?.name || this.project()?.name || ''; }
  protected parentFolderName(): string { return this.breadcrumbs().at(-2)?.name || this.project()?.name || ''; }
  protected isExpanded(nodeId: string): boolean { return this.expandedIds().has(nodeId); }
  protected formatFileSize(bytes: number): string { return formatFileSize(bytes); }
  protected projectColor(value: string | undefined): string { return projectColor(value); }
  protected safeItemUrl(value: string | undefined): string | null { return safeUrl(value); }
  protected isSecretLocked(item: ProjectItem): boolean {
    this.vaultEpoch();
    if (item.secretEncrypted) return !this.vault.isUnlocked() || !this.secrets()[item.id];
    return this.vault.hasEnabledVault() && !this.vault.isUnlocked() && !!(item.login || item.password);
  }
  protected attachmentAction(file: WorkspaceFile): string { return this.previewKind(file) ? 'Aperçu' : 'Télécharger'; }
  protected priorityLabel(id: string | undefined): string { return this.store.data()?.settings.todoPriorities?.find((priority) => priority.id === id)?.label || id || ''; }
  protected isNoteLong(item: ProjectItem): boolean { return (item.note?.split('\n').length ?? 0) > 3 || (item.note?.length ?? 0) > 200; }
  protected noteContent(item: ProjectItem): string {
    if (!item.note || !this.isNoteLong(item) || this.expandedNotes().has(item.id)) return item.note || '';
    return `${item.note.split('\n').slice(0, 3).join('\n').slice(0, 200)}\n\n...`;
  }
  protected toggleNote(itemId: string): void {
    this.expandedNotes.update((current) => {
      const next = new Set(current);
      if (next.has(itemId)) next.delete(itemId); else next.add(itemId);
      return next;
    });
  }

  protected setFilter(filter: string): void { this.activeFilter.set(filter); }

  protected itemTypeLabel(type: KnownProjectItemType): string { return this.filters.find((filter) => filter.id === type)?.label || type; }

  protected navigateToBreadcrumb(index: number): void {
    this.navigateStack(this.folderStack().slice(0, index + 1));
  }

  protected goParent(): void {
    if (this.folderStack().length > 1) this.navigateStack(this.folderStack().slice(0, -1));
  }

  protected backToProjects(): void {
    const parentId = this.project()?.parentId;
    void this.router.navigate(['/projects'], { queryParams: parentId ? { parent: parentId } : {} });
  }

  protected activateNode(node: ProjectNode): void {
    if (this.selectionMode()) {
      this.toggleSelection(node.id);
      return;
    }
    if (node.nodeType === 'folder') this.navigateFolder(node.id);
  }

  protected activateFromKeyboard(event: Event, node: ProjectNode): void {
    if (event.target !== event.currentTarget) return;
    event.preventDefault();
    this.activateNode(node);
  }

  protected activateItem(item: ProjectItem, event: MouseEvent): void {
    if ((event.target as HTMLElement | null)?.closest('a,button,input')) return;
    if (this.selectionMode()) this.toggleSelection(item.id);
    else this.toggleExpanded(item.id);
  }

  protected activateItemFromKeyboard(event: Event, item: ProjectItem): void {
    event.preventDefault();
    if (this.selectionMode()) this.toggleSelection(item.id);
    else this.toggleExpanded(item.id);
  }

  protected navigateFolder(nodeId: string): void {
    const project = this.project();
    if (!project) return;
    const path = findProjectNodePath(project, nodeId);
    if (!path) return;
    this.navigateStack(path);
  }

  protected toggleExpanded(nodeId: string): void {
    this.expandedIds.update((current) => {
      const next = new Set(current);
      if (next.has(nodeId)) next.delete(nodeId); else next.add(nodeId);
      return next;
    });
  }

  protected toggleSelectionMode(): void {
    this.selectionMode.update((enabled) => !enabled);
    this.selectedIds.set(new Set());
  }

  protected toggleSelection(nodeId: string): void {
    this.selectedIds.update((current) => {
      const next = new Set(current);
      if (next.has(nodeId)) next.delete(nodeId); else next.add(nodeId);
      return next;
    });
  }

  protected togglePin(node: ProjectNode): void {
    this.mutate((data) => updateProjectNode(data, this.projectId(), node.id, { pinned: node.pinned !== true }));
  }

  protected dragStart(event: DragEvent, node: ProjectNode): void {
    this.dnd.begin(node.id, node.nodeType);
    event.dataTransfer?.setData('text/plain', node.id);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  }

  protected dragOver(event: DragEvent, target: ProjectNode): void {
    const sourceId = this.dnd.activeSource()?.id;
    const project = this.project();
    const source = sourceId && project ? findProjectNode(project, sourceId) : null;
    if (!source || source.id === target.id || (source.nodeType === 'folder' && !!findTreeNode(source, target.id))) return;
    const position = this.dnd.pointerPosition(event, event.currentTarget as HTMLElement, target.nodeType === 'folder');
    if (position === 'inside' && target.nodeType !== 'folder') return;
    event.preventDefault();
    this.dnd.setPreview(target.id, position);
  }

  protected dragLeave(targetId: string): void {
    if (this.dnd.previewPosition()?.targetId === targetId) this.dnd.clearPreview();
  }

  protected dropNode(event: DragEvent, target: ProjectNode): void {
    event.preventDefault();
    const preview = this.dnd.previewPosition();
    const source = this.dnd.activeSource();
    if (!preview || preview.targetId !== target.id || !source) { this.dragEnd(); return; }
    const moved = this.mutate((data) => dropProjectNode(data, this.projectId(), source.id, target.id, preview.position));
    this.dragEnd();
    if (moved) this.feedback.showToast('Élément déplacé', 'success');
  }

  protected dragEnd(): void { this.dnd.cancel(); }
  protected allowParentDrop(event: DragEvent): void { if (this.dnd.activeSource()) event.preventDefault(); }

  protected dropIntoParent(event: DragEvent): void {
    event.preventDefault();
    const source = this.dnd.activeSource();
    const parentId = this.folderStack().at(-2);
    if (source && parentId) {
      const moved = this.mutate((data) => moveProjectNode(data, this.projectId(), source.id, parentId));
      if (moved) this.feedback.showToast('Élément déplacé dans le dossier parent', 'success');
    }
    this.dragEnd();
  }

  protected isDrop(targetId: string, position: 'before' | 'inside' | 'after'): boolean {
    const preview = this.dnd.previewPosition();
    return preview?.targetId === targetId && preview.position === position;
  }

  protected openNewFolder(): void {
    this.folderName = '';
    this.dialog.set({ kind: 'folder', title: 'Nouveau dossier' });
  }

  protected openRenameFolder(folder: ProjectFolder): void {
    this.folderName = folder.name;
    this.dialog.set({ kind: 'folder', title: 'Renommer le dossier', nodeId: folder.id });
  }

  protected submitFolder(): void {
    const name = this.folderName.trim();
    if (!name) return;
    const active = this.dialog();
    if (!active || active.kind !== 'folder') return;
    const updated = active.nodeId
      ? this.mutate((data) => updateProjectNode(data, this.projectId(), active.nodeId as string, { name }))
      : this.mutate((data) => addProjectNode(data, this.projectId(), this.folderStack().at(-1) || this.projectId(), { id: id(), nodeType: 'folder', name, children: [], createdAt: Date.now() }));
    if (!updated) return;
    this.closeDialog();
    this.feedback.showToast(active.nodeId ? 'Dossier renommé' : 'Dossier créé', 'success');
  }

  protected openNewItem(): void {
    this.itemDraft = emptyItemDraft();
    this.dialog.set({ kind: 'item', title: 'Ajouter un item' });
  }

  protected async openItemEditor(item: ProjectItem): Promise<void> {
    let secret = this.secretFor(item);
    if (item.type === 'password' && this.isSecretLocked(item) && !secret) {
      if (!await this.requestVaultUnlock('Déverrouiller le coffre pour modifier cet item')) return;
      secret = item.secretEncrypted ? await this.loadSecret(item) : this.secretFor(item);
    }
    if (item.type === 'password' && item.secretEncrypted && !secret) {
      this.feedback.showToast('Impossible de déchiffrer cet item', 'error');
      return;
    }
    this.itemDraft = {
      type: itemType(item.type),
      title: item.title,
      category: item.category || '',
      url: item.url || '',
      login: secret?.login || item.login || '',
      password: secret?.password || item.password || '',
      note: item.note || '',
      code: item.code || '',
      language: item.language || 'javascript',
      tags: (item.tags || []).join(', '),
      file: item.file || null,
    };
    this.dialog.set({ kind: 'item', title: "Modifier l'item", nodeId: item.id });
  }

  protected async submitItem(): Promise<void> {
    const active = this.dialog();
    if (!active || active.kind !== 'item') return;
    const draft = this.itemDraft;
    const title = draft.title.trim();
    if (!title) {
      this.feedback.showToast('Titre requis', 'error');
      return;
    }
    const rawUrl = draft.type === 'link' || draft.type === 'password' ? draft.url.trim() : '';
    const url = rawUrl ? (safeUrl(rawUrl) || '') : '';
    if (rawUrl && !url) {
      this.feedback.showToast('URL non autorisée', 'error');
      return;
    }
    let login = draft.type === 'password' ? draft.login.trim() : '';
    let password = draft.type === 'password' ? draft.password : '';
    let secretEncrypted = null;
    if (draft.type === 'password' && this.vault.hasEnabledVault()) {
      if (!this.vault.isUnlocked() && !await this.requestVaultUnlock('Déverrouiller le coffre pour enregistrer cet item')) return;
      if (login || password) {
        try { secretEncrypted = await this.vault.encryptSecret({ login, password }); } catch { this.feedback.showToast('Chiffrement impossible', 'error'); return; }
      }
      login = '';
      password = '';
    }
    const nodeData = {
      nodeType: 'item' as const,
      type: draft.type,
      title,
      category: draft.category.trim(),
      url,
      login,
      password,
      secretEncrypted,
      note: draft.type === 'code' ? '' : draft.note,
      code: draft.type === 'code' ? draft.code : '',
      language: draft.type === 'code' ? draft.language.trim() || 'plaintext' : '',
      tags: [...new Set(draft.tags.split(',').map((tag) => tag.trim()).filter(Boolean))],
      file: draft.file,
    };
    if (active.nodeId) {
      this.mutate((data) => updateProjectNode(data, this.projectId(), active.nodeId as string, nodeData));
      if (secretEncrypted) this.secrets.update((current) => ({ ...current, [active.nodeId as string]: { login: draft.login.trim(), password: draft.password } }));
    } else {
      this.mutate((data) => addProjectNode(data, this.projectId(), this.folderStack().at(-1) || this.projectId(), { id: id(), ...nodeData, createdAt: Date.now() }));
    }
    this.closeDialog();
    this.feedback.showToast(active.nodeId ? 'Item mis à jour' : 'Item ajouté', 'success');
  }

  protected async selectFile(event: Event): Promise<void> {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      this.itemDraft = { ...this.itemDraft, file: await this.files.readAttachment(file) };
    } catch {
      this.feedback.showToast('Pièce jointe invalide ou trop volumineuse', 'error');
    }
  }

  protected openProjectEditor(): void {
    const project = this.project();
    if (!project) return;
    this.projectDraft = { name: project.name, color: projectColor(project.color), categories: (project.categories ?? []).join(', ') };
    this.dialog.set({ kind: 'project', title: 'Modifier le projet' });
  }

  protected submitProject(): void {
    const name = this.projectDraft.name.trim();
    if (!name) return;
    const color = projectColor(this.projectDraft.color);
    const categories = [...new Set(this.projectDraft.categories.split(',').map((category) => category.trim()).filter(Boolean))];
    const updated = this.mutate((data) => {
      const project = data.projects.find((candidate) => candidate.id === this.projectId());
      if (!project) return null;
      const result = structuredClone(data);
      const target = result.projects.find((candidate) => candidate.id === this.projectId());
      if (!target) return null;
      target.name = name;
      target.color = color;
      target.categories = categories;
      return result;
    });
    if (!updated) return;
    this.closeDialog();
    this.feedback.showToast('Projet mis à jour', 'success');
  }

  protected openMoveDialog(node: ProjectNode): void {
    this.moveNodeId = node.id;
    const path = this.project() ? findProjectNodePath(this.project() as Project, node.id) : null;
    this.moveTargetId = path?.at(-2) || this.projectId();
    this.dialog.set({ kind: 'move', title: node.nodeType === 'folder' ? 'Déplacer le dossier' : "Déplacer l'item", nodeId: node.id });
  }

  protected submitMove(): void {
    const active = this.dialog();
    if (!active?.nodeId || !this.moveTargetId) return;
    const sourcePath = this.project() ? findProjectNodePath(this.project() as Project, active.nodeId) : null;
    if (sourcePath?.at(-2) === this.moveTargetId) { this.closeDialog(); return; }
    const moved = this.mutate((data) => moveProjectNode(data, this.projectId(), active.nodeId as string, this.moveTargetId));
    if (moved) this.feedback.showToast('Élément déplacé', 'success');
    this.closeDialog();
  }

  protected async removeNode(node: ProjectNode): Promise<void> {
    const accepted = await this.feedback.confirm({
      title: `Supprimer ${node.nodeType === 'folder' ? 'le dossier' : "l'item"} « ${node.nodeType === 'folder' ? node.name : node.title} » ?`,
      message: 'Cet élément et son contenu seront déplacés dans la corbeille.',
      confirmLabel: 'Supprimer',
      destructive: true,
    });
    if (!accepted) return;
    const path = this.project() ? findProjectNodePath(this.project() as Project, node.id) : null;
    const deleted = this.mutate((data) => deleteProjectNode(data, this.projectId(), node.id));
    if (!deleted) return;
    if (path) {
      const stack = this.folderStack();
      const index = stack.indexOf(node.id);
      if (index >= 0) this.navigateStack(stack.slice(0, Math.max(1, index)));
    }
    this.selectedIds.update((current) => { const next = new Set(current); next.delete(node.id); return next; });
    this.feedback.showToast('Élément déplacé dans la corbeille', 'success');
  }

  protected async deleteSelected(): Promise<void> {
    const ids = [...this.selectedIds()];
    if (!ids.length) return;
    const accepted = await this.feedback.confirm({ title: `Supprimer ${ids.length} élément${ids.length > 1 ? 's' : ''} ?`, message: 'Les éléments seront déplacés dans la corbeille.', confirmLabel: 'Supprimer', destructive: true });
    if (!accepted) return;
    for (const nodeId of ids) this.mutate((data) => deleteProjectNode(data, this.projectId(), nodeId));
    this.selectedIds.set(new Set());
    this.selectionMode.set(false);
    this.feedback.showToast('Éléments déplacés dans la corbeille', 'success');
  }

  protected secretFor(item: ProjectItem): PasswordSecret | null {
    this.vaultEpoch();
    if (!item.secretEncrypted) {
      if (this.vault.hasEnabledVault() && !this.vault.isUnlocked()) return null;
      return item.login || item.password ? { login: item.login || '', password: item.password || '' } : null;
    }
    if (!this.vault.isUnlocked()) return null;
    return this.secrets()[item.id] || null;
  }

  protected async unlockAndLoad(item: ProjectItem): Promise<void> {
    if (!await this.requestVaultUnlock('Déverrouiller cet item sécurisé')) return;
    await this.loadSecret(item);
  }

  protected toggleSecret(itemId: string): void {
    this.revealedSecrets.update((current) => {
      const next = new Set(current);
      if (next.has(itemId)) next.delete(itemId); else next.add(itemId);
      return next;
    });
  }

  protected async openFullscreen(item: ProjectItem): Promise<void> {
    if (item.type === 'password' && this.isSecretLocked(item) && !this.secretFor(item)) {
      if (!await this.requestVaultUnlock('Déverrouiller cet item sécurisé')) return;
      if (item.secretEncrypted && !await this.loadSecret(item)) return;
    }
    this.fullscreenItem.set(item);
  }

  protected closeFullscreen(): void { this.fullscreenItem.set(null); }

  protected async copyItem(item: ProjectItem): Promise<void> {
    const secret = item.type === 'password' ? this.secretFor(item) : null;
    const value = item.type === 'code' ? item.code || '' : secret ? `${secret.login}\n${secret.password}` : item.note || item.title;
    await this.copyText(value, 'Élément copié');
  }

  protected async copyText(value: string, message: string): Promise<void> {
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(value);
      else {
        const textarea = document.createElement('textarea');
        textarea.value = value;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        try {
          document.body.appendChild(textarea);
          textarea.select();
          if (!document.execCommand('copy')) throw new Error('copy-failed');
        } finally {
          textarea.remove();
        }
      }
      this.feedback.showToast(message, 'success');
    } catch {
      this.feedback.showToast('Copie impossible', 'error');
    }
  }

  protected openWikiLink(title: string): void {
    const project = this.project();
    const target = project && this.allProjectNodes(project.children).find((node) => node.nodeType === 'item' && node.title.toLowerCase() === title.toLowerCase());
    if (!project || !target) { this.feedback.showToast(`Lien introuvable : ${title}`, 'info'); return; }
    const path = findProjectNodePath(project, target.id);
    if (path) this.navigateStack(path.slice(0, -1), target.id, 'item');
  }

  protected openTodo(_todo: Todo): void {
    void this.router.navigate(['/todos'], { queryParams: { project: this.projectId() } });
  }

  protected openAttachment(file: WorkspaceFile): void {
    try {
      const blob = dataUrlBlob(file);
      const kind = this.previewKind(file);
      const isImage = kind === 'image';
      const isPdf = kind === 'pdf';
      if (isImage || isPdf) {
        this.closeAttachmentPreview();
        const url = this.files.createObjectUrl(blob);
        this.attachmentUrl = url;
        this.attachmentPreview.set({
          file,
          imageUrl: this.sanitizer.bypassSecurityTrustUrl(url),
          frameUrl: this.sanitizer.bypassSecurityTrustResourceUrl(url),
          kind: isImage ? 'image' : 'pdf',
        });
        return;
      }
      void this.files.saveBlob(blob, file.name, false).then((result) => { if (!result.saved && !result.cancelled) this.feedback.showToast('Téléchargement impossible', 'error'); });
    } catch {
      this.feedback.showToast('Pièce jointe illisible', 'error');
    }
  }

  protected closeAttachmentPreview(): void {
    if (this.attachmentUrl) this.files.revokeObjectUrl(this.attachmentUrl);
    this.attachmentUrl = null;
    this.attachmentPreview.set(null);
  }

  private previewKind(file: WorkspaceFile): 'image' | 'pdf' | null {
    const mime = file.mime.toLowerCase().split(';', 1)[0];
    const signature = file.base64.slice(file.base64.indexOf(',') + 1, file.base64.indexOf(',') + 12);
    if (mime === 'image/png' && signature.startsWith('iVBORw0KGgo')) return 'image';
    if (mime === 'image/gif' && signature.startsWith('R0lGOD')) return 'image';
    if (mime === 'image/jpeg' && signature.startsWith('/9j/')) return 'image';
    if (mime === 'image/webp' && signature.startsWith('UklGR')) return 'image';
    if (mime === 'application/pdf' && signature.startsWith('JVBERi0')) return 'pdf';
    return null;
  }

  protected dialogType(): DialogKind | null { return this.dialog()?.kind || null; }

  protected closeDialog(): void {
    this.dialog.set(null);
    this.moveNodeId = null;
    this.moveTargetId = '';
  }

  protected setVaultPassword(event: Event): void { this.vaultPassword.set((event.target as HTMLInputElement).value); }

  protected cancelVaultUnlock(): void {
    this.vaultDialog.set(null);
    this.vaultPassword.set('');
    this.vaultUnlockResolver?.(false);
    this.vaultUnlockResolver = null;
  }

  protected async submitVaultUnlock(): Promise<void> {
    const password = this.vaultPassword();
    if (!password) return;
    try {
      await this.vault.unlock(password);
      this.vaultDialog.set(null);
      this.vaultPassword.set('');
      this.vaultEpoch.update((value) => value + 1);
      this.vaultUnlockResolver?.(true);
      this.vaultUnlockResolver = null;
      this.feedback.showToast('Coffre déverrouillé', 'success');
    } catch {
      this.feedback.showToast('Mot de passe maître invalide', 'error');
    }
  }

  @HostListener('document:keydown', ['$event'])
  protected onKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return;
    if (this.vaultDialog()) { event.preventDefault(); this.cancelVaultUnlock(); return; }
    if (this.dialog()) { event.preventDefault(); this.closeDialog(); return; }
    if (this.attachmentPreview()) { event.preventDefault(); this.closeAttachmentPreview(); return; }
    if (this.fullscreenItem()) { event.preventDefault(); this.closeFullscreen(); }
  }

  ngOnDestroy(): void {
    if (this.focusTimer) clearTimeout(this.focusTimer);
    this.closeAttachmentPreview();
    this.vaultUnlockResolver?.(false);
  }

  private navigateStack(stack: string[], focus: string | null = null, kind: string | null = null): void {
    const project = this.project();
    if (!project) return;
    const valid = this.validFolderStack(project, stack.slice(1));
    this.folderStack.set(valid);
    this.focusId.set(focus);
    if (focus) this.scheduleFocus(focus);
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { path: valid.slice(1).join(',') || null, folder: null, focus, kind },
    });
  }

  private validFolderStack(project: Project, requested: string[]): string[] {
    const stack = [project.id];
    let current: ProjectFolder | null = { id: project.id, nodeType: 'folder', name: project.name, children: project.children };
    for (const nodeId of requested) {
      const node: ProjectNode | null = current?.children.find((candidate) => candidate.id === nodeId) ?? null;
      if (!node || node.nodeType !== 'folder') break;
      stack.push(node.id);
      current = node;
    }
    return stack;
  }

  private mutate(mutator: (data: WorkspaceData) => WorkspaceData | null): WorkspaceData | null {
    let changed = false;
    const updated = this.store.update((draft) => {
      const next = mutator(draft);
      if (!next) return;
      changed = true;
      Object.assign(draft, next);
    });
    return changed ? updated : null;
  }

  private allProjectNodes(nodes: readonly ProjectNode[]): ProjectNode[] {
    const result: ProjectNode[] = [];
    for (const node of nodes) {
      result.push(node);
      if (node.nodeType === 'folder') result.push(...this.allProjectNodes(node.children));
    }
    return result;
  }

  private scheduleFocus(nodeId: string): void {
    this.clearFocus();
    this.focusHighlight.set(nodeId);
    this.focusTimer = setTimeout(() => {
      this.focusTimer = null;
      const target = Array.from(document.querySelectorAll<HTMLElement>('[data-project-node-id]'))
        .find((element) => element.dataset['projectNodeId'] === nodeId);
      target?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
      this.focusTimer = setTimeout(() => this.focusHighlight.set(null), 1600);
    }, 0);
  }

  private clearFocus(): void {
    if (this.focusTimer) clearTimeout(this.focusTimer);
    this.focusTimer = null;
    this.focusHighlight.set(null);
  }

  private async loadSecret(item: ProjectItem): Promise<PasswordSecret | null> {
    const projectId = this.projectId();
    if (!item.secretEncrypted || !projectId || this.loadingSecretIds.has(item.id)) return this.secretFor(item);
    if (!this.vault.isUnlocked()) return null;
    this.loadingSecretIds.add(item.id);
    try {
      const secret = await this.vault.readSecret(projectId, item.id);
      this.secrets.update((current) => ({ ...current, [item.id]: secret }));
      return secret;
    } catch {
      return null;
    } finally {
      this.loadingSecretIds.delete(item.id);
    }
  }

  private requestVaultUnlock(reason: string): Promise<boolean> {
    if (!this.vault.hasEnabledVault() || this.vault.isUnlocked()) return Promise.resolve(true);
    if (this.vaultUnlockResolver) return Promise.resolve(false);
    this.vaultPassword.set('');
    this.vaultDialog.set({ title: 'Déverrouiller le coffre', reason });
    return new Promise((resolve) => { this.vaultUnlockResolver = resolve; });
  }
}
