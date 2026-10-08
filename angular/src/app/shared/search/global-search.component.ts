import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { StoragePreferencesService, STORAGE_KEYS } from '../../core/persistence/storage-preferences.service';
import { WorkspaceStoreService } from '../../core/persistence/workspace-store.service';
import { searchWorkspace, type WorkspaceSearchResult } from '../../core/domain/workspace-search';
import { GlobalSearchService } from './global-search.service';
import { FocusTrapDirective } from '../a11y/focus-trap.directive';
import { ResizableDialogDirective } from '../dialog/resizable-dialog.directive';

interface SearchAction {
  title: string;
  subtitle: string;
  path: string;
  createJournal?: boolean;
}

type SearchItem = WorkspaceSearchResult | SearchAction;

const ACTIONS: SearchAction[] = [
  { title: 'Tableau de bord', subtitle: 'Accueil', path: '/home' },
  { title: 'Projets', subtitle: 'Liste des projets', path: '/projects' },
  { title: 'Taches', subtitle: 'Todo et priorites', path: '/todos' },
  { title: 'Snippets', subtitle: 'Code reutilisable', path: '/snippets' },
  { title: 'RH', subtitle: 'Fiches et dossiers', path: '/rh' },
  { title: 'Journal', subtitle: 'Journal personnel', path: '/journal' },
  { title: 'Nouvelle entree de journal', subtitle: 'Ecrire dans le journal', path: '/journal', createJournal: true },
  { title: 'Export', subtitle: 'Sauvegarde locale', path: '/export' },
  { title: 'Parametres', subtitle: 'Preferences', path: '/settings' },
];

@Component({
  selector: 'app-global-search',
  standalone: true,
  imports: [CommonModule, FocusTrapDirective, ResizableDialogDirective],
  templateUrl: './global-search.component.html',
  styleUrl: './global-search.component.css',
})
export class GlobalSearchComponent {
  protected readonly state = inject(GlobalSearchService);
  private readonly store = inject(WorkspaceStoreService);
  private readonly preferences = inject(StoragePreferencesService);
  private readonly router = inject(Router);
  protected readonly query = signal('');
  protected readonly selected = signal(0);
  protected readonly results = computed(() => searchWorkspace(this.store.data(), this.searchText()));
  protected readonly items = computed<SearchItem[]>(() => {
    const raw = this.query().trim();
    const command = raw.startsWith('>');
    const text = (command ? raw.slice(1) : raw).trim().toLowerCase();
    if (command || !text) return ACTIONS.filter((action) => !text || `${action.title} ${action.subtitle}`.toLowerCase().includes(text));
    return this.results();
  });
  protected setQuery(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
    this.selected.set(0);
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') { event.preventDefault(); this.state.close(); return; }
    if (event.key === 'ArrowDown') { event.preventDefault(); this.move(1); return; }
    if (event.key === 'ArrowUp') { event.preventDefault(); this.move(-1); return; }
    if (event.key === 'Enter') { event.preventDefault(); this.activate(this.items()[this.selected()]); }
  }

  protected onOverlay(event: MouseEvent): void {
    if (event.target === event.currentTarget) this.state.close();
  }

  protected activate(item: SearchItem | undefined): void {
    if (!item) return;
    this.state.close();
    if ('kind' in item) {
      void this.router.navigateByUrl(this.url(item));
    } else {
      if (item.createJournal) {
        this.preferences.set(STORAGE_KEYS.createJournal, '1', 'session');
      }
      void this.router.navigateByUrl(item.path);
    }
  }

  protected icon(item: SearchItem): string {
    return 'icon' in item ? item.icon : '→';
  }

  private move(direction: number): void {
    const length = this.items().length;
    if (!length) return;
    this.selected.update((index) => (index + direction + length) % length);
  }

  private searchText(): string {
    return this.query().trim().startsWith('>') ? '' : this.query();
  }

  private url(result: WorkspaceSearchResult): string {
    const query = new URLSearchParams();
    Object.entries(result.queryParams).forEach(([key, value]) => query.set(key, String(value)));
    return `/${result.path}${query.toString() ? `?${query.toString()}` : ''}`;
  }
}
