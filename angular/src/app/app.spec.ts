import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { App } from './app';
import { routes } from './app.routes';
import { GlobalSearchService } from './shared/search/global-search.service';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter(routes)],
    }).compileComponents();
  });

  it('creates the standalone shell', () => {
    expect(TestBed.createComponent(App).componentInstance).toBeTruthy();
  });

  it('renders the shared shell without legacy scripts', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('.brand')?.textContent).toContain('Workspace');
    expect(element.querySelector('nav[aria-label="Navigation principale"]')).toBeTruthy();
    expect(element.querySelector('script')).toBeNull();
  });

  it('opens search and handles g navigation without shortcuts in inputs', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const search = TestBed.inject(GlobalSearchService);
    const event = new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true });
    fixture.componentInstance['onShortcut'](event);
    expect(search.isOpen()).toBe(true);

    const input = document.createElement('input');
    document.body.appendChild(input);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'g', bubbles: true }));
    expect(TestBed.inject(GlobalSearchService).isOpen()).toBe(true);
    input.remove();
  });

  it('opens the legacy-style theme and accent picker', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const trigger = fixture.nativeElement.querySelector('.theme-toggle') as HTMLButtonElement;
    trigger.click();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelectorAll('.theme-picker-item')).toHaveLength(12);
    expect(fixture.nativeElement.querySelector('.theme-picker-accent-input')).toBeTruthy();
  });
});
