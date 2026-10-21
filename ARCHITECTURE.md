# Architecture Workspace

## Runtime

Workspace est une application Angular statique, hébergée sur GitHub Pages. Elle
n'a ni serveur applicatif ni backend ; les données restent dans IndexedDB du
navigateur. L'application est publiée sous `/workspace/app/` avec le routage
Angular par hash.

Les anciennes URL (`todos.html`, `project.html?id=...`, etc.) sont générées par
`.github/scripts/build-legacy-redirects.py` et redirigent vers leurs routes
Angular. Les routes sont définies dans `angular/src/app/app.routes.ts` ; le
mapping de compatibilité est testé avec
`angular/src/app/core/routing/legacy-route.service.ts`.

## Structure

```text
angular/
  src/app/
    core/          # persistance, domaine, fichiers, sécurité, export
    features/      # dashboard, tâches, projets, RH, journal, snippets...
    shared/        # navigation, recherche, arbres, rendu, feedback
    app.routes.ts
    app.config.ts
  src/styles/      # styles globaux utilisés par le build Angular
fixtures/          # données anonymisées pour tests
e2e/               # smoke tests navigateur Playwright
.github/
  scripts/         # validation de l'artifact, redirections, fixtures, sécurité
  workflows/       # CI, déploiement GitHub Pages et rollback
```

Le [README racine](README.md) décrit l'application et son exploitation ;
[`angular/README.md`](angular/README.md) documente les commandes de
développement. `DATA-CONTRACT.md` définit les formats persistés et exportés.

## Application

- Les routes associent des URL hash à des composants standalone ; les vues
  principales sont chargées à la demande.
- Les composants Angular composent le shell et les fonctionnalités. Les services
  portent l'état partagé et les opérations métier avec Signals ; aucun store
  externe n'est utilisé.
- Les styles globaux sont dans `angular/src/styles/`, les styles propres aux
  composants à côté de ceux-ci.
- Les anciennes URL `.html` publiées sont des redirections minimales, pas des
  pages ou scripts legacy.

## Persistance

`WorkspaceDbService` adapte IndexedDB via Dexie : base `workspace`, version `1`,
store `kv`. La racine complète est stockée dans `kv["data"]` ; le handle de
répertoire de sauvegarde utilise `kv["backupDirHandle"]`. `WorkspaceStoreService`
expose cette racine dans l'état Angular, en conservant les champs inconnus.

- La valeur legacy `localStorage["workspace_data"]` sert de fallback seulement
  si la ligne IndexedDB n'existe pas. La migration la copie sans supprimer la
  valeur d'origine.
- Web Locks, sous le nom `workspace:data-write`, réserve l'écriture à une seule
  fenêtre Workspace par origine. Les autres fenêtres sont en lecture seule.
- Les mutations sont persistées avec debounce ; un flush est demandé au masquage
  du document et à la fermeture/navigation de la page.
- Les formats et règles de compatibilité sont détaillés dans `DATA-CONTRACT.md`.

Les sources legacy ne sont plus dans `main`. La branche
`legacy-rollback-tan58` conserve le snapshot utilisé par la procédure de
rollback ; ne pas la supprimer sans remplacer explicitement cette procédure.

## Build et déploiement

La CI exécute le build Angular, les tests, les vérifications TypeScript, l'audit
des dépendances, les contrôles de fixtures et les smoke tests Chromium. Elle
valide aussi les redirections et l'artifact Pages. En mode Angular, celui-ci
contient le build Angular et les redirections, sans les sources legacy.

Un push sur `main` déploie Angular. Le lancement manuel de `CI/CD` avec
`pages_mode=legacy` et `legacy_ref=legacy-rollback-tan58` valide puis publie le
snapshot de rollback ; relancer en mode `transition` rétablit Angular.
