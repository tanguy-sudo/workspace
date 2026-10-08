import { AfterViewInit, Component, ElementRef, ViewChild, computed, forwardRef, input, output, signal } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { renderSafeMarkdown } from './safe-rendering';

type EditorMode = 'edit' | 'split' | 'preview';
type Command = 'heading' | 'bold' | 'italic' | 'strike' | 'link' | 'image' | 'unordered' | 'ordered' | 'task' | 'quote' | 'code' | 'codeblock' | 'table' | 'rule' | 'wiki';

interface ToolbarItem {
  command?: Command;
  label?: string;
  title?: string;
  separator?: boolean;
}

const TOOLBAR: ToolbarItem[] = [
  { command: 'heading', label: 'H1', title: 'Titre' },
  { command: 'bold', label: 'B', title: 'Gras (Ctrl+B)' },
  { command: 'italic', label: 'I', title: 'Italique (Ctrl+I)' },
  { command: 'strike', label: 'S', title: 'Barre' },
  { separator: true },
  { command: 'link', label: 'Link', title: 'Lien (Ctrl+K)' },
  { command: 'image', label: 'Img', title: 'Image' },
  { separator: true },
  { command: 'unordered', label: '-', title: 'Liste a puces' },
  { command: 'ordered', label: '1.', title: 'Liste numerotee' },
  { command: 'task', label: '[]', title: 'Tache' },
  { separator: true },
  { command: 'quote', label: '>', title: 'Citation' },
  { command: 'code', label: '`', title: 'Code inline' },
  { command: 'codeblock', label: '{}', title: 'Bloc de code' },
  { command: 'table', label: 'Table', title: 'Tableau' },
  { command: 'rule', label: '---', title: 'Separateur' },
  { separator: true },
  { command: 'wiki', label: '[[ ]]', title: 'Lien wiki' },
];

const MODES: Array<{ id: EditorMode; label: string }> = [
  { id: 'edit', label: 'Edition' },
  { id: 'split', label: 'Cote a cote' },
  { id: 'preview', label: 'Apercu' },
];

@Component({
  selector: 'app-markdown-editor',
  standalone: true,
  templateUrl: './markdown-editor.component.html',
  providers: [{ provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => MarkdownEditorComponent), multi: true }],
})
export class MarkdownEditorComponent implements ControlValueAccessor, AfterViewInit {
  @ViewChild('input') private input?: ElementRef<HTMLTextAreaElement>;

  readonly placeholder = input('Ecrivez en Markdown...');
  readonly minHeight = input(140);
  readonly name = input('');
  readonly wikiLink = output<string>();

  protected readonly toolbar = TOOLBAR;
  protected readonly modes = MODES;
  protected readonly mode = signal<EditorMode>('edit');
  protected readonly value = signal('');
  protected readonly previewHtml = computed(() => renderSafeMarkdown(this.value()));
  protected readonly disabled = signal(false);

  private onChange: (value: string) => void = () => undefined;
  private onTouched: () => void = () => undefined;

  ngAfterViewInit(): void { this.autosize(); }

  writeValue(value: string | null): void {
    this.value.set(value ?? '');
    this.autosize();
  }

  registerOnChange(fn: (value: string) => void): void { this.onChange = fn; }
  registerOnTouched(fn: () => void): void { this.onTouched = fn; }
  setDisabledState(disabled: boolean): void { this.disabled.set(disabled); }

  protected onInput(event: Event): void {
    const value = (event.target as HTMLTextAreaElement).value;
    this.value.set(value);
    this.onChange(value);
    this.autosize();
  }

  protected onBlur(): void { this.onTouched(); }

  protected setMode(mode: EditorMode): void { this.mode.set(mode); }

  protected onPreviewClick(event: MouseEvent): void {
    const target = (event.target as HTMLElement | null)?.closest<HTMLElement>('.wiki-link');
    const title = target?.dataset['wiki'] ?? target?.textContent?.replace(/^\[\[|\]\]$/g, '').trim();
    if (!title) return;
    event.preventDefault();
    this.wikiLink.emit(title);
  }

