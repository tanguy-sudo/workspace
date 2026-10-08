import { createWorkspaceExport } from '../persistence/workspace-data-codec';
import type {
  JournalEntry,
  Project,
  ProjectItem,
  ProjectNode,
  Snippet,
  Todo,
  WorkspaceData,
  WorkspaceExportMeta,
} from '../persistence/workspace-data';

export type WorkspaceExportFormat = 'json' | 'md' | 'csv' | 'zip';

export interface ExportFile {
  name: string;
  content: string | Uint8Array;
}

export interface WorkspaceExportSection {
  id: string;
  title: string;
  description: string;
  filename: string;
  count: string;
  formats: readonly WorkspaceExportFormat[];
  data: unknown;
  markdown?: string;
  csv?: string;
  zip?: ExportFile[];
}

interface TreeExportNode {
  nodeType?: string;
  name?: string;
  title?: string;
  date?: string;
  note?: string;
  url?: string;
  tags?: string[];
  file?: { name?: string; size?: number } | null;
  children?: readonly TreeExportNode[];
}

const TODO_CSV_COLUMNS = [
  'id', 'title', 'status', 'priority',
  'dueDate', 'reminderAt', 'pinned', 'createdAt', 'note',
  'priorityId', 'description', 'context', 'attachedTo',
  'estimatedTime', 'dependencies', 'tags', 'projectId', 'recurrence', 'updatedAt',
] as const;

const TODO_STATUS_ORDER = ['todo', 'waitinginfo', 'inprogress', 'in-progress', 'blocked', 'done'];

const TODO_STATUS_LABELS: Record<string, string> = {
  todo: 'À faire',
  waitinginfo: "En attente d'info",
  inprogress: 'En cours',
  'in-progress': 'En cours',
  blocked: 'Bloqué',
  done: 'Terminées',
};

function todoStatus(todo: Todo): string {
  return todo.status || (todo['done'] === true ? 'done' : 'todo');
}

function todoTitle(todo: Todo): string {
  return todo.title || '(sans titre)';
}

function todoPriority(todo: Todo): string {
  return String(todo.priority || todo.priorityId || '');
}

function todoPriorityLabel(todo: Todo, priorities: readonly { id: string; label: string }[] = []): string {
  return priorities.find((priority) => priority.id === todo.priorityId)?.label || todoPriority(todo);
}

function todoDescription(todo: Todo): string {
  return [todo.description, todo.note]
    .filter((value, index, values): value is string => Boolean(value) && values.indexOf(value) === index)
    .join('\n\n');
}

function localeDate(timestamp: number | undefined): string {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('fr-FR');
}

function todoTextMetadata(todo: Todo): string {
  const estimatedTime = todo['estimatedTime'] as unknown;
  const metadata = [
    `statut : ${TODO_STATUS_LABELS[todoStatus(todo)] || todoStatus(todo)}`,
    todo.context ? `contexte : ${todo.context}` : '',
    todo.projectId ? `projet : ${todo.projectId}` : '',
    estimatedTime !== undefined && estimatedTime !== null && estimatedTime !== '' ? `estimation : ${estimatedTime} min` : '',
    todo.dependencies?.length ? `dépend de : ${todo.dependencies.join(', ')}` : '',
    todo.tags?.length ? `tags : ${todo.tags.join(', ')}` : '',
    todo.recurrence ? `récurrence : ${recurrenceLabel(todo.recurrence)}` : '',
  ].filter(Boolean);
  return metadata.length ? ` _(${metadata.join(' · ')})_` : '';
}

function recurrenceLabel(value: Todo['recurrence']): string {
  if (!value) return '';
  if (value.type === 'daily') return 'quotidienne';
  if (value.type === 'weekly') return `hebdomadaire (${value.weeklyDays.join(', ')})`;
  return `${value.nth === -1 ? 'dernier' : `${value.nth}e`} jour ${value.weekday}`;
}

