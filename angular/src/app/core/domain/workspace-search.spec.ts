import fixture from '../../../../../fixtures/workspace-full.json';
import { parseWorkspaceSearchQuery, searchWorkspace } from './workspace-search';
import type { WorkspaceData } from '../persistence/workspace-data';

describe('Workspace search', () => {
  const data = fixture.data as WorkspaceData;

  it('parses filters, tags, phrases and aliases', () => {
    expect(parseWorkspaceSearchQuery('"boot quotidien" #fixture p:urgent s:todo ctx:bureau type:todo')).toEqual({
      tag: ['fixture'], priority: ['urgent'], status: ['todo'], context: ['bureau'], type: ['todo'],
      lang: [], in: [], folder: [], text: [], phrases: ['boot quotidien'],
    });
  });

  it('searches all migrated domains with compatible focus targets', () => {
    expect(searchWorkspace(data, 'projet')).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'project-alpha', path: 'project/project-alpha' }),
    ]));
    expect(searchWorkspace(data, 'type:todo status:waitinginfo')[0]).toEqual(expect.objectContaining({
      id: 'todo-weekly', path: 'todos', queryParams: { focus: 'todo-weekly', kind: 'todo' },
    }));
    expect(searchWorkspace(data, 'type:snippet lang:javascript')[0]).toEqual(expect.objectContaining({
      id: 'snippet-json', queryParams: { path: 'snippet-tools', focus: 'snippet-json', kind: 'snippet' },
    }));
    expect(searchWorkspace(data, 'Guide de test')[0]).toEqual(expect.objectContaining({
      id: 'rh-guide', path: 'rh', queryParams: { path: 'rh-team,rh-onboarding', focus: 'rh-guide', kind: 'document' },
    }));
  });

  it('keeps the result list bounded', () => {
    expect(searchWorkspace({ ...data, todos: Array.from({ length: 40 }, (_, index) => ({ ...data.todos[0], id: `todo-${index}` })) }, 'Verifier')).toHaveLength(30);
  });
});
