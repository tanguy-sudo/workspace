import { TestBed } from '@angular/core/testing';
import { MarkdownEditorComponent } from './markdown-editor.component';

describe('MarkdownEditorComponent', () => {
  beforeEach(() => TestBed.configureTestingModule({ imports: [MarkdownEditorComponent] }));

  it('keeps the form name, propagates input and renders the live preview', () => {
    const fixture = TestBed.createComponent(MarkdownEditorComponent);
    const changed = vi.fn();
    fixture.componentInstance.registerOnChange(changed);
    fixture.componentRef.setInput('name', 'description');
    fixture.componentInstance.writeValue('# Title\n\n**bold**');
    fixture.detectChanges();

    const textarea = fixture.nativeElement.querySelector('textarea') as HTMLTextAreaElement;
    expect(textarea.name).toBe('description');
    textarea.value = '# Updated';
    textarea.dispatchEvent(new Event('input'));
    expect(changed).toHaveBeenCalledWith('# Updated');

    (fixture.nativeElement.querySelectorAll('.md-mode-btn')[2] as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.md-preview h1')?.textContent).toBe('Updated');
  });
});