export function todosToMarkdown(todos: readonly Todo[], priorities: readonly { id: string; label: string }[] = []): string {
  if (!todos.length) return '_Aucune tâche._';

  const byStatus = new Map<string, Todo[]>();
  todos.forEach((todo) => {
    const status = todoStatus(todo);
    const current = byStatus.get(status) ?? [];
    current.push(todo);
    byStatus.set(status, current);
  });

  const output = ['# Tâches', ''];
  const orderedStatuses = [
    ...TODO_STATUS_ORDER,
    ...[...byStatus.keys()].filter((status) => !TODO_STATUS_ORDER.includes(status)),
  ];
  const seen = new Set<string>();

  for (const status of orderedStatuses) {
    if (seen.has(status)) continue;
    seen.add(status);
    const entries = byStatus.get(status);
    if (!entries?.length) continue;
    output.push(`## ${TODO_STATUS_LABELS[status] || status}`, '');
    for (const todo of entries) {
      const priority = todoPriorityLabel(todo, priorities);
      const due = todo.dueDate ? ` 📅 ${todo.dueDate}` : '';
      const reminder = todo.reminderAt ? ` ⏰ ${localeDate(Date.parse(todo.reminderAt)) || todo.reminderAt}` : '';
      const pinned = todo.pinned ? ' 📌' : '';
      const tick = status === 'done' ? 'x' : ' ';
      output.push(`- [${tick}] ${todoTitle(todo)}${priority ? ` _[${priority}]_` : ''}${due}${reminder}${pinned}${todoTextMetadata(todo)}`);
      const description = todoDescription(todo);
      if (description) output.push(...description.split('\n').map((line) => `  ${line}`));
    }
    output.push('');
  }

  return output.join('\n');
}

function csvValue(value: unknown): unknown {
  if (Array.isArray(value) || (value && typeof value === 'object')) return JSON.stringify(value);
  return value;
}

export function csvField(value: unknown): string {
  if (value == null) return '';
  const text = String(csvValue(value));
  return /[",\n;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function todosToCsv(todos: readonly Todo[], priorities: readonly { id: string; label: string }[] = []): string {
  const rows = [TODO_CSV_COLUMNS.join(',')];
  for (const todo of todos) {
    const values: Record<string, unknown> = {
      id: todo.id,
      title: todo.title,
      status: todoStatus(todo),
      priority: todoPriorityLabel(todo, priorities),
      dueDate: todo.dueDate,
      reminderAt: todo.reminderAt,
      pinned: todo.pinned,
      createdAt: todo.createdAt,
      note: todo.note ?? todo.description,
      priorityId: todo.priorityId,
      description: todo.description,
      context: todo.context,
      attachedTo: todo.attachedTo,
      estimatedTime: todo.estimatedTime,
      dependencies: todo.dependencies,
      tags: todo.tags,
      projectId: todo.projectId,
      recurrence: todo.recurrence,
      updatedAt: todo.updatedAt,
    };
    rows.push(TODO_CSV_COLUMNS.map((column) => csvField(values[column])).join(','));
  }
  return rows.join('\n');
}

export function snippetsToMarkdown(snippets: readonly Snippet[]): string {
  if (!snippets.length) return '_Aucun snippet._';
  const output = ['# Snippets', ''];
  for (const snippet of snippets) {
    output.push(`## ${snippet.title || '(sans titre)'}`);
    if (snippet.tags?.length) output.push(`_Tags : ${snippet.tags.join(', ')}_`);
    if (snippet.language) output.push(`_Langage : ${snippet.language}_`);
    output.push('', `\`\`\`${snippet.language || ''}`, snippet.code || '', '\`\`\`', '');
  }
  return output.join('\n');
}

export function snippetsToZipFiles(snippets: readonly Snippet[]): ExportFile[] {
  return snippets.map((snippet) => ({
    name: `${slugifyFile(snippet.title || snippet.id)}.${extForLang(snippet.language) || 'txt'}`,
    content: snippet.code || '',
  }));
}

export function journalToMarkdown(entries: readonly JournalEntry[]): string {
  if (!entries.length) return '_Aucune entrée._';
  const output = ['# Journal', ''];
  const sorted = [...entries].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  for (const entry of sorted) {
    const date = localeDate(entry.createdAt) || 'Date inconnue';
    const metadata = [
      date,
      entry.mood ? `humeur : ${entry.mood}` : '',
      entry.tags?.length ? entry.tags.join(', ') : '',
    ].filter(Boolean).join(' · ');
    output.push(`## ${entry.title || date}`, `_${metadata}_`, '', entry.content || '_(vide)_', '');
  }
  return output.join('\n');
}

export function journalToZipFiles(entries: readonly JournalEntry[]): ExportFile[] {
  return entries.map((entry) => {
    const date = entry.createdAt ? new Date(entry.createdAt) : null;
    const stamp = date && !Number.isNaN(date.getTime())
      ? `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
      : 'sans-date';
    const title = entry.title || (date ? `Entrée du ${date.toLocaleDateString('fr-FR')}` : 'Entrée');
    const metadata = [
      date && !Number.isNaN(date.getTime()) ? date.toLocaleString('fr-FR') : 'Date inconnue',
      entry.mood || '',
      entry.tags?.length ? entry.tags.join(', ') : '',
    ].filter(Boolean).join(' · ');
    return {
      name: `${stamp}-${slugifyFile(entry.title || 'entree')}.md`,
      content: `# ${title}\n_${metadata}_\n\n${entry.content || ''}`,
    };
  });
}

