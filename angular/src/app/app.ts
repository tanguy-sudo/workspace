import { Component, DestroyRef, HostListener, OnInit, computed, effect, inject, signal } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { StoragePreferencesService, STORAGE_KEYS } from './core/persistence/storage-preferences.service';
import { WorkspaceStoreService } from './core/persistence/workspace-store.service';
import { FeedbackComponent } from './shared/feedback/feedback.component';
import { GlobalSearchComponent } from './shared/search/global-search.component';
import { GlobalSearchService } from './shared/search/global-search.service';
import { FavoritesComponent } from './shared/favorites/favorites.component';
import { FocusTrapDirective } from './shared/a11y/focus-trap.directive';
import { WorkspaceBackupService } from './core/files/workspace-backup.service';
import { ReminderNotificationService } from './core/notifications/reminder-notification.service';
import { ResizableDialogDirective } from './shared/dialog/resizable-dialog.directive';
import { TrashComponent } from './shared/trash/trash.component';

const THEMES = [
  { id: 'dark', label: 'Dark', bg: '#0d1520', accent: '#f0a030' },
  { id: 'light', label: 'Light', bg: '#f2efe8', accent: '#c47800' },
  { id: 'midnight', label: 'Midnight', bg: '#050810', accent: '#4488ff' },
  { id: 'nord', label: 'Nord', bg: '#1c2130', accent: '#88ccdd' },
  { id: 'violet', label: 'Violet', bg: '#12101e', accent: '#a070ff' },
  { id: 'coffee', label: 'Coffee', bg: '#1a1208', accent: '#e8982a' },
  { id: 'matcha', label: 'Matcha', bg: '#0e1a10', accent: '#66cc66' },
  { id: 'rose-pine', label: 'Rosé Pine', bg: '#191724', accent: '#ebbcba' },
  { id: 'cyberpunk', label: 'Cyberpunk', bg: '#080c10', accent: '#00e5ff' },
  { id: 'gruvbox', label: 'Gruvbox', bg: '#1d2021', accent: '#fabd2f' },
  { id: 'sakura', label: 'Sakura', bg: '#fdf6f8', accent: '#d4538a' },
  { id: 'dusk', label: 'Dusk', bg: '#1a1520', accent: '#ff8c69' },
] as const;

const NAV_ITEMS = [
  { path: '/home', label: 'Tableau de bord' },
  { path: '/rh', label: 'RH' },
  { path: '/projects', label: 'Projects' },
  { path: '/todos', label: 'Tâches' },
  { path: '/snippets', label: 'Snippets' },
  { path: '/journal', label: 'Journal' },
  { path: '/export', label: 'Export' },
  { path: '/smart-planning', label: 'Planification' },
] as const;

