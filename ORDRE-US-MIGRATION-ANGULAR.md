# Ordre d'exécution des US - Migration Angular

**Epic Linear :** [TAN-17](https://linear.app/tanguy-sudo/issue/TAN-17/epic-migrer-workspace-vers-angular-et-automatiser-le-demarrage-windows)<br>
**Projet Linear :** [workspace](https://linear.app/tanguy-sudo/project/workspace-0e782be3ae51/overview)<br>
**Branche de préparation :** `plan/angular-migration-windows`<br>
**Plan détaillé :** [PLAN-MIGRATION-ANGULAR-WINDOWS.md](PLAN-MIGRATION-ANGULAR-WINDOWS.md)

## Mode d'emploi

- Cocher une case uniquement lorsque l'US Linear est terminée et vérifiée.
- L'ordre est recommandé : une US peut être déplacée uniquement si sa dépendance est déjà satisfaite.
- Les issues `Urgent` sont généralement des prérequis ou des protections contre la perte de données.
- Après chaque phase, exécuter le jalon de validation avant de commencer la suivante.
- Mettre à jour ce fichier dans la même branche que le travail correspondant.

## Vue d'ensemble

- [x] M0 - Cadrage et baseline
- [x] M1 - Socle Angular et CI
- [x] M2 - Données et sécurité
- [x] M3 - Shell et navigation
- [x] M4 - Migration fonctionnelle
- [ ] M5 - Import/export et qualité
- [ ] M6 - Déploiement GitHub Pages
- [ ] M7 - Windows et bascule

## M0 - Cadrage et baseline

**Objectif :** décider l'architecture et créer une référence fiable avant toute migration.

### Ordre

1. - [x] [TAN-18 - Valider les décisions d'architecture et d'hébergement](https://linear.app/tanguy-sudo/issue/TAN-18/us-valider-les-decisions-darchitecture-et-dhebergement)
2. - [x] [TAN-21 - Établir la baseline fonctionnelle et la matrice des URL](https://linear.app/tanguy-sudo/issue/TAN-21/us-etablir-la-baseline-fonctionnelle-et-la-matrice-des-url)
3. - [x] [TAN-24 - Créer les fixtures de données et l'export de référence](https://linear.app/tanguy-sudo/issue/TAN-24/us-creer-les-fixtures-de-donnees-et-lexport-de-reference)
4. - [x] [TAN-19 - Formaliser le contrat de compatibilité des données](https://linear.app/tanguy-sudo/issue/TAN-19/us-formaliser-le-contrat-de-compatibilite-des-donnees)

### Validation M0

- [x] URL GitHub Pages et stratégie de routage validées.
- [x] Distribution en ligne uniquement via GitHub Pages confirmée ; aucune version locale/hors ligne prévue.
- [ ] Export JSON de référence vérifié et conservé hors du dépôt.
- [x] Fixtures anonymisées disponibles.
- [x] Contrat IndexedDB et coffre documenté.

## M1 - Socle Angular et CI

**Objectif :** compiler Angular sans remplacer ni casser l'application legacy.

### Ordre

5. - [x] [TAN-22 - Initialiser le workspace Angular standalone](https://linear.app/tanguy-sudo/issue/TAN-22/us-initialiser-le-workspace-angular-standalone)
6. - [x] [TAN-20 - Ajouter le build et les tests Angular à la CI](https://linear.app/tanguy-sudo/issue/TAN-20/us-ajouter-le-build-et-les-tests-angular-a-la-ci)
7. - [x] [TAN-23 - Préparer un environnement Angular de transition sans remplacer le legacy](https://linear.app/tanguy-sudo/issue/TAN-23/us-preparer-un-environnement-angular-de-transition-sans-remplacer-le)

### Validation M1

- [x] `npm ci` fonctionne sur une machine propre.
- [x] Le build Angular de production passe.
- [x] Les tests et checks legacy passent toujours.
- [x] Angular est accessible sur un chemin de transition isolé.
- [x] Aucun fichier sensible ou `node_modules` n'est publié.

## M2 - Données et sécurité

**Objectif :** permettre à Angular de lire et écrire les données existantes sans perte.

### Ordre

8. - [x] [TAN-25 - Implémenter l'adaptateur Dexie compatible avec le stockage legacy](https://linear.app/tanguy-sudo/issue/TAN-25/us-implementer-ladaptateur-dexie-compatible-avec-le-stockage-legacy)
9. - [x] [TAN-26 - Migrer idempotemment l'ancien localStorage vers IndexedDB](https://linear.app/tanguy-sudo/issue/TAN-26/us-migrer-idempotemment-lancien-localstorage-vers-indexeddb)
10. - [x] [TAN-28 - Créer le store Workspace typé avec écritures maîtrisées](https://linear.app/tanguy-sudo/issue/TAN-28/us-creer-le-store-workspace-type-avec-ecritures-maitrisees)
11. - [x] [TAN-29 - Centraliser les préférences localStorage et sessionStorage](https://linear.app/tanguy-sudo/issue/TAN-29/us-centraliser-les-preferences-localstorage-et-sessionstorage)
12. - [x] [TAN-30 - Porter les fonctions métier pures de storage.js](https://linear.app/tanguy-sudo/issue/TAN-30/us-porter-les-fonctions-metier-pures-de-storagejs)
13. - [x] [TAN-27 - Encapsuler les APIs fichiers et téléchargements](https://linear.app/tanguy-sudo/issue/TAN-27/us-encapsuler-les-apis-fichiers-et-telechargements)
14. - [x] [TAN-31 - Migrer le coffre de mots de passe sans changer le format cryptographique](https://linear.app/tanguy-sudo/issue/TAN-31/us-migrer-le-coffre-de-mots-de-passe-sans-changer-le-format)

### Validation M2

- [x] Une base IndexedDB legacy s'ouvre dans Angular.
- [x] La migration `workspace_data` est idempotente.
- [x] Une écriture Angular est relue par la version legacy.
- [x] Les champs inconnus sont conservés.
- [x] Les fichiers et fallbacks navigateur sont testés.
- [x] Une fixture du coffre est déverrouillable.
- [x] Aucun secret n'apparaît dans les logs.

## M3 - Shell et navigation

**Objectif :** construire les fondations UI et le routage utilisés par toutes les fonctionnalités.

### Ordre

15. - [x] [TAN-32 - Migrer le shell global, le thème et la navigation commune](https://linear.app/tanguy-sudo/issue/TAN-32/us-migrer-le-shell-global-le-theme-et-la-navigation-commune)
16. - [x] [TAN-34 - Migrer les modales, toasts et comportements d'accessibilité partagés](https://linear.app/tanguy-sudo/issue/TAN-34/us-migrer-les-modales-toasts-et-comportements-daccessibilite-partages)
17. - [x] [TAN-33 - Implémenter le routage Angular et la compatibilité des anciennes URL](https://linear.app/tanguy-sudo/issue/TAN-33/us-implementer-le-routage-angular-et-la-compatibilite-des-anciennes)
18. - [x] [TAN-35 - Migrer les arbres génériques et le drag and drop accessible](https://linear.app/tanguy-sudo/issue/TAN-35/us-migrer-les-arbres-generiques-et-le-drag-and-drop-accessible)
19. - [x] [TAN-37 - Migrer la recherche globale, les favoris et les raccourcis](https://linear.app/tanguy-sudo/issue/TAN-37/us-migrer-la-recherche-globale-les-favoris-et-les-raccourcis)
20. - [x] [TAN-38 - Sécuriser le rendu Markdown, HTML et les prévisualisations](https://linear.app/tanguy-sudo/issue/TAN-38/us-securiser-le-rendu-markdown-html-et-les-previsualisations)

### Validation M3

- [x] Le shell fonctionne sur une route Angular vide.
- [x] Le thème et les préférences legacy sont respectés.
- [x] Les anciennes URL et paramètres sont interprétés.
- [x] Le rechargement d'une route profonde fonctionne.
- [x] Les arbres empêchent les déplacements cycliques.
- [x] Le contenu HTML/Markdown hostile est neutralisé.
- [x] Les composants détruisent leurs timers, observers et listeners.

## M4 - Migration fonctionnelle

**Objectif :** migrer les domaines fonctionnels dans un ordre limitant les dépendances.

### Journal, RH et snippets

21. - [x] [TAN-40 - Migrer le journal Markdown](https://linear.app/tanguy-sudo/issue/TAN-40/us-migrer-le-journal-markdown)
22. - [x] [TAN-36 - Migrer l'arborescence RH et les documents](https://linear.app/tanguy-sudo/issue/TAN-36/us-migrer-larborescence-rh-et-les-documents)
23. - [x] [TAN-39 - Migrer la bibliothèque de snippets et sa prévisualisation](https://linear.app/tanguy-sudo/issue/TAN-39/us-migrer-la-bibliotheque-de-snippets-et-sa-previsualisation)

### Paramètres et sauvegardes

24. - [x] [TAN-41 - Migrer les paramètres et les sauvegardes](https://linear.app/tanguy-sudo/issue/TAN-41/us-migrer-les-parametres-et-les-sauvegardes)

### Projets

25. - [x] [TAN-43 - Migrer la liste et la hiérarchie des projets](https://linear.app/tanguy-sudo/issue/TAN-43/us-migrer-la-liste-et-la-hierarchie-des-projets)
26. - [x] [TAN-45 - Migrer le détail projet et les items de contenu](https://linear.app/tanguy-sudo/issue/TAN-45/us-migrer-le-detail-projet-et-les-items-de-contenu)

### Tâches, planification et accueil

27. - [x] [TAN-44 - Migrer les tâches, rappels et récurrences](https://linear.app/tanguy-sudo/issue/TAN-44/us-migrer-les-taches-rappels-et-recurrences)
28. - [x] [TAN-46 - Migrer la planification intelligente](https://linear.app/tanguy-sudo/issue/TAN-46/us-migrer-la-planification-intelligente)
29. - [x] [TAN-49 - Encadrer les notifications locales et leurs fallbacks](https://linear.app/tanguy-sudo/issue/TAN-49/us-encadrer-les-notifications-locales-et-leurs-fallbacks)
30. - [x] [TAN-42 - Migrer le tableau de bord, les rappels et la revue hebdomadaire](https://linear.app/tanguy-sudo/issue/TAN-42/us-migrer-le-tableau-de-bord-les-rappels-et-la-revue-hebdomadaire)

### Validation M4

- [x] Journal, RH et snippets fonctionnent sur les données historiques.
- [x] Paramètres et sauvegardes fonctionnent avec et sans File System Access.
- [x] Projets et items conservent ordre, hiérarchie et liens.
- [x] Les tâches récurrentes produisent les mêmes occurrences.
- [x] La planification conserve son état.
- [x] Le dashboard fonctionne avec un workspace vide et rempli.

## M5 - Import/export et qualité

**Objectif :** sécuriser les échanges de données et valider la parité avant publication.

### Ordre

31. - [x] [TAN-47 - Garantir la parité de l'export JSON, Markdown, CSV et ZIP](https://linear.app/tanguy-sudo/issue/TAN-47/us-garantir-la-parite-de-lexport-json-markdown-csv-et-zip)
32. - [x] [TAN-50 - Valider les imports JSON avant toute écriture](https://linear.app/tanguy-sudo/issue/TAN-50/us-valider-les-imports-json-avant-toute-ecriture)
33. - [x] [TAN-54 - Tester les round-trips legacy vers Angular et retour](https://linear.app/tanguy-sudo/issue/TAN-54/us-tester-les-round-trips-legacy-vers-angular-et-retour)
34. - [x] [TAN-48 - Ajouter les tests de non-régression end-to-end](https://linear.app/tanguy-sudo/issue/TAN-48/us-ajouter-les-tests-de-non-regression-end-to-end)
35. - [x] [TAN-51 - Réaliser l'audit sécurité et accessibilité Angular](https://linear.app/tanguy-sudo/issue/TAN-51/us-realiser-laudit-securite-et-accessibilite-angular)
36. - [x] [TAN-53 - Mesurer les performances et le quota du workspace Angular](https://linear.app/tanguy-sudo/issue/TAN-53/us-mesurer-les-performances-et-le-quota-du-workspace-angular)

### Validation M5

- [x] Export JSON complet puis import sans perte.
- [x] Imports invalides refusés sans modification de la base.
- [x] Round-trip legacy -> Angular -> legacy validé.
- [x] Tests end-to-end des parcours critiques exécutés.
- [x] Audit sécurité et accessibilité terminé.
- [x] Seuils de performance et de quota documentés.

## M6 - Déploiement GitHub Pages

**Objectif :** publier le build Angular de production sans exposer de fichiers inutiles.

### Ordre

37. - [x] [TAN-52 - Publier le build Angular de production sur GitHub Pages](https://linear.app/tanguy-sudo/issue/TAN-52/us-publier-le-build-angular-de-production-sur-github-pages)

### Validation M6

- [x] L'URL HTTPS de production est confirmée : `https://tanguy-sudo.github.io/workspace/`.
- [x] Le `base href` fonctionne sous le sous-chemin GitHub Pages (`/workspace/app/`).
- [x] Les assets et routes se chargent après rechargement direct (route Angular `/app/#/todos` vérifiée).
- [x] L'artifact ne contient ni dépendances de développement ni fixtures sensibles (vérification CI de l'artifact réussie).
- [x] La version legacy reste accessible pour le rollback (`/todos.html` vérifiée).

## M7 - Persistance et bascule

**Objectif :** valider la persistance navigateur et finaliser la bascule avec rollback. L'application sera ouverte manuellement dans le navigateur ; aucun démarrage automatique Windows n'est requis.

### Ordre

38. - [ ] [TAN-56 - Tester l'origine navigateur et la persistance au redémarrage Windows](https://linear.app/tanguy-sudo/issue/TAN-56/us-tester-lorigine-navigateur-et-la-persistance-au-redemarrage-windows)
39. - [x] [TAN-58 - Organiser la coexistence et le propriétaire des écritures](https://linear.app/tanguy-sudo/issue/TAN-58/us-organiser-la-coexistence-et-le-proprietaire-des-ecritures)
40. - [x] [TAN-59 - Préparer le rollback et retirer progressivement les pages legacy](https://linear.app/tanguy-sudo/issue/TAN-59/us-preparer-le-rollback-et-retirer-progressivement-les-pages-legacy)
41. - [ ] [TAN-61 - Réaliser la recette finale et basculer Angular en production](https://linear.app/tanguy-sudo/issue/TAN-61/us-realiser-la-recette-finale-et-basculer-angular-en-production)

### Validation M7

- [ ] L'application s'ouvre manuellement sur l'origine et dans le profil navigateur attendus.
- [x] Les données IndexedDB persistent après fermeture complète et réouverture du navigateur sur l'origine HTTPS de production (Chromium, profil temporaire isolé).
- [ ] La persistance est confirmée après un redémarrage réel de Windows avec le profil navigateur habituel.
- [ ] Le rollback vers legacy a été testé.
- [ ] Angular devient la cible par défaut.
- [ ] Le retrait des pages legacy est validé ou reporté explicitement.
- [x] Une seule fenêtre Workspace peut écrire : verrou Web Locks partagé entre Angular et legacy, conflit couvert par tests unitaires et E2E.
- [x] Le snapshot legacy de rollback est conservé et son artifact se valide localement.
- [ ] Le mode rollback est exécuté sur GitHub Pages, puis le retour au mode transition est vérifié.

**Décision :** TAN-60 (démarrage automatique via Task Scheduler) est abandonnée ; l'ouverture manuelle de l'URL répond au besoin.

**Décision :** TAN-57 (documentation d'installation/désinstallation Windows) est retirée du périmètre ; GitHub Pages ne nécessite aucune installation Windows.

**Décision :** TAN-55 (variante locale hors ligne) est abandonnée ; l'application sera distribuée uniquement par GitHub Pages et ouverte dans un navigateur. La demande Linear correspondante reste à fermer/annuler.

**TAN-58 validée :** verrou Web Locks exclusif par origine sur la racine IndexedDB partagée ; le premier onglet est écrivain, les autres versions Angular/legacy sont en lecture seule avec avertissement. Sans support Web Locks, l'application reste en lecture seule. Pas de coordination multi-onglet des modifications : fermer les autres onglets Workspace avant d'éditer.

**Limite de déploiement :** les onglets ouverts avec un ancien JavaScript legacy qui ne connaît pas ce verrou doivent être rechargés après le déploiement ; ils ne peuvent pas être coordonnés rétroactivement.

**TAN-59 préparée :** `workflow_dispatch` propose le rollback Pages vers le snapshot legacy dédié `legacy-rollback-tan58`. Les modes `legacy` et `transition` passent leur validation GitHub Actions sur la branche `tan-59-rollback-legacy`. Aucun de ces runs n'a modifié le site public. Le rollback réel et le retour au mode transition restent à tester après fusion sur `main`.

**Retrait legacy :** différé après la recette TAN-61 et au moins 7 jours d'observation sans incident. TAN-59 prépare le rollback ; le retrait des sources legacy reste conditionné à TAN-61 et à cette période d'observation.

## Suivi des décisions et écarts

| Date | US / phase | Décision ou écart | Action à faire |
|---|---|---|---|
| 2026-08-19 | M0/M1 | M0 validée sauf la preuve d'un export JSON réel conservé hors dépôt ; M1 validée par `npm ci`, build, 67 tests, checks legacy, artifact local isolé et contrôles d'exclusion. | Conserver ou vérifier manuellement l'export de référence hors dépôt avant de considérer M0 totalement clôturée. |
| 2026-08-19 | M3 | Validation locale et CI effectuées : build Angular sous `/workspace/app/`, 67 tests, checks legacy, fixtures et sanitation hostile passés. | Commencer M4 par TAN-40, puis TAN-36 et TAN-39. |
| 2026-08-25 | TAN-41 | Paramètres, préférences de sauvegarde, sauvegarde JSON complète, auto-backup au démarrage, picker/fallback fichier, quota et coffre migrés dans Angular. Validation locale : build et 89 tests. | Poursuivre M4 avec TAN-43. La validation manuelle dans un navigateur réel reste à exécuter avant la recette M4 complète. |
| 2026-08-25 | TAN-43 | Liste Angular des projets avec scopes `parent`, breadcrumbs/historique, recherche, vues grille/liste, favoris, création de projets/sous-projets, suppression en cascade vers la corbeille et navigation vers le détail. Validation locale : build et 97 tests. | TAN-45 terminée ; poursuivre M4 avec TAN-44. La validation manuelle des parcours projet reste à exécuter avant la recette M4 complète. |
| 2026-09-01 | TAN-45 | Détail projet Angular, paramètres `folder`/`path`/`focus`/`kind`, arbres mixtes, filtres récursifs, CRUD, ordre et déplacements anti-cycle, corbeille, tâches liées, pièces jointes, Markdown, URLs sûres, plein écran/copie et coffre verrouillé. Validation locale : `npm run verify`, build, TypeScript et 106 tests passés. Budget `anyComponentStyle` ajusté à 10.5 kB ; warnings de budget initial/avertissements de sanitization conservés. | TAN-44 terminée ; poursuivre M4 avec TAN-46. La validation manuelle des parcours projet reste à exécuter avant la recette M4 complète. |
| 2026-09-01 | TAN-44 | Page `/todos` Angular lazy-loaded avec filtres `status`/`priority`/`context`/`project`/`due`, paramètres `focus`/`savedView`/`view`, vues colonnes/liste/priorités, CRUD complet, dépendances, estimation, échéances/rappels, récurrences locales, priorités, modèles, sélection multiple, corbeille et activités. Validation locale : `npm run verify`, build, TypeScript et 115 tests passés. Notifications natives laissées à TAN-49 ; warnings de budgets Angular conservés. | Exécuter la validation manuelle des parcours tâches avant la recette M4 complète, puis poursuivre avec TAN-46. |
| 2026-09-01 | TAN-46 | Route `/smart-planning` Angular lazy-loaded, sélection équilibrée/focus/sprint, filtres contexte/date/projet/dépendances, parseur d'estimation partagé, état `workspace-smart-plan`, restauration inter-route, complétion via le domaine commun et navigation vers les tâches. Validation locale : `npm run verify`, build, TypeScript et 122 tests passés. Warnings de budgets Angular conservés. | TAN-49 terminée ; poursuivre M4 avec TAN-42. La validation manuelle des parcours planification reste à exécuter avant la recette M4 complète. |
| 2026-09-01 | TAN-49 | Service Angular global de rappels : permission demandée une seule fois, vérification immédiate puis toutes les 30 secondes et au retour de visibilité, déduplication via `workspace-reminder-fired-v1`, notification native facultative et toast visuel de fallback. Les notifications lorsque l'application est fermée restent hors périmètre, sans service worker. Validation locale : `npm run verify`, build, TypeScript et 126 tests passés. Warnings de budgets Angular et avertissements de sanitization conservés. | Poursuivre M4 avec TAN-42. La validation manuelle des notifications dans un navigateur réel reste à exécuter avant la recette M4 complète. |
| 2026-09-01 | TAN-42 | Dashboard Angular lazy-loaded sur `/home` : hero et raccourcis, rappels avec onglets/actions, statistiques, santé de l'organisation, revue hebdomadaire, activité récente et liens Angular. Workspace vierge initialisé avec des sections par défaut ; focus des tâches, récurrences et modale de rappel accessibles. Validation locale : `npm run verify`, build, TypeScript et 134 tests passés. Warnings de budgets Angular et avertissements de sanitization conservés. | La recette navigateur M4 a couvert les parcours dashboard rempli et vide, rappels et revue. |
| 2026-09-01 | M4 | Validation fonctionnelle locale complète : smoke Chromium sur les routes Angular avec `workspace-full` et `workspace-empty`, checks syntaxe/resources/fixtures legacy, build local et `npm run verify` avec 134 tests. Les tests couvrent aussi le picker File System Access et le fallback téléchargement. | M4 validé ; commencer M5 avec TAN-47. |
| 2026-09-02 | TAN-47 | Route `/export` Angular lazy-loaded avec exports JSON complets et par section, Markdown, CSV des tâches, ZIP UTF-8 sans dépendance et widget de quota. Politique coffre documentée : JSON lossless, fichiers lisibles sans secrets. Validation locale : `npm run verify`, build local, checks legacy/fixtures, 147 tests et smoke Chromium des quatre formats avec lecture ZIP. | TAN-47 terminée ; poursuivre M5 avec TAN-50. |
| 2026-09-02 | TAN-50 | Import JSON validé avant toute écriture, côté Angular (`workspace-import.ts`, `WorkspaceImportService`, page `/export`) et côté legacy (`js/pages/export-import.js`). Reconnaissance des exports complets legacy et actuels et des exports par section, validation complète avant écriture, sauvegarde préalable obligatoire en écrasement, écriture via `replace()` puis `flush()`, rollback mémoire et persistance en cas d'échec, invalidation de la session du coffre. Deux écarts corrigés : `_nodeParentId` et `_rhParentId` redevenus optionnels côté Angular pour accepter les corbeilles des exports historiques, et `flush()` legacy propage désormais les échecs de persistance. Validation locale : `npm run verify`, build, TypeScript application et specs, 171 tests, checks legacy/fixtures, import de l'export réel pré-migration du 2026-09-02 accepté par les deux validateurs avec fusion stable, et rollback vérifié sur un vrai IndexedDB avec relecture après échec. | TAN-50 terminée ; poursuivre M5 avec TAN-54. Restent à couvrir hors tests automatisés : smoke navigateur de `/export` et de `export.html` (import fusion, écrasement avec sauvegarde, refus d'un JSON invalide, pièce jointe et coffre), échec réel d'IndexedDB sur le chemin legacy, et concurrence multi-onglets non coordonnée entre Angular et legacy (aucun verrou inter-onglets livré ; seul un changement pendant la sauvegarde préalable, dans le même onglet, est détecté). |
| 2026-09-03 | TAN-54 | Tests d'intégration sur IndexedDB partagé : export legacy puis import Angular, lecture legacy par Angular puis export/import retour legacy, workspace vide, pièce jointe, ordre des arbres, IDs, dates, secrets chiffrés et refus d'un import invalide sans mutation. Le harnais exécute les vrais scripts legacy d'export/import dans un DOM isolé sans réseau. Validation locale : 4 scénarios round-trip et 175 tests Angular passés. | TAN-54 terminée ; poursuivre M5 avec TAN-48. Les tests navigateur réel et la concurrence multi-onglets restent hors périmètre. |
| 2026-09-03 | TAN-48 | Runner Playwright Python avec serveur HTTP local isolé, profil Chromium persistant jetable, fixtures vide/remplie, navigation Angular et legacy, routes profondes, CRUD tâche/projet/journal, corbeille, récurrence/planification, import/export, coffre, fallback des APIs facultatives, raccourcis et responsive. Les diagnostics d'échec sont capturés dans un artifact CI sans mot de passe de fixture. Validation locale : smoke Chrome passé. | TAN-48 terminée ; poursuivre M5 avec TAN-51. La couverture multi-navigateurs et le test Task Scheduler restent hors périmètre. |
| 2026-09-04 | TAN-51 | Audit sécurité et accessibilité Angular terminé : rendu Markdown et previews durcis, URLs et imports bornés, coffre contrôlé, CSP Angular générée, ressources legacy avec SRI, exclusions d'artefacts, focus/clavier/dialogues et fallbacks vérifiés. Validation locale : `npm run verify`, smoke Chromium, `npm audit --audit-level=high`, checks sécurité/artefact et syntaxe legacy. Warnings de budgets Angular conservés. | TAN-51 terminée ; poursuivre M5 avec TAN-53. Les tests multi-navigateurs et la coordination multi-onglets restent hors périmètre. |
| 2026-09-09 | TAN-53 | Budgets production alignés sur la baseline mesurée : initial 550 kB en avertissement / 1 MB en erreur ; styles de composants 11 kB / 12 kB. Ajout de `npm run measure:performance`, qui somme les assets initiaux référencés par l'artifact. Quota navigateur déjà exposé par `/settings` et `/export`, avec avertissement à 70 %, seuil critique documenté à 85 % et fallback lorsque l'estimation est indisponible. Validation locale : build production sans warning de budget, mesure à 513,6 kB, `npm run verify` et tests du quota. | TAN-53 terminée ; poursuivre M6 avec TAN-52. |

## Historique des validations

| Date | Milestone | Validé par | Commentaire |
|---|---|---|---|
| 2026-08-19 | M0/M1 - Cadrage et socle Angular | OpenCode | M1 complète ; M0 complète sur les critères dépôt/CI, export JSON réel hors dépôt restant à confirmer manuellement. |
| 2026-08-19 | M3 - Shell et navigation | OpenCode | TAN-32, TAN-34, TAN-33, TAN-35, TAN-37 et TAN-38 mergées ; validation M3 complète. |
| 2026-08-25 | TAN-41 - Paramètres et sauvegardes | OpenCode | Settings Angular, sauvegarde JSON canonique, auto-backup, File System Access/fallback, quota et intégration du coffre validés par le build et 89 tests locaux. |
| 2026-08-25 | TAN-43 - Liste et hiérarchie des projets | OpenCode | Route `/projects` Angular, hiérarchie, scope URL, recherche, vues, favoris, création/suppression et tests de non-régression validés localement. |
| 2026-09-01 | TAN-45 - Détail projet et items de contenu | OpenCode | Route `/project/:id`, parcours d’arbre, CRUD des dossiers/items, déplacement/réordonnancement, corbeille, pièces jointes, rendu sûr, tâches liées et coffre verrouillé validés par `npm run verify` et 106 tests locaux. |
| 2026-09-01 | TAN-44 - Tâches, rappels et récurrences | OpenCode | Route `/todos`, filtres URL, vues, CRUD, récurrences, dépendances, priorités, modèles, sélection multiple, corbeille et tests de non-régression validés localement par `npm run verify` et 115 tests. |
| 2026-09-01 | TAN-46 - Planification intelligente | OpenCode | Route `/smart-planning`, algorithme de sélection, état local restaurable, complétion de session, navigation vers `/todos` et cas limites de durée/date validés par `npm run verify` et 122 tests locaux. |
| 2026-09-01 | TAN-49 - Notifications locales et fallbacks | OpenCode | Permission unique, rappels dus, déduplication persistée, fallback toast et absence d'API Notification couverts par le service global Angular et 126 tests locaux ; aucune notification d'arrière-plan n'est promise. |
| 2026-09-01 | TAN-42 - Tableau de bord, rappels et revue hebdomadaire | OpenCode | Route `/home`, dashboard vide et rempli, onglets/actions de rappels, compteurs, santé, revue hebdomadaire, activité récente et navigations Angular validés par `npm run verify` et 134 tests locaux. |
| 2026-09-01 | M4 - Migration fonctionnelle | OpenCode | Recette M4 validée localement : données historiques et workspace vide vérifiés dans Chromium, compatibilité des routes et interactions contrôlée, récurrences/planification/persistance et sauvegardes picker/fallback couvertes par les tests. Warnings de budgets Angular et avertissements de sanitization conservés. |
| 2026-09-02 | TAN-47 - Parité des exports | OpenCode | Route Angular `/export`, convertisseurs JSON/Markdown/CSV, ZIP sans dépendance, politique coffre et fallback téléchargement validés par 147 tests, le build et un smoke Chromium sur fixture remplie. Warnings de budgets Angular conservés. |
| 2026-09-04 | TAN-51 - Audit sécurité et accessibilité | OpenCode | Contrôles de rendu sûr, previews sandboxées, limites d'import, coffre, CSP, SRI/CDN, artefacts publiés, focus/clavier et fallbacks validés par le build, 180 tests Angular, le smoke Chromium, `npm audit --audit-level=high` et les checks sécurité/transition. Les warnings de budgets restent reportés à TAN-53. |
| 2026-09-09 | TAN-53 - Performances et quota | OpenCode | Baseline du bundle initial, budgets Angular sans warning, mesure automatisée de l'artifact et seuils de quota documentés avec fallback navigateur validés localement. |