export function projectsToMarkdown(projects: readonly Project[]): string {
  if (!projects.length) return '_Aucun projet._';
  const output = ['# Projets', ''];
  for (const project of projects) {
    output.push(`## ${project.name}`);
    if (project.categories.length) output.push(`_Catégories : ${project.categories.join(', ')}_`);
    output.push('', projectChildrenToMarkdown(project.children, 0), '');
  }
  return output.join('\n');
}

function projectChildrenToMarkdown(children: readonly ProjectNode[], depth: number): string {
  if (!children.length) return depth === 0 ? '_(vide)_' : '';
  const lines: string[] = [];
  const indent = '  '.repeat(depth);
  for (const node of children) {
    if (node.nodeType === 'folder') {
      lines.push(`${indent}- 📁 **${node.name || '(dossier)'}**`);
      const nested = projectChildrenToMarkdown(node.children, depth + 1);
      if (nested) lines.push(nested);
      continue;
    }

    lines.push(`${indent}- 📄 **${node.title || '(sans titre)'}** _(${node.type || 'item'})_`);
    const details = [
      node.category ? `catégorie : ${node.category}` : '',
      node.url ? `URL : ${node.url}` : '',
      node.language ? `langage : ${node.language}` : '',
      node.tags?.length ? `tags : ${node.tags.join(', ')}` : '',
    ].filter(Boolean);
    details.forEach((detail) => lines.push(`${indent}  > ${detail}`));
    if (node.note) node.note.split('\n').forEach((line) => lines.push(`${indent}  > ${line}`));
    if (node.type === 'code' && node.code) {
      lines.push(`${indent}  > \`\`\`${node.language || ''}`);
      node.code.split('\n').forEach((line) => lines.push(`${indent}  > ${line}`));
      lines.push(`${indent}  > \`\`\``);
    }
    if (node.type === 'password') lines.push(`${indent}  > Secrets omis de cet export lisible.`);
  }
  return lines.join('\n');
}

export function projectsToZipFiles(projects: readonly Project[]): ExportFile[] {
  const files: ExportFile[] = [];
  for (const project of projects) {
    const projectDirectory = slugifyFile(project.name);
    files.push({
      name: `${projectDirectory}/_project.md`,
      content: `# ${project.name}\n\n${project.categories.length ? `_Catégories : ${project.categories.join(', ')}_\n\n` : ''}${projectChildrenToMarkdown(project.children, 0)}`,
    });
    walkProjectItems(project.children, (item, path) => {
      files.push({
        name: `${projectDirectory}/${path.map(slugifyFile).join('/')}${path.length ? '/' : ''}${slugifyFile(item.title || item.id)}.md`,
        content: itemToMarkdown(item),
      });
    });
  }
  return files;
}

