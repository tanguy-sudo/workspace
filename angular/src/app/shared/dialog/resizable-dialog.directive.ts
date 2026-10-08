import { AfterViewInit, Directive, ElementRef, OnDestroy, Renderer2, inject } from '@angular/core';
import { StoragePreferencesService } from '../../core/persistence/storage-preferences.service';

@Directive({
  selector: '.dialog, [appResizableDialog]',
  standalone: true,
})
export class ResizableDialogDirective implements AfterViewInit, OnDestroy {
  private readonly element = inject(ElementRef<HTMLElement>);
  private readonly renderer = inject(Renderer2);
  private readonly preferences = inject(StoragePreferencesService);
  private readonly key = this.element.nativeElement.getAttribute('aria-labelledby') || 'dialog';
  private observer?: ResizeObserver;
  private resetButton?: HTMLButtonElement;
  private readonly removeListeners: Array<() => void> = [];
  private dragStart: { x: number; y: number } | null = null;
  private resizeStart: { x: number; y: number; width: number; height: number; direction: string } | null = null;
  private suppressBackdropClick = false;
  private restoring = true;

  ngAfterViewInit(): void {
    const host = this.element.nativeElement;
    const saved = this.preferences.getModalSize?.(this.key);
    if (saved) {
      host.style.width = `${saved.width}px`;
      host.style.height = `${saved.height}px`;
    }

    this.resetButton = this.renderer.createElement('button') as HTMLButtonElement;
    this.renderer.setAttribute(this.resetButton, 'type', 'button');
    this.renderer.setAttribute(this.resetButton, 'aria-label', 'Réinitialiser la taille de la popin');
    this.renderer.setAttribute(this.resetButton, 'title', 'Réinitialiser la taille');
    this.renderer.addClass(this.resetButton, 'dialog-reset-size');
    this.renderer.setProperty(this.resetButton, 'innerHTML', '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M13.5 6A5.5 5.5 0 1 0 14 9" /><path d="M13.5 2.5V6H10" /></svg>');
    this.renderer.listen(this.resetButton, 'click', () => this.resetSize());
    this.renderer.appendChild(host, this.resetButton);

    for (const direction of ['nw', 'ne', 'sw', 'se']) {
      const handle = this.renderer.createElement('span') as HTMLSpanElement;
      this.renderer.addClass(handle, 'dialog-resize-handle');
      this.renderer.addClass(handle, `dialog-resize-handle--${direction}`);
      this.renderer.setAttribute(handle, 'role', 'separator');
      this.renderer.setAttribute(handle, 'aria-label', `Redimensionner la popin depuis le coin ${direction}`);
      this.renderer.listen(handle, 'mousedown', (event: MouseEvent) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        const rect = host.getBoundingClientRect();
        this.resizeStart = { x: event.clientX, y: event.clientY, width: rect.width, height: rect.height, direction };
        this.dragStart = { x: event.clientX, y: event.clientY };
      });
      this.renderer.appendChild(host, handle);
    }

    const onMouseDown = (event: MouseEvent) => {
      if (event.button === 0) this.dragStart = { x: event.clientX, y: event.clientY };
    };
    const onMouseMove = (event: MouseEvent) => {
      if (this.resizeStart) {
        const { x, y, width, height, direction } = this.resizeStart;
        const horizontal = direction.includes('w') ? x - event.clientX : event.clientX - x;
        const vertical = direction.includes('n') ? y - event.clientY : event.clientY - y;
        host.style.width = `${width + horizontal}px`;
        host.style.height = `${height + vertical}px`;
        this.suppressBackdropClick = true;
        return;
      }
      if (!this.dragStart) return;
      if (Math.abs(event.clientX - this.dragStart.x) > 3 || Math.abs(event.clientY - this.dragStart.y) > 3) {
        this.suppressBackdropClick = true;
      }
    };
    const onMouseUp = () => { this.dragStart = null; this.resizeStart = null; };
    const onClick = (event: MouseEvent) => {
      if (!this.suppressBackdropClick) return;
      event.preventDefault();
      event.stopPropagation();
      this.suppressBackdropClick = false;
    };
    const removeMouseDown = this.renderer.listen(host, 'mousedown', onMouseDown);
    const removeMouseMove = this.renderer.listen(document, 'mousemove', onMouseMove);
    const removeMouseUp = this.renderer.listen(document, 'mouseup', onMouseUp);
    this.removeListeners.push(removeMouseDown, removeMouseMove, removeMouseUp);
    this.removeListeners.push(this.renderer.listen(document, 'click', onClick, { capture: true }));

    if (typeof ResizeObserver === 'undefined') {
      this.restoring = false;
      return;
    }
    this.observer = new ResizeObserver(() => {
      if (this.restoring) return;
      const rect = host.getBoundingClientRect();
      this.preferences.setModalSize?.(this.key, { width: rect.width, height: rect.height });
    });
    this.observer.observe(host);
    requestAnimationFrame(() => { this.restoring = false; });
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
    this.removeListeners.forEach((remove) => remove());
  }

  private resetSize(): void {
    const host = this.element.nativeElement;
    this.preferences.removeModalSize?.(this.key);
    this.renderer.removeStyle(host, 'width');
    this.renderer.removeStyle(host, 'height');
  }
}
