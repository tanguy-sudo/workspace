import { Injectable } from '@angular/core';
import { Params } from '@angular/router';

const LEGACY_ORIGIN = 'https://workspace.invalid';
const LEGACY_PAGES = new Set([
  'index.html',
  'todos.html',
  'projects.html',
  'project.html',
  'snippets.html',
  'rh.html',
  'journal.html',
  'smart-planning.html',
  'settings.html',
  'export.html',
]);

export interface AngularRouteTarget {
  path: string;
  queryParams: Params;
}

@Injectable({ providedIn: 'root' })
export class LegacyRouteService {
  map(input: string | URL): AngularRouteTarget | null {
    const url = this.parse(input);
    if (!url) return null;

    const page = this.pageName(url.pathname);
    const queryParams = this.queryParams(url.searchParams);

    if (page === 'index.html' || page === '') return { path: 'home', queryParams };
    if (!LEGACY_PAGES.has(page)) return null;

    if (page === 'project.html') {
      const id = url.searchParams.get('id');
      if (!id) return { path: 'projects', queryParams: {} };
      delete queryParams['id'];
      return {
        path: `project/${encodeURIComponent(id)}`,
        queryParams: this.withFolderAlias(queryParams, url.searchParams),
      };
    }

    if (page === 'rh.html' || page === 'snippets.html') {
      return {
        path: page === 'rh.html' ? 'rh' : 'snippets',
        queryParams: this.withFolderAlias(queryParams, url.searchParams),
      };
    }

    return {
      path: page.replace('.html', ''),
      queryParams,
    };
  }

  toUrl(input: string | URL): string | null {
    const target = this.map(input);
    if (!target) return null;

    const query = new URLSearchParams();
    Object.entries(target.queryParams).forEach(([key, value]) => {
      for (const item of Array.isArray(value) ? value : [value]) {
        if (item !== undefined && item !== null) query.append(key, String(item));
      }
    });

    const queryString = query.toString();
    return `/${target.path}${queryString ? `?${queryString}` : ''}`;
  }

  private parse(input: string | URL): URL | null {
    try {
      const url = input instanceof URL ? input : new URL(input, LEGACY_ORIGIN);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
      if (input instanceof URL && url.origin !== LEGACY_ORIGIN && url.origin !== globalThis.location?.origin) return null;
      if (typeof input === 'string' && /^[a-z][a-z\d+.-]*:/i.test(input) && url.origin !== LEGACY_ORIGIN && url.origin !== globalThis.location?.origin) return null;
      return url;
    } catch {
      return null;
    }
  }

  private pageName(pathname: string): string {
    const name = pathname.split('/').filter(Boolean).pop() || '';
    return name.toLowerCase();
  }

  private queryParams(searchParams: URLSearchParams): Params {
    const params: Params = {};
    searchParams.forEach((value, key) => {
      const previous = params[key];
      params[key] = previous === undefined
        ? value
        : Array.isArray(previous)
          ? [...previous, value]
          : [previous, value];
    });
    return params;
  }

  private withFolderAlias(params: Params, searchParams: URLSearchParams): Params {
    const next = { ...params };
    delete next['folder'];

    if (!searchParams.get('path')) {
      const folder = searchParams.get('folder');
      if (folder) next['path'] = folder;
    }

    return next;
  }
}
