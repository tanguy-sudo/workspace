import { TestBed } from '@angular/core/testing';
import { STORAGE_KEYS, StoragePreferencesService } from './storage-preferences.service';

describe('StoragePreferencesService', () => {
  let preferences: StoragePreferencesService;

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    TestBed.configureTestingModule({ providers: [StoragePreferencesService] });
    preferences = TestBed.inject(StoragePreferencesService);
  });

  it('reads legacy values and falls back for invalid JSON', () => {
    localStorage.setItem(STORAGE_KEYS.theme, 'midnight');
    localStorage.setItem(STORAGE_KEYS.smartPlan, '{invalid');

    expect(preferences.get(STORAGE_KEYS.theme)).toBe('midnight');
    expect(preferences.getJson(STORAGE_KEYS.smartPlan, { planIds: [] })).toEqual({ planIds: [] });
  });

  it('keeps session and local storage separate', () => {
    preferences.set(STORAGE_KEYS.vaultKey, 'session-only', 'session');

    expect(preferences.get(STORAGE_KEYS.vaultKey)).toBeNull();
    expect(preferences.get(STORAGE_KEYS.vaultKey, null, 'session')).toBe('session-only');
  });

  it('uses settings.theme before the legacy early-boot key', () => {
    localStorage.setItem(STORAGE_KEYS.theme, 'light');

    expect(preferences.resolveTheme('nord')).toBe('nord');
    expect(preferences.resolveTheme(undefined)).toBe('light');
  });

  it('validates modal size values', () => {
    preferences.setJson(STORAGE_KEYS.modalSizePrefix + 'project', { w: 900, h: 600 });
    expect(preferences.getModalSize('project')).toEqual({ width: 900, height: 600 });

    preferences.setJson(STORAGE_KEYS.modalSizePrefix + 'broken', { w: '900', h: 600 });
    expect(preferences.getModalSize('broken')).toBeNull();
  });

  it('tolerates blocked storage', () => {
    const original = Object.getOwnPropertyDescriptor(window, 'localStorage');
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get: () => { throw new Error('blocked'); },
    });

    expect(preferences.get('blocked', 'fallback')).toBe('fallback');
    expect(preferences.set('blocked', 'value')).toBe(false);

    if (original) Object.defineProperty(window, 'localStorage', original);
  });
});
