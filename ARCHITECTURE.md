# Architecture - Workspace Application

## Vue d'ensemble

Application web statique cote navigateur.

- Stack: HTML/CSS/JavaScript vanilla
- Persistance: IndexedDB via Dexie + cache memoire
- Pas de serveur applicatif ni de build obligatoire
- Les donnees Workspace ne sont pas envoyees vers un backend
- Navigation multi-pages (1 page HTML par domaine fonctionnel)
- Highlight.js et sa feuille de style sont charges depuis cdnjs sur les pages de code

## Structure du depot

```text
.
├── *.html                        # pages applicatives (index, todos, project, ...)
├── package.json                  # metadonnees npm minimales, sans build runtime
├── assets/                       # icones et bibliotheque Dexie embarquee
│   └── vendor/dexie.min.js
├── css/
│   ├── base.css                  # variables/theme + reset
│   ├── components.css            # composants partages
│   ├── layout.css                # topbar, layout global
│   ├── favorites.css             # panel favoris flottant
│   ├── global-search.css         # palette recherche
│   ├── markdown-editor.css       # editeur/preview markdown
│   └── pages/*.css               # styles par page
├── js/
│   ├── db.js                     # couche Dexie + cache memoire global
│   ├── storage.js                # modele de donnees + CRUD metier
│   ├── safe-storage.js           # helpers de serialisation et robustesse stockage
│   ├── common-utils.js           # utilitaires communs (tree traversal, parse temps, ...)
│   ├── components.js             # modales, toasts, composants UI
│   ├── modal-utils.js            # resize/persistance des modales
│   ├── date-picker-utils.js      # date picker custom
│   ├── router.js                 # lecture/ecriture params URL
│   ├── theme.js                  # theme + accent
│   ├── shortcuts.js              # raccourcis clavier globaux
│   ├── drag-drop.js              # drag and drop transversal
│   ├── wiki-links.js             # rendu/gestion des [[wiki-links]]
│   ├── markdown-editor.js        # editeur markdown
│   ├── global-search.js          # recherche globale transversale
│   ├── favorites.js              # panel favoris
│   ├── highlight-init.js         # init highlight.js (project/snippets)
│   ├── password-vault.js         # chiffrement des items mot de passe
│   ├── zip-writer.js             # generation zip export
│   └── pages/*.js                # logique metier par page
└── .github/agents/               # instructions de contribution GitHub
```

## Chargement des scripts

Les pages partagent une chaine de chargement, puis ajoutent des modules selon leurs besoins. L'ordre reel varie legerement entre les pages.

### Chaine commune

```html
1. assets/vendor/dexie.min.js
2. js/db.js
3. js/storage.js
4. js/safe-storage.js
5. js/common-utils.js
6. js/router.js
7. js/components.js
8. js/modal-utils.js
9. js/date-picker-utils.js
10. js/theme.js
11. js/drag-drop.js
12. js/wiki-links.js (pages Markdown)
13. js/markdown-editor.js (pages Markdown)
14. js/global-search.js
15. js/shortcuts.js
16. js/favorites.js
17. js/pages/<page>.js
```

`export.html` remplace les modules Markdown par `global-search.js`, `shortcuts.js`, `drag-drop.js`, `favorites.js`, puis charge `zip-writer.js`, les convertisseurs et la page Export. `settings.html` charge `password-vault.js` avant les modules d'interface. Les pages de code chargent Highlight.js depuis cdnjs avant `highlight-init.js`.

### Modules optionnels

- `js/wiki-links.js` + `js/markdown-editor.js`: pages contenant du Markdown
- `js/password-vault.js`: pages qui manipulent le coffre secret (`project`, `settings`)
- `js/highlight-init.js` + CDN `highlight.min.js`: pages code (`project`, `snippets`)
- `js/zip-writer.js` + `js/pages/export-*`: page export/import

### Contraintes critiques

- `db.js` doit etre charge avant `storage.js`
- `drag-drop.js` doit etre charge avant `favorites.js` (sinon panel favoris incomplet)
- `highlight-init.js` ne doit etre charge que si `hljs` est disponible
- `Ctrl+K` est gere par la recherche globale et par l'editeur Markdown (insertion de lien)

## Boot runtime

1. Chaque HTML applique le theme le plus tot possible via un petit script inline (`workspace-theme`).
2. `db.js` initialise Dexie et expose `window.WorkspaceDB_READY`.
3. Les scripts de page utilisent `bootPage(() => { ... })` pour attendre DOM + DB prets.
4. Pendant le boot, `db.js` declenche aussi l'initialisation ou la mise a jour des snippets systeme et des modeles par defaut, puis purge la corbeille au-dela de 30 jours.
5. `initPageCommon()` applique le branding et le theme, initialise les rappels communs et verifie la sauvegarde automatique.

## Persistance

### IndexedDB (Dexie)

- Base: `workspace`
- Table: `kv`
- Cles principales:
  - `data`: etat applicatif complet
  - `backupDirHandle`: handle de dossier pour backup (si support navigateur)

Le modele est volontairement simple: une seule racine de donnees, lue en memoire puis persistee en debounce.

### Cache memoire

