# Baseline fonctionnelle et matrice des URL legacy

**Issue Linear :** [TAN-21](https://linear.app/tanguy-sudo/issue/TAN-21/us-etablir-la-baseline-fonctionnelle-et-la-matrice-des-url)<br>
**Epic :** [TAN-17](https://linear.app/tanguy-sudo/issue/TAN-17/epic-migrer-workspace-vers-angular-et-automatiser-le-demarrage-windows)<br>
**Projet :** [workspace](https://linear.app/tanguy-sudo/project/workspace-0e782be3ae51/overview)<br>
**Version legacy observée :** commit `8100340` de `plan/angular-migration-windows`<br>
**Date de capture :** 2026-08-19<br>
**URL publique observée :** `https://tanguy-sudo.github.io/workspace/`

## Objectif

Ce document constitue la référence fonctionnelle de l'application legacy avant la migration Angular. Il sert à :

- conserver la liste des pages et des URL publiques ;
- décrire les paramètres réellement lus et générés par le code ;
- identifier les parcours CRUD et les parcours de navigation critiques ;
- fournir une checklist de smoke tests reproductible ;
- séparer les comportements à préserver des écarts connus à traiter dans d'autres US ;
- comparer le comportement legacy et Angular pendant la coexistence.

La baseline ne modifie pas le comportement legacy. Les écarts recensés à la fin sont des constats, pas des corrections incluses dans `TAN-21`.

## Légende des tests

- `[x]` : vérification documentaire ou disponibilité HTTP déjà effectuée.
- `[ ]` : scénario interactif à exécuter dans un navigateur avec un profil de test dédié.
- `LEG` : comportement legacy à préserver pendant la coexistence.
- `ANG` : comportement attendu de la future application Angular.
- `OBS` : observation ou écart connu, sans correction dans cette US.

## Méthode et périmètre

La baseline a été construite à partir de :

- `README.md` et `ARCHITECTURE.md` ;
- dix pages HTML applicatives ;
- `js/router.js`, les modules transverses et `js/pages/*.js` ;
- `fixtures/README.md`, les fixtures JSON et `validate-fixtures.py` ;
- les contrats de stockage dans `js/db.js` et `js/storage.js` ;
- l'exécution HTTP publique des dix pages sur GitHub Pages ;
- l'inventaire des APIs navigateur utilisées par le code.

Le profil de test interactif doit être séparé du profil personnel. La base IndexedDB, le `localStorage` et le `sessionStorage` sont propres à l'origine et au profil du navigateur.

## Invariants transverses

Ces comportements sont communs à plusieurs pages et doivent rester identiques après migration :

| Domaine | Baseline legacy | Référence |
|---|---|---|
| Origine publique | `https://tanguy-sudo.github.io/workspace/` | Configuration GitHub Pages et déploiement actuel |
| Persistance | IndexedDB via Dexie, base `workspace`, table `kv`, clé `data` | `js/db.js:8-28` |
| Migration historique | lecture de `localStorage["workspace_data"]` si `kv["data"]` est absent | `js/db.js:35-55` |
| Boot | attente du DOM et de `WorkspaceDB_READY` via `bootPage` | `js/db.js:149-181` |
| Écriture | cache mémoire puis flush différé d'environ 80 ms | `js/db.js:68-100` |
| Flush de sécurité | `beforeunload`, `pagehide`, `visibilitychange` | `js/db.js:140-147` |
| Thème | préférence initiale dans `localStorage`, valeur métier dans `settings.theme` | `index.html:5-13`, `js/storage.js:1266-1275` |
| Navigation commune | topbar vers accueil, RH, projets, tâches, snippets, journal, export, planification et paramètres | `index.html:31-67` |
| Confirmation | modales pour actions destructives et formulaires incomplets | `js/components.js` |
| Corbeille | suppressions métier déplacées vers `trash` selon le domaine | `js/storage.js:169-191`, `js/storage.js:702-713` |
| Données distantes | aucune API métier ; les données restent dans le navigateur | `README.md:3-9` |
| Ressources externes | Google Fonts et Highlight.js depuis CDN sur les pages concernées | `css/base.css`, `project.html`, `snippets.html` |

## Inventaire des pages

| ID | Page legacy | Rôle | Paramètres d'entrée | Données principales | Mutations principales |
|---|---|---|---|---|---|
| P01 | `index.html` | Tableau de bord | Aucun | `todos`, `projects`, `rh`, `snippets`, `journal`, `recentlyVisited`, `activityLog`, `settings.weeklyReview` | créer/terminer/épingler un rappel, créer/terminer une revue |
| P02 | `todos.html` | Tâches | `focus`, `savedView`, `status`, `priority`, `context`, `project`, `due`, `view` | `todos`, `trash`, `settings.todoPriorities`, `settings.todoSavedViews` | CRUD tâche, statuts, récurrence, dépendances, vues, priorités, suppression |
| P03 | `projects.html` | Liste des projets | `parent` | `projects`, `trash`, favoris, vues locales | CRUD projet, hiérarchie, archivage, sélection multiple |
| P04 | `project.html` | Détail d'un projet | `id`, `folder`, `path`, `focus`, `kind` généré | projet et arbre `folder`/`item`, tâches liées, coffre | CRUD dossiers/items, déplacement, ordre, pièces jointes, previews |
| P05 | `snippets.html` | Snippets | `folder`, `path`, `focus` | `snippets`, `snippetFolders`, `snippetMixedOrder`, `trash` | CRUD snippets/dossiers, import, ordre, favoris, copie |
| P06 | `rh.html` | Documents RH | `folder`, `path`, `focus` | arbre `rh`, `trash` | CRUD dossiers/documents, tags, pièces jointes, ordre |
| P07 | `journal.html` | Journal personnel | Aucun | `journal`, `trash` | CRUD entrées, auto-save, recherche locale, Markdown |
| P08 | `smart-planning.html` | Planification | Aucun | `todos`, `workspace-smart-plan` | générer un plan, terminer une tâche, réinitialiser le plan |
| P09 | `settings.html` | Paramètres et coffre | Aucun | `settings`, `backupDirHandle`, préférences locales | réglages, sauvegarde, picker dossier, coffre |
| P10 | `export.html` | Export/import | Aucun | toutes les sections | créer des fichiers, fusionner ou remplacer les données |

## Matrice détaillée par page

### P01 - Tableau de bord

**Sources :** `index.html:71-210`, `js/pages/home.js:4-850`.

| Élément | Comportement de référence |
|---|---|
| URL d'entrée | `index.html`, sans paramètre URL |
| Lecture | statistiques tâches, rappels, projets actifs, documents RH, snippets, journal, visites et activité |
| Création | nouveau rappel ; tâche de revue hebdomadaire |
| Mise à jour | marquer un rappel terminé, épingler/désépingler, marquer la revue hebdomadaire comme faite |
| Suppression | aucune suppression directe depuis l'accueil |
| Navigation | liens topbar ; cartes de santé vers `todos.html?project=none`, `todos.html?status=waitinginfo`, `projects.html`, `snippets.html` ; éléments récents vers `project.html?id=...` ou `rh.html?folder=...` |
| APIs | Notification best effort ; `sessionStorage` pour le focus de tâche ; timers d'affichage et de rappels |
| États vides | message par onglet de rappel ; dashboard utilisable avec zéro donnée |
| Cas supprimé | une carte récente devient inactive et affiche un toast si sa cible n'existe plus |

### P02 - Tâches

**Sources :** `todos.html:69-236`, `js/pages/todos.js:4-1521`.

| Élément | Comportement de référence |
|---|---|
| URL d'entrée | `todos.html` avec les query params listés dans le contrat ci-dessous |
| Lecture | tâches filtrées par statut, priorité, contexte, projet et échéance |
| Création | tâche complète, tâche depuis modèle, rappel indirect |
| Mise à jour | titre, description, priorité, contexte, tags, projet, dépendances, statut, estimation, échéance, rappel, récurrence, favori |
| Suppression | suppression unitaire, sélection multiple, purge des tâches terminées ; suppression métier vers corbeille |
| Vues | colonnes, liste et priorités ; vue sauvegardée ; préférences locales |
| Récurrence | quotidienne, hebdomadaire avec jours, mensuelle par nième jour de semaine |
| Navigation d'entrée | `focus` cible une carte ; `savedView` recharge une vue ; `project=none` cible les tâches sans projet |
| Erreurs | titre obligatoire, validation du temps estimé, dépendances et récurrence ; confirmations avant actions destructives |
| APIs | drag-and-drop HTML5, dates et timers ; notifications via le socle commun |

### P03 - Liste des projets

**Sources :** `projects.html:68-151`, `js/pages/projects.js:4-302`, `js/components.js:497-579`.

| Élément | Comportement de référence |
|---|---|
| URL d'entrée | `projects.html` ou `projects.html?parent=<projectId>` |
| Lecture | projets du niveau courant, recherche, favoris, nombre de sous-projets |
| Création | projet racine ou sous-projet avec nom et catégories |
| Mise à jour | vue grille/liste, favori, verrouillage du routage vers les enfants, catégories |
| Suppression | projet unique ou sélection multiple ; descendants concernés selon le métier |
| Navigation | carte vers `project.html?id=<id>` ; sous-projets via `projects.html?parent=<id>` ; précédent/suivant via `history` |
| Persistance UI | `workspace-projects-view`, `workspace-projects-parent` dans `localStorage` |
| Erreurs | parent invalide réinitialisé à la racine ; état vide avec bouton Nouveau projet |

### P04 - Détail projet

**Sources :** `project.html:72-181`, `js/pages/project.js:4-1382`.

| Élément | Comportement de référence |
|---|---|
| URL d'entrée | `project.html?id=<projectId>` ; `folder` legacy ou `path=<folder1,folder2>` ; `focus=<nodeId>` |
| Redirection | absence de `id` ou projet absent : retour vers `projects.html` |
| Lecture | arbre de dossiers/items, filtres par type, tâches liées, contenu et secrets selon l'état du coffre |
| Création | dossier ou item de type `link`, `memo`, `info`, `code`, `password` |
| Mise à jour | projet, catégories, dossiers, items, tags, favoris, ordre, déplacement, contenu, pièces jointes |
| Suppression | dossier/item individuel ou sélection multiple ; confirmation ; corbeille |
| Navigation interne | `history.pushState` avec `path` ; bouton précédent/suivant restaure la pile de dossiers |
| Navigation externe | liens, previews et plein écran via `window.open`/Blob URL ; tâches liées vers `todos.html` |
| APIs | Clipboard, Blob, object URLs, FileReader/drag-drop, Web Crypto, sessionStorage du coffre |
| Erreurs | projet/dossier inexistant, coffre verrouillé, clipboard refusé, déplacement cyclique, fichier trop volumineux |

### P05 - Snippets

**Sources :** `snippets.html:73-200`, `js/pages/snippets.js:4-1238`.

| Élément | Comportement de référence |
|---|---|
| URL d'entrée | `snippets.html` ; `folder` legacy ou `path=<folder1,folder2>` ; `focus=<snippetOrFolderId>` |
| Lecture | dossiers, ordre mixte, recherche par titre/code/tag/langage, favoris |
| Création | snippet, dossier, import JSON/Markdown/code |
| Mise à jour | édition, langage, tags, favori, déplacement, renommage, ordre, mode grille/liste |
| Suppression | snippet ou dossier ; choix déplacement du contenu ou purge |
| Navigation | pile de dossiers via `history.pushState`, focus depuis la recherche, plein écran et liens externes |
| APIs | Clipboard, FileReader, Blob, object URLs, `iframe.srcdoc`, `window.open`, Highlight.js CDN |
| Erreurs | JSON invalide, import sans bloc ou sans snippet, clipboard refusé, dossier cible invalide |
| Sécurité | preview HTML/CSS nettoyée dans une iframe `sandbox` vide ; les previews de pièces jointes sont limitées aux signatures de formats connus |

### P06 - RH

**Sources :** `rh.html:68-135`, `js/pages/rh.js:4-720`.

| Élément | Comportement de référence |
|---|---|
| URL d'entrée | `rh.html` ; `folder` legacy ou `path=<folder1,folder2>` ; `focus=<nodeId>` |
| Lecture | arborescence, documents, tags, notes Markdown, favoris et pièces jointes |
| Création | dossier ou document |
| Mise à jour | contenu, tags, pin, renommage, déplacement et ordre |
| Suppression | document/dossier individuel ou sélection multiple ; corbeille |
| Navigation | pile de dossiers via `history.pushState`, liens externes et wiki-links |
| APIs | drag-and-drop, FileReader et viewer de fichiers partagé |
| Erreurs | chemin absent retourne à root, dossier vide, déplacement invalide, fichier supérieur à la limite |
| Confidentialité | données locales ; aucune API métier distante |

### P07 - Journal

**Sources :** `journal.html:72-159`, `js/pages/journal.js:5-429`.

| Élément | Comportement de référence |
|---|---|
| URL d'entrée | `journal.html`, sans paramètre URL |
| Lecture | entrées triées, titre, contenu, humeur, tags, recherche locale |
| Création | entrée vide ou depuis un modèle ; création depuis la palette globale via sessionStorage |
| Mise à jour | titre, Markdown, tags, humeur ; auto-save différé d'environ 400 ms |
| Suppression | entrée active ou sélection multiple ; corbeille |
| Navigation | topbar et liens de l'éditeur ; pas de route date persistée dans l'URL |
| APIs | timers/debounce, Markdown et stockage de session |
| Erreurs | journal non tableau réinitialisé en mémoire par les valeurs par défaut ; toast si sauvegarde échoue |

### P08 - Planification intelligente

**Sources :** `smart-planning.html:69-218`, `js/pages/smart-planning.js:4-469`.

| Élément | Comportement de référence |
|---|---|
| URL d'entrée | `smart-planning.html`, sans paramètre URL |
| Lecture | tâches actives, priorités, dépendances, projets et estimations |
| Création | état de planification dans `localStorage`, pas de nouvel objet métier |
| Mise à jour | génération de plan, marquage terminé d'une tâche, état de session |
| Suppression | réinitialisation de `workspace-smart-plan` |
| Paramètres UI | temps disponible, contexte, projet, échéance, mode équilibré/focus/sprint |
| Erreurs | durée invalide/nulle, aucune tâche planifiable, tâche supprimée entre deux sessions, JSON localStorage malformé |
| Navigation | topbar uniquement ; les actions de tâche utilisent le service métier commun |

### P09 - Paramètres

**Sources :** `settings.html:68-199`, `js/pages/settings.js:4-353`.

| Élément | Comportement de référence |
|---|---|
| URL d'entrée | `settings.html`, sans paramètre URL |
| Mise à jour | nom utilisateur, nom du site, fréquence de backup, préférence de dossier, thème/accent selon les composants |
| Sauvegarde | test manuel, backup automatique vérifié au chargement, téléchargement classique ou picker natif |
| Coffre | activer, déverrouiller, verrouiller, changer le mot de passe, désactiver |
| Persistance | paramètres dans IndexedDB, handle `backupDirHandle` dans IndexedDB, préférences complémentaires dans localStorage, clé coffre en sessionStorage |
| APIs | `showDirectoryPicker`, `showSaveFilePicker`, Web Crypto, sessionStorage |
| Erreurs | picker absent/refusé/annulé, mot de passe invalide, confirmation différente, handle invalide, quota |
| Sécurité | la désactivation du coffre remet les secrets en clair selon le comportement actuel ; décision à préserver explicitement |

### P10 - Export/import

**Sources :** `export.html:68-224`, `js/pages/export.js:8-352`, `js/pages/export-import.js:8-287`, `js/pages/export-converters.js:10-297`.

| Élément | Comportement de référence |
|---|---|
| URL d'entrée | `export.html`, sans paramètre URL |
| Export section | JSON et, selon la section, Markdown, CSV ou ZIP |
| Export complet | JSON, Markdown ou ZIP avec `workspace.json` |
| Import | fichier JSON, choix fusion ou écrasement pour une sauvegarde complète |
| Fusion | tableaux par `id`, arbres remplacés si présents, paramètres fusionnés superficiellement |
| Erreurs | JSON invalide, format inconnu, ZIP vide, mode écrasement indisponible pour une section |
| APIs | `File.text`, JSON, Blob, object URLs, téléchargement, quota et File System Access selon le chemin |
| Point sensible | les convertisseurs textuels utilisent certains champs/statuts historiques qui ne correspondent pas toujours au modèle actuel |

## Contrat des URL legacy

### Paramètres officiellement supportés par une page

| Paramètre | Page(s) qui le lisent | Signification | Valeur type | Comportement si absent ou invalide |
|---|---|---|---|---|
| `id` | `project.html` | identifiant du projet | `projet-abc` | absence/projet inconnu : retour vers `projects.html` |
| `parent` | `projects.html` | projet parent affiché | `projet-abc` | absent : racine ; inconnu : racine |
| `folder` | `project.html`, `rh.html`, `snippets.html` | compatibilité d'un dossier unique | `folder-abc` | absent : racine du domaine |
| `path` | `project.html`, `rh.html`, `snippets.html` | pile de dossiers séparée par virgules | `folder-a,folder-b` | absent : racine ou `folder` legacy ; chemin invalide selon le domaine |
| `focus` | `project.html`, `rh.html`, `snippets.html`, `todos.html` | élément à mettre en évidence ou sélectionner | `node-abc` | page normale sans focus |
| `kind` | liens générés par recherche projet | type attendu de la cible (`item`/`folder`) | `item` | actuellement surtout un contexte de lien ; conserver pendant la transition |
| `savedView` | `todos.html` | vue de tâches à restaurer | `view-abc` | vue par défaut |
| `status` | `todos.html` | filtre de statut | `waitinginfo` | `all` |
| `priority` | `todos.html` | filtre de priorité | `urgent` | `all` |
| `context` | `todos.html` | filtre de contexte | `bureau` | `all` |
| `project` | `todos.html` | filtre projet, ou `none` sans projet | `projet-abc` / `none` | `all` |
| `due` | `todos.html` | filtre d'échéance | valeur métier actuelle | `all` |
| `view` | `todos.html` | mode d'affichage | `columns`, `list`, `priority` | mode local par défaut |

### URL d'entrée par page

| Page | URL racine | Variantes à tester |
|---|---|---|
| Accueil | `index.html` | aucune |
| Tâches | `todos.html` | `?focus=<todo>`, `?savedView=<view>`, filtres `status`, `priority`, `context`, `project`, `due`, `view` |
| Projets | `projects.html` | `?parent=<project>` |
| Détail projet | `project.html?id=<project>` | `&folder=<folder>`, `&path=<folder1,folder2>`, `&focus=<node>`, `&kind=item` |
| Snippets | `snippets.html` | `?folder=<folder>`, `?path=<folder1,folder2>`, `?focus=<node>` |
| RH | `rh.html` | `?folder=<folder>`, `?path=<folder1,folder2>`, `?focus=<node>` |
| Journal | `journal.html` | aucune |
| Planification | `smart-planning.html` | aucune |
| Paramètres | `settings.html` | aucune |
| Export | `export.html` | aucune |

### URL générées par le code

| Producteur | Format généré | Usage |
|---|---|---|
| `js/router.js` | `projects.html?parent=<id>` | ouvrir un niveau de projets |
| `js/router.js` | `rh.html?folder=<id>` | ouvrir un dossier RH legacy |
| `js/router.js` | `project.html?id=<id>&folder=<id>` | ouvrir un dossier projet legacy |
| `js/pages/project.js` | `project.html?id=<id>&path=<a,b>` | navigation interne projet |
| `js/pages/rh.js` | `rh.html?path=<a,b>` | navigation interne RH |
| `js/pages/snippets.js` | `snippets.html?path=<a,b>` | navigation interne snippets |
| `js/global-search.js` | `project.html?id=<id>&path=<path>&focus=<node>&kind=<kind>` | résultat projet/item/dossier |
| `js/pages/home.js` | `todos.html?project=none` | tâches sans projet |
| `js/pages/home.js` | `todos.html?status=waitinginfo` | tâches en attente d'information |
| `js/pages/home.js` | `project.html?id=<id>` ou `rh.html?folder=<id>` | élément récemment visité |

### Règles de migration des URL

1. Toute URL listée ci-dessus doit rester interprétable pendant la coexistence.
2. `folder` est conservé comme alias de compatibilité ; `path` est la représentation multi-niveaux de référence.
3. Les valeurs doivent être décodées par les APIs URL natives, jamais par concaténation HTML non contrôlée.
4. Les identifiants absents ou inconnus doivent produire un état vide ou une redirection documentée, sans exception non gérée.
5. Les liens générés par la recherche doivent ouvrir la route Angular équivalente après migration de la fonctionnalité ciblée.
6. Les routes Angular utilisent le hash routing décidé dans `TAN-18` pour éviter les 404 GitHub Pages sur rechargement direct.
7. Les anciennes pages `.html` restent disponibles jusqu'à la fin de la période d'observation.

## Matrice des APIs navigateur et permissions

| API | Fonctionnalités concernées | Refus/absence attendu | Fallback à préserver |
|---|---|---|---|
| IndexedDB/Dexie | toutes les pages | base indisponible, quota, erreur d'ouverture | état d'erreur visible ; export manuel dès que possible |
| `localStorage` | thème, vues, planification, flags | stockage bloqué ou invalide | valeurs par défaut et helpers `safeStorage*` |
| `sessionStorage` | coffre, focus et création journal | session indisponible | ne pas bloquer le domaine ; perdre seulement l'état temporaire |
| Notification | rappels | permission refusée ou API absente | rappels visibles dans le dashboard |
| Clipboard | copie code, URL et secrets | permission refusée ou API absente | toast d'erreur ; valeur toujours visible dans son contexte autorisé |
| File System Access | sauvegarde et dossier préféré | API absente, picker annulé ou permission retirée | téléchargement classique et resélection du dossier |
| FileReader | import snippets et pièces jointes | fichier illisible ou annulation | message d'erreur, aucune écriture partielle |
| Blob/object URL | previews, exports, plein écran | création ou ouverture bloquée | téléchargement ou message d'erreur ; révocation des URLs |
| `window.open` | liens externes, previews, plein écran | popup bloquée | lien visible et action réessayable |
| Web Crypto | coffre | contexte non sécurisé, mauvais mot de passe, déchiffrement invalide | coffre verrouillé ; aucune révélation de secret |
| `iframe.srcdoc` | preview HTML/CSS snippets | contenu actif ou sandbox impossible | preview neutralisée ou désactivée |
| `history.pushState` | arbres projets/RH/snippets | historique indisponible | navigation complète vers une URL équivalente |
| `navigator.storage.estimate` | widget de stockage | API absente | taille locale estimée ou indication indisponible |

## Parcours critiques de référence

Chaque scénario doit être rejoué avec un workspace vide puis un workspace fixture rempli. Les IDs de données utilisés dans les URL doivent venir de la fixture, jamais être codés en dur dans l'application.

### Smoke tests de disponibilité

- [x] `https://tanguy-sudo.github.io/workspace/` répond et affiche le tableau de bord.
- [x] `https://tanguy-sudo.github.io/workspace/todos.html` répond et affiche la page Tâches.
- [x] `https://tanguy-sudo.github.io/workspace/projects.html` répond et affiche la page Projets.
- [x] `https://tanguy-sudo.github.io/workspace/project.html` répond et affiche l'état sans projet.
- [x] `https://tanguy-sudo.github.io/workspace/snippets.html` répond et affiche la page Snippets.
- [x] `https://tanguy-sudo.github.io/workspace/rh.html` répond et affiche la page RH.
- [x] `https://tanguy-sudo.github.io/workspace/journal.html` répond et affiche la page Journal.
- [x] `https://tanguy-sudo.github.io/workspace/smart-planning.html` répond et affiche la page Planification.
- [x] `https://tanguy-sudo.github.io/workspace/settings.html` répond et affiche la page Paramètres.
- [x] `https://tanguy-sudo.github.io/workspace/export.html` répond et affiche la page Export.
- [ ] Rejouer les mêmes dix URL dans un navigateur avec console ouverte et vérifier l'absence d'erreur JavaScript.

### Navigation commune

- [ ] Depuis chaque page, ouvrir chaque lien de la topbar et vérifier la page active.
- [ ] Ouvrir puis fermer le menu mobile avec clavier et souris.
- [ ] Basculer le thème, recharger la page et vérifier la persistance.
- [ ] Ouvrir une modale, déplacer le focus avec `Tab`, fermer par `Escape`, puis vérifier la restitution du focus.
- [ ] Déclencher une action destructive et vérifier la confirmation.
- [ ] Ouvrir la recherche globale avec `Ctrl+Espace` et `Ctrl+K` hors champ de saisie.
- [ ] Vérifier que les raccourcis ne se déclenchent pas dans un input, textarea ou éditeur.
- [ ] Fermer/recharger une page après une mutation et vérifier la persistance IndexedDB.

### Accueil, tâches et planification

- [ ] Créer un rappel sans date, puis vérifier l'onglet épinglé.
- [ ] Créer un rappel avec échéance et vérifier les onglets Aujourd'hui, En retard et À venir.
- [ ] Épingler, désépingler puis terminer un rappel.
- [ ] Depuis une carte de santé, ouvrir `todos.html?project=none` et vérifier le filtre.
- [ ] Depuis une carte de santé, ouvrir `todos.html?status=waitinginfo` et vérifier le filtre.
- [ ] Créer une tâche avec estimation `60*5`, puis refuser une expression invalide.
- [ ] Modifier chaque statut et vérifier les compteurs du dashboard.
- [ ] Créer une récurrence quotidienne, hebdomadaire et mensuelle, puis terminer la tâche.
- [ ] Vérifier la création de la prochaine occurrence récurrente.
- [ ] Créer, modifier et supprimer une dépendance de tâche.
- [ ] Créer une vue sauvegardée, la rouvrir avec `savedView`, puis la supprimer.
- [ ] Recharger `todos.html` avec chaque filtre `status`, `priority`, `context`, `project`, `due` et `view`.
- [ ] Générer un plan équilibré, focus et sprint.
- [ ] Recharger la page de planification et vérifier `workspace-smart-plan`.
- [ ] Marquer une tâche du plan terminée et vérifier sa mise à jour dans les tâches.
- [ ] Marquer la revue hebdomadaire comme faite puis générer sa tâche.

### Projets et arbres

- [ ] Créer un projet racine puis un sous-projet.
- [ ] Ouvrir `projects.html?parent=<id>` et vérifier le niveau affiché.
- [ ] Utiliser précédent/suivant entre racine, sous-projet et détail.
- [ ] Basculer grille/liste et recharger.
- [ ] Rechercher dans un scope projet.
- [ ] Ouvrir `project.html?id=<id>`.
- [ ] Créer un dossier projet puis un sous-dossier.
- [ ] Créer un item de chaque type `link`, `memo`, `info`, `code`, `password`.
- [ ] Ouvrir `project.html?id=<id>&folder=<folder>` pour le format legacy.
- [ ] Ouvrir `project.html?id=<id>&path=<folder1,folder2>` pour le format multi-niveaux.
- [ ] Ouvrir `project.html?id=<id>&focus=<node>&kind=item` depuis un résultat de recherche.
- [ ] Déplacer et réordonner des dossiers/items.
- [ ] Tenter de déplacer un dossier dans lui-même et dans un descendant.
- [ ] Supprimer un item, le retrouver dans la corbeille et le restaurer.
- [ ] Supprimer un projet parent et vérifier le comportement de ses descendants.

### RH et snippets

- [ ] Créer un dossier RH et un document.
- [ ] Ouvrir `rh.html?folder=<id>` puis `rh.html?path=<folder1,folder2>`.
- [ ] Ouvrir `rh.html?focus=<node>` depuis une recherche.
- [ ] Modifier titre, Markdown, tags, pin et pièce jointe d'un document.
- [ ] Déplacer/réordonner un document et vérifier l'anti-cycle.
- [ ] Supprimer puis restaurer un document RH.
- [ ] Créer un dossier snippets et un snippet.
- [ ] Ouvrir `snippets.html?folder=<id>` puis `snippets.html?path=<folder1,folder2>`.
- [ ] Ouvrir `snippets.html?focus=<node>` depuis une recherche.
- [ ] Modifier langage, code, tags, favori et ordre mixte.
- [ ] Importer un JSON de snippets valide puis un JSON invalide.
- [ ] Importer un fichier Markdown avec blocs de code puis un fichier code brut.
- [ ] Copier un snippet avec Clipboard autorisé puis refusé.
- [ ] Ouvrir les previews HTML et CSS avec contenu de test inoffensif.
- [ ] Tester un contenu preview contenant un script et vérifier qu'il ne s'exécute pas.

### Journal

- [ ] Créer la première entrée depuis l'état vide.
- [ ] Créer une entrée depuis la palette globale.
- [ ] Modifier titre, contenu Markdown, tags et humeur.
- [ ] Vérifier l'auto-save après rechargement.
- [ ] Rechercher une entrée par titre, contenu et tag.
- [ ] Supprimer une entrée active, puis la restaurer depuis la corbeille.
- [ ] Créer une entrée avec caractères spéciaux et Markdown hostile.

### Paramètres, coffre et fichiers

- [ ] Modifier le nom utilisateur, le nom du site et la fréquence de sauvegarde.
- [ ] Choisir un dossier avec File System Access si disponible.
- [ ] Annuler le picker de dossier et vérifier l'absence de mutation.
- [ ] Refuser/retirer la permission du dossier et vérifier le fallback.
- [ ] Tester une sauvegarde manuelle par picker puis par téléchargement classique.
- [ ] Activer le coffre avec des items mot de passe existants.
- [ ] Vérifier que les secrets migrés sont chiffrés et absents des champs en clair.
- [ ] Déverrouiller avec le bon mot de passe et refuser un mauvais mot de passe.
- [ ] Modifier un secret, verrouiller, recharger puis déverrouiller.
- [ ] Changer le mot de passe maître.
- [ ] Désactiver le coffre après confirmation et vérifier le comportement documenté.
- [ ] Tester un fichier joint sous la limite puis au-dessus de la limite.

### Export/import

- [ ] Exporter chaque section en JSON lorsque le format est disponible.
- [ ] Exporter les sections Markdown, CSV et ZIP correspondantes.
- [ ] Exporter le workspace complet en JSON, Markdown et ZIP.
- [ ] Importer un export complet en mode fusion.
- [ ] Importer un export de section en mode fusion.
- [ ] Refuser le mode écrasement pour un export partiel.
- [ ] Importer un export complet en mode écrasement après sauvegarde préalable.
- [ ] Refuser un JSON invalide sans modifier la base.
- [ ] Importer des IDs en conflit et vérifier que la règle de fusion est appliquée.
- [ ] Exporter/importer une fixture avec coffre et pièces jointes.
- [ ] Vérifier le quota affiché et l'avertissement de stockage.

## Smoke tests de compatibilité Angular

Ces scénarios seront rejoués à chaque fonctionnalité migrée. `LEG` signifie que l'URL est ouverte par la version legacy avant migration ; `ANG` signifie qu'elle doit ouvrir la route Angular après migration.

| ID | Précondition | Action | Résultat attendu LEG | Résultat attendu ANG |
|---|---|---|---|---|
| COMP-01 | projet fixture connu | ouvrir `project.html?id=<id>` | détail projet legacy | route Angular projet équivalente |
| COMP-02 | dossier projet connu | ouvrir `project.html?id=<id>&folder=<folder>` | dossier legacy affiché | alias converti vers la route Angular |
| COMP-03 | chemin profond connu | ouvrir `project.html?id=<id>&path=<a,b>` | pile projet restaurée | pile Angular restaurée |
| COMP-04 | node connu | ouvrir `project.html?id=<id>&focus=<node>&kind=item` | node ciblé | node ciblé |
| COMP-05 | projet parent connu | ouvrir `projects.html?parent=<id>` | niveau projet affiché | route Angular projets équivalente |
| COMP-06 | dossier RH connu | ouvrir `rh.html?folder=<id>` | dossier RH affiché | alias converti |
| COMP-07 | chemin RH profond | ouvrir `rh.html?path=<a,b>` | pile RH restaurée | pile Angular restaurée |
| COMP-08 | node RH connu | ouvrir `rh.html?focus=<node>` | node ciblé | node ciblé |
| COMP-09 | dossier snippet connu | ouvrir `snippets.html?path=<a,b>` | pile snippets restaurée | pile Angular restaurée |
| COMP-10 | tâche connue | ouvrir `todos.html?focus=<todo>` | tâche ciblée | tâche ciblée |
| COMP-11 | vue connue | ouvrir `todos.html?savedView=<view>` | vue rechargée | vue Angular équivalente |
| COMP-12 | filtres connus | ouvrir `todos.html?status=waitinginfo&project=none` | filtres appliqués | filtres Angular équivalents |
| COMP-13 | navigation interne | utiliser précédent/suivant dans un arbre | pile restaurée | pile Angular restaurée |
| COMP-14 | résultat recherche | cliquer un résultat projet/RH/snippet/tâche | URL et focus corrects | route et focus Angular corrects |
| COMP-15 | export fixture | importer puis relire les sections | données équivalentes | données équivalentes |

## Constats et écarts observés

Ces points sont enregistrés afin d'éviter de les confondre avec une régression Angular. Ils doivent être traités dans l'US indiquée ou faire l'objet d'une décision explicite.

| ID | Constat legacy | Référence | Traitement prévu |
|---|---|---|---|
| OBS-01 | Le dashboard écrit `workspace_focus_todo` dans `sessionStorage` lorsqu'un rappel est cliqué, alors que `todos.js` utilise principalement `?focus=...`. | `js/pages/home.js:739-743`, `js/pages/todos.js:14-16` | Vérifier en recette ; ne pas corriger dans TAN-21 ; traiter avec la migration dashboard/tâches |
| OBS-02 | `kind` est ajouté aux liens de recherche projet, mais la lecture directe identifiée dans `project.js` porte surtout sur `focus` et `path`. | `js/global-search.js:680-715`, `js/pages/project.js:52-65` | Conserver l'information pendant la transition ; clarifier dans le routeur Angular |
| OBS-03 | Les convertisseurs legacy Markdown/CSV utilisent des champs/statuts historiques (`note`, `priority`, `in-progress`, `blocked`) qui ne correspondent pas toujours au modèle courant (`description`, `priorityId`, `inprogress`). | `js/pages/export-converters.js:10-63`, `js/pages/todos.js:1137-1141` | TAN-47 porte la route Angular `/export` avec projections compatibles et champs actuels ; le legacy reste inchangé pendant la coexistence |
| OBS-04 | La preview HTML/CSS des snippets est nettoyée et rendue dans une iframe avec `sandbox` vide ; les previews de fichiers suivent une allowlist de signatures. | `js/pages/snippets.js:708-715`, `js/drag-drop.js:67-105`, `angular/src/app/shared/rendering/sandbox-preview.component.ts` | TAN-51 validée |
| OBS-05 | Highlight.js reste chargé depuis cdnjs uniquement pour les pages legacy et les fenêtres de code ; chaque ressource est versionnée et contrôlée par SRI SHA-384. Les Google Fonts ont été retirées. | `project.html:29-34`, `snippets.html:29-34`, `js/pages/project.js:697`, `js/pages/snippets.js:660` | TAN-51 validée ; auto-hébergement possible avant publication finale |
| OBS-06 | L'import legacy valide et fusionne superficiellement les données avant écriture, sans validation complète de schéma ni sauvegarde automatique avant écrasement. | `js/pages/export-import.js:39-94`, `:244-286` | TAN-50 |
| OBS-07 | Les tests Angular, les checks legacy et le smoke navigateur sont configurés. | `angular/package.json`, `.github/workflows/ci-cd.yml`, `e2e/run.py` | TAN-48 validée |
| OBS-08 | Les notifications sont vérifiées par un timer lorsque l'application est ouverte ; elles ne constituent pas un service d'arrière-plan fiable. | `js/components.js:95-169` | TAN-49 |

## Données de test à préparer

La matrice interactive exige un jeu de données connu, reproductible et non sensible :

- deux projets racine, dont un avec deux niveaux de sous-projets ;
- un arbre projet avec dossiers et un item de chaque type ;
- deux dossiers RH, dont un document avec Markdown, tags et pièce jointe ;
- deux dossiers snippets avec ordre mixte et plusieurs langages ;
- tâches couvrant chaque statut, priorité, contexte, échéance, dépendance et récurrence ;
- une entrée de journal avec humeur, tags et Markdown ;
- un favori de chaque type applicable ;
- activité récente et élément supprimé dans la corbeille ;
- une fixture avec coffre activé, secrets de test et mot de passe de test connu uniquement du profil de recette ;
- un export complet JSON et un export de section pour chaque famille.

Les fixtures ne doivent pas contenir de données personnelles, de vrais mots de passe, de tokens, d'URL privées ni de fichiers confidentiels. Elles ne doivent pas être incluses dans l'artifact GitHub Pages.

## Critères de sortie de TAN-21

- [x] Les dix pages legacy sont inventoriées.
- [x] Les paramètres URL listés dans l'issue sont associés à leurs consommateurs et producteurs.
- [x] Les parcours CRUD, navigation, import/export et permissions sont décrits.
- [x] Les dix URL publiques legacy ont été vérifiées comme accessibles le 2026-08-19.
- [x] Les écarts connus sont isolés avec une issue de traitement ou un propriétaire futur.
- [ ] La checklist interactive est exécutée avec un profil navigateur et les fixtures dédiées.

La dernière case relève de la recette interactive globale. Elle ne bloque pas la livraison documentaire de TAN-21, mais doit rester ouverte jusqu'à la création des fixtures et des tests automatisés des US suivantes.
