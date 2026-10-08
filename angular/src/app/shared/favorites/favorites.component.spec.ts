import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { routes } from '../../app.routes';
import { FavoritesComponent, safeFavoriteUrl } from './favorites.component';

describe('FavoritesComponent', () => {
  beforeEach(() => TestBed.configureTestingModule({ imports: [FavoritesComponent], providers: [provideRouter(routes)] }));

  it('accepts internal legacy and external HTTPS links only', () => {
    expect(safeFavoriteUrl('project.html?id=project-alpha')).toBe('project.html?id=project-alpha');
    expect(safeFavoriteUrl('https://docs.example.invalid/workspace')).toBe('https://docs.example.invalid/workspace');
    expect(safeFavoriteUrl('javascript:alert(1)')).toBeNull();
    expect(safeFavoriteUrl('data:text/html,alert(1)')).toBeNull();
    expect(safeFavoriteUrl('//evil.example.invalid')).toBeNull();
    expect(safeFavoriteUrl('https://user:password@example.invalid')).toBeNull();
    expect(safeFavoriteUrl('https:\\evil.example.invalid')).toBeNull();
  });

  it('renders a closed accessible panel trigger', () => {
    const fixture = TestBed.createComponent(FavoritesComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.favorites-fab')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('.favorites-panel')).toBeNull();
  });

  it('keeps the panel fixed-size without resize controls', () => {
    const fixture = TestBed.createComponent(FavoritesComponent);
    fixture.componentInstance['open'].set(true);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.favorites-panel .dialog-reset-size')).toBeNull();
    expect(fixture.nativeElement.querySelector('.favorites-panel > header > button[aria-label="Fermer les favoris"]')).toBeTruthy();
  });

});
