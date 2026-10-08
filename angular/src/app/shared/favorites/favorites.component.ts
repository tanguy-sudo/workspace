import { CommonModule } from '@angular/common';
import { Component, computed, effect, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { LegacyRouteService } from '../../core/routing/legacy-route.service';
import { findTreeNode } from '../../core/domain/workspace-domain';
import { WorkspaceStoreService } from '../../core/persistence/workspace-store.service';
import type { FavoriteFolder, FavoriteNode } from '../../core/persistence/workspace-data';
import { FocusTrapDirective } from '../a11y/focus-trap.directive';
import { safeUrl } from '../rendering/safe-rendering';

export function safeFavoriteUrl(value: string): string | null {
  const raw = value.trim();
  const url = safeUrl(raw);
  if (!url) return null;
  try {
    const parsed = new URL(url, 'https://workspace.invalid');
    if (parsed.origin === 'https://workspace.invalid') {
      return parsed.pathname.endsWith('.html') || parsed.pathname === '/' ? `${parsed.pathname.replace(/^\//, '')}${parsed.search}` : null;
    }
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `favorite-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

@Component({
  selector: 'app-favorites',
  standalone: true,
  imports: [CommonModule, FocusTrapDirective],
  templateUrl: './favorites.component.html',
  styleUrl: './favorites.component.css',
})
export class FavoritesComponent {
  protected readonly open = signal(false);
  private readonly stack = signal(['root']);
  private readonly store = inject(WorkspaceStoreService);
  private readonly router = inject(Router);
  private readonly legacyRoutes = inject(LegacyRouteService);
  protected readonly root = computed(() => this.store.data()?.favorites ?? null);
  protected readonly current = computed(() => {
    const root = this.root();
    const id = this.stack().at(-1) ?? 'root';
    return root && (id === 'root' ? root : findTreeNode(root, id) as FavoriteFolder | null);
  });
  protected readonly breadcrumbs = computed(() => {
    const root = this.root();
    if (!root) return [];
    return this.stack().map((id) => (id === 'root' ? root : findTreeNode(root, id))).filter(Boolean) as FavoriteFolder[];
  });

  constructor() {
    effect(() => {
      const root = this.root();
      const valid = root && this.stack().every((id) => id === 'root' || Boolean(findTreeNode(root, id)));
      if (!valid) this.stack.set(['root']);
    });
  }

  protected toggle(): void { this.open.update((value) => !value); }
  protected close(): void { this.open.set(false); }
  protected onBackdrop(event: MouseEvent): void { if (event.target === event.currentTarget) this.close(); }

  protected activate(node: FavoriteNode): void {
    if (node.nodeType === 'folder') {
      this.stack.update((value) => [...value, node.id]);
      return;
    }
    const url = safeFavoriteUrl(node.url);
    if (!url) return;
    const target = this.legacyRoutes.map(url);
    if (target) {
      const projectId = target.path.startsWith('project/') ? decodeURIComponent(target.path.slice('project/'.length)) : null;
      if (projectId && !this.store.data()?.projects.some((project) => project.id === projectId)) {
        void this.router.navigateByUrl('/projects');
        return;
      }
      const query = new URLSearchParams();
      Object.entries(target.queryParams).forEach(([key, value]) => query.set(key, String(value)));
      void this.router.navigateByUrl(`/${target.path}${query.toString() ? `?${query.toString()}` : ''}`);
      return;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  protected jump(index: number): void { this.stack.set(this.stack().slice(0, index + 1)); }

  protected addFolder(): void {
    const name = window.prompt('Nom du dossier');
    if (!name?.trim()) return;
    const parentId = this.stack().at(-1) ?? 'root';
    this.store.update((data) => {
      const parent = parentId === 'root' ? data.favorites : findTreeNode(data.favorites, parentId);
      if (parent?.nodeType === 'folder') parent.children = [...(parent.children ?? []), { id: newId(), nodeType: 'folder', name: name.trim(), children: [] }];
    });
  }

  protected addLink(): void {
    const name = window.prompt('Nom du lien');
    const rawUrl = window.prompt('URL du lien');
    const url = rawUrl ? safeFavoriteUrl(rawUrl) : null;
    if (!name?.trim() || !url) return;
    const parentId = this.stack().at(-1) ?? 'root';
    this.store.update((data) => {
      const parent = parentId === 'root' ? data.favorites : findTreeNode(data.favorites, parentId);
      if (parent?.nodeType === 'folder') parent.children = [...(parent.children ?? []), { id: newId(), nodeType: 'link', name: name.trim(), url }];
    });
  }

  protected rename(node: FavoriteNode): void {
    const name = window.prompt('Nouveau nom', node.name);
    if (!name?.trim()) return;
    this.store.update((data) => {
      const found = findTreeNode(data.favorites, node.id);
      if (found) found.name = name.trim();
    });
  }

  protected remove(node: FavoriteNode): void {
    this.store.update((data) => {
      const parent = findParent(data.favorites, node.id);
      if (parent) parent.children = (parent.children ?? []).filter((child) => child.id !== node.id);
    });
  }
}

function findParent(root: FavoriteFolder, id: string): FavoriteFolder | null {
  if ((root.children ?? []).some((child) => child.id === id)) return root;
  for (const child of root.children ?? []) {
    if (child.nodeType !== 'folder') continue;
    const found = findParent(child, id);
    if (found) return found;
  }
  return null;
}
