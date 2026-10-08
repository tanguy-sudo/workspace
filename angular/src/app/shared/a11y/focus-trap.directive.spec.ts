import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FocusTrapDirective } from './focus-trap.directive';

@Component({
  standalone: true,
  imports: [FocusTrapDirective],
  template: '<section appFocusTrap tabindex="-1"><button>Premier</button><button>Dernier</button></section>',
})
class FocusTrapHostComponent {}

describe('FocusTrapDirective', () => {
  it('focuses the first control, wraps Tab and restores the trigger', async () => {
    await TestBed.configureTestingModule({ imports: [FocusTrapHostComponent] }).compileComponents();
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();

    const fixture = TestBed.createComponent(FocusTrapHostComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    const dialog = fixture.nativeElement.querySelector('section') as HTMLElement;
    const buttons = dialog.querySelectorAll('button');
    expect(document.activeElement).toBe(buttons[0]);

    buttons[1].focus();
    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    expect(document.activeElement).toBe(buttons[0]);

    fixture.destroy();
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });
});
