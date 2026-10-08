import fullFixture from '../../../../../fixtures/workspace-full.json';
import vaultFixture from '../../../../../fixtures/workspace-with-vault.json';
import {
  buildExportSections,
  createZip,
  journalToZipFiles,
  projectsToZipFiles,
  snippetsToZipFiles,
  todosToCsv,
  todosToMarkdown,
  workspaceJson,
  workspaceMarkdown,
  workspaceZipFiles,
} from './workspace-export';
import { parseWorkspaceExport } from '../persistence/workspace-data-codec';
import type { Todo, WorkspaceData } from '../persistence/workspace-data';

describe('Workspace export formats', () => {
  it('round-trips the complete fixture and keeps export version metadata', () => {
    const source = structuredClone(fullFixture.data) as WorkspaceData;
    const parsed = parseWorkspaceExport(workspaceJson(source));

    expect(parsed._meta).toMatchObject({ app: 'Workspace', version: 6 });
    expect(parsed.data).toEqual(source);
  });

  it('exposes every legacy section and format with current task fields', () => {
    const data = fullFixture.data as WorkspaceData;
    const sections = buildExportSections(data);
    const byId = new Map(sections.map((section) => [section.id, section]));

    expect([...byId.keys()]).toEqual(['todos', 'snippets', 'journal', 'rh', 'projects', 'favorites', 'settings']);
    expect(byId.get('todos')?.formats).toEqual(['json', 'md', 'csv']);
    expect(byId.get('snippets')?.formats).toEqual(['json', 'md', 'zip']);
    expect(byId.get('journal')?.formats).toEqual(['json', 'md', 'zip']);
    expect(byId.get('projects')?.formats).toEqual(['json', 'md', 'zip']);

    const weekly = data.todos.find((todo) => todo.id === 'todo-weekly')!;
    expect(byId.get('todos')?.markdown).toContain('Rejouer la recette hebdomadaire');
    expect(byId.get('todos')?.markdown).toContain("En attente d'info");
    expect(byId.get('todos')?.markdown).toContain('récurrence : hebdomadaire');
    expect(byId.get('todos')?.csv).toContain('priorityId');
    expect(byId.get('todos')?.csv).toContain(weekly.id);
  });

  it('uses RFC-4180 quoting while retaining historical and current todo columns', () => {
    const todo = {
      id: 'csv-todo',
      title: 'Titre, "important"',
      status: 'inprogress',
      priorityId: 'urgent',
      priority: 'Urgent',
      description: 'Ligne 1\nLigne 2',
      note: '',
      context: 'bureau',
      attachedTo: '',
      estimatedTime: 45,
      dependencies: ['other'],
      tags: ['one', 'two'],
      dueDate: '2026-02-02',
      reminderAt: '',
      recurrence: null,
      projectId: 'project-alpha',
      pinned: false,
      createdAt: 1,
      updatedAt: 2,
    } as Todo;
    const csv = todosToCsv([todo]);

    expect(csv.split('\n', 1)[0]).toContain('priorityId');
    expect(csv).toContain('"Titre, ""important"""');
    expect(csv).toContain('"Ligne 1\nLigne 2"');
    expect(csv).toContain('"[""other""]"');
  });

  it('keeps readable Markdown and ZIP item files free of vault secrets', () => {
    const data = vaultFixture.data as WorkspaceData;
    const markdown = workspaceMarkdown(data);
    const files = workspaceZipFiles(data);
    const readableFiles = files.filter((file) => file.name.endsWith('.md'));

    expect(markdown).not.toContain('fixture-login');
    expect(markdown).not.toContain('fixture-secret');
    expect(readableFiles.every((file) => !String(file.content).includes('fixture-login'))).toBe(true);
    expect(readableFiles.every((file) => !String(file.content).includes('fixture-secret'))).toBe(true);
    expect(files.find((file) => file.name === 'workspace.json')?.content).toContain('secretEncrypted');
  });

  it('preserves legacy ZIP contents and emits a valid UTF-8 store archive', async () => {
    const data = fullFixture.data as WorkspaceData;
    expect(snippetsToZipFiles(data.snippets).map((file) => file.name)).toEqual([
      'parser-json.js',
      'lecture-sql.sql',
      'bloc-markdown.md',
    ]);
    expect(journalToZipFiles(data.journal)[0].name).toBe('2026-01-02-recette-initiale.md');
    expect(projectsToZipFiles(data.projects).map((file) => file.name)).toContain('projet-alpha/_project.md');

    const archive = createZip([{ name: 'échantillon.md', content: '# Test' }]);
    const bytes = new Uint8Array(await readBlobAsArrayBuffer(archive));
    const text = new TextDecoder().decode(bytes);
    expect(bytes.slice(0, 4)).toEqual(new Uint8Array([0x50, 0x4b, 0x03, 0x04]));
    expect(text).toContain('échantillon.md');
    expect(text).toContain('# Test');
  });

  it('returns stable empty messages for empty sections', () => {
    expect(todosToMarkdown([])).toBe('_Aucune tâche._');
    expect(buildExportSections({ ...fullFixture.data, todos: [], snippets: [], journal: [], projects: [] } as WorkspaceData)
      .find((section) => section.id === 'todos')?.markdown).toBe('_Aucune tâche._');
  });
});

function readBlobAsArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}
