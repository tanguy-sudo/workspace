import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TestBed } from '@angular/core/testing';
import { DatePickerComponent } from './date-picker.component';

@Component({
  standalone: true,
  imports: [DatePickerComponent, FormsModule],
  template: '<app-date-picker name="date" [(ngModel)]="date" /><app-date-picker name="dateTime" mode="datetime" [(ngModel)]="dateTime" />',
})
class DatePickerHostComponent {
  date = '2026-09-11';
  dateTime = '2026-09-11T14:30';
}

describe('DatePickerComponent', () => {
  it('keeps native values while rendering the custom calendar and time picker', async () => {
    await TestBed.configureTestingModule({ imports: [DatePickerHostComponent] }).compileComponents();
    const fixture = TestBed.createComponent(DatePickerHostComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const triggers = fixture.nativeElement.querySelectorAll('.dt-trigger') as NodeListOf<HTMLButtonElement>;
    expect(triggers[0].textContent).toContain('11/09/2026');
    expect(triggers[1].textContent).toContain('11/09/2026 à 14:30');

    triggers[1].click();
    fixture.detectChanges();
    const popup = fixture.nativeElement.querySelector('.dt-popup') as HTMLElement;
    const hour = popup.querySelector('.dt-hour') as HTMLInputElement;
    hour.value = '16';
    hour.dispatchEvent(new Event('input', { bubbles: true }));
    (popup.querySelector('.dt-btn-ok') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(fixture.componentInstance.dateTime).toBe('2026-09-11T16:30');
    expect(fixture.nativeElement.querySelectorAll('.dt-popup')).toHaveLength(0);
  });
});
