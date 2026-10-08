import { Injectable, OnDestroy, inject } from '@angular/core';
import { StoragePreferencesService, STORAGE_KEYS } from '../persistence/storage-preferences.service';
import { WorkspaceStoreService } from '../persistence/workspace-store.service';
import { FeedbackService } from '../../shared/feedback/feedback.service';
import type { Todo } from '../persistence/workspace-data';

export const REMINDER_CHECK_INTERVAL_MS = 30 * 1000;
export const REMINDER_OVERDUE_NOTIFY_WINDOW_MS = 24 * 60 * 60 * 1000;

type FiredReminderStore = Record<string, number>;

function reminderDueTimestamp(todo: Todo): number | null {
  if (todo.reminderAt) {
    const timestamp = Date.parse(todo.reminderAt);
    if (!Number.isNaN(timestamp)) return timestamp;
  }
  if (todo.dueDate) {
    const timestamp = Date.parse(`${todo.dueDate}T23:59:59`);
    if (!Number.isNaN(timestamp)) return timestamp;
  }
  return null;
}

@Injectable({ providedIn: 'root' })
export class ReminderNotificationService implements OnDestroy {
  private readonly store = inject(WorkspaceStoreService);
  private readonly preferences = inject(StoragePreferencesService);
  private readonly feedback = inject(FeedbackService);
  private timer: ReturnType<typeof setInterval> | null = null;
  private started = false;

  private readonly onVisibilityChange = (): void => {
    if (document.visibilityState === 'visible') this.checkNow();
  };

  start(): void {
    if (this.started) return;
    this.started = true;
    this.requestPermissionOnce();
    this.checkNow();
    this.timer = setInterval(() => this.checkNow(), REMINDER_CHECK_INTERVAL_MS);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
  }

  checkNow(now = Date.now()): void {
    const todos = this.store.data()?.todos ?? [];
    if (!todos.length) return;

    const stored = this.preferences.getJson<unknown>(STORAGE_KEYS.reminderFired, {});
    const fired: FiredReminderStore = stored && typeof stored === 'object' && !Array.isArray(stored)
      ? stored as FiredReminderStore
      : {};
    let changed = false;

    for (const todo of todos) {
      if (todo.status === 'done') continue;
      const due = reminderDueTimestamp(todo);
      if (due === null || due > now || now - due > REMINDER_OVERDUE_NOTIFY_WINDOW_MS) continue;

      const key = `${todo.id}:${due}`;
      if (Object.prototype.hasOwnProperty.call(fired, key)) continue;

      const title = todo.title || 'Tâche';
      const context = todo.context ? `@${todo.context}` : 'Échéance atteinte';
      this.feedback.showToast(`Rappel : ${title}`, 'error');
      this.showNativeNotification(title, context, todo.id);
      fired[key] = now;
      changed = true;
    }

    const cutoff = now - 30 * 24 * 60 * 60 * 1000;
    for (const key of Object.keys(fired)) {
      if ((fired[key] || 0) < cutoff) {
        delete fired[key];
        changed = true;
      }
    }
    if (changed) this.preferences.setJson(STORAGE_KEYS.reminderFired, fired);
  }

  ngOnDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.onVisibilityChange);
  }

  private requestPermissionOnce(): void {
    if (typeof Notification === 'undefined' || Notification.permission !== 'default') return;
    if (this.preferences.get(STORAGE_KEYS.notificationAsked)) return;

    this.preferences.set(STORAGE_KEYS.notificationAsked, '1');
    try {
      void Notification.requestPermission().catch(() => undefined);
    } catch {
      // A browser may reject permission requests outside a user gesture.
    }
  }

  private showNativeNotification(title: string, body: string, id: string): void {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    try {
      new Notification(`Rappel : ${title}`, { body, tag: `workspace-rem-${id}` });
    } catch {
      // Native notifications are optional; the toast remains the fallback.
    }
  }
}
