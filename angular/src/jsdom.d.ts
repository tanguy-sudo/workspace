declare module 'jsdom' {
  export interface BeforeParseWindow {
    indexedDB?: IDBFactory;
    IDBKeyRange?: typeof IDBKeyRange;
  }

  export class JSDOM {
    constructor(html?: string, options?: {
      url?: string;
      runScripts?: 'dangerously';
      beforeParse?: (window: BeforeParseWindow) => void;
    });
    readonly window: Window & { eval(source: string): void };
  }
}
