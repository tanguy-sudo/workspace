import { ChangeDetectorRef, Component, ElementRef, HostListener, Input, OnDestroy, ViewChild, forwardRef, inject } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

interface CalendarDay {
  date: Date;
  timestamp: number;
  otherMonth: boolean;
}

type DatePickerMode = 'date' | 'datetime';

const MONTHS_FR = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
];
const WEEKDAYS_FR = ['Lu', 'Ma', 'Me', 'Je', 'Ve', 'Sa', 'Di'];

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function fromNative(value: string, mode: DatePickerMode): Date | null {
  if (!value) return null;
  const date = new Date(mode === 'datetime' ? value : `${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toNative(date: Date, mode: DatePickerMode): string {
  const result = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return mode === 'datetime' ? `${result}T${pad(date.getHours())}:${pad(date.getMinutes())}` : result;
}

function sameDay(a: Date | null, b: Date): boolean {
  return !!a && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

@Component({
  selector: 'app-date-picker',
  standalone: true,
  templateUrl: './date-picker.component.html',
  styleUrl: './date-picker.component.css',
  providers: [{ provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => DatePickerComponent), multi: true }],
})
export class DatePickerComponent implements ControlValueAccessor, OnDestroy {
  private static nextId = 0;

  @Input() mode: DatePickerMode = 'date';
  @Input() name = '';
  @Input() placeholder = '';
  @Input() ariaLabel = '';

  @ViewChild('trigger', { static: true }) private readonly trigger?: ElementRef<HTMLButtonElement>;
  @ViewChild('popup') private readonly popup?: ElementRef<HTMLDivElement>;

  protected readonly weekdays = WEEKDAYS_FR;
  protected value = '';
  protected open = false;
  protected positioned = false;
  protected viewYear = new Date().getFullYear();
  protected viewMonth = new Date().getMonth();
  protected draft: Date | null = null;
  protected popupAbove = false;
  protected popupAlignEnd = false;
  protected readonly popupId = `date-picker-popup-${DatePickerComponent.nextId++}`;

  protected disabled = false;
  private animationFrame: number | null = null;
  private onChange: (value: string) => void = () => undefined;
  private onTouched: () => void = () => undefined;
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly changeDetector = inject(ChangeDetectorRef);

  protected get monthLabel(): string {
    return `${MONTHS_FR[this.viewMonth]} ${this.viewYear}`;
  }

  protected get displayValue(): string {
    const date = fromNative(this.value, this.mode);
    if (!date) return '';
    const result = `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`;
    return this.mode === 'datetime' ? `${result} à ${pad(date.getHours())}:${pad(date.getMinutes())}` : result;
  }

  protected get effectivePlaceholder(): string {
    return this.placeholder || (this.mode === 'datetime' ? 'Choisir date & heure…' : 'Choisir une date…');
  }

  protected formatTime(value: number): string {
    return pad(value);
  }

  protected get calendarDays(): CalendarDay[] {
    const firstDay = new Date(this.viewYear, this.viewMonth, 1);
    const lastDay = new Date(this.viewYear, this.viewMonth + 1, 0);
    const startDay = firstDay.getDay() === 0 ? 6 : firstDay.getDay() - 1;
    const days: CalendarDay[] = [];

    for (let index = startDay - 1; index >= 0; index--) {
      const date = new Date(this.viewYear, this.viewMonth, -index);
      days.push({ date, timestamp: date.getTime(), otherMonth: true });
    }
    for (let day = 1; day <= lastDay.getDate(); day++) {
      const date = new Date(this.viewYear, this.viewMonth, day);
      days.push({ date, timestamp: date.getTime(), otherMonth: false });
    }
    let nextDay = 1;
    while (days.length < 42) {
      const date = new Date(this.viewYear, this.viewMonth + 1, nextDay++);
      days.push({ date, timestamp: date.getTime(), otherMonth: true });
    }
    return days;
  }

  writeValue(value: string | null | undefined): void {
    this.value = value || '';
    if (!this.open) this.draft = fromNative(this.value, this.mode);
  }

  registerOnChange(fn: (value: string) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this.disabled = isDisabled;
    if (isDisabled) this.close();
  }

  protected toggle(event: MouseEvent): void {
    event.stopPropagation();
    if (this.disabled) return;
    if (this.open) {
      this.close();
      return;
    }

    this.open = true;
    this.positioned = false;
    this.popupAbove = false;
    this.popupAlignEnd = false;
    this.draft = fromNative(this.value, this.mode);
    const initial = this.draft || new Date();
    this.viewYear = initial.getFullYear();
    this.viewMonth = initial.getMonth();
    this.changeDetector.detectChanges();
    this.schedulePosition();
  }

  protected selectDay(date: Date): void {
    const next = new Date(date);
    const base = this.draft || new Date(this.viewYear, this.viewMonth, 1, 9, 0, 0, 0);
    next.setHours(base.getHours(), base.getMinutes(), 0, 0);
    this.draft = next;
    this.viewYear = next.getFullYear();
    this.viewMonth = next.getMonth();
  }

  protected previousMonth(): void {
    if (--this.viewMonth < 0) {
      this.viewMonth = 11;
      this.viewYear--;
    }
  }

  protected nextMonth(): void {
    if (++this.viewMonth > 11) {
      this.viewMonth = 0;
      this.viewYear++;
    }
  }

  protected setToday(): void {
    const today = new Date();
    if (this.mode === 'date') today.setHours(0, 0, 0, 0);
    this.draft = today;
    this.viewYear = today.getFullYear();
    this.viewMonth = today.getMonth();
  }

  protected updateHour(event: Event): void {
    this.updateTime('hours', Number((event.target as HTMLInputElement).value));
  }

  protected updateMinute(event: Event): void {
    this.updateTime('minutes', Number((event.target as HTMLInputElement).value));
  }

  protected isSelected(date: Date): boolean {
    return sameDay(this.draft, date);
  }

  protected isToday(date: Date): boolean {
    return sameDay(new Date(), date);
  }

  protected dayLabel(date: Date): string {
    return date.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  }

  protected confirm(): void {
    const value = this.draft ? toNative(this.draft, this.mode) : '';
    this.value = value;
    this.onChange(value);
    this.close();
  }

  protected clear(): void {
    this.draft = null;
    this.value = '';
    this.onChange('');
    this.close();
  }

  @HostListener('document:click', ['$event'])
  protected closeOnOutsideClick(event: MouseEvent): void {
    if (this.open && !this.host.nativeElement.contains(event.target as Node)) this.close();
  }

  @HostListener('document:keydown.escape')
  protected closeOnEscape(): void {
    if (this.open) this.close();
  }

  @HostListener('window:resize')
  protected repositionOnResize(): void {
    if (this.open) this.schedulePosition();
  }

  @HostListener('window:scroll')
  protected repositionOnScroll(): void {
    if (this.open) this.schedulePosition();
  }

  ngOnDestroy(): void {
    this.cancelPosition();
  }

  private updateTime(part: 'hours' | 'minutes', value: number): void {
    const date = this.draft || new Date(this.viewYear, this.viewMonth, 1, 9, 0, 0, 0);
    const next = new Date(date);
    if (part === 'hours') next.setHours(Math.min(23, Math.max(0, Number.isFinite(value) ? value : 0)));
    else next.setMinutes(Math.min(59, Math.max(0, Number.isFinite(value) ? value : 0)));
    next.setSeconds(0, 0);
    this.draft = next;
  }

  private close(): void {
    if (!this.open) return;
    this.open = false;
    this.positioned = false;
    this.cancelPosition();
    this.onTouched();
  }

  private schedulePosition(): void {
    this.cancelPosition();
    this.animationFrame = requestAnimationFrame(() => {
      this.animationFrame = null;
      this.positionPopup();
    });
  }

  private positionPopup(): void {
    const trigger = this.trigger?.nativeElement;
    const popup = this.popup?.nativeElement;
    if (!trigger || !popup || !this.open) return;

    const rect = trigger.getBoundingClientRect();
    const margin = 8;
    const popupWidth = popup.offsetWidth || 288;
    const popupHeight = popup.offsetHeight || 420;
    this.popupAbove = rect.bottom + popupHeight + 6 > window.innerHeight - margin && rect.top - popupHeight - 6 >= margin;
    this.popupAlignEnd = rect.left + popupWidth > window.innerWidth - margin;
    this.positioned = true;
    this.changeDetector.detectChanges();
  }

  private cancelPosition(): void {
    if (this.animationFrame !== null) cancelAnimationFrame(this.animationFrame);
    this.animationFrame = null;
  }
}
