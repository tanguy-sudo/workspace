import { TestBed } from '@angular/core/testing';
import { FeedbackComponent } from './feedback.component';
import { FeedbackService } from './feedback.service';

describe('FeedbackComponent', () => {
  let feedback: FeedbackService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [FeedbackComponent],
      providers: [FeedbackService],
    });
    feedback = TestBed.inject(FeedbackService);
  });

  it('renders an accessible dialog and traps Tab focus', async () => {
    const fixture = TestBed.createComponent(FeedbackComponent);
    fixture.detectChanges();
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();

    feedback.confirm({ title: 'Action destructive', message: 'Confirmer ?', destructive: true });
    fixture.detectChanges();
    await fixture.whenStable();

    const dialog = fixture.nativeElement.querySelector('[role="alertdialog"]') as HTMLElement;
    const buttons = dialog.querySelectorAll('button');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-labelledby')).toBe('dialog-title');
    expect(buttons).toHaveLength(3);

    (buttons[2] as HTMLButtonElement).focus();
    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    expect(document.activeElement).toBe(buttons[0]);

    feedback.resolveModal(false);
    fixture.detectChanges();
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });

  it('closes on Escape without leaving a modal promise pending', async () => {
    const fixture = TestBed.createComponent(FeedbackComponent);
    fixture.detectChanges();
    const result = feedback.confirm({ title: 'Question', message: 'Continuer ?' });
    fixture.detectChanges();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await expect(result).resolves.toBe(false);
  });
});