function itemToMarkdown(item: ProjectItem): string {
  const lines = [`# ${item.title || '(sans titre)'}`, '', `_Type : ${item.type || 'item'}_`, ''];
  if (item.category) lines.push(`_Catégorie : ${item.category}_`, '');
  if (item.tags?.length) lines.push(`_Tags : ${item.tags.join(', ')}_`, '');
  if (item.url) lines.push(`URL : ${item.url}`, '');
  if (item.type === 'code' && item.code) lines.push(`\`\`\`${item.language || ''}`, item.code, '\`\`\`', '');
  if (item.note) lines.push(item.note, '');
  if (item.type === 'password') lines.push('Secrets omis de cet export lisible.', '');
  return `${lines.join('\n')}\n`;
}

export function treeToMarkdown(tree: TreeExportNode | null | undefined, title: string): string {
  if (!tree) return '_Aucune donnée._';
  return `# ${title}\n\n${treeChildrenToMarkdown(tree.children || [], 0)}`;
}

function treeChildrenToMarkdown(children: readonly TreeExportNode[], depth: number): string {
  if (!children.length) return depth === 0 ? '_(vide)_' : '';
  const lines: string[] = [];
  for (const child of children) {
    const indent = '  '.repeat(depth);
    if (child.nodeType === 'folder') {
      lines.push(`${indent}- 📁 **${child.name || '(dossier)'}**`);
      const nested = treeChildrenToMarkdown(child.children || [], depth + 1);
      if (nested) lines.push(nested);
    } else {
      lines.push(`${indent}- 📄 **${child.name || child.title || '(sans titre)'}**`);
      [
        child.date ? `date : ${child.date}` : '',
        child.url ? `URL : ${child.url}` : '',
        child.tags?.length ? `tags : ${child.tags.join(', ')}` : '',
        child.file?.name ? `pièce jointe : ${child.file.name}${child.file.size ? ` (${child.file.size} octets)` : ''}` : '',
      ].filter(Boolean).forEach((detail) => lines.push(`${indent}  > ${detail}`));
      if (child.note) child.note.split('\n').forEach((line) => lines.push(`${indent}  > ${line}`));
    }
  }
  return lines.join('\n');
}

function walkProjectItems(
  children: readonly ProjectNode[],
  visit: (item: ProjectItem, path: string[]) => void,
  path: string[] = [],
): void {
  for (const child of children) {
    if (child.nodeType === 'folder') walkProjectItems(child.children, visit, [...path, child.name || 'dossier']);
    else visit(child, path);
  }
}

export function buildExportSections(data: WorkspaceData): WorkspaceExportSection[] {
  return [
    {
      id: 'todos', title: 'Tâches', description: 'Liste de tâches avec statut, priorité, échéances et rappels.',
      filename: 'todos', count: `${data.todos.length} tâche(s)`, formats: ['json', 'md', 'csv'], data: data.todos,
      markdown: todosToMarkdown(data.todos, data.settings.todoPriorities),
      csv: todosToCsv(data.todos, data.settings.todoPriorities),
    },
    {
      id: 'snippets', title: 'Snippets', description: 'Fragments de code avec langage, tags et favoris.',
      filename: 'snippets', count: `${data.snippets.length} snippet(s)`, formats: ['json', 'md', 'zip'],
      data: { snippets: data.snippets, folders: data.snippetFolders }, markdown: snippetsToMarkdown(data.snippets), zip: snippetsToZipFiles(data.snippets),
    },
    {
      id: 'journal', title: 'Journal', description: 'Entrées datées du journal personnel.',
      filename: 'journal', count: `${data.journal.length} entrée(s)`, formats: ['json', 'md', 'zip'], data: data.journal,
      markdown: journalToMarkdown(data.journal), zip: journalToZipFiles(data.journal),
    },
    {
      id: 'rh', title: 'Notes RH', description: "Arborescence des dossiers et fiches RH.",
      filename: 'rh', count: `${treeItemCount(data.rh)} note(s)`, formats: ['json', 'md'], data: data.rh,
      markdown: treeToMarkdown(data.rh, 'Notes RH'),
    },
    {
      id: 'projects', title: 'Projets', description: 'Tous les projets avec leurs catégories et leur contenu.',
      filename: 'projets', count: `${data.projects.length} projet(s)`, formats: ['json', 'md', 'zip'], data: data.projects,
      markdown: projectsToMarkdown(data.projects), zip: projectsToZipFiles(data.projects),
    },
    {
      id: 'favorites', title: 'Favoris', description: "Arborescence des éléments mis en favoris.",
      filename: 'favoris', count: `${treeItemCount(data.favorites)} entrée(s)`, formats: ['json', 'md'], data: data.favorites,
      markdown: treeToMarkdown(data.favorites, 'Favoris'),
    },
    {
      id: 'settings', title: 'Paramètres', description: 'Préférences, priorités et vues sauvegardées.',
      filename: 'parametres', count: 'Configuration', formats: ['json'], data: data.settings,
    },
  ];
}

