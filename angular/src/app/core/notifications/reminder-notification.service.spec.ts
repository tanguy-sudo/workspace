import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import fixture from '../../../../../fixtures/workspace-full.json';
import { StoragePreferencesService, STORAGE_KEYS } from '../persistence/storage-preferences.service';
import type { WorkspaceData } from '../persistence/workspace-data';
import { WorkspaceStoreService } from '../persistence/workspace-store.service';
import { FeedbackService } from '../../shared/feedback/feedback.service';
import { ReminderNotificationService } from './reminder-notification.service';

describe('ReminderNotificationService', () => {
  let service: ReminderNotificationService;
  let data: ReturnType<typeof signal<WorkspaceData>>;
  let feedback: { showToast: ReturnType<typeof vi.fn> };
  let notificationDescriptor: PropertyDescriptor | undefined;

  beforeEach(() => {
    localStorage.clear();
    data = signal(structuredClone(fixture.data) as WorkspaceData);
    feedback = { showToast: vi.fn() };
    notificationDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'Notification');
    TestBed.configureTestingModule({
      providers: [
        ReminderNotificationService,
        StoragePreferencesService,
        { provide: WorkspaceStoreService, useValue: { data: data.asReadonly() } },
        { provide: FeedbackService, useValue: feedback },
      ],
    });
    service = TestBed.inject(ReminderNotificationService);
  });

  afterEach(() => {
    service.ngOnDestroy();
    if (notificationDescriptor) Object.defineProperty(globalThis, 'Notification', notificationDescriptor);
    else Reflect.deleteProperty(globalThis, 'Notification');
  });

  function setTodos(todos: WorkspaceData['todos']): void {
    data.update((current) => ({ ...current, todos }));
  }

  function mockNotification(initialPermission: NotificationPermission, result = initialPermission, updatePermission = true): { requestPermission: ReturnType<typeof vi.fn>; instances: unknown[] } {
    const requestPermission = vi.fn();
    const instances: unknown[] = [];
    class MockNotification {
      static permission = initialPermission;

      static requestPermission = requestPermission;

      constructor(title: string, options: NotificationOptions) {
        instances.push({ title, options });
      }
    }
    requestPermission.mockImplementation(() => {
      if (updatePermission) MockNotification.permission = result;
      return Promise.resolve(result);
    });
    Object.defineProperty(globalThis, 'Notification', { configurable: true, writable: true, value: MockNotification });
    return { requestPermission, instances };
  }

  it('keeps the visual fallback when the Notification API is unavailable', () => {
    Object.defineProperty(globalThis, 'Notification', { configurable: true, writable: true, value: undefined });
    const now = Date.parse('2026-09-01T12:00:00');
    setTodos([{ id: 'todo-no-api', title: 'Sans API', status: 'todo', reminderAt: '2026-09-01T11:59:00', dependencies: [], tags: [], recurrence: null }]);

    expect(() => service.start()).not.toThrow();
    expect(() => service.checkNow(now)).not.toThrow();
    expect(feedback.showToast).toHaveBeenCalledWith('Rappel : Sans API', 'error');
    expect(localStorage.getItem(STORAGE_KEYS.reminderFired)).toContain('todo-no-api');
  });

  it('asks for permission once and does not loop after a refusal', () => {
    const notification = mockNotification('default', 'denied', false);

    service['requestPermissionOnce']();
    service['requestPermissionOnce']();

    expect(notification.requestPermission).toHaveBeenCalledTimes(1);
    expect(notification.requestPermission).toHaveReturnedWith(expect.any(Promise));
    expect(localStorage.getItem(STORAGE_KEYS.notificationAsked)).toBe('1');
  });

  it('deduplicates one due task and uses the native notification when granted', () => {
    const notification = mockNotification('granted');
    const now = Date.parse('2026-09-01T12:00:00');
    setTodos([{ id: 'todo-due', title: 'Échéance', status: 'todo', context: 'bureau', reminderAt: '2026-09-01T11:59:00', dependencies: [], tags: [], recurrence: null }]);

    service.checkNow(now);
    service.checkNow(now);

    expect(feedback.showToast).toHaveBeenCalledTimes(1);
    expect(notification.instances).toHaveLength(1);
    expect(notification.instances[0]).toEqual({
      title: 'Rappel : Échéance',
      options: { body: '@bureau', tag: 'workspace-rem-todo-due' },
    });
  });

  it('ignores completed and stale reminders, then removes old deduplication entries', () => {
    const notification = mockNotification('denied');
    const now = Date.parse('2026-09-01T12:00:00');
    localStorage.setItem(STORAGE_KEYS.reminderFired, JSON.stringify({ 'old:1': now - 31 * 24 * 60 * 60 * 1000 }));
    setTodos([
      { id: 'todo-done', title: 'Terminée', status: 'done', reminderAt: '2026-09-01T11:00:00', dependencies: [], tags: [], recurrence: null },
      { id: 'todo-stale', title: 'Trop ancienne', status: 'todo', reminderAt: '2026-08-30T11:00:00', dependencies: [], tags: [], recurrence: null },
    ]);

    service.checkNow(now);

    expect(feedback.showToast).not.toHaveBeenCalled();
    expect(notification.instances).toHaveLength(0);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.reminderFired) || '{}')).toEqual({});
  });
});
