import type { Params } from '@angular/router';
import type { Project, ProjectNode, Snippet, Todo, WorkspaceData } from '../persistence/workspace-data';
import type { TreeNode } from './workspace-domain';

export interface WorkspaceSearchQuery {
  tag: string[];
  priority: string[];
  status: string[];
  context: string[];
  type: string[];
  lang: string[];
  in: string[];
  folder: string[];
  text: string[];
  phrases: string[];
}

export interface WorkspaceSearchTarget {
  path: string;
  queryParams: Params;
}

export interface WorkspaceSearchResult extends WorkspaceSearchTarget {
  id: string;
  kind: 'project' | 'item' | 'rh' | 'todo' | 'snippet' | 'folder' | 'document';
  title: string;
  section: string;
  subtitle: string;
  icon: string;
}

type FilterKey = 'tag' | 'priority' | 'status' | 'context' | 'type' | 'lang' | 'in' | 'folder';

const FILTER_ALIASES: Record<string, FilterKey> = {
  tag: 'tag',
  priority: 'priority',
  prio: 'priority',
  p: 'priority',
  status: 'status',
  s: 'status',
  context: 'context',
  ctx: 'context',
  type: 'type',
  t: 'type',
  kind: 'type',
  lang: 'lang',
  language: 'lang',
  l: 'lang',
  in: 'in',
  project: 'in',
  folder: 'folder',
  dossier: 'folder',
};

export function parseWorkspaceSearchQuery(raw: string): WorkspaceSearchQuery {
  const parsed: WorkspaceSearchQuery = {
    tag: [],
    priority: [],
    status: [],
    context: [],
    type: [],
    lang: [],
    in: [],
    folder: [],
    text: [],
    phrases: [],
  };
  const withoutPhrases = String(raw || '').replace(/"([^"]+)"/g, (_match, phrase: string) => {
    if (phrase.trim()) parsed.phrases.push(phrase.trim().toLowerCase());
    return ' ';
  });

  withoutPhrases.split(/\s+/).filter(Boolean).forEach((token) => {
    if (token.startsWith('#') && token.length > 1) {
      parsed.tag.push(token.slice(1).toLowerCase());
      return;
    }
    const match = token.match(/^([a-z]+):(.+)$/i);
    const key = match ? FILTER_ALIASES[match[1].toLowerCase()] : undefined;
    if (key && match) {
      parsed[key].push(match[2].toLowerCase());
      return;
    }
    parsed.text.push(token.toLowerCase());
  });
  return parsed;
}

export function searchWorkspace(data: WorkspaceData | null, raw: string, limit = 30): WorkspaceSearchResult[] {
  if (!data) return [];
  const query = parseWorkspaceSearchQuery(raw);
  const results: WorkspaceSearchResult[] = [];

  for (const project of data.projects) {
    if (matchesProject(project, query)) {
      results.push({
        id: project.id,
        kind: 'project',
        title: project.name,
        subtitle: 'Projet',
        section: 'Projets',
        icon: 'folder',
        path: projectPath(project.id),
        queryParams: {},
      });
    }

    for (const entry of treeEntries(project.children)) {
      const kind = entry.node.nodeType === 'folder' ? 'folder' : 'item';
      if (!matchesProjectNode(project, entry.node, kind, entry.path, query)) continue;
      results.push({
        id: entry.node.id,
        kind,
        title: String(entry.node['name'] ?? entry.node['title'] ?? entry.node.id),
        subtitle: `${kind === 'folder' ? 'Dossier' : 'Element'} dans ${project.name}`,
        section: 'Projets',
        icon: kind === 'folder' ? 'folder' : 'document',
        path: projectPath(project.id),
        queryParams: { ...(entry.path.length ? { path: entry.path.join(',') } : {}), focus: entry.node.id, kind },
      });
    }
  }

  for (const entry of treeEntries(data.rh.children ?? [])) {
    const kind = entry.node.nodeType === 'folder' ? 'folder' : 'document';
    const title = String(entry.node['name'] ?? entry.node['title'] ?? entry.node.id);
    if (!matchesNode(kind, title, entry.node, query) || !matchesFolder(entry.node, query)) continue;
    results.push({
      id: entry.node.id,
      kind: 'rh',
      title,
      subtitle: kind === 'folder' ? 'Dossier RH' : 'Document RH',
      section: 'RH',
      icon: kind === 'folder' ? 'folder' : 'document',
      path: 'rh',
      queryParams: { ...(entry.path.length ? { path: entry.path.join(',') } : {}), focus: entry.node.id, kind },
    });
  }

  for (const todo of data.todos) {
    if (!matchesTodo(todo, query)) continue;
    results.push({
      id: todo.id,
      kind: 'todo',
      title: todo.title,
      subtitle: todo.status,
      section: 'Taches',
      icon: 'check',
      path: 'todos',
      queryParams: { focus: todo.id, kind: 'todo' },
    });
  }

  const snippetFolders = folderNames(data.snippetFolders);
  for (const snippet of data.snippets) {
    if (!matchesSnippet(snippet, snippetFolders[snippet.folderId ?? 'root'] ?? '', query)) continue;
    const path = snippetFolderPath(data.snippetFolders, snippet.folderId);
    results.push({
      id: snippet.id,
      kind: 'snippet',
      title: snippet.title,
      subtitle: snippet.language || 'Snippet',
      section: 'Snippets',
      icon: 'code',
      path: 'snippets',
      queryParams: { ...(path.length ? { path: path.join(',') } : {}), focus: snippet.id, kind: 'snippet' },
    });
  }

  return results.slice(0, Math.max(0, limit));
}