function treeItemCount(node: TreeExportNode): number {
  return (node.children || []).reduce((count, child) => count + (child.nodeType === 'folder' ? treeItemCount(child) : 1), 0);
}

export function workspaceJson(data: WorkspaceData, metadata: Omit<Partial<WorkspaceExportMeta>, 'version'> = {}): string {
  return JSON.stringify(createWorkspaceExport(data, metadata), null, 2);
}

export function workspaceMarkdown(data: WorkspaceData): string {
  const parts = ['# Sauvegarde Workspace', `_Exportée le ${new Date().toLocaleString('fr-FR')}_`, ''];
  for (const section of buildExportSections(data)) {
    if (section.markdown === undefined) continue;
    parts.push(`\n\n---\n\n## ${section.title}\n`, section.markdown);
  }
  return parts.join('\n');
}

export function workspaceZipFiles(data: WorkspaceData): ExportFile[] {
  const files: ExportFile[] = [
    { name: 'workspace.json', content: workspaceJson(data) },
    { name: 'README.md', content: zipReadme() },
  ];
  for (const section of buildExportSections(data)) {
    const directory = `${section.filename}/`;
    files.push({ name: `${directory}${section.filename}.json`, content: JSON.stringify(section.data, null, 2) });
    if (section.markdown !== undefined) files.push({ name: `${directory}${section.filename}.md`, content: section.markdown });
    for (const item of section.zip || []) files.push({ name: `${directory}items/${item.name}`, content: item.content });
  }
  return files;
}

