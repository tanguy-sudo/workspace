declare module 'node:fs/promises' {
  export function readFile(path: string, encoding: 'utf8'): Promise<string>;
}

declare module 'node:path' {
  export function resolve(...paths: string[]): string;
}

declare module 'node:child_process' {
  export function execFileSync(file: string, args: string[], options: { encoding: 'utf8' }): string;
}

declare const process: { cwd(): string };
