import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Component, DestroyRef, computed, effect, inject, signal } from '@angular/core';
import { StoragePreferencesService, STORAGE_KEYS } from '../../core/persistence/storage-preferences.service';
import { FileAccessService } from '../../core/files/file-access.service';
import {
  createJournalEntry,
  deleteJournalEntry,
  updateJournalEntry,
} from '../../core/domain/workspace-domain';
import { WorkspaceStoreService } from '../../core/persistence/workspace-store.service';
import type { JournalEntry, WorkspaceData } from '../../core/persistence/workspace-data';
import type { WorkspaceTemplate } from '../../core/persistence/workspace-data';
import { FeedbackService } from '../../shared/feedback/feedback.service';
import { FocusTrapDirective } from '../../shared/a11y/focus-trap.directive';
import { MarkdownEditorComponent } from '../../shared/rendering/markdown-editor.component';

type JournalDialog = 'templates' | 'templateForm' | null;

interface JournalTemplate {
  id: string;
  name: string;
  icon: string;
  title: string;
  content: string;
  mood: string;
  tags: string[];
}

interface JournalTemplateDraft {
  name: string;
  icon: string;
  title: string;
  content: string;
  mood: string;
  tags: string;
}

const MOODS = [
  { id: 'great', label: 'Excellente' },
  { id: 'good', label: 'Bonne' },
  { id: 'neutral', label: 'Neutre' },
  { id: 'low', label: 'Moyenne' },
  { id: 'bad', label: 'Difficile' },
] as const;

const DEFAULT_JOURNAL_TEMPLATES: WorkspaceTemplate[] = [
  {
    id: 'tpl-standup', name: 'Standup', type: 'journal', icon: '🗣️', title: 'Standup {{date}}',
    content: "## ✅ Hier\n\n- \n\n## 🎯 Aujourd'hui\n\n- \n\n## 🚧 Blocages\n\n- ", mood: 'good', tags: ['standup'],
  },
  {
    id: 'tpl-retro', name: 'Rétrospective', type: 'journal', icon: '🔄', title: 'Rétro — {{date}}',
    content: "## 💚 Ce qui a bien marché\n\n- \n\n## 🔴 Ce qui n'a pas marché\n\n- \n\n## 💡 À améliorer\n\n- \n\n## 🎯 Actions pour la suite\n\n- ", mood: 'neutral', tags: ['retro'],
  },
  {
    id: 'tpl-cr', name: 'Compte-rendu', type: 'journal', icon: '📝', title: 'CR — {{date}}',
    content: '## 👥 Participants\n\n- \n\n## 📋 Ordre du jour\n\n- \n\n## 📌 Points abordés\n\n- \n\n## ✅ Décisions prises\n\n- \n\n## 🔜 Actions à suivre\n\n| Action | Responsable | Deadline |\n|--------|-------------|----------|\n| | | |', mood: '', tags: ['réunion'],
  },
  {
    id: 'tpl-weekly', name: 'Revue hebdo', type: 'journal', icon: '📅', title: 'Semaine du {{date}}',
    content: '## 🏆 Victoires de la semaine\n\n- \n\n## 📊 Avancement des projets\n\n- \n\n## 📚 Apprentissages\n\n- \n\n## 🎯 Objectifs semaine prochaine\n\n- ', mood: 'good', tags: ['hebdo'],
  },
];

function newJournalId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `journal-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function sortedEntries(data: WorkspaceData | null): JournalEntry[] {
  return [...(data?.journal ?? [])].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

function previewText(content: string): string {
  return content
    .replace(/[*_`#>\[\]()-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || 'Aucun contenu';
}

function interpolateTemplate(value: string): string {
  const now = new Date();
  return value
    .replace(/\{\{date\}\}/gi, now.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))
    .replace(/\{\{time\}\}/gi, now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }));
}

function emptyTemplateDraft(): JournalTemplateDraft {
  return { name: '', icon: '📋', title: '', content: '', mood: '', tags: '' };
}