function zipReadme(): string {
  return [
    '# Workspace — Sauvegarde',
    '',
    `Exportée le ${new Date().toLocaleString('fr-FR')}.`,
    '',
    '## Contenu',
    '',
    '- `workspace.json`            — sauvegarde complète ré-importable depuis la page Export.',
    '- `<section>/<section>.json`  — données brutes d’une section.',
    '- `<section>/<section>.md`    — version Markdown lisible.',
    '- `<section>/items/`          — fichiers individuels (snippets, entrées journal, projets).',
    '',
    'Les données proviennent du stockage local IndexedDB de votre navigateur. Les fichiers JSON sont lossless et peuvent contenir des secrets en clair si le coffre est désactivé ; les documents lisibles individuels omettent les secrets.',
  ].join('\n');
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

export function todayStamp(date = new Date()): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function slugifyFile(value: string): string {
  return String(value || 'sans-titre')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'sans-titre';
}

function extForLang(language: string): string | null {
  const extensions: Record<string, string> = {
    javascript: 'js', typescript: 'ts', python: 'py', ruby: 'rb', java: 'java', csharp: 'cs',
    cpp: 'cpp', c: 'c', go: 'go', rust: 'rs', php: 'php', html: 'html', css: 'css', scss: 'scss',
    json: 'json', yaml: 'yml', xml: 'xml', markdown: 'md', bash: 'sh', shell: 'sh', sql: 'sql',
    powershell: 'ps1', kotlin: 'kt', swift: 'swift',
  };
  return extensions[String(language || '').toLowerCase()] || null;
}

function utf8Encode(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function blobPart(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(new ArrayBuffer(bytes.byteLength));
  copy.set(bytes);
  return copy.buffer;
}

function writeU16(view: DataView, offset: number, value: number): void {
  view.setUint16(offset, value, true);
}

function writeU32(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value, true);
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    let value = (crc ^ byte) & 0xff;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    crc = (crc >>> 8) ^ value;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date: Date): { dosTime: number; dosDate: number } {
  const year = Math.max(1980, date.getFullYear());
  const dosTime = ((date.getHours() & 0x1f) << 11)
    | ((date.getMinutes() & 0x3f) << 5)
    | (Math.floor(date.getSeconds() / 2) & 0x1f);
  const dosDate = (((year - 1980) & 0x7f) << 9)
    | (((date.getMonth() + 1) & 0xf) << 5)
    | (date.getDate() & 0x1f);
  return { dosTime, dosDate };
}

export function createZip(files: readonly ExportFile[]): Blob {
  const { dosTime, dosDate } = dosDateTime(new Date());
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;
  let centralSize = 0;

  for (const file of files) {
    const nameBytes = utf8Encode(file.name);
    const dataBytes = typeof file.content === 'string' ? utf8Encode(file.content) : file.content;
    const checksum = crc32(dataBytes);

    const localHeader = new ArrayBuffer(30 + nameBytes.length);
    const localView = new DataView(localHeader);
    writeU32(localView, 0, 0x04034b50);
    writeU16(localView, 4, 20);
    writeU16(localView, 6, 0x0800);
    writeU16(localView, 8, 0);
    writeU16(localView, 10, dosTime);
    writeU16(localView, 12, dosDate);
    writeU32(localView, 14, checksum);
    writeU32(localView, 18, dataBytes.length);
    writeU32(localView, 22, dataBytes.length);
    writeU16(localView, 26, nameBytes.length);
    writeU16(localView, 28, 0);
    new Uint8Array(localHeader, 30).set(nameBytes);
    localParts.push(new Uint8Array(localHeader), dataBytes);

    const centralHeader = new ArrayBuffer(46 + nameBytes.length);
    const centralView = new DataView(centralHeader);
    writeU32(centralView, 0, 0x02014b50);
    writeU16(centralView, 4, 20);
    writeU16(centralView, 6, 20);
    writeU16(centralView, 8, 0x0800);
    writeU16(centralView, 10, 0);
    writeU16(centralView, 12, dosTime);
    writeU16(centralView, 14, dosDate);
    writeU32(centralView, 16, checksum);
    writeU32(centralView, 20, dataBytes.length);
    writeU32(centralView, 24, dataBytes.length);
    writeU16(centralView, 28, nameBytes.length);
    writeU16(centralView, 30, 0);
    writeU16(centralView, 32, 0);
    writeU16(centralView, 34, 0);
    writeU16(centralView, 36, 0);
    writeU32(centralView, 38, 0);
    writeU32(centralView, 42, offset);
    new Uint8Array(centralHeader, 46).set(nameBytes);
    centralParts.push(new Uint8Array(centralHeader));

    offset += 30 + nameBytes.length + dataBytes.length;
    centralSize += 46 + nameBytes.length;
  }

  const end = new ArrayBuffer(22);
  const endView = new DataView(end);
  writeU32(endView, 0, 0x06054b50);
  writeU16(endView, 4, 0);
  writeU16(endView, 6, 0);
  writeU16(endView, 8, files.length);
  writeU16(endView, 10, files.length);
  writeU32(endView, 12, centralSize);
  writeU32(endView, 16, offset);
  writeU16(endView, 20, 0);

  return new Blob([...localParts, ...centralParts, new Uint8Array(end)].map(blobPart), { type: 'application/zip' });
}
