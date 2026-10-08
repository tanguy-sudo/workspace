# Workspace Angular

Standalone Angular transition shell generated with Angular CLI `22.1.7`.
It is isolated from the legacy HTML pages and uses strict application type checking.

## Reproducible checks

From this directory:

```bash
npm ci
npm run verify
```

`verify` runs the production build, Vitest tests and application type checking.
Security controls also cover CSP, safe rendering, import limits, attachment
previews and the published artifact. The production artifact is written to
`dist/workspace/app/browser/` with base href `/workspace/app/`.

The Angular package has its own `package-lock.json`; the legacy root remains
unchanged and continues to use its existing browser scripts.

## Local preview

For the isolated shell with the development server:

```bash
npm start
```

Open `http://localhost:4200/`. To serve the production output with a static
server, run `npm run build` first and serve `dist/workspace/app/browser/`.

The shell contains no legacy script tags. Its navigation uses Angular routes;
legacy `.html` pages remain available at the repository root during coexistence.