@Component({
  selector: 'app-journal',
  standalone: true,
  imports: [CommonModule, FocusTrapDirective, FormsModule, MarkdownEditorComponent],
  templateUrl: './journal.component.html',
  styleUrl: './journal.component.css',
})
export class JournalComponent {
  protected readonly moods = MOODS;
  protected readonly loading = computed(() => this.store.loading());
  protected readonly entries = computed(() => sortedEntries(this.store.data()));
  protected readonly search = signal('');
  protected readonly selectedId = signal<string | null>(null);
  protected readonly draftTitle = signal('');
  protected readonly draftContent = signal('');
  protected readonly draftMood = signal('');
  protected readonly draftTags = signal('');
  protected readonly dialog = signal<JournalDialog>(null);
  protected readonly templateEditingId = signal<string | null>(null);
  protected readonly saveState = signal<'idle' | 'saving' | 'saved'>('idle');
  protected readonly selectedEntry = computed(() => {
    const id = this.selectedId();
    return this.store.data()?.journal.find((entry) => entry.id === id) ?? null;
  });
  protected readonly visibleEntries = computed(() => {
    const query = this.search().trim().toLowerCase();
    if (!query) return this.entries();
    return this.entries().filter((entry) => `${entry.title} ${entry.content} ${(entry.tags ?? []).join(' ')}`.toLowerCase().includes(query));
  });
  protected readonly templates = computed<JournalTemplate[]>(() => {
    const settings = this.store.data()?.settings;
    const stored = (settings?.templates ?? []).filter((template) => template.type === 'journal');
    const deleted = new Set(Array.isArray(settings?.['deletedTemplateIds'])
      ? settings['deletedTemplateIds'].filter((id): id is string => typeof id === 'string')
      : []);
    const templates = [
      ...stored,
      ...DEFAULT_JOURNAL_TEMPLATES.filter((fallback) => !stored.some((template) => template.id === fallback.id) && !deleted.has(fallback.id)),
    ].filter((template) => !deleted.has(template.id));

    return templates.map((template) => ({
      id: template.id,
      name: template.name,
      icon: typeof template['icon'] === 'string' ? template['icon'] : '📋',
      title: typeof template['title'] === 'string' ? template['title'] : '',
      content: typeof template['content'] === 'string' ? template['content'] : '',
      mood: typeof template['mood'] === 'string' ? template['mood'] : '',
      tags: Array.isArray(template['tags']) ? template['tags'].filter((tag): tag is string => typeof tag === 'string') : [],
    }));
  });

  private readonly store = inject(WorkspaceStoreService);
  private readonly preferences = inject(StoragePreferencesService);
  private readonly files = inject(FileAccessService);
  private readonly feedback = inject(FeedbackService);
  private readonly destroyRef = inject(DestroyRef);
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private initialized = false;
  private dirty = false;
  protected templateDraft: JournalTemplateDraft = emptyTemplateDraft();

  constructor() {
    effect(() => {
      const data = this.store.data();
      if (!data || this.initialized) return;
      this.initialized = true;
      if (this.preferences.get(STORAGE_KEYS.createJournal, null, 'session') === '1') {
        this.preferences.remove(STORAGE_KEYS.createJournal, 'session');
        this.createEntry();
        return;
      }
      this.selectEntry(sortedEntries(data)[0]?.id ?? null, false);
    });
    void this.store.init();
    this.destroyRef.onDestroy(() => {
      if (this.saveTimer) clearTimeout(this.saveTimer);
      if (this.dirty) this.saveNow();
    });
  }

  protected setSearch(event: Event): void { this.search.set((event.target as HTMLInputElement).value); }

  protected selectEntry(id: string | null, persist = true): void {
    if (id === this.selectedId()) return;
    if (persist) this.saveNow();
    const entry = this.store.data()?.journal.find((candidate) => candidate.id === id) ?? null;
    this.selectedId.set(id);
    this.draftTitle.set(entry?.title ?? '');
    this.draftContent.set(entry?.content ?? '');
    this.draftMood.set(entry?.mood ?? '');
    this.draftTags.set((entry?.tags ?? []).join(', '));
    this.saveState.set('idle');
    this.dirty = false;
  }