  protected onPreviewKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    this.onPreviewClick(event as unknown as MouseEvent);
  }

  protected onKeydown(event: KeyboardEvent): void {
    const key = event.key.toLowerCase();
    if ((event.ctrlKey || event.metaKey) && !event.shiftKey) {
      const command: Command | null = key === 'b' ? 'bold' : key === 'i' ? 'italic' : key === 'k' ? 'link' : null;
      if (command) {
        event.preventDefault();
        this.applyCommand(command);
        return;
      }
      if (key === '1' || key === '2' || key === '3') {
        event.preventDefault();
        this.wrapLines('#'.repeat(Number(key)) + ' ');
        return;
      }
    }

    if (event.key === 'Tab') {
      event.preventDefault();
      event.shiftKey ? this.outdent() : this.indent();
      return;
    }

    if (event.key === 'Enter') this.continueList(event);
  }

  protected applyCommand(command: Command): void {
    switch (command) {
      case 'heading': return this.wrapLines('# ');
      case 'bold': return this.wrapSelection('**', '**', 'texte en gras');
      case 'italic': return this.wrapSelection('*', '*', 'texte en italique');
      case 'strike': return this.wrapSelection('~~', '~~', 'texte barre');
      case 'code': return this.wrapSelection('`', '`', 'code');
      case 'quote': return this.wrapLines('> ');
      case 'unordered': return this.wrapLines('- ');
      case 'ordered': return this.wrapLines('1. ');
      case 'task': return this.wrapLines('- [ ] ');
      case 'wiki': return this.wrapSelection('[[', ']]', 'Titre');
      case 'link': {
        const url = globalThis.prompt?.('URL du lien :', 'https://');
        if (url != null) this.wrapSelection('[', `](${url})`, 'texte du lien');
        return;
      }
      case 'image': {
        const url = globalThis.prompt?.("URL de l'image :", 'https://');
        if (url != null) this.wrapSelection('![', `](${url})`, 'alt');
        return;
      }
      case 'codeblock': return this.wrapSelection('\n```\n', '\n```\n', 'code');
      case 'table': return this.insertAtCursor('\n| Colonne 1 | Colonne 2 |\n| --- | --- |\n| valeur | valeur |\n');
      case 'rule': return this.insertAtCursor('\n\n***\n\n');
    }
  }

  private selectionInfo(): { start: number; end: number; value: string; lineStart: number; lineEnd: number; line: string } {
    const element = this.input?.nativeElement;
    const value = this.value();
    const start = element?.selectionStart ?? value.length;
    const end = element?.selectionEnd ?? start;
    const lineStart = value.lastIndexOf('\n', start - 1) + 1;
    const lineEnd = value.indexOf('\n', end);
    const line = value.slice(lineStart, lineEnd === -1 ? value.length : lineEnd);
    return { start, end, value, lineStart, lineEnd, line };
  }

  private replace(start: number, end: number, replacement: string, selectionStart = start + replacement.length, selectionEnd = selectionStart): void {
    const next = this.value().slice(0, start) + replacement + this.value().slice(end);
    this.value.set(next);
    this.onChange(next);
    const element = this.input?.nativeElement;
    element?.focus();
    if (element) {
      element.selectionStart = selectionStart;
      element.selectionEnd = selectionEnd;
    }
    this.autosize();
  }

  private wrapSelection(prefix: string, suffix: string, placeholder: string): void {
    const { start, end, value } = this.selectionInfo();
    const selected = value.slice(start, end);
    const content = selected || placeholder;
    const replacement = `${prefix}${content}${suffix}`;
    const selectionStart = selected ? start + replacement.length : start + prefix.length;
    const selectionEnd = selected ? selectionStart : selectionStart + placeholder.length;
    this.replace(start, end, replacement, selectionStart, selectionEnd);
  }

  private wrapLines(prefix: string): void {
    const { start, end, value, lineStart, lineEnd } = this.selectionInfo();
    const blockEnd = lineEnd === -1 ? value.length : lineEnd;
    const block = value.slice(lineStart, blockEnd);
    this.replace(lineStart, blockEnd, block.split('\n').map((line) => prefix + line).join('\n'));
    if (start === end) {
      const element = this.input?.nativeElement;
      const position = lineStart + prefix.length + block.length;
      if (element) element.selectionStart = element.selectionEnd = position;
    }
  }

  private insertAtCursor(text: string): void {
    const { start, end } = this.selectionInfo();
    this.replace(start, end, text);
  }

  private continueList(event: KeyboardEvent): void {
    const { line } = this.selectionInfo();
    const match = line.match(/^(\s*)([-*+]\s+\[([ x])\]\s+|[-*+]\s+|(\d+)\.\s+)/);
    if (!match) return;
    const content = line.slice(match[0].length);
    if (!content.trim()) {
      event.preventDefault();
      this.replaceCurrentLine('');
      return;
    }
    event.preventDefault();
    const marker = match[2];
    const next = marker.includes('[') ? `\n${match[1]}- [ ] ` : /^\d+\./.test(marker) ? `\n${match[1]}${Number(match[4]) + 1}. ` : `\n${match[1]}${marker}`;
    this.insertAtCursor(next);
  }

  private replaceCurrentLine(text: string): void {
    const { lineStart, lineEnd } = this.selectionInfo();
    this.replace(lineStart, lineEnd === -1 ? this.value().length : lineEnd, text);
  }

  private indent(): void {
    const { start, end, value, lineStart } = this.selectionInfo();
    if (start === end) this.replace(start, end, '  ');
    else this.replace(lineStart, end, value.slice(lineStart, end).split('\n').map((line) => `  ${line}`).join('\n'));
  }

  private outdent(): void {
    const { end, value, lineStart } = this.selectionInfo();
    this.replace(lineStart, end, value.slice(lineStart, end).split('\n').map((line) => line.replace(/^( {1,2}|\t)/, '')).join('\n'));
  }

  private autosize(): void {
    const element = this.input?.nativeElement;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${Math.max(this.minHeight(), element.scrollHeight)}px`;
  }
}