- `WorkspaceDB.cache` sert de source synchrone pour les pages
- `WorkspaceDB.setSync` programme un flush differe (~80 ms)
- flush force sur `beforeunload`, `pagehide`, `visibilitychange`
- un verrou Web Locks exclusif `workspace:data-write` attribue l'ecriture a un seul onglet par origine ; les autres versions Workspace restent en lecture seule
- l'ecriture refusee en lecture seule ne modifie pas le cache memoire
- navigateur sans Web Locks : mode lecture seule par securite
- verrou volontairement global car legacy et Angular remplacent tous deux la racine `kv.data`; aucune edition simultanee multi-onglet n'est prise en charge

### localStorage

Utilise pour preferences et etat UI, notamment:

- `workspace-theme`, `workspace-accent`
- `workspace-last-backup`
- `workspace-smart-plan`
- `workspace-projects-view`, `workspace-projects-parent`
- `workspace-snippets-view`, `workspace-todos-view`
- `workspace-reminder-fired-v1`, `workspace-notif-asked`
- `workspace-modal-size-v1:<cle>` pour la taille des modales
- `workspace_data` est conserve comme cle legacy pour la migration

### sessionStorage

Utilise pour etats temporaires:

- `workspace-vault-key-v1`: cle de session du coffre secret
- `workspace_create_journal`: creation demandee depuis la palette globale
- `workspace_focus_todo`: drapeau legacy de focus depuis l'accueil

### Navigation inter-page

Les parametres URL `focus`, `path`, `kind` et `savedView` restaurent une vue ou le focus sur la page cible.

## Modele de donnees

Racine (`getData`) avec sections principales:

- `projects`: tableau projets, chacun avec arbre mixte `folder`/`item`
- `todos`: taches (status, priorite, recurrence, rappel, estimation, attachedTo)
- `snippets` + `snippetFolders` + `snippetMixedOrder`
- `rh`: arbre documents RH
- `favorites`: arbre favoris
- `journal`: entrees journal
- `trash`: corbeille globale
- `recentlyVisited`: historique des visites de l'accueil
- `activityLog`: journal d'activite, cree a la premiere mutation
- `settings`: preferences utilisateur/site/backup/coffre

Les parametres contiennent notamment `todoSavedViews`, `weeklyReview`, `todoPriorities` et `templates`. `secretVault` est ajoute uniquement lorsque le coffre est active. Les snippets sont stockes dans un tableau, avec l'arbre `snippetFolders` et l'ordre mixte `snippetMixedOrder`.

### Details importants

- Les arbres utilisent `nodeType: "folder" | "item"`; l'arbre RH utilise aussi `document` et l'arbre des favoris utilise `link`
- Les items de projets utilisent les types `link`, `memo`, `info`, `code` et `password`
- Les parcours d'arbres utilisent `walkTree` / `countTreeNodes` (eviter les recursions ad hoc)
- Les taches utilisent les statuts `todo`, `waitinginfo`, `inprogress` et `done`
- Les taches recurrentes sont dupliquees automatiquement lors du passage a `done`

## Flots fonctionnels majeurs

### 1) Taches recurrentes

- Normalisation recurrence dans `storage.js`
- Calcul prochaine occurrence (daily/weekly/monthly_nth_weekday)
- Creation automatique de la prochaine tache sur completion
- Reminders decalés sur la nouvelle date si besoin

### 2) Coffre de mots de passe

- Activation depuis `settings`
- Derivation de cle via PBKDF2
- Chiffrement AES-GCM des secrets des items `type="password"`
- Secret de session garde en `sessionStorage`

### 3) Recherche globale

- Index multi-sections (projets, items et dossiers de projets, todos, snippets, RH)
- Filtres textuels (`type:`, `tag:`, `status:`, etc.)
- Navigation avec parametres de focus (`focus`, `path`, `kind`) vers la page cible
- Le journal dispose d'une recherche locale dans `journal.js`, mais ses entrees ne sont pas indexees par la recherche globale

### 4) Backup / export / import

- Backup automatique configurable, verifie au chargement de chaque page quand l'intervalle est echu
- Aucun timer de backup ne tourne en arriere-plan entre deux chargements de page
- Backup manuel depuis `settings`, avec choix de dossier natif quand le navigateur le permet
- Le backup automatique utilise le telechargement classique; le dossier choisi sert aux sauvegardes manuelles
- Export JSON/Markdown/ZIP via `export.html` (legacy) et la route Angular `/export` pendant la transition
- Export par section: JSON/Markdown, CSV pour les taches, ZIP pour les snippets, le journal et les projets
- Import JSON uniquement, avec normalisation des payloads partiels
- Import par fusion; ecrasement autorise uniquement pour une sauvegarde complete Workspace

## Guide maintenance

### Ajouter une nouvelle page

1. Creer `<page>.html`
2. Reprendre la chaine de scripts de base
3. Ajouter `js/pages/<page>.js` avec `bootPage(() => { ... })`
4. Ajouter `css/pages/<page>.css`
5. Integrer la navigation topbar

### Regles de robustesse

- Garder l'ordre de chargement des scripts stable
- Ne pas ajouter de dependance implicite entre modules transverses
- Tester le drag and drop sur listes mixtes (dossiers + items)
- Verifier que les pages sans Markdown continuent de fonctionner sans `wiki-links.js`
- Conserver un fallback local dans `global-search.js` pour `debounce`

## Version du document

Mis a jour le 2026-08-18, aligne sur le code actuel du depot.