function projectPath(id: string): string {
  return `project/${encodeURIComponent(id)}`;
}

function matchesProject(project: Project, query: WorkspaceSearchQuery): boolean {
  return matchesType('project', query) && matchesText(`${project.name} ${String(project['note'] ?? '')}`, query)
    && matchesIn(project.name, query) && !query.tag.length && !query.priority.length
    && !query.status.length && !query.context.length && !query.lang.length && !query.folder.length;
}

function matchesProjectNode(project: Project, node: TreeNode, kind: 'folder' | 'item', path: string[], query: WorkspaceSearchQuery): boolean {
  const title = String(node['name'] ?? node['title'] ?? node.id);
  return matchesType(kind, query) && matchesText(`${title} ${String(node['note'] ?? '')}`, query)
    && matchesTags(node, query) && matchesIn(project.name, query)
    && (!query.folder.length || matchesValues(path, query.folder));
}

function matchesTodo(todo: Todo, query: WorkspaceSearchQuery): boolean {
  return matchesType('todo', query)
    && matchesText(`${todo.title} ${todo.description ?? ''} ${todo.context ?? ''} ${(todo.tags ?? []).join(' ')}`, query)
    && matchesTags(todo, query) && matchesValues([todo.priorityId ?? ''], query.priority)
    && matchesValues([todo.status], query.status) && matchesValues([todo.context ?? ''], query.context)
    && (!query.lang.length && !query.in.length && !query.folder.length);
}

function matchesSnippet(snippet: Snippet, folderName: string, query: WorkspaceSearchQuery): boolean {
  return matchesType('snippet', query)
    && matchesText(`${snippet.title} ${snippet.code} ${(snippet.tags ?? []).join(' ')}`, query)
    && matchesTags(snippet, query) && matchesValues([snippet.language], query.lang)
    && matchesValues([folderName], query.folder)
    && !query.priority.length && !query.status.length && !query.context.length && !query.in.length;
}

function matchesNode(kind: string, title: string, node: TreeNode, query: WorkspaceSearchQuery): boolean {
  return (matchesType(kind, query) || matchesType('rh', query))
    && matchesText(`${title} ${String(node['note'] ?? '')} ${String(node['url'] ?? '')}`, query)
    && matchesTags(node, query) && !query.priority.length && !query.status.length
    && !query.context.length && !query.lang.length && !query.in.length;
}

function matchesType(kind: string, query: WorkspaceSearchQuery): boolean {
  if (!query.type.length) return true;
  return query.type.some((value) => kind.startsWith(value) || (kind === 'folder' && value === 'rh'));
}

function matchesText(value: string, query: WorkspaceSearchQuery): boolean {
  const haystack = value.toLowerCase();
  return query.text.every((part) => haystack.includes(part)) && query.phrases.every((part) => haystack.includes(part));
}

function matchesTags(value: { [key: string]: unknown }, query: WorkspaceSearchQuery): boolean {
  if (!query.tag.length) return true;
  const tags = (Array.isArray(value['tags']) ? value['tags'] : []).map((tag) => String(tag).toLowerCase());
  return query.tag.every((needle) => tags.some((tag) => tag === needle || tag.includes(needle)));
}

function matchesIn(value: string, query: WorkspaceSearchQuery): boolean {
  return query.in.every((part) => value.toLowerCase().includes(part));
}

function matchesFolder(node: TreeNode, query: WorkspaceSearchQuery): boolean {
  return !query.folder.length || matchesValues([String(node['name'] ?? node['title'] ?? '')], query.folder);
}

function matchesValues(values: string[], filters: string[]): boolean {
  return filters.every((filter) => values.some((value) => value.toLowerCase().includes(filter)));
}

function treeEntries(nodes: readonly TreeNode[], parentPath: string[] = []): Array<{ node: TreeNode; path: string[] }> {
  return (nodes ?? []).flatMap((node) => [
    { node, path: parentPath },
    ...(node.nodeType === 'folder' ? treeEntries(node.children ?? [], [...parentPath, node.id]) : []),
  ]);
}

function folderNames(root: TreeNode): Record<string, string> {
  const result: Record<string, string> = { root: root.name ?? 'Snippets' };
  for (const entry of treeEntries(root.children ?? [])) result[entry.node.id] = String(entry.node['name'] ?? entry.node.id);
  return result;
}

function snippetFolderPath(root: TreeNode, folderId: string | null): string[] {
  if (!folderId) return [];
  for (const entry of treeEntries(root.children ?? [])) if (entry.node.id === folderId) return [...entry.path, folderId];
  return [];
}
