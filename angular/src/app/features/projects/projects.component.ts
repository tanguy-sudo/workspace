import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Component, HostListener, computed, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import {
  countProjectItems,
  createProjectId,
  deleteProjectTree,
  projectAncestors,
  projectChildren,
  projectDescendants,
} from '../../core/domain/workspace-domain';
import type { Project } from '../../core/persistence/workspace-data';
import { StoragePreferencesService, STORAGE_KEYS } from '../../core/persistence/storage-preferences.service';
import { WorkspaceStoreService } from '../../core/persistence/workspace-store.service';
import { FeedbackService } from '../../shared/feedback/feedback.service';
import { FocusTrapDirective } from '../../shared/a11y/focus-trap.directive';
import { ResizableDialogDirective } from '../../shared/dialog/resizable-dialog.directive';

type ProjectViewMode = 'grid' | 'list';

interface ProjectDraft {
  name: string;
  category: string;
  color: string;
}

function newProjectId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `project-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function safeProjectColor(value: string | undefined): string {
  return /^#[0-9a-f]{6}$/i.test(value || '') ? value as string : '#64b0ff';
}

@Component({
  selector: 'app-projects',
  standalone: true,
  imports: [CommonModule, FocusTrapDirective, FormsModule, ResizableDialogDirective],
  templateUrl: './projects.component.html',
  styleUrl: './projects.component.css',
})
export class ProjectsComponent {
  private readonly store = inject(WorkspaceStoreService);
  private readonly preferences = inject(StoragePreferencesService);
  private readonly feedback = inject(FeedbackService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly params = toSignal(this.route.queryParamMap, { initialValue: this.route.snapshot.queryParamMap });
  private restoreStoredParent = true;

  protected readonly search = signal('');
  protected readonly viewMode = signal<ProjectViewMode>(
    this.preferences.get(STORAGE_KEYS.projectsView, 'grid') === 'list' ? 'list' : 'grid',
  );
  protected readonly parentId = signal<string | null>(null);
  protected readonly selectionMode = signal(false);
  protected readonly selectedIds = signal(new Set<string>());
  protected readonly createDialog = signal(false);
  protected projectDraft: ProjectDraft = { name: '', category: 'Projet', color: '#64b0ff' };
  protected readonly status = this.store.status;
  protected readonly loading = this.store.loading;
  protected readonly data = computed(() => this.store.data());
  protected readonly currentParent = computed(() => {
    const id = this.parentId();
    return this.data()?.projects.find((project) => project.id === id) ?? null;
  });
  protected readonly scopeLabel = computed(() => {
    const parent = this.currentParent();
    return parent ? `Sous-projets de ${parent.name}` : 'Racine';
  });
  protected readonly scopeProjects = computed(() => projectChildren(this.data()?.projects ?? [], this.parentId()));
  protected readonly filteredProjects = computed(() => {
    const query = this.search().trim().toLowerCase();
    return this.scopeProjects().filter((project) => !query || project.name.toLowerCase().includes(query));
  });
  protected readonly favoriteProjects = computed(() => this.scopeProjects().filter((project) => project['favorite'] === true));
  protected readonly breadcrumbs = computed(() => {
    const projects = this.data()?.projects ?? [];
    const current = this.currentParent();
    return current ? [...projectAncestors(projects, current.id), current] : [];
  });

  constructor() {
    effect(() => {
      const data = this.data();
      if (!data) return;
      const queryParent = this.params().get('parent');
      const storedParent = this.preferences.get(STORAGE_KEYS.projectsParent, '');
      const requestedParent = queryParent === null && this.restoreStoredParent ? storedParent : queryParent;
      this.restoreStoredParent = false;
      const validParent = requestedParent && data.projects.some((project) => project.id === requestedParent)
        ? requestedParent
        : null;
      this.parentId.set(validParent);
      this.preferences.set(STORAGE_KEYS.projectsParent, validParent ?? '');
      if (queryParent && !validParent) void this.router.navigate([], { relativeTo: this.route, queryParams: { parent: null } });
    });
    void this.store.init();
  }

  protected setSearch(event: Event): void {
    this.search.set((event.target as HTMLInputElement).value);
  }

  protected toggleViewMode(): void {
    const next: ProjectViewMode = this.viewMode() === 'grid' ? 'list' : 'grid';
    this.viewMode.set(next);
    this.preferences.set(STORAGE_KEYS.projectsView, next);
  }

  protected toggleSelectionMode(): void {
    this.selectionMode.update((enabled) => !enabled);
    this.selectedIds.set(new Set());
  }

  protected toggleSelection(id: string): void {
    this.selectedIds.update((selected) => {
      const next = new Set(selected);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  protected navigateScope(parentId: string | null): void {
    this.parentId.set(parentId);
    this.selectedIds.set(new Set());
    this.preferences.set(STORAGE_KEYS.projectsParent, parentId ?? '');
    void this.router.navigate([], { relativeTo: this.route, queryParams: { parent: parentId || null } });
  }

  protected openProject(project: Project): void {
    if (this.selectionMode()) {
      this.toggleSelection(project.id);
      return;
    }
    if (project['lockToChildren'] === true) {
      this.navigateScope(project.id);
      return;
    }
    void this.router.navigate(['/project', project.id]);
  }

  protected openProjectFromKeyboard(event: Event, project: Project): void {
    if (event.target !== event.currentTarget) return;
    event.preventDefault();
    this.openProject(project);
  }

  protected projectCounts(project: Project): ReturnType<typeof countProjectItems> {
    return countProjectItems(project);
  }

  protected childCount(projectId: string): number {
    return projectChildren(this.data()?.projects ?? [], projectId).length;
  }

  protected projectColor(project: Project): string {
    return safeProjectColor(project.color);
  }

  protected toggleFavorite(project: Project): void {
    this.store.update((draft) => {
      const target = draft.projects.find((candidate) => candidate.id === project.id);
      if (target) target['favorite'] = target['favorite'] !== true;
    });
  }

  protected toggleLock(project: Project): void {
    this.store.update((draft) => {
      const target = draft.projects.find((candidate) => candidate.id === project.id);
      if (target) target['lockToChildren'] = target['lockToChildren'] !== true;
    });
  }

  protected async removeProject(project: Project): Promise<void> {
    const descendants = projectDescendants(this.data()?.projects ?? [], project.id);
    const suffix = descendants.length
      ? ` et ${descendants.length} sous-projet${descendants.length > 1 ? 's' : ''}`
      : '';
    const accepted = await this.feedback.confirm({
      title: `Supprimer ${project.name} ?`,
      message: `Le projet${suffix} et son contenu seront déplacés dans la corbeille.`,
      confirmLabel: 'Supprimer',
      destructive: true,
    });
    if (!accepted) return;
    this.store.update((draft) => {
      const next = deleteProjectTree(draft, project.id);
      if (next) Object.assign(draft, next);
    });
    if (this.parentId() === project.id || !this.data()?.projects.some((candidate) => candidate.id === this.parentId())) {
      this.navigateScope(null);
    }
    this.feedback.showToast('Projet supprimé', 'success');
  }

  protected async deleteSelected(): Promise<void> {
    const ids = [...this.selectedIds()];
    if (!ids.length) return;
    const accepted = await this.feedback.confirm({
      title: `Supprimer ${ids.length} projet${ids.length > 1 ? 's' : ''} ?`,
      message: 'Les projets et leurs contenus seront déplacés dans la corbeille.',
      confirmLabel: 'Supprimer',
      destructive: true,
    });
    if (!accepted) return;
    this.store.update((draft) => {
      for (const id of ids) {
        const next = deleteProjectTree(draft, id);
        if (next) Object.assign(draft, next);
      }
    });
    this.selectedIds.set(new Set());
    this.selectionMode.set(false);
    this.feedback.showToast('Projets supprimés', 'success');
  }

  protected openCreateProject(): void {
    this.projectDraft = { name: '', category: 'Projet', color: '#64b0ff' };
    this.createDialog.set(true);
  }

  protected closeCreateProject(): void {
    this.createDialog.set(false);
  }

  protected setProjectDraft(field: keyof ProjectDraft, event: Event): void {
    this.projectDraft = { ...this.projectDraft, [field]: (event.target as HTMLInputElement).value };
  }

  protected submitCreateProject(): void {
    const name = this.projectDraft.name.trim();
    const category = this.projectDraft.category.trim();
    if (!name || !category) return;
    const color = safeProjectColor(this.projectDraft.color);
    const currentParent = this.parentId();
    const project: Project = {
      id: createProjectId(name, this.data()?.projects ?? [], newProjectId),
      name,
      color,
      parentId: currentParent,
      categories: [category],
      children: [],
      createdAt: Date.now(),
      lastVisited: Date.now(),
    };
    if (!this.store.update((draft) => draft.projects.push(project))) return;
    this.closeCreateProject();
    this.feedback.showToast(currentParent ? 'Sous-projet créé' : 'Projet créé', 'success');
  }

  @HostListener('document:keydown', ['$event'])
  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && this.createDialog()) {
      event.preventDefault();
      this.closeCreateProject();
    }
  }
}
