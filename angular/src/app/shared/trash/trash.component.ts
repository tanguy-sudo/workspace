import { CommonModule } from '@angular/common';
import { Component, HostListener, computed, inject, signal } from '@angular/core';
import { restoreFromTrash } from '../../core/domain/workspace-domain';
import { WorkspaceStoreService } from '../../core/persistence/workspace-store.service';
import type { TrashEntry } from '../../core/persistence/workspace-data';
import { FeedbackService } from '../feedback/feedback.service';
import { FocusTrapDirective } from '../a11y/focus-trap.directive';
import { ResizableDialogDirective } from '../dialog/resizable-dialog.directive';

const DAY_MS = 24 * 60 * 60 * 1000;
const TTL_DAYS = 30;
const TYPE_LABELS: Record<string, string> = {
  todo: 'Tâches', project: 'Projets', journal: 'Journal', snippet: 'Snippets', rh: 'RH', 'project-node': 'Éléments projet',
};

@Component({
  selector: 'app-trash',
  standalone: true,
  imports: [CommonModule, FocusTrapDirective, ResizableDialogDirective],
  templateUrl: './trash.component.html',
  styleUrl: './trash.component.css',
})
export class TrashComponent {
  protected readonly store = inject(WorkspaceStoreService);
  private readonly feedback = inject(FeedbackService);
  protected readonly open = signal(false);
  protected readonly entries = computed(() => [...(this.store.data()?.trash ?? [])].sort((a, b) => b._deletedAt - a._deletedAt));
  protected readonly count = computed(() => this.entries().length);

  protected show(): void { this.open.set(true); }
  protected close(): void { this.open.set(false); }

  protected title(entry: TrashEntry): string {
    const value = entry as TrashEntry & Record<string, unknown>;
    return String(value['title'] || value['name'] || value['content'] || '(sans titre)').slice(0, 80);
  }

  protected typeLabel(type: string): string { return TYPE_LABELS[type] || type; }
  protected daysAgo(timestamp: number): number { return Math.max(0, Math.floor((Date.now() - timestamp) / DAY_MS)); }
  protected daysLeft(timestamp: number): number { return Math.max(0, TTL_DAYS - this.daysAgo(timestamp)); }

  protected async restore(entry: TrashEntry): Promise<void> {
    this.store.update((draft) => { const next = restoreFromTrash(draft, entry.id); if (next) Object.assign(draft, next); });
    this.feedback.showToast('Élément restauré', 'success');
  }

  protected async remove(entry: TrashEntry): Promise<void> {
    if (!await this.feedback.confirm({ title: 'Supprimer définitivement ?', message: 'Cet élément ne pourra plus être restauré.', confirmLabel: 'Supprimer', destructive: true })) return;
    this.store.update((draft) => { draft.trash = draft.trash.filter((item) => item.id !== entry.id); });
  }

  protected async empty(): Promise<void> {
    if (!this.count() || !await this.feedback.confirm({ title: 'Vider définitivement la corbeille ?', message: 'Tous les éléments seront supprimés sans possibilité de restauration.', confirmLabel: 'Tout vider', destructive: true })) return;
    this.store.update((draft) => { draft.trash = []; });
  }

  @HostListener('document:keydown', ['$event'])
  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && this.open()) { event.preventDefault(); this.close(); }
  }
}
