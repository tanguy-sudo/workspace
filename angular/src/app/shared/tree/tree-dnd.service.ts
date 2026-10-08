import { Injectable } from '@angular/core';
import type { TreeDropPosition, TreeNode } from '../../core/domain/workspace-domain';

export interface TreeDropEvent {
  sourceId: string;
  sourceType: string;
  targetId: string;
  position: TreeDropPosition;
}

@Injectable()
export class TreeDndService {
  private source: { id: string; type: string } | null = null;
  private preview: { targetId: string; position: TreeDropPosition } | null = null;
  private moving = false;

  begin(sourceId: string, sourceType: string): void {
    this.source = { id: sourceId, type: sourceType };
    this.preview = null;
    this.moving = false;
  }

  cancel(): void {
    this.source = null;
    this.preview = null;
    this.moving = false;
  }

  setPreview(targetId: string, position: TreeDropPosition): void {
    this.preview = { targetId, position };
  }

  previewPosition(): { targetId: string; position: TreeDropPosition } | null {
    return this.preview;
  }

  activeSource(): { id: string; type: string } | null {
    return this.source;
  }

  clearPreview(): void {
    this.preview = null;
  }

  pointerPosition(
    event: Pick<DragEvent, 'clientY'>,
    element: Pick<HTMLElement, 'getBoundingClientRect'>,
    mixed: boolean,
  ): TreeDropPosition {
    const rect = element.getBoundingClientRect();
    const relative = event.clientY - rect.top;
    if (!mixed) return relative < rect.height / 2 ? 'before' : 'after';
    const zone = rect.height * 0.25;
    return relative < zone ? 'before' : relative > rect.height - zone ? 'after' : 'inside';
  }

  startKeyboardMove(): boolean {
    if (!this.source) return false;
    this.moving = true;
    this.preview = null;
    return true;
  }

  keyboardMoving(): boolean {
    return this.moving;
  }

  commit(targetId: string, position: TreeDropPosition): TreeDropEvent | null {
    if (!this.source || this.source.id === targetId) {
      this.cancel();
      return null;
    }
    const result = {
      sourceId: this.source.id,
      sourceType: this.source.type,
      targetId,
      position,
    };
    this.cancel();
    return result;
  }

  announce(event: TreeDropEvent, source: TreeNode, target: TreeNode): string {
    const sourceName = String(source['name'] ?? source['title'] ?? source.id);
    const targetName = String(target['name'] ?? target['title'] ?? target.id);
    const placement = event.position === 'inside'
      ? `dans ${targetName}`
      : `${event.position === 'before' ? 'avant' : 'apres'} ${targetName}`;
    return `${sourceName} deplace ${placement}`;
  }
}
