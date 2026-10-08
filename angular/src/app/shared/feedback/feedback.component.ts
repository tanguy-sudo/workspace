import { Component, HostListener, inject } from '@angular/core';
import { FeedbackService } from './feedback.service';
import { FocusTrapDirective } from '../a11y/focus-trap.directive';
import { ResizableDialogDirective } from '../dialog/resizable-dialog.directive';

@Component({
  selector: 'app-feedback',
  standalone: true,
  imports: [FocusTrapDirective, ResizableDialogDirective],
  templateUrl: './feedback.component.html',
  styleUrl: './feedback.component.css',
})
export class FeedbackComponent {
  protected readonly feedback = inject(FeedbackService);

  @HostListener('document:keydown', ['$event'])
  protected onKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape' || !this.feedback.modal()) return;
    event.preventDefault();
    this.feedback.resolveModal(false);
  }

  onBackdrop(event: MouseEvent): void {
    if (event.target === event.currentTarget) this.feedback.resolveModal(false);
  }
}
