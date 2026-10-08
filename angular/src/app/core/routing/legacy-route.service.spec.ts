import { LegacyRouteService } from './legacy-route.service';

describe('LegacyRouteService', () => {
  let service: LegacyRouteService;

  beforeEach(() => {
    service = new LegacyRouteService();
  });

  it('maps every legacy page to its Angular route', () => {
    expect(service.map('index.html')).toEqual({ path: 'home', queryParams: {} });
    expect(service.map('todos.html')).toEqual({ path: 'todos', queryParams: {} });
    expect(service.map('projects.html')).toEqual({ path: 'projects', queryParams: {} });
    expect(service.map('project.html?id=project-1')).toEqual({
      path: 'project/project-1',
      queryParams: {},
    });
    expect(service.map('snippets.html')).toEqual({ path: 'snippets', queryParams: {} });
    expect(service.map('rh.html')).toEqual({ path: 'rh', queryParams: {} });
    expect(service.map('journal.html')).toEqual({ path: 'journal', queryParams: {} });
    expect(service.map('smart-planning.html')).toEqual({ path: 'smart-planning', queryParams: {} });
    expect(service.map('settings.html')).toEqual({ path: 'settings', queryParams: {} });
    expect(service.map('export.html')).toEqual({ path: 'export', queryParams: {} });
  });

  it('preserves todo filters and encoded values', () => {
    expect(service.map('todos.html?focus=todo%2F1&savedView=work&status=waitinginfo&priority=urgent&context=au%20bureau&project=none&due=overdue&view=list')).toEqual({
      path: 'todos',
      queryParams: {
        focus: 'todo/1',
        savedView: 'work',
        status: 'waitinginfo',
        priority: 'urgent',
        context: 'au bureau',
        project: 'none',
        due: 'overdue',
        view: 'list',
      },
    });
  });

  it('converts folder aliases without overriding a real path', () => {
    expect(service.map('project.html?id=p%2F1&folder=folder-1&focus=item-1&kind=item')).toEqual({
      path: 'project/p%2F1',
      queryParams: { path: 'folder-1', focus: 'item-1', kind: 'item' },
    });
    expect(service.map('project.html?id=p-1&folder=folder-1&path=folder-1%2Cfolder-2')).toEqual({
      path: 'project/p-1',
      queryParams: { path: 'folder-1,folder-2' },
    });
    expect(service.map('rh.html?folder=rh-1')).toEqual({ path: 'rh', queryParams: { path: 'rh-1' } });
    expect(service.map('snippets.html?folder=snippet-1')).toEqual({
      path: 'snippets',
      queryParams: { path: 'snippet-1' },
    });
  });

  it('falls back safely for missing or unknown routes', () => {
    expect(service.map('project.html?focus=item-1')).toEqual({ path: 'projects', queryParams: {} });
    expect(service.map('not-a-page.html')).toBeNull();
    expect(service.map('javascript:alert(1)')).toBeNull();
    expect(service.map('%E0%A4%A')).toBeNull();
  });

  it('serializes route segments and query parameters safely', () => {
    expect(service.toUrl('project.html?id=project%2F1&focus=item%2F1&kind=item')).toBe(
      '/project/project%2F1?focus=item%2F1&kind=item',
    );
  });
});
