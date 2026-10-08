import { TestBed } from '@angular/core/testing';
import { SandboxPreviewComponent } from './sandbox-preview.component';

describe('SandboxPreviewComponent', () => {
  beforeEach(() => TestBed.configureTestingModule({ imports: [SandboxPreviewComponent] }));

  it('renders hostile HTML in an empty sandbox', () => {
    const fixture = TestBed.createComponent(SandboxPreviewComponent);
    fixture.componentRef.setInput('source', '<script>alert(1)</script><img src="https://evil.invalid/image.png"><img src="javascript:alert(2)" onerror="alert(3)"><style>@import url(https://evil.invalid/x.css); body { background: url(https://evil.invalid/x); }</style>');
    fixture.detectChanges();

    const frame = fixture.nativeElement.querySelector('iframe') as HTMLIFrameElement;
    expect(frame.getAttribute('sandbox')).toBe('');
    expect(frame.getAttribute('allow')).toBeNull();
    expect(frame.srcdoc).not.toContain('<script');
    expect(frame.srcdoc).not.toContain('javascript:');
    expect(frame.srcdoc).not.toContain('https://evil.invalid/image.png');
    expect(frame.srcdoc).not.toContain('@import');
    expect(frame.srcdoc).not.toContain('url(');
    expect(frame.srcdoc).not.toContain('allow-scripts');
    expect(frame.srcdoc).not.toContain('allow-same-origin');
  });

  it('sanitizes CSS breakout text before building the preview document', () => {
    const fixture = TestBed.createComponent(SandboxPreviewComponent);
    fixture.componentRef.setInput('language', 'css');
    fixture.componentRef.setInput('source', '</style><script>alert(1)</script> body { color: red; }');
    fixture.detectChanges();

    const frame = fixture.nativeElement.querySelector('iframe') as HTMLIFrameElement;
    expect(frame.srcdoc).not.toContain('<script');
    expect(frame.srcdoc).not.toContain('</style><script');
    expect(frame.srcdoc).toContain('color: red');
  });
});