@Component({
  selector: 'app-root',
   imports: [FavoritesComponent, FeedbackComponent, FocusTrapDirective, GlobalSearchComponent, ResizableDialogDirective, RouterLink, RouterLinkActive, RouterOutlet, TrashComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App implements OnInit {
  protected readonly themes = THEMES;
  protected readonly navItems = NAV_ITEMS;
  protected readonly theme = signal('dark');
  protected readonly accent = signal('#f0a030');
  protected readonly activeTheme = computed(() => THEMES.find((entry) => entry.id === this.theme()) || THEMES[0]);
  protected readonly themePickerOpen = signal(false);
  protected readonly accentOverride = signal(false);
  protected readonly siteName = signal('Workspace');
  protected readonly store = inject(WorkspaceStoreService);
  protected readonly clock = signal('');
  protected readonly menuOpen = signal(false);
  protected readonly shortcutsHelp = signal(false);

  private readonly destroyRef = inject(DestroyRef);
  private readonly preferences = inject(StoragePreferencesService);
  private readonly router = inject(Router);
  private readonly search = inject(GlobalSearchService);
  private readonly backups = inject(WorkspaceBackupService);
  private readonly reminders = inject(ReminderNotificationService);
  private gTimer: number | undefined;
  private gMode = false;

  constructor() {
    effect(() => {
      const data = this.store.data();
      if (!data) return;
      this.siteName.set(data.settings.siteName?.trim() || 'Workspace');
      const storedTheme = this.preferences.resolveTheme(data.settings.theme);
      this.applyTheme(storedTheme);
       const savedAccent = this.preferences.get(STORAGE_KEYS.accent, null);
       this.accentOverride.set(!!savedAccent);
       this.applyAccent(savedAccent || this.themeAccent(storedTheme));
    });
  }

  ngOnInit(): void {
    const initialTheme = this.preferences.resolveTheme(undefined);
    this.applyTheme(initialTheme);
    const savedAccent = this.preferences.get(STORAGE_KEYS.accent, null);
    this.accentOverride.set(!!savedAccent);
    this.applyAccent(savedAccent || this.themeAccent(initialTheme));
    this.updateClock();

    const timer = window.setInterval(() => this.updateClock(), 1000);
    this.destroyRef.onDestroy(() => window.clearInterval(timer));
    this.destroyRef.onDestroy(() => {
      if (this.gTimer !== undefined) window.clearTimeout(this.gTimer);
    });

    void this.store.init().then((data) => {
      if (data) {
        this.reminders.start();
        void this.backups.checkAutomaticBackup();
      }
    });
  }

  protected toggleThemePicker(): void {
    this.themePickerOpen.update((open) => !open);
  }

  protected selectTheme(selected: string): void {
    if (!THEMES.some((entry) => entry.id === selected)) selected = 'dark';
    this.preferences.remove(STORAGE_KEYS.accent);
    this.accentOverride.set(false);
    this.applyTheme(selected);
    this.preferences.set(STORAGE_KEYS.theme, selected);
    this.store.updateSettings({ theme: selected });
    this.applyAccent(this.themeAccent(selected));
    this.themePickerOpen.set(false);
  }

  protected changeAccent(event: Event): void {
    const selected = (event.target as HTMLInputElement).value;
    this.applyAccent(selected);
    this.preferences.set(STORAGE_KEYS.accent, selected);
    this.accentOverride.set(true);
  }

  protected resetAccent(): void {
    this.preferences.remove(STORAGE_KEYS.accent);
    this.accentOverride.set(false);
    this.applyAccent(this.themeAccent(this.theme()));
  }

  protected toggleMenu(): void {
    this.menuOpen.update((open) => !open);
  }

  protected closeMenu(): void {
    this.menuOpen.set(false);
  }

  protected skipToContent(): void {
    document.getElementById('main-content')?.focus();
  }

  protected handleNavClick(path: string): void {
    this.closeMenu();
    if (path === '/projects') this.preferences.remove(STORAGE_KEYS.projectsParent);
  }

  @HostListener('document:keydown', ['$event'])
  protected onShortcut(event: KeyboardEvent): void {
    const target = event.target as HTMLElement | null;
    const typing = target?.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(target?.tagName || '');

    if ((event.ctrlKey || event.metaKey) && (event.code === 'Space' || event.key.toLowerCase() === 'k')) {
      event.preventDefault();
      this.search.open();
      return;
    }
    if (event.key === 'Escape') {
      if (this.shortcutsHelp()) { this.shortcutsHelp.set(false); return; }
      if (this.themePickerOpen()) { this.themePickerOpen.set(false); return; }
      this.search.close();
      return;
    }
    if (typing || event.ctrlKey || event.metaKey) return;
    if (event.key === '?' || event.key === ',') {
      event.preventDefault();
      this.shortcutsHelp.update((open) => !open);
      return;
    }
    if (event.key === 'g') {
      event.preventDefault();
      this.gMode = true;
      if (this.gTimer !== undefined) window.clearTimeout(this.gTimer);
      this.gTimer = window.setTimeout(() => { this.gMode = false; }, 1200);
      return;
    }
    if (!this.gMode) return;
    this.gMode = false;
    if (this.gTimer !== undefined) window.clearTimeout(this.gTimer);
    const paths: Record<string, string> = { h: '/home', t: '/todos', s: '/snippets', j: '/journal', p: '/projects', r: '/rh', e: '/export', n: '/smart-planning' };
    const path = paths[event.key.toLowerCase()];
    if (path) { event.preventDefault(); void this.router.navigateByUrl(path); }
  }

  @HostListener('document:visibilitychange')
  protected onVisibilityChange(): void {
    if (document.visibilityState === 'visible') void this.backups.checkAutomaticBackup();
  }

  @HostListener('document:click', ['$event'])
  protected onDocumentClick(event: MouseEvent): void {
    const target = event.target as Element | null;
    if (!target?.closest('.theme-picker')) this.themePickerOpen.set(false);
  }

  private applyTheme(value: string): void {
    const theme = THEMES.some((entry) => entry.id === value) ? value : 'dark';
    this.theme.set(theme);
    document.documentElement.setAttribute('data-theme', theme);
  }

  private applyAccent(value: string): void {
    const accent = /^#[0-9a-f]{6}$/i.test(value) ? value : '#f0a030';
    this.accent.set(accent);
    document.documentElement.style.setProperty('--accent', accent);
    document.documentElement.style.setProperty('--accent-hi', accent);
    document.documentElement.style.setProperty(
      '--accent-dim',
      `color-mix(in srgb, ${accent} 15%, transparent)`,
    );
  }

  private themeAccent(theme: string): string {
    return THEMES.find((entry) => entry.id === theme)?.accent || '#f0a030';
  }

  private updateClock(): void {
    this.clock.set(
      new Intl.DateTimeFormat('fr-FR', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }).format(new Date()),
    );
  }
}
