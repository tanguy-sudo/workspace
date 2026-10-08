import { CommonModule } from '@angular/common';
import {
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { findTreeNode } from '../../core/domain/workspace-domain';
import type { TreeDropPosition, TreeNode } from '../../core/domain/workspace-domain';
import { TreeDndService } from './tree-dnd.service';

@Component({
  selector: 'app-tree',
  standalone: true,
  imports: [CommonModule],
  providers: [TreeDndService],
  templateUrl: './tree.component.html',
  styleUrl: './tree.component.css',
})
export class TreeComponent {
  readonly nodes = input.required<readonly TreeNode[]>();
  readonly label = input<(node: TreeNode) => string>((node) => String(node['name'] ?? node['title'] ?? node.id));
  readonly ariaLabel = input('Workspace tree');
  readonly expandedIds = input<readonly string[]>([]);
  readonly selectionMode = input(false);
  readonly selectedIds = input<ReadonlySet<string>>(new Set<string>());
  readonly canDrop = input<(source: TreeNode, target: TreeNode, position: TreeDropPosition) => boolean>(() => true);
  readonly activated = output<TreeNode>();
  readonly selectionToggled = output<string>();
  readonly pinToggled = output<TreeNode>();
  readonly dropped = output<import('./tree-dnd.service').TreeDropEvent>();

  protected readonly focusedId = signal<string | null>(null);
  protected readonly announcement = signal('');
  private readonly expanded = signal(new Set<string>());
  private readonly keyboardTargetId = signal<string | null>(null);
  private readonly keyboardPosition = signal<TreeDropPosition>('after');
  private readonly dnd = inject(TreeDndService);
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly destroyRef = inject(DestroyRef);
  private readonly flatNodes = computed(() => {
    const result: TreeNode[] = [];
    const visit = (nodes: readonly TreeNode[]): void => {
      for (const node of nodes) {
        result.push(node);
        if (this.isBranch(node) && this.isExpanded(node)) visit(node.children ?? []);
      }
    };
    visit(this.nodes());
    return result;
  });

  constructor() {
    effect(() => this.expanded.set(new Set(this.expandedIds())));
    effect(() => {
      const nodes = this.nodes();
      if (!this.focusedId() && nodes[0]) this.focusedId.set(nodes[0].id);
    });
    this.destroyRef.onDestroy(() => this.dnd.cancel());
  }

  protected isBranch(node: TreeNode): boolean {
    return node.nodeType === 'folder' && Boolean(node.children?.length);
  }

  protected isExpanded(node: TreeNode): boolean {
    return this.expanded().has(node.id);
  }

  protected toggle(node: TreeNode): void {
    if (!this.isBranch(node)) return;
    this.expanded.update((current) => {
      const next = new Set(current);
      if (next.has(node.id)) next.delete(node.id); else next.add(node.id);
      return next;
    });
  }

  protected activate(node: TreeNode): void {
    if (this.selectionMode()) {
      this.selectionToggled.emit(node.id);
      return;
    }
    this.activated.emit(node);
    this.toggle(node);
  }

  protected toggleSelection(event: Event, nodeId: string): void {
    event.stopPropagation();
    this.selectionToggled.emit(nodeId);
  }

  protected togglePin(event: Event, node: TreeNode): void {
    event.stopPropagation();
    this.pinToggled.emit(node);
  }

  protected isDrop(targetId: string, position: TreeDropPosition): boolean {
    const preview = this.dnd.previewPosition();
    return preview?.targetId === targetId && preview.position === position;
  }

  protected onDragStart(event: DragEvent, node: TreeNode): void {
    this.dnd.begin(node.id, String(node.nodeType ?? 'any'));
    event.dataTransfer?.setData('text/plain', node.id);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  }

  protected onDragOver(event: DragEvent, target: TreeNode): void {
    const source = this.sourceNode();
    if (!source || source.id === target.id) return;
    const position = this.dnd.pointerPosition(event, event.currentTarget as HTMLElement, target.nodeType === 'folder');
    if (!this.canDropAt(source, target, position)) return;
    event.preventDefault();
    this.dnd.setPreview(target.id, position);
  }

  protected onDragLeave(targetId: string): void {
    if (this.dnd.previewPosition()?.targetId === targetId) this.dnd.clearPreview();
  }

  protected onDrop(event: DragEvent, target: TreeNode): void {
    event.preventDefault();
    const preview = this.dnd.previewPosition();
    const source = this.sourceNode();
    if (!preview || !source || !this.canDropAt(source, target, preview.position)) {
      this.dnd.cancel();
      return;
    }
    this.emitDrop(target, preview.position);
  }

  protected onDragEnd(): void {
    this.dnd.cancel();
  }

  protected onKeydown(event: KeyboardEvent): void {
    const current = this.focusedId();
    if (!current) return;
    const index = this.flatNodes().findIndex((node) => node.id === current);
    if (index < 0) return;
    if (this.selectionMode() && (event.key === ' ' || event.key === 'Enter') && (event.target as HTMLElement).tagName !== 'INPUT') {
      event.preventDefault();
      this.selectionToggled.emit(current);
      return;
    }
    if (event.key === 'Escape' && this.dnd.keyboardMoving()) {
      event.preventDefault();
      this.dnd.cancel();
      this.keyboardTargetId.set(null);
      this.keyboardPosition.set('after');
      this.announcement.set('Deplacement annule.');
      return;
    }
    const moveFocus = (nextIndex: number): void => {
      const node = this.flatNodes()[Math.max(0, Math.min(nextIndex, this.flatNodes().length - 1))];
      if (!node) return;
      this.focusedId.set(node.id);
      this.focusElement(node.id);
      if (this.dnd.keyboardMoving()) {
        this.keyboardTargetId.set(node.id);
        this.keyboardPosition.set('after');
      }
    };

    if (event.key === 'ArrowDown') { event.preventDefault(); moveFocus(index + 1); return; }
    if (event.key === 'ArrowUp') { event.preventDefault(); moveFocus(index - 1); return; }
    if (event.key === 'Home') { event.preventDefault(); moveFocus(0); return; }
    if (event.key === 'End') { event.preventDefault(); moveFocus(this.flatNodes().length - 1); return; }
    if (event.key === 'ArrowRight') {
      if (this.dnd.keyboardMoving()) {
        const target = this.findNode(this.keyboardTargetId());
        const source = this.sourceNode();
        if (target && source && this.canDropAt(source, target, 'inside')) {
          this.keyboardPosition.set('inside');
          this.announcement.set(`Cible selectionnee : ${this.displayLabel(target)}, dedans.`);
        }
        return;
      }
      const node = this.flatNodes()[index];
      if (node && this.isBranch(node) && !this.isExpanded(node)) this.toggle(node);
      return;
    }
    if (event.key === 'ArrowLeft') {
      const node = this.flatNodes()[index];
      if (node && this.isBranch(node) && this.isExpanded(node)) this.toggle(node);
      return;
    }
    if (event.key === ' ') {
      event.preventDefault();
      this.dnd.begin(current, String(this.findNode(current)?.nodeType ?? 'any'));
      this.dnd.startKeyboardMove();
      this.keyboardTargetId.set(null);
      this.keyboardPosition.set('after');
      this.announcement.set('Selectionnez une cible avec les fleches puis appuyez sur Entree.');
      return;
    }
    if (event.key === 'Enter' && this.dnd.keyboardMoving()) {
      event.preventDefault();
      const target = this.findNode(this.keyboardTargetId());
      const source = this.sourceNode();
      if (target && source && target.id !== source.id) {
        const position = this.keyboardPosition();
        if (this.canDropAt(source, target, position)) this.emitDrop(target, position);
      }
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const node = this.findNode(current);
      if (node) this.activate(node);
    }
  }

  private emitDrop(target: TreeNode, position: TreeDropPosition): void {
    const source = this.sourceNode();
    if (!source) return;
    const event = this.dnd.commit(target.id, position);
    if (!event) return;
    this.keyboardTargetId.set(null);
    this.dropped.emit(event);
    this.announcement.set(this.dnd.announce(event, source, target));
  }

  private sourceNode(): TreeNode | null {
    return this.findNode(this.dnd.activeSource()?.id);
  }

  private findNode(id: string | null | undefined): TreeNode | null {
    for (const node of this.nodes()) {
      const found = findTreeNode(node, id ?? '');
      if (found) return found;
    }
    return null;
  }

  protected displayLabel(node: TreeNode): string {
    return this.label()(node);
  }

  protected nodeAriaLabel(node: TreeNode): string {
    const kind = node.nodeType === 'folder' ? 'Dossier' : node.nodeType === 'document' ? 'Document' : '';
    return kind ? `${kind} : ${this.displayLabel(node)}` : this.displayLabel(node);
  }

  protected nodeKindCode(node: TreeNode): string {
    if (node.nodeType === 'folder') return 'DIR';
    if (node.nodeType === 'document') return 'DOC';
    return '';
  }

  private canDropAt(source: TreeNode, target: TreeNode, position: TreeDropPosition): boolean {
    if (source.id === target.id) return false;
    if (position === 'inside' && target.nodeType !== 'folder') return false;
    if (findTreeNode(source, target.id)) return false;
    return this.canDrop()(source, target, position);
  }

  private focusElement(id: string): void {
    queueMicrotask(() => {
      const element = Array.from(this.host.nativeElement.querySelectorAll('[role="treeitem"]'))
        .find((candidate) => (candidate as HTMLElement).getAttribute('data-id') === id) as HTMLElement | undefined;
      element?.focus();
    });
  }
}