  protected createEntry(prefill: Partial<Pick<JournalEntry, 'title' | 'content' | 'mood' | 'tags'>> = {}): void {
    this.saveNow();
    const now = Date.now();
    const entry: JournalEntry = {
      id: newJournalId(),
      title: prefill.title ?? '',
      content: prefill.content ?? '',
      mood: prefill.mood ?? '',
      tags: prefill.tags ?? [],
      createdAt: now,
      updatedAt: now,
    };
    const updated = this.store.update((draft) => Object.assign(draft, createJournalEntry(draft, entry)));
    if (!updated) return;
    this.search.set('');
    this.selectEntry(entry.id, false);
    this.feedback.showToast('Nouvelle entree');
  }

  protected setTitle(event: Event): void { this.draftTitle.set((event.target as HTMLInputElement).value); this.scheduleSave(); }
  protected setContent(value: string): void { this.draftContent.set(value); this.scheduleSave(); }
  protected setTags(event: Event): void { this.draftTags.set((event.target as HTMLInputElement).value); this.scheduleSave(); }

  protected setMood(mood: string): void {
    this.draftMood.set(this.draftMood() === mood ? '' : mood);
    this.scheduleSave();
  }

  protected openTemplates(): void {
    this.templateEditingId.set(null);
    this.dialog.set('templates');
  }

  protected openNewTemplate(): void {
    this.templateEditingId.set(null);
    this.templateDraft = emptyTemplateDraft();
    this.dialog.set('templateForm');
  }

  protected openEditTemplate(template: JournalTemplate): void {
    this.templateEditingId.set(template.id);
    this.templateDraft = {
      name: template.name,
      icon: template.icon || '📋',
      title: template.title,
      content: template.content,
      mood: template.mood,
      tags: template.tags.join(', '),
    };
    this.dialog.set('templateForm');
  }

  protected cancelTemplateForm(): void {
    this.templateEditingId.set(null);
    this.dialog.set('templates');
  }

  protected closeDialog(): void {
    this.dialog.set(null);
    this.templateEditingId.set(null);
  }

  protected applyTemplate(template: JournalTemplate): void {
    this.closeDialog();
    this.createEntry({
      title: interpolateTemplate(template.title),
      content: interpolateTemplate(template.content),
      mood: template.mood,
      tags: [...template.tags],
    });
  }

  protected submitTemplate(): void {
    const name = this.templateDraft.name.trim();
    if (!name) {
      this.feedback.showToast('Nom du modèle requis', 'error');
      return;
    }

    const editingId = this.templateEditingId();
    const template: WorkspaceTemplate = {
      id: editingId || newJournalId(),
      name,
      type: 'journal',
      icon: this.templateDraft.icon.trim() || '📋',
      title: this.templateDraft.title.trim(),
      content: this.templateDraft.content,
      mood: this.templateDraft.mood,
      tags: this.templateDraft.tags.split(',').map((tag) => tag.trim()).filter(Boolean),
    };
    const next = this.store.update((data) => {
      const current = data.settings.templates ?? [];
      data.settings.templates = current.some((candidate) => candidate.id === template.id)
        ? current.map((candidate) => candidate.id === template.id ? { ...candidate, ...template } : candidate)
        : [...current, template];
      const deleted = Array.isArray(data.settings['deletedTemplateIds'])
        ? data.settings['deletedTemplateIds'].filter((id): id is string => typeof id === 'string' && id !== template.id)
        : [];
      if (deleted.length) data.settings['deletedTemplateIds'] = deleted;
      else delete data.settings['deletedTemplateIds'];
    });
    if (!next) return;
    this.templateEditingId.set(null);
    this.dialog.set('templates');
    this.feedback.showToast(editingId ? 'Modèle mis à jour' : 'Modèle créé', 'success');
  }

  protected async removeTemplate(template: JournalTemplate): Promise<void> {
    if (!await this.feedback.confirm({ title: `Supprimer « ${template.name} » ?`, message: 'Le modèle sera supprimé définitivement.', confirmLabel: 'Supprimer', destructive: true })) return;
    const next = this.store.update((data) => {
      data.settings.templates = (data.settings.templates ?? []).filter((candidate) => candidate.id !== template.id);
      const deleted = Array.isArray(data.settings['deletedTemplateIds'])
        ? data.settings['deletedTemplateIds'].filter((id): id is string => typeof id === 'string')
        : [];
      if (!deleted.includes(template.id)) deleted.push(template.id);
      data.settings['deletedTemplateIds'] = deleted;
    });
    if (next) this.feedback.showToast('Modèle supprimé', 'success');
  }

