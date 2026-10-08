import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Component, DestroyRef, HostListener, computed, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import {
  addRhNode,
  deleteRhNode,
  dropTreeNode,
  findTreeNode,
  restoreFromTrash,
  updateRhNode,
} from '../../core/domain/workspace-domain';
import type { TreeDropEvent } from '../../shared/tree/tree-dnd.service';
import type { TreeNode } from '../../core/domain/workspace-domain';
import type { RhDocument, RhFolder, RhNode, WorkspaceData, WorkspaceFile } from '../../core/persistence/workspace-data';
import { WorkspaceStoreService } from '../../core/persistence/workspace-store.service';
import { FileAccessService } from '../../core/files/file-access.service';
import { FeedbackService } from '../../shared/feedback/feedback.service';
import { MarkdownEditorComponent } from '../../shared/rendering/markdown-editor.component';
import { SafeMarkdownComponent } from '../../shared/rendering/safe-markdown.component';
import { safeUrl } from '../../shared/rendering/safe-rendering';
import { TreeComponent } from '../../shared/tree/tree.component';
import { FocusTrapDirective } from '../../shared/a11y/focus-trap.directive';
import { DatePickerComponent } from '../../shared/date-picker/date-picker.component';
import { ResizableDialogDirective } from '../../shared/dialog/resizable-dialog.directive';

function nodeLabel(node: RhNode): string {
  return node.nodeType === 'folder' ? node.name : node.title;
}

function pinnedFirst(nodes: readonly RhNode[]): RhNode[] {
  return nodes
    .map((node, index) => ({ node, index }))
    .sort((a, b) => Number(b.node.pinned === true) - Number(a.node.pinned === true) || a.index - b.index)
    .map(({ node }) => node);
}

