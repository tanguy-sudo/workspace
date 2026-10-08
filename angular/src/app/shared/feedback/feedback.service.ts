import { Injectable, OnDestroy, signal } from '@angular/core';

export type ToastKind = 'success' | 'error' | 'info';

export interface ToastMessage {
  id: number;
  message: string;
  kind: ToastKind;
}

export interface ModalOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

@Injectable({ providedIn: 'root' })
export class FeedbackService implements OnDestroy {
  readonly toasts = signal<ToastMessage[]>([]);
  readonly modal = signal<(ModalOptions & { resolve: (value: boolean) => void }) | null>(null);

  private nextId = 0;
  private readonly timers = new Map<number, ReturnType<typeof setTimeout>>();

  showToast(message: string, kind: ToastKind = 'info', duration = 3200): number {
    const id = ++this.nextId;
    this.toasts.update((items) => [...items, { id, message, kind }]);
    this.timers.set(id, setTimeout(() => this.dismissToast(id), duration));
    return id;
  }

  dismissToast(id: number): void {
    const timer = this.timers.get(id);
    if (timer) clearTimeout(timer);
    this.timers.delete(id);
    this.toasts.update((items) => items.filter((item) => item.id !== id));
  }

  confirm(options: ModalOptions): Promise<boolean> {
    const current = this.modal();
    current?.resolve(false);
    return new Promise((resolve) => {
      this.modal.set({
        ...options,
        confirmLabel: options.confirmLabel || 'Confirmer',
        cancelLabel: options.cancelLabel || 'Annuler',
        destructive: !!options.destructive,
        resolve,
      });
    });
  }

  resolveModal(value: boolean): void {
    const current = this.modal();
    if (!current) return;
    this.modal.set(null);
    current.resolve(value);
  }

  ngOnDestroy(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }
}
