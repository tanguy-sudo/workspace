# AGENTS.md

Static Angular app (no backend; data in IndexedDB via Dexie), published on GitHub Pages under `/workspace/app/` with hash routing. Docs are in French.

## Commands (run from `angular/`)
- `npm start` dev server; `npm run build:local` dev build with base-href `/`.
- `npm run build` is the production build (base-href `/workspace/app/`), not for local serving.
- `npm test -- --watch=false` runs Vitest through `ng test` (jsdom + fake-indexeddb; the script passes `--isolate=false`).
- `npm run verify` runs build, then tests, then `tsc --noEmit -p tsconfig.app.json`.
- Node 22 in CI. The package manager is npm.
- E2E (from the repo root): `python3 e2e/run.py` builds Angular and runs browser smoke tests on `fixtures/`. `WORKSPACE_BROWSER` selects the browser.

## Layout
- `angular/src/app/{core,features,shared}`: `core` holds persistence, domain, export and security. Routes are in `app.routes.ts`. State uses Signals services, with no external store.
- `.github/scripts/*.py` are CI checks (security controls, fixtures, legacy redirects and rollback). Legacy `.html` URLs are generated redirects, not real pages.
- Persisted and exported formats are defined in `DATA-CONTRACT.md`. Read it before changing the persistence or export code. See also `ARCHITECTURE.md`.
- `.github/agents/workspace-frontend.agent.md` is stale: it describes the old vanilla-JS multi-page app. Ignore it.

## Gotchas
- Git: toujours utiliser `git -c http.sslBackend=schannel <commande>` (surtout pour fetch/pull/push).
- Workflow: pour tout développement, créer une branche dédiée (jamais de commit direct sur `main`), pousser puis ouvrir une pull request vers `main` (CI sur PR : `main` et `plan/angular-migration-windows`). Lancer `npm run verify` avant la PR.
- Never use a personal browser profile or real credentials in tests or fixtures. Fixtures must stay anonymised.
- CI fetches the `legacy-rollback-tan58` branch for compatibility tests, and the workflow has a legacy rollback mode.
