import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { routes } from './app.routes';

describe('Angular routes', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideRouter(routes)] });
  });

  it('redirects the empty route to the dashboard', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/');

    expect(TestBed.inject(Router).url).toBe('/home');
    expect(harness.routeNativeElement?.querySelector('#dashboard-title')).toBeTruthy();
    expect(harness.routeNativeElement?.querySelector('.error-message')).toBeNull();
  });

  it('supports the projects shell and registers the project detail route', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/projects?parent=project-1');
    expect(TestBed.inject(Router).url).toBe('/projects?parent=project-1');
    expect(harness.routeNativeElement?.querySelector('h1')?.textContent).toContain('Projets');

    expect(routes.find((route) => route.path === 'project/:id')?.loadComponent).toBeTypeOf('function');
  });

  it('mounts the projects migration route with its parent scope', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/projects?parent=project-alpha');

    expect(TestBed.inject(Router).url).toBe('/projects?parent=project-alpha');
    expect(harness.routeNativeElement?.querySelector('#projects-title')?.textContent).toContain('Projets');
  });

  it('keeps the project detail route in the router configuration', () => {
    expect(routes).toContainEqual(expect.objectContaining({ path: 'project/:id' }));
  });

  it('registers the lazy tasks route', () => {
    expect(routes.find((route) => route.path === 'todos')?.loadComponent).toBeTypeOf('function');
  });

  it('registers and mounts the lazy dashboard route', async () => {
    expect(routes.find((route) => route.path === 'home')?.loadComponent).toBeTypeOf('function');
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/home');

    expect(harness.routeNativeElement?.querySelector('#dashboard-title')).toBeTruthy();
  });

  it('mounts the migrated tasks route with legacy filters', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/todos?project=none&view=list');

    expect(TestBed.inject(Router).url).toBe('/todos?project=none&view=list');
    expect(harness.routeNativeElement?.querySelector('#todos-title')?.textContent).toContain('Tâches');
  });

  it('mounts the migrated smart planning route', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/smart-planning');

    expect(TestBed.inject(Router).url).toBe('/smart-planning');
    expect(harness.routeNativeElement?.querySelector('#planning-title')?.textContent).toContain('Planification');
  });

  it('mounts the migrated journal route', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/journal');

    expect(TestBed.inject(Router).url).toBe('/journal');
    expect(harness.routeNativeElement?.querySelector('#journal-title')?.textContent).toContain('Journal');
  });

  it('mounts the RH migration route', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/rh?path=rh-team,rh-onboarding&focus=rh-guide');

    expect(TestBed.inject(Router).url).toBe('/rh?path=rh-team,rh-onboarding&focus=rh-guide');
    expect(harness.routeNativeElement?.querySelector('#rh-title')?.textContent).toContain('RH');
  });

  it('mounts the snippets migration route', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/snippets?path=snippet-tools&focus=snippet-json');

    expect(TestBed.inject(Router).url).toBe('/snippets?path=snippet-tools&focus=snippet-json');
    expect(harness.routeNativeElement?.querySelector('#snippets-title')?.textContent).toContain('Snippets');
  });

  it('mounts the settings migration route', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/settings');

    expect(TestBed.inject(Router).url).toBe('/settings');
    expect(harness.routeNativeElement?.querySelector('#settings-title')?.textContent).toContain('Paramètres');
  });

  it('mounts the migrated export route', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/export');

    expect(TestBed.inject(Router).url).toBe('/export');
    expect(harness.routeNativeElement?.querySelector('#export-title')?.textContent).toContain('Export');
  });

  it('uses a safe dashboard fallback for an unknown route', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/not-a-route');

    expect(TestBed.inject(Router).url).toBe('/home');
    expect(harness.routeNativeElement?.querySelector('#dashboard-title')).toBeTruthy();
  });
});
