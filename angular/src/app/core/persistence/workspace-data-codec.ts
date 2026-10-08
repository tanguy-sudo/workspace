import {
  REQUIRED_WORKSPACE_SECTIONS,
  WORKSPACE_EXPORT_VERSION,
} from './workspace-data';
import type { WorkspaceData, WorkspaceExport, WorkspaceExportMeta } from './workspace-data';

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

/** Checks the stable envelope boundary without normalizing its contents. */
export function assertWorkspaceData(value: unknown): asserts value is WorkspaceData {
  if (!isRecord(value)) throw new Error('Workspace data must be an object');

  const missing = REQUIRED_WORKSPACE_SECTIONS.filter((section) => !hasOwn(value, section));
  if (missing.length) throw new Error(`Workspace data is missing: ${missing.join(', ')}`);

  if (!Array.isArray(value['projects'])) throw new Error('Workspace projects must be an array');
  if (!Array.isArray(value['todos'])) throw new Error('Workspace todos must be an array');
  if (!Array.isArray(value['snippets'])) throw new Error('Workspace snippets must be an array');
  if (!Array.isArray(value['journal'])) throw new Error('Workspace journal must be an array');
  if (!Array.isArray(value['trash'])) throw new Error('Workspace trash must be an array');
  if (!Array.isArray(value['recentlyVisited'])) {
    throw new Error('Workspace recentlyVisited must be an array');
  }
  if (!Array.isArray(value['activityLog'])) {
    throw new Error('Workspace activityLog must be an array');
  }

  for (const section of ['rh', 'snippetFolders', 'favorites', 'settings']) {
    if (!isRecord(value[section])) throw new Error(`Workspace ${section} must be an object`);
  }

  if (!isRecord(value['snippetMixedOrder'])) {
    throw new Error('Workspace snippetMixedOrder must be an object');
  }
}

export function createWorkspaceExport(
  data: WorkspaceData,
  metadata: Omit<Partial<WorkspaceExportMeta>, 'version'> = {},
): WorkspaceExport {
  assertWorkspaceData(data);
  return {
    _meta: {
      app: 'Workspace',
      exportedAt: new Date().toISOString(),
      ...metadata,
      version: WORKSPACE_EXPORT_VERSION,
    },
    data,
  };
}

export function serializeWorkspaceExport(
  data: WorkspaceData,
  metadata: Omit<Partial<WorkspaceExportMeta>, 'version'> = {},
): string {
  return JSON.stringify(createWorkspaceExport(data, metadata));
}

export function parseWorkspaceExport(raw: string): WorkspaceExport {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Workspace export is not valid JSON');
  }

  if (!isRecord(parsed) || !isRecord(parsed['_meta'])) {
    throw new Error('Workspace export must contain _meta and data');
  }
  const metadata = parsed['_meta'];
  if (metadata['version'] !== WORKSPACE_EXPORT_VERSION) {
    throw new Error(`Unsupported workspace export version: ${String(metadata['version'])}`);
  }
  assertWorkspaceData(parsed['data']);
  return parsed as WorkspaceExport;
}