  protected saveNow(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    const id = this.selectedId();
    if (!id || !this.dirty && this.saveState() !== 'saving') return;
    const updated = this.store.update((draft) => {
      const next = updateJournalEntry(draft, id, {
        title: this.draftTitle().trim(),
        content: this.draftContent(),
        mood: this.draftMood(),
        tags: this.draftTags().split(',').map((tag) => tag.trim()).filter(Boolean),
      });
      if (next) Object.assign(draft, next);
    });
    if (!updated) return;
    this.dirty = false;
    this.saveState.set('saved');
  }

  protected async removeEntry(): Promise<void> {
    const id = this.selectedId();
    if (!id) return;
    await this.removeEntryById(id);
  }

  protected async removeEntryById(id: string): Promise<void> {
    const entry = this.store.data()?.journal.find((candidate) => candidate.id === id);
    if (!entry) return;
    const accepted = await this.feedback.confirm({ title: `Supprimer « ${entry.title || 'cette entree'} » ?`, message: 'Elle sera deplacee dans la corbeille.', destructive: true });
    if (!accepted) return;
    this.saveNow();
    const updated = this.store.update((draft) => {
      const next = deleteJournalEntry(draft, id);
      if (next) Object.assign(draft, next);
    });
    if (!updated) return;
    if (this.selectedId() === id) {
      const nextId = sortedEntries(updated)[0]?.id ?? null;
      this.selectEntry(nextId, false);
    }
    this.feedback.showToast('Entree deplacee dans la corbeille', 'success');
  }

  protected async exportJournal(format: 'json' | 'markdown'): Promise<void> {
    this.saveNow();
    const entries = this.entries();
    const content = format === 'json' ? JSON.stringify(entries, null, 2) : journalMarkdown(entries);
    const blob = new Blob([content], { type: format === 'json' ? 'application/json' : 'text/markdown;charset=utf-8' });
    const result = await this.files.saveBlob(blob, `workspace-journal-${todayStamp()}.${format === 'json' ? 'json' : 'md'}`);
    if (result.saved) this.feedback.showToast('Journal exporte', 'success');
    else if (!result.cancelled) this.feedback.showToast('Export impossible', 'error');
  }

  protected formatDay(timestamp: number | undefined): string { return timestamp ? new Date(timestamp).toLocaleDateString('fr-FR', { day: '2-digit' }) : '--'; }
  protected formatMonth(timestamp: number | undefined): string { return timestamp ? new Date(timestamp).toLocaleDateString('fr-FR', { month: 'short' }).replace('.', '') : ''; }
  protected formatDate(timestamp: number | undefined): string { return timestamp ? new Date(timestamp).toLocaleDateString('fr-FR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }) : ''; }
  protected formatTime(timestamp: number | undefined): string { return timestamp ? new Date(timestamp).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : ''; }
  protected moodLabel(id: string): string { return MOODS.find((mood) => mood.id === id)?.label ?? id; }
  protected moodMark(id: string): string { return ({ great: '+', good: 'o', neutral: '-', low: '~', bad: '!' } as Record<string, string>)[id] ?? ''; }
  protected contentPreview(content: string): string { return previewText(content); }

  private scheduleSave(): void {
    this.dirty = true;
    this.saveState.set('saving');
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.saveNow(), 400);
  }
}

function todayStamp(): string {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function journalMarkdown(entries: JournalEntry[]): string {
  if (!entries.length) return '_Aucune entree._';
  return [
    '# Journal',
    '',
    ...entries
      .slice()
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
      .flatMap((entry) => {
        const date = entry.createdAt ? new Date(entry.createdAt).toLocaleString('fr-FR') : '';
        const metadata = [date, entry.mood && `humeur : ${entry.mood}`, entry.tags?.join(', ')].filter(Boolean).join(' · ');
        return [`## ${entry.title || date}`, `_${metadata}_`, '', entry.content || '_(vide)_', ''];
      }),
  ].join('\n');
}
