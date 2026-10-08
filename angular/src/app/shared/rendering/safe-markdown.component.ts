import { Component, computed, input, output } from '@angular/core';
import { renderSafeMarkdown } from './safe-rendering';

@Component({
  selector: 'app-safe-markdown',
  standalone: true,
  templateUrl: './safe-markdown.component.html',
})
export class SafeMarkdownComponent {
  readonly markdown = input('');
  readonly wikiLink = output<string>();
  protected readonly html = computed(() => renderSafeMarkdown(this.markdown()));

  protected onClick(event: MouseEvent): void {
    const target = (event.target as HTMLElement | null)?.closest<HTMLElement>('.wiki-link') ?? null;
    this.emitWikiLink(event, target);
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const target = (event.target as HTMLElement | null)?.closest<HTMLElement>('.wiki-link') ?? null;
    this.emitWikiLink(event, target);
  }

  private emitWikiLink(event: Event, target: HTMLElement | null): void {
    const title = target?.dataset['wiki'] ?? target?.textContent?.replace(/^\[\[|\]\]$/g, '').trim();
    if (!title) return;
    event.preventDefault();
    this.wikiLink.emit(title);
  }
}