function id(): string {
  return globalThis.crypto?.randomUUID?.() ?? `rh-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function parsePath(value: string | null): string[] {
  return (value ?? '').split(',').map((part) => part.trim()).filter(Boolean);
}

function findPath(root: RhFolder, targetId: string): string[] {
  const walk = (node: RhNode, path: string[]): string[] | null => {
    if (node.id === targetId) return path;
    for (const child of node.nodeType === 'folder' ? node.children : []) {
      const found = walk(child, [...path, child.id]);
      if (found) return found;
    }
    return null;
  };
  return walk(root, ['root']) ?? ['root'];
}

function pathNode(root: RhFolder, path: string[]): RhFolder {
  let current = root;
  for (const part of path.slice(1)) {
    const next = current.children.find((node) => node.id === part);
    if (!next || next.nodeType !== 'folder') break;
    current = next;
  }
  return current;
}

interface DocumentDraft {
  title: string;
  url: string;
  date: string;
  note: string;
  tags: string;
  file: WorkspaceFile | null;
}

function emptyDocumentDraft(): DocumentDraft {
  return { title: '', url: '', date: '', note: '', tags: '', file: null };
}

@Component({
  selector: 'app-rh',
  standalone: true,
  imports: [CommonModule, DatePickerComponent, FocusTrapDirective, FormsModule, MarkdownEditorComponent, ResizableDialogDirective, SafeMarkdownComponent, TreeComponent],
  templateUrl: './rh.component.html',
  styleUrl: './rh.component.css',
})
export class RhComponent {
  protected readonly search = signal('');
  protected readonly path = signal(['root']);
  protected readonly selectedId = signal<string | null>(null);
  protected readonly selectionMode = signal(false);
  protected readonly selectedIds = signal(new Set<string>());
  protected readonly expandedIds = signal<string[]>([]);
  protected readonly createDialog = signal<'folder' | 'document' | null>(null);
  protected readonly createName = signal('');
  protected readonly editingDocumentId = signal<string | null>(null);
  protected documentDraft: DocumentDraft = emptyDocumentDraft();
  protected readonly loading = computed(() => this.store.loading());
  protected readonly root = computed(() => this.store.data()?.rh ?? { id: 'root', name: 'RH', nodeType: 'folder', children: [] } as RhFolder);
  protected readonly currentFolder = computed(() => pathNode(this.root(), this.path()));
  protected readonly currentChildren = computed(() => {
    const query = this.search().trim().toLowerCase();
    return pinnedFirst(this.currentFolder().children.filter((node) => !query || `${nodeLabel(node)} ${node.nodeType === 'document' ? `${node.note ?? ''} ${(node.tags ?? []).join(' ')}` : ''}`.toLowerCase().includes(query)));
  });
  protected readonly selectedDocument = computed(() => {
    const node = this.selectedId() ? findTreeNode(this.root(), this.selectedId()!) : null;
    return node?.nodeType === 'document' ? node as RhDocument : null;
  });
  protected readonly breadcrumbs = computed(() => this.path().map((id) => findTreeNode(this.root(), id)).filter((node): node is RhFolder => Boolean(node && node.nodeType === 'folder')));
  protected readonly documentCount = computed(() => countDocuments(this.root()));
  protected readonly deletedRh = computed(() => (this.store.data()?.trash ?? []).filter((entry) => entry['_trashType'] === 'rh'));

  private readonly store = inject(WorkspaceStoreService);
  private readonly route = inject(ActivatedRoute);
  private readonly queryParams = toSignal(this.route.queryParamMap, { initialValue: this.route.snapshot.queryParamMap });
  private readonly router = inject(Router);
  private readonly files = inject(FileAccessService);
  private readonly feedback = inject(FeedbackService);
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    effect(() => {
      const query = this.queryParams();
      const requestedPath = parsePath(query.get('path'));
      const folder = query.get('folder');
      const focus = query.get('focus');
      const root = this.root();
      const targetPath = focus ? findPath(root, focus).slice(0, -1) : requestedPath.length ? ['root', ...requestedPath] : folder ? findPath(root, folder) : ['root'];
      const validPath = pathNode(root, targetPath).id === targetPath.at(-1) ? targetPath : ['root'];
      this.path.set(validPath);
      this.selectedId.set(focus && findTreeNode(root, focus)?.nodeType === 'document' ? focus : null);
      this.expandedIds.set(validPath.slice(1));
    });
    void this.store.init();
    this.destroyRef.onDestroy(() => undefined);
  }

  protected setSearch(event: Event): void { this.search.set((event.target as HTMLInputElement).value); }

  protected activateNode(node: import('../../core/domain/workspace-domain').TreeNode): void {
    const rhNode = findTreeNode(this.root(), node.id) as RhNode | null;
    if (!rhNode) return;
    if (rhNode.nodeType === 'folder') {
      const next = [...findPath(this.root(), rhNode.id)];
      this.navigate(next);
    } else {
      this.selectedId.set(rhNode.id);
      void this.router.navigate([], { relativeTo: this.route, queryParams: { focus: rhNode.id, path: this.path().slice(1).join(',') || null }, queryParamsHandling: 'merge' });
    }
  }

  protected drop(event: TreeDropEvent): void {
    const updated = this.store.update((draft) => {
      const next = dropTreeNode(draft.rh, event.sourceId, event.targetId, event.position);
      if (next) draft.rh = next as RhFolder;
    });
    if (updated) this.feedback.showToast('Arbre RH mis a jour', 'success');
  }

  protected navigateTo(index: number): void { this.navigate(this.path().slice(0, index + 1)); }
  protected goParent(): void { if (this.path().length > 1) this.navigate(this.path().slice(0, -1)); }

  protected toggleSelectionMode(): void {
    this.selectionMode.update((enabled) => !enabled);
    this.selectedIds.set(new Set());
  }

  protected toggleSelection(id: string): void {
    this.selectedIds.update((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  protected openCreateFolder(): void {
    this.createName.set('');
    this.createDialog.set('folder');
  }

  protected openCreateDocument(): void {
    this.documentDraft = emptyDocumentDraft();
    this.editingDocumentId.set(null);
    this.createDialog.set('document');
  }

  protected closeCreateDialog(): void {
    this.createDialog.set(null);
    this.editingDocumentId.set(null);
  }

  protected setCreateName(event: Event): void {
    this.createName.set((event.target as HTMLInputElement).value);
  }

  protected async submitCreate(): Promise<void> {
    const kind = this.createDialog();
    if (!kind) return;
    if (kind === 'document') {
      const title = this.documentDraft.title.trim();
      if (!title) return;
      const changes = {
        title,
        url: this.documentDraft.url.trim(),
        date: this.documentDraft.date,
        note: this.documentDraft.note,
        tags: this.documentDraft.tags.split(',').map((tag) => tag.trim()).filter(Boolean),
        file: this.documentDraft.file,
      };
      const documentId = this.editingDocumentId();
      const updated = this.store.update((draft) => {
        const next = documentId
          ? updateRhNode(draft, documentId, changes)
          : addRhNode(draft, this.currentFolder().id, { id: id(), nodeType: 'document', ...changes, createdAt: Date.now() });
        if (next) Object.assign(draft, next);
      });
      if (updated) {
        this.closeCreateDialog();
        this.feedback.showToast(documentId ? 'Document mis a jour' : 'Document cree', 'success');
      }
      return;
    }
    const name = this.createName().trim();
    if (!name) return;
    const node: RhNode = { id: id(), nodeType: 'folder', name, children: [], createdAt: Date.now() };
    if (this.store.update((draft) => { const next = addRhNode(draft, this.currentFolder().id, node); if (next) Object.assign(draft, next); })) {
      this.closeCreateDialog();
      this.feedback.showToast('Dossier cree', 'success');
    }
  }

  protected editDocument(document: RhDocument): void {
    this.documentDraft = {
      title: document.title,
      url: document.url ?? '',
      date: document.date ?? '',
      note: document.note ?? '',
      tags: (document.tags ?? []).join(', '),
      file: document.file ?? null,
    };
    this.editingDocumentId.set(document.id);
    this.createDialog.set('document');
  }

  protected async selectDocumentFile(event: Event): Promise<void> {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      this.documentDraft = { ...this.documentDraft, file: await this.files.readAttachment(file) };
    } catch {
      this.feedback.showToast('Piece jointe invalide ou trop volumineuse', 'error');
    }
  }

  protected clearDocumentFile(): void { this.documentDraft = { ...this.documentDraft, file: null }; }

  protected togglePin(document: RhDocument): void { this.store.update((draft) => { const next = updateRhNode(draft, document.id, { pinned: !document['pinned'] }); if (next) Object.assign(draft, next); }); }

  protected toggleNodePin(node: TreeNode): void { this.store.update((draft) => { const next = updateRhNode(draft, node.id, { pinned: node['pinned'] !== true }); if (next) Object.assign(draft, next); }); }

  protected async remove(node: RhNode): Promise<void> {
    const accepted = await this.feedback.confirm({ title: `Supprimer ${nodeLabel(node)} ?`, message: 'L’element sera deplace dans la corbeille.', destructive: true });
    if (!accepted) return;
    this.store.update((draft) => { const next = deleteRhNode(draft, node.id); if (next) Object.assign(draft, next); });
    this.selectedId.set(null);
    this.feedback.showToast('Element deplace dans la corbeille', 'success');
  }

  protected async deleteSelected(): Promise<void> {
    const ids = [...this.selectedIds()];
    if (!ids.length) return;
    const nodes = ids.map((nodeId) => findTreeNode(this.root(), nodeId)).filter((node): node is RhNode => Boolean(node));
    const topLevel = nodes.filter((node) => !findPath(this.root(), node.id).slice(1, -1).some((ancestorId) => this.selectedIds().has(ancestorId)));
    if (!await this.feedback.confirm({ title: `Supprimer ${topLevel.length} élément${topLevel.length > 1 ? 's' : ''} ?`, message: 'Les éléments seront déplacés dans la corbeille.', confirmLabel: 'Supprimer', destructive: true })) return;
    let changed = false;
    this.store.update((draft) => {
      let next = draft;
      for (const node of topLevel) {
        const updated = deleteRhNode(next, node.id);
        if (updated) { next = updated; changed = true; }
      }
      if (changed) Object.assign(draft, next);
    });
    if (!changed) return;
    this.selectedIds.set(new Set());
    this.selectionMode.set(false);
    this.selectedId.set(null);
    this.feedback.showToast('Éléments déplacés dans la corbeille', 'success');
  }

  protected async restoreLatest(): Promise<void> {
    const latest = this.deletedRh().at(-1);
    if (!latest) return;
    this.store.update((draft) => { const next = restoreFromTrash(draft, latest.id); if (next) Object.assign(draft, next); });
    this.feedback.showToast('Element RH restaure', 'success');
  }

  protected safeDocumentUrl(url: string | undefined): string | null { return safeUrl(url); }

  protected openWikiLink(title: string): void {
    const target = this.root().children.flatMap((node) => collectDocuments(node)).find((document) => document.title.toLowerCase() === title.toLowerCase());
    if (!target) {
      this.feedback.showToast(`Lien introuvable : ${title}`, 'info');
      return;
    }
    const targetPath = findPath(this.root(), target.id);
    this.path.set(targetPath.slice(0, -1));
    this.selectedId.set(target.id);
    void this.router.navigate([], { relativeTo: this.route, queryParams: { path: targetPath.slice(1, -1).join(',') || null, focus: target.id }, queryParamsHandling: 'merge' });
  }

  protected handleDocumentClick(event: MouseEvent): void {
    const link = (event.target as HTMLElement | null)?.closest<HTMLElement>('.wiki-link');
    const title = link?.dataset['wiki'] ?? link?.textContent?.replace(/^\[\[|\]\]$/g, '').trim();
    if (title) this.openWikiLink(title);
  }

  protected async attachFile(document: RhDocument, file: File): Promise<void> {
    try {
      const attachment = await this.files.readAttachment(file);
      this.store.update((draft) => {
        const next = updateRhNode(draft, document.id, { file: attachment });
        if (next) Object.assign(draft, next);
      });
    } catch {
      this.feedback.showToast('Piece jointe invalide ou trop volumineuse', 'error');
    }
  }

  protected attachFileFromInput(document: RhDocument, event: Event): void {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (file) void this.attachFile(document, file);
  }

  protected download(file: WorkspaceFile): void {
    const binary = atob(file.base64.split(',')[1] ?? '');
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    void this.files.saveBlob(new Blob([bytes], { type: file.mime }), file.name).then((result) => { if (!result.saved && !result.cancelled) this.feedback.showToast('Telechargement impossible', 'error'); });
  }

  @HostListener('document:keydown', ['$event'])
  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && this.createDialog()) {
      event.preventDefault();
      this.closeCreateDialog();
    }
  }

  private navigate(next: string[]): void {
    this.path.set(next);
    this.selectedId.set(null);
    this.selectedIds.set(new Set());
    this.expandedIds.set(next.slice(1));
    void this.router.navigate([], { relativeTo: this.route, queryParams: { path: next.slice(1).join(',') || null, folder: null, focus: null }, queryParamsHandling: 'merge' });
  }
}

function countDocuments(root: RhFolder): number {
  return (root.children ?? []).reduce((total, node) => total + (node.nodeType === 'document' ? 1 : countDocuments(node)), 0);
}

function collectDocuments(node: RhNode): RhDocument[] {
  return node.nodeType === 'document' ? [node] : (node.children ?? []).flatMap((child) => collectDocuments(child));
}
