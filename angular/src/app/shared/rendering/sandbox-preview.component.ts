import { AfterViewChecked, Component, ElementRef, ViewChild, computed, input } from '@angular/core';
import { buildSandboxPreview } from './safe-rendering';

@Component({
  selector: 'app-sandbox-preview',
  standalone: true,
  templateUrl: './sandbox-preview.component.html',
  styleUrl: './sandbox-preview.component.css',
})
export class SandboxPreviewComponent implements AfterViewChecked {
  @ViewChild('frame') private frame?: ElementRef<HTMLIFrameElement>;
  readonly source = input('');
  readonly language = input<'html' | 'css'>('html');
  readonly title = input('Apercu securise');
  protected readonly document = computed(() => buildSandboxPreview(this.source(), this.language()));
  private appliedDocument = '';

  ngAfterViewChecked(): void {
    const document = this.document();
    if (!this.frame || document === this.appliedDocument) return;
    this.frame.nativeElement.srcdoc = document;
    this.appliedDocument = document;
  }
}
