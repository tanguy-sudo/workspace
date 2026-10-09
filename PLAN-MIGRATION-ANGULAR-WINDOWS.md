# Plan de migration vers Angular et d'utilisation Windows

**Branche :** `plan/angular-migration-windows`<br>
**Projet :** Workspace<br>
**Date :** 2026-08-19<br>
**Statut :** plan de préparation, aucune migration applicative commencée

## 1. Résumé exécutif

Le projet actuel est une application web locale statique en HTML, CSS et JavaScript natif. Elle ne possède ni serveur applicatif ni backend. Les données sont conservées dans le navigateur, principalement dans IndexedDB via Dexie.

La migration recommandée est progressive :

1. conserver les anciennes pages pendant toute la transition ;
2. créer une application Angular standalone avec TypeScript ;
3. réutiliser le contrat de persistance existant avant de modifier le modèle de données ;
4. migrer les fonctionnalités une par une, avec un seul propriétaire d'écriture par fonctionnalité ;
5. conserver les anciennes URL, les exports JSON et les données chiffrées ;
6. déployer d'abord Angular sous un chemin isolé, puis effectuer le basculement final ;
7. ouvrir manuellement l'URL GitHub Pages dans le navigateur habituel ; aucun démarrage automatique Windows n'est requis.

Le mode d'utilisation retenu est donc :

```text
Build Angular de production sur GitHub Pages
        -> ouverture manuelle de l'URL HTTPS dans le navigateur habituel
```

Cette solution ne demande ni Node.js, ni Python, ni serveur local sur le poste au moment du démarrage. Elle nécessite une connexion Internet et l'acceptation de stocker les données dans l'origine navigateur de GitHub Pages.

Une variante « build local hors ligne + serveur HTTP sur `127.0.0.1` » est décrite à la fin. Elle ne doit être retenue que si l'accès hors ligne, l'indépendance vis-à-vis de GitHub Pages ou la confidentialité du code l'impose.

## 2. État actuel du projet

### 2.1 Stack et exécution

Constats issus du dépôt :

- pages HTML séparées : `index.html`, `todos.html`, `projects.html`, `project.html`, `snippets.html`, `rh.html`, `journal.html`, `smart-planning.html`, `settings.html` et `export.html` ;
- logique métier dans `js/` et `js/pages/` ;
- styles globaux dans `css/` et styles par page dans `css/pages/` ;
- IndexedDB via `assets/vendor/dexie.min.js` ;
- dépendance npm `dexie` déclarée dans `package.json`, mais sans application Angular ni lockfile actuellement ;
- aucun build applicatif obligatoire actuellement ;
- déploiement GitHub Pages de la racine du dépôt dans `.github/workflows/ci-cd.yml` ;
- contrôle CI actuel limité à la syntaxe JavaScript et aux ressources locales ;
- pas de backend, pas d'API HTTP métier et pas de synchronisation distante.

Références : `README.md:3-9`, `README.md:93-106`, `ARCHITECTURE.md:3-12`, `package.json:1-16` et `.github/workflows/ci-cd.yml:14-64`.

### 2.2 Fonctionnalités à préserver

Le périmètre fonctionnel actuel comprend :

- tableau de bord avec rappels, statistiques, santé de l'organisation, revue hebdomadaire et activité récente ;
- tâches avec statuts, priorités, tags, contextes, dépendances, récurrence, estimation, échéance et rappels ;
- projets hiérarchiques avec dossiers et items mixtes ;
- items de projet de type lien, mémo, information, code et mot de passe ;
- snippets avec dossiers, tags, favoris, import et prévisualisation ;
- arborescence RH et documents ;
- journal Markdown ;
- planification intelligente ;
- thème, préférences, favoris, raccourcis et recherche globale ;
- export JSON, Markdown, CSV et ZIP ;
- import JSON par fusion ou remplacement complet ;
- coffre de mots de passe local ;
- sauvegardes et API File System Access lorsqu'elle est disponible.

La migration Angular ne doit pas être l'occasion de supprimer ou de réinterpréter implicitement une de ces fonctionnalités.

### 2.3 Contrat de données à préserver

Le contrat de compatibilité prioritaire est celui de `js/db.js` et `js/storage.js` :

- nom de la base IndexedDB : `workspace` ;
- version Dexie actuelle : `1` ;
- table : `kv` ;
- clé principale : `data` ;
- clé complémentaire : `backupDirHandle` ;
- ancien stockage à migrer : `localStorage["workspace_data"]` ;
- état complet stocké dans une seule valeur `kv["data"]` ;
- écritures actuellement mises en cache puis persistées avec un debounce d'environ 80 ms ;
- flush sur `beforeunload`, `pagehide` et `visibilitychange`.

Références : `js/db.js:7-28`, `js/db.js:35-60`, `js/db.js:68-100` et `ARCHITECTURE.md:104-145`.

Les sections connues de la racine sont notamment :

```text
projects
rh
snippets
snippetFolders
snippetMixedOrder
favorites
journal
trash
recentlyVisited
activityLog
settings
```

Les champs inconnus doivent être conservés lors d'une lecture puis d'une écriture. Il ne faut pas remplacer le modèle complet par un nouveau schéma relationnel avant d'avoir une sauvegarde fiable et des tests de migration.

### 2.4 Stockages navigateur à inventorier dans l'adaptateur

Les clés suivantes doivent être centralisées dans un service Angular, tout en conservant leur nom pendant la transition :

| Stockage | Clés ou usages |
|---|---|
| `localStorage` | `workspace-theme`, `workspace-accent`, `workspace-last-backup`, `workspace-smart-plan`, préférences de vues et de dossiers, rappels déjà notifiés, demande de permission de notification, tailles de modales, `workspace_data` legacy |
| `sessionStorage` | `workspace-vault-key-v1`, création de journal demandée depuis la recherche, ancien focus de tâche |
| IndexedDB | données Workspace et handle de dossier de sauvegarde |

Le thème existe actuellement à la fois dans `settings.theme` et dans `localStorage["workspace-theme"]`. Pendant la coexistence, `settings.theme` est la valeur canonique dès que la base est disponible ; `workspace-theme` reste le fallback de démarrage anticipé des pages legacy. La suppression de cette duplication est une tâche séparée, après validation.

## 3. Objectifs et limites

### 3.1 Objectifs

- obtenir une application Angular typée et construite par Angular CLI ;
- conserver le comportement utilisateur et le rendu visuel pendant la migration ;
- conserver les données IndexedDB existantes sans migration destructive ;
- conserver le coffre et son format cryptographique ;
- conserver les anciennes URL et les anciens exports JSON ;
- améliorer la testabilité avec des services, des types et des tests automatisés ;
- faire produire à la CI un artefact Angular vérifié ;
- ouvrir l'application manuellement depuis son URL HTTPS ;
- disposer d'une procédure d'installation, de vérification et de désinstallation reproductible.

### 3.2 Hors périmètre initial

Ne pas ajouter au premier passage :

- backend ou API distante ;
- authentification serveur ;
- synchronisation cloud ;
- SSR ou application Angular nécessitant un serveur Node en production ;
- application Electron/Tauri ;
- NgRx ou une autre bibliothèque d'état globale sans besoin démontré ;
- refonte graphique complète ;
- normalisation immédiate de la base IndexedDB en plusieurs tables ;
- exécution de `ng serve` au démarrage de Windows ;
- notifications fiables lorsque le navigateur et l'application sont fermés.

Ces sujets pourront faire l'objet de décisions séparées une fois la migration fonctionnelle terminée.

## 4. Décisions validées pour TAN-18

Les décisions suivantes constituent le périmètre de référence pour commencer la migration. Elles privilégient le minimum d'infrastructure et la compatibilité avec le dépôt actuel.

| Sujet | Choix recommandé | Pourquoi |
|---|---|---|
| Architecture Angular | composants standalone, TypeScript strict, services Angular et Signals | socle moderne sans ajouter un store inutile |
| Runtime applicatif | application client-side statique, sans backend, SSR ou serveur Node en production | GitHub Pages suffit pour distribuer le build |
| État partagé | services typés + Signals au départ | le projet reste local et mono-utilisateur |
| Persistance | Dexie, base `workspace`, table `kv`, clé `data` | compatibilité directe avec les données existantes |
| Routage initial | `HashLocationStrategy` pendant la coexistence et sur GitHub Pages | évite les 404 des routes profondes sans réécriture serveur |
| URL de production | `https://tanguy-sudo.github.io/workspace/` | URL vérifiée le 2026-08-19, HTTPS activé et GitHub Pages configuré par workflow |
| `base href` final | `/workspace/` | correspond au sous-chemin du dépôt GitHub Pages |
| Déploiement de transition | Angular sous `https://tanguy-sudo.github.io/workspace/app/` | conserve les pages legacy à la racine et facilite le rollback |
| Déploiement final | artefact Angular dédié publié par GitHub Pages | ne pas publier tout le dépôt par inadvertance |
| Gestion d'état complexe | report de NgRx | aucune synchronisation distante ne le justifie aujourd'hui |
| Format de sauvegarde de référence | JSON complet actuel | c'est le format le plus complet et le plus adapté au round-trip |
| Démarrage Windows | aucun démarrage automatique ; ouverture manuelle de l'URL dans le navigateur habituel | évite une tâche planifiée inutile et laisse le choix du moment d'ouverture |
| Coexistence legacy/Angular | jusqu'à la recette finale, puis période d'observation minimale de 7 jours | permet un rollback sans maintenir deux propriétaires d'une même fonctionnalité indéfiniment |
| Écriture pendant coexistence | une seule version possède l'écriture pour chaque fonctionnalité ; édition simultanée legacy/Angular non supportée | évite l'écrasement de caches complets sans ajouter de synchronisation prématurée |
| GitHub Pages pour les données | accepté pour l'application personnelle sous HTTPS, avec données uniquement dans le navigateur | le code client est public et ne constitue pas une frontière de sécurité ; aucun backend ne reçoit les données |
| Mode hors ligne | non requis pour le premier parcours ; traité séparément dans [TAN-55](https://linear.app/tanguy-sudo/issue/TAN-55/us-preparer-la-variante-locale-hors-ligne-sur-127001) | évite de gérer deux origines et deux procédures de distribution dès le départ |
| Notifications | notifications best effort lorsque l'application est ouverte ; pas de service worker initial | le service worker est un chantier distinct et le comportement actuel est conservé |
| Ressources tierces | audit puis contrôle/auto-hébergement avant la publication finale | réduit la dépendance aux CDN et relève de [TAN-51](https://linear.app/tanguy-sudo/issue/TAN-51/us-realiser-laudit-securite-et-accessibilite-angular) |

### Conséquences et rollback

| Décision | Conséquence acceptée | Rollback |
|---|---|---|
| GitHub Pages comme cible nominale | connexion Internet nécessaire et code client public | revenir à la version legacy publiée à la racine |
| Hash routing | URLs Angular avec `#` | conserver les anciennes URL HTML et changer la cible Windows |
| Base `workspace` inchangée | écritures initiales dans une valeur complète `kv["data"]` | revenir à l'application legacy sans migration destructive |
| Une version propriétaire des écritures | pas d'édition simultanée legacy/Angular | désactiver les routes Angular concernées et reprendre sur legacy |
| Ouverture manuelle | le profil choisi par l'utilisateur est utilisé | ouvrir manuellement l'URL legacy pendant la coexistence |
| Mode hors ligne reporté | pas de serveur local ni de build installé sur le PC au premier déploiement | ouvrir le chantier TAN-55 avec export/import entre origines |

### Décisions reportées et issues associées

Les sujets non nécessaires au premier parcours sont explicitement reportés dans des issues existantes :

- **Build local hors ligne et serveur loopback :** [TAN-55](https://linear.app/tanguy-sudo/issue/TAN-55/us-preparer-la-variante-locale-hors-ligne-sur-127001).
- **Notifications lorsque l'application est fermée :** [TAN-49](https://linear.app/tanguy-sudo/issue/TAN-49/us-encadrer-les-notifications-locales-et-leurs-fallbacks).
- **Audit des dépendances, CSP, sécurité et accessibilité :** [TAN-51](https://linear.app/tanguy-sudo/issue/TAN-51/us-realiser-laudit-securite-et-accessibilite-angular).
- **Propriétaire des écritures et fin de coexistence :** [TAN-58](https://linear.app/tanguy-sudo/issue/TAN-58/us-organiser-la-coexistence-et-le-proprietaire-des-ecritures).
- **Démarrage automatique Windows :** [TAN-60](https://linear.app/tanguy-sudo/issue/TAN-60/us-preparer-le-demarrage-windows-via-task-scheduler) est abandonnée ; l'ouverture manuelle suffit au besoin.

## 5. Architecture Angular cible minimale

La structure cible peut rester simple :

```text
src/
  app/
    core/
      persistence/
        workspace-db.service.ts
        workspace-store.service.ts
        storage-preferences.service.ts
      security/
        password-vault.service.ts
      files/
        file-access.service.ts
      routing/
        legacy-route.service.ts
      notifications/
        reminder-notification.service.ts
    shared/
      layout/
      modal/
      toast/
      markdown/
      tree/
      search/
      favorites/
    features/
      home/
      todos/
      projects/
      project-detail/
      snippets/
      rh/
      journal/
      smart-planning/
      settings/
      export/
    app.routes.ts
    app.component.ts
  assets/
  styles.scss
```

Cette structure est une cible indicative, pas une obligation de créer tous les dossiers dès le début. Chaque fonctionnalité doit être créée uniquement au moment de sa migration.

### 5.1 Service de persistance

`WorkspaceDbService` devra :

- ouvrir la base `workspace` avec le contrat Dexie existant ;
- attendre explicitement l'initialisation avant d'afficher les données ;
- migrer `workspace_data` si `kv["data"]` n'existe pas ;
- exposer un état typé en mémoire ;
- sérialiser les écritures ;
- déclencher un flush explicite avant export et avant fermeture ;
- conserver les champs non encore typés ;
- signaler les erreurs de quota et de persistance à l'interface ;
- ne jamais journaliser le contenu complet de la base ni les secrets.

Le premier service doit reprendre le comportement fiable existant avant toute optimisation. L'utilisation de Signals doit servir à notifier les composants, pas à muter directement des objets partagés sans passer par une méthode métier.

### 5.2 Services métier

Le code de `storage.js` doit être découpé progressivement en services ou fonctions pures, sans copier-coller :

- `TodoService` pour tâches, récurrence et rappels ;
- `ProjectService` pour projets, arbres, dossiers et items ;
- `SnippetService` pour snippets et ordre mixte ;
- `RhService` pour l'arbre RH ;
- `JournalService` pour les entrées Markdown ;
- `FavoritesService` pour les favoris ;
- `ExportService` et `ImportService` pour les formats ;
- `WorkspaceSettingsService` pour les préférences ;
- `ActivityService` pour l'activité et les visites.

Une fonction métier ne doit pas être réimplémentée dans plusieurs composants. Les algorithmes de récurrence, d'anti-cycle, de fusion et de réordonnancement doivent être portés en priorité sous forme de fonctions pures testables.

### 5.3 HTML, CSS et sécurité de rendu

La première migration visuelle doit réutiliser les fichiers CSS actuels autant que possible :

1. importer les styles globaux dans `src/styles.scss` ;
2. conserver les variables et les classes existantes ;
3. remplacer progressivement les sélecteurs par des styles de composants ;
4. ne pas refaire la charte graphique en parallèle de la migration fonctionnelle.

Les anciens `innerHTML` ne doivent pas être transférés automatiquement dans les templates Angular :

- préférer l'interpolation et les bindings Angular ;
- utiliser `DomSanitizer` uniquement pour des contenus contrôlés et documentés ;
- traiter les titres, tags, URLs, Markdown importé et noms de fichiers comme des entrées non fiables ;
- conserver une sandbox pour les prévisualisations HTML/CSS ;
- ne pas faire confiance à une URL `javascript:`, `data:` ou à un schéma inconnu.

## 6. Plan d'exécution par phases

Chaque phase doit être livrée avec son code, ses tests et un critère de sortie. Une phase n'est pas considérée comme terminée parce que le composant compile : les parcours utilisateur et la compatibilité des données doivent également être validés.

### Phase 0 - Baseline, décisions et filet de sécurité

**But :** savoir exactement ce qui doit rester compatible avant de toucher au runtime.

**Actions :**

1. prendre un export JSON complet réel et le conserver hors du dépôt ;
2. créer des fixtures anonymisées : workspace vide, workspace rempli, ancien localStorage, coffre activé, arbres profonds, ordre mélangé, fichiers joints et corbeille ;
3. relever les URLs publiques actuelles et tous leurs paramètres ;
4. inventorier les navigateurs supportés et les APIs facultatives ;
5. confirmer le chemin GitHub Pages et le mode de routage ;
6. décider si l'application doit fonctionner hors ligne ;
7. définir la durée de coexistence legacy/Angular ;
8. consigner la stratégie de sauvegarde et de restauration avant toute migration.

**Livrables :**

- [baseline fonctionnelle et matrice des URL](BASELINE-FONCTIONNELLE-URL.md) ;
- [fixtures de données anonymisées](fixtures/README.md) et validateur CI ;
- liste des URLs et paramètres ;
- décisions de routage, hébergement et sécurité ;
- sauvegarde manuelle vérifiée.

**Sortie :** aucune migration ne démarre sans un export de référence lisible et restaurable.

### Phase 1 - Socle Angular et CI sans remplacement fonctionnel

**But :** introduire Angular sans casser l'application actuelle.

**Actions :**

1. initialiser l'application Angular dans un répertoire clairement défini ;
2. choisir la version Angular supportée à la date d'implémentation et la verrouiller ;
3. créer un lockfile et des scripts npm explicites : installation, build, test et vérification ;
4. activer TypeScript strict ;
5. configurer le `base href` pour le chemin GitHub Pages ;
6. ajouter une page Angular minimale avec un indicateur de version ;
7. construire Angular dans un chemin isolé, par exemple `dist/workspace/browser` ;
8. conserver la CI JavaScript legacy ;
9. ajouter à la CI `npm ci`, build Angular et tests Angular ;
10. ne pas remplacer encore l'artifact GitHub Pages existant.

**Tests :**

- installation reproductible ;
- build de production ;
- démarrage local sur un serveur statique ;
- ouverture du chemin Angular sur GitHub Pages de test ;
- vérification qu'une page legacy fonctionne toujours.

**Sortie :** le build Angular passe dans la CI sans modifier le comportement public legacy.

### Phase 2 - Adaptateur IndexedDB et contrat de données

**But :** faire lire et écrire Angular dans la même base que l'application actuelle.

**Actions :**

1. porter l'ouverture Dexie en conservant `workspace`, `kv`, `data` et `backupDirHandle` ;
2. implémenter la migration idempotente depuis `localStorage["workspace_data"]` ;
3. définir les types TypeScript correspondant aux sections existantes ;
4. préserver les champs optionnels et inconnus ;
5. porter le cache mémoire et le flush différé avec une API explicite ;
6. ajouter un flush avant export, `pagehide` et masquage de document ;
7. centraliser `localStorage` et `sessionStorage` dans des services tolérants aux erreurs ;
8. afficher une erreur exploitable si IndexedDB est indisponible ;
9. ne pas augmenter la version Dexie sans migration testée ;
10. documenter que deux onglets legacy et Angular ne doivent pas modifier simultanément la même base tant qu'aucune coordination n'est livrée.

**Tests obligatoires :**

- ouverture d'une base vide ;
- ouverture d'une base existante ;
- migration depuis `workspace_data` ;
- migration répétée sans doublon ni perte ;
- conservation de clés inconnues ;
- écriture puis relecture après fermeture ;
- erreur de quota ;
- flush sur `visibilitychange` et `pagehide` ;
- interaction séquentielle entre une page legacy puis Angular.

**Sortie :** Angular peut charger un export de référence et le relire sans différence destructive.

### Phase 3 - Shell, navigation et composants transverses

**But :** migrer ce qui est partagé avant les pages métier.

**Actions :**

1. migrer la topbar, le branding, le thème et le menu mobile ;
2. migrer toasts, modales, gestion du focus et fermeture par `Escape` ;
3. migrer le routeur Angular et les paramètres de route ;
4. créer une table de conversion des anciennes URL HTML ;
5. migrer favoris, raccourcis et activité commune ;
6. migrer recherche globale et navigation vers un élément ciblé ;
7. migrer les fonctions d'arbre génériques et le drag and drop réutilisable ;
8. remplacer les écouteurs globaux par des subscriptions et destructions Angular explicites ;
9. vérifier que chaque timer, observer et listener est arrêté à la destruction du composant.

**Compatibilité des URL à couvrir :**

```text
id
parent
folder
path
focus
kind
savedView
status
priority
context
project
due
view
```

**Sortie :** un composant shell Angular permet de naviguer entre des routes de démonstration sans charger les scripts globaux legacy.

### Phase 4 - Journal, RH et snippets

**Ordre recommandé :** journal, RH, puis snippets.

#### Journal

Porter :

- liste et sélection par date ;
- édition Markdown et prévisualisation ;
- humeur, tags et recherche locale ;
- autosauvegarde ;
- création demandée depuis la recherche globale ;
- export et suppression/restauration via corbeille.

Tests : rechargement, changement de date, Markdown hostile, caractères spéciaux, sauvegarde et export JSON.

#### RH

Porter :

- arbre de dossiers et documents ;
- création, renommage, déplacement et anti-cycle ;
- tags, favoris et wiki-links ;
- pièces jointes, import et export ;
- corbeille et restauration.

Tests : arbre profond, déplacement vers soi ou un descendant, ordre des enfants, document absent, fichier trop volumineux et navigation avec bouton précédent.

#### Snippets

Porter :

- dossiers imbriqués ;
- ordre mixte dossiers/snippets ;
- langage, tags, favoris et recherche ;
- import de fichier ;
- copie presse-papier ;
- prévisualisation et Highlight.js.

Décider avant le port si Highlight.js reste chargé depuis CDN. Le choix par défaut est de l'auto-héberger ou de le versionner avec intégrité plutôt que de dépendre d'un script distant non contrôlé.

Tests : round-trip de l'ordre mixte, import de code, preview contenant du HTML ou du script, refus des URLs dangereuses et fallback presse-papier.

**Sortie :** ces trois domaines sont utilisables dans Angular avec les mêmes données que la version legacy, sans perte à la navigation.

### Phase 5 - Paramètres, fichiers, sauvegarde et coffre

**But :** sécuriser les opérations sensibles avant de migrer les projets contenant des secrets.

#### Paramètres et sauvegardes

Porter :

- thème et accent ;
- nom d'utilisateur et nom du site ;
- priorités et vues sauvegardées ;
- sélection de dossier ;
- backup manuel ;
- backup automatique au démarrage de l'application ;
- fallback téléchargement si File System Access est indisponible ;
- estimation de quota.

Dans Angular, la sauvegarde automatique était auparavant vérifiée au chargement d'une page. Comme les navigations deviennent internes, décider si le contrôle doit être effectué uniquement au démarrage de l'application ou aussi à chaque navigation importante. Le choix minimal recommandé est : démarrage, retour dans l'application après longue absence et action manuelle explicite.

#### Coffre de mots de passe

Conserver sans réencodage :

- PBKDF2 avec SHA-256 ;
- 250 000 itérations actuelles ;
- sel aléatoire de 16 octets ;
- AES-GCM 256 bits ;
- IV aléatoire de 12 octets ;
- champs Base64 `salt`, `verifier.iv`, `verifier.cipher`, `secretEncrypted.iv` et `secretEncrypted.cipher` ;
- clé temporaire dans `sessionStorage["workspace-vault-key-v1"]`.

Le service Angular doit couvrir :

- activation et migration des secrets existants ;
- déverrouillage ;
- verrouillage ;
- lecture et écriture d'un secret ;
- changement de mot de passe ;
- désactivation avec confirmation explicite.

Points à traiter séparément : la désactivation remet les secrets en clair ; la clé de session reste lisible par un script de la même origine. Le service Angular utilise la valeur persistée `iterations`, avec une validation d'import entre 100 000 et 1 000 000 ; aucun changement de format cryptographique n'est introduit.

**Tests obligatoires :**

- déverrouillage d'une fixture historique ;
- mauvais mot de passe sans révélation ;
- activation avec secrets existants ;
- modification et relecture d'un secret ;
- changement de mot de passe ;
- verrouillage/rechargement ;
- export/import d'un coffre ;
- absence de secret en clair dans les logs et les templates non autorisés.

**Sortie :** les données du coffre historique sont lisibles par Angular et restent lisibles après retour à la page legacy.

### Phase 6 - Projets et détail de projet

**Ordre interne :**

1. liste et hiérarchie des projets ;
2. détail sans secrets ;
3. dossiers et items mixtes ;
4. drag and drop et réordonnancement ;
5. Markdown, code, liens et plein écran ;
6. pièces jointes ;
7. items mot de passe après la phase coffre.

Préserver explicitement :

- `id`, `parentId`, ordre et catégories ;
- paramètres `id`, `folder`, `path`, `focus` et `kind` ;
- anti-cycle des déplacements ;
- suppression vers la corbeille et restauration ;
- tâches liées au projet ;
- plein écran, copie et previews ;
- champs chiffrés sans les remplacer par des champs en clair.

Tests : création, renommage, hiérarchie, déplacement, réordonnancement, suppression, restauration, fichier joint, URL dangereuse, preview sandboxée et coffre verrouillé.

**Sortie :** un projet existant peut être parcouru et modifié dans Angular sans modifier sa structure persistée de façon inattendue.

### Phase 7 - Tâches, planification et accueil

Les tâches doivent être migrées avant le tableau de bord, car ce dernier agrège presque toutes les sections.

#### Tâches

Porter et tester :

- statuts `todo`, `waitinginfo`, `inprogress` et `done` ;
- priorités personnalisables ;
- filtres et vues sauvegardées ;
- tags, contextes et projet ;
- dépendances ;
- estimation et parser d'expressions ;
- échéances et rappels ;
- récurrence quotidienne, hebdomadaire et mensuelle ;
- sélection multiple ;
- corbeille et activités.

Les calculs de prochaine occurrence doivent être des fonctions pures et conserver les dates locales actuelles. Les régressions de fuseau horaire doivent être couvertes par des tests avec plusieurs dates limites.

#### Planification

Porter l'algorithme de sélection et l'état de session stocké dans `workspace-smart-plan`. Vérifier que les tâches complétées dans la session ne sont pas perdues lors d'un changement de route.

#### Accueil

Porter en dernier :

- rappels et onglets ;
- notifications best effort ;
- statistiques ;
- santé de l'organisation ;
- revue hebdomadaire ;
- activité récente ;
- raccourcis vers les autres domaines.

Les URLs générées par l'accueil doivent utiliser le routeur Angular après bascule, tout en acceptant les anciennes URL pendant la coexistence.

**Sortie :** les scénarios quotidiens complets sont exécutables dans Angular de l'accueil jusqu'à la modification d'une tâche ou d'un projet.

### Phase 8 - Export, import et compatibilité complète

Même si une première version de l'export est portée en phase 3 ou 5 pour les sauvegardes, la parité complète est validée ici.

#### Export

Conserver :

- export JSON complet réimportable ;
- exports par section ;
- Markdown ;
- CSV des tâches ;
- ZIP des snippets, du journal et des projets ;
- noms de fichiers et dates suffisamment stables pour les sauvegardes existantes.

Le JSON complet est le format canonique. Les convertisseurs Markdown/CSV actuels semblent utiliser des champs historiques qui ne correspondent pas toujours au modèle courant, notamment pour la priorité et la description des tâches. Ne pas corriger ce comportement en silence : créer une décision ou une tâche dédiée, puis ajouter des tests de sortie avant de modifier le format.

#### Import

L'import Angular doit :

1. lire le fichier sans modifier la base ;
2. reconnaître les sauvegardes complètes, sections et tableaux historiques acceptés ;
3. valider les types et les identifiants ;
4. refuser les structures invalides avant toute écriture ;
5. proposer fusion ou remplacement uniquement quand le format le permet ;
6. créer une sauvegarde préalable avant un remplacement complet ;
7. écrire une seule fois après validation ;
8. recharger l'état Angular sans rechargement brutal de la page ;
9. afficher une erreur sans exposer de contenu sensible.

**Sortie :** un export JSON historique puis un import Angular produit un état équivalent et les données invalides ne modifient pas la base.

### Phase 9 - Coexistence, bascule et retrait legacy

**Coexistence :**

- un verrou Web Locks exclusif `workspace:data-write` attribue l'écriture à un seul onglet de l'origine, Angular ou legacy ;
- les autres onglets détectent le conflit, affichent un avertissement et refusent toute écriture avant mutation du cache ;
- si Web Locks est absent ou ne peut être acquis, l'application fonctionne en lecture seule ;
- le verrou est global, car les deux versions remplacent toute la racine `kv.data` ;
- les onglets chargés avec un ancien script legacy doivent être rechargés après déploiement pour participer au verrou ;
- les liens legacy sont convertis vers les routes Angular lorsqu'une fonctionnalité est migrée ;
- les pages non migrées restent accessibles ;
- les exports JSON sont utilisés comme filet de retour arrière ;
- une seule fenêtre Workspace peut donc être utilisée en écriture à la fois ; aucun merge multi-onglet n'est effectué.

**Bascule :**

1. publier Angular sur un environnement de test ;
2. importer une copie de la fixture et exécuter la matrice de non-régression ;
3. publier Angular sous le chemin de transition ;
4. faire tester toutes les anciennes URL ;
5. mettre à jour les liens legacy ;
6. conserver les anciennes pages pendant une période d'observation ;
7. publier l'artifact final Angular à la racine lorsque le rollback est encore possible ;
8. transformer les anciennes URL `.html` en redirections ou wrappers compatibles ;
9. retirer les scripts legacy uniquement après validation des sauvegardes et URLs ;
10. conserver une archive versionnée du dernier build legacy.

**Critère de bascule :** aucune fonctionnalité critique, donnée ou URL bloquante ne reste sans test documenté.

## 7. Routage et GitHub Pages

### 7.1 Stratégie initiale

Les pages actuelles utilisent des URL telles que `todos.html`, `project.html?id=...` et `rh.html?folder=...`. Angular utilisera des routes internes. Pendant la coexistence, les anciennes URL doivent continuer à ouvrir les pages legacy ou rediriger vers la route Angular équivalente.

Le routage par hash est recommandé au début :

```text
https://tanguy-sudo.github.io/workspace/app/#/todos
https://tanguy-sudo.github.io/workspace/app/#/projects
https://tanguy-sudo.github.io/workspace/app/#/project/<id>
```

Avantages :

- pas de réécriture serveur nécessaire ;
- rechargement direct compatible avec GitHub Pages ;
- déploiement local par serveur statique simple ;
- rollback plus facile pendant la coexistence.

Inconvénient : les URLs sont moins propres. Une migration ultérieure vers `PathLocationStrategy` nécessite un fallback `404.html` ou un autre mécanisme GitHub Pages testé, et ne doit pas être mélangée au portage fonctionnel initial.

### 7.2 Workflow CI/CD cible

Le workflow devra évoluer progressivement :

1. conserver la vérification des scripts legacy durant la coexistence ;
2. exécuter `npm ci` avec un lockfile ;
3. lancer la compilation de production Angular ;
4. exécuter les tests unitaires et d'intégration ;
5. vérifier les ressources locales et les chemins générés ;
6. publier uniquement le dossier de build prévu au moment du basculement ;
7. ne pas publier `node_modules`, fichiers de développement ou scripts internes ;
8. ajouter un smoke test de l'accueil et d'une route profonde.

Le chemin réel de l'artefact doit être confirmé après création du workspace Angular. Tant que le dépôt contient les pages legacy à la racine, l'artifact de transition peut contenir les deux applications. Après bascule, il doit contenir le build Angular et uniquement les wrappers nécessaires aux anciennes URL.

## 8. Ouverture manuelle dans le navigateur

Après connexion à Windows, l'utilisateur ouvre manuellement l'URL HTTPS GitHub Pages dans son navigateur habituel et le profil souhaité. Aucun script, tâche planifiée, privilège élevé ou processus `ng serve` n'est requis.

### Pourquoi ne pas lancer `ng serve`

`ng serve` est un serveur de développement :

- il nécessite Node.js et les dépendances du dépôt ;
- il n'est pas destiné à servir un runtime de production ;
- il peut changer de comportement avec une version de CLI ;
- il doit être exposé par un processus permanent ;
- il complexifie les logs, les mises à jour et la sécurité du poste.

Le navigateur doit ouvrir un build `ng build` de production déjà publié.

### Variante hors ligne : build local et serveur loopback

Si l'application doit fonctionner sans Internet, prévoir une distribution locale distincte :

```text
%LOCALAPPDATA%\Workspace\
  app\       build Angular de production
  bin\       lanceur et procédure d'arrêt
  logs\      journaux techniques sans données métier
```

Le lanceur devra :

1. vérifier que `app\index.html` existe ;
2. vérifier si le port fixe est déjà occupé par l'application ;
3. démarrer un serveur statique uniquement si nécessaire ;
4. écouter exclusivement sur `127.0.0.1` ;
5. attendre une réponse HTTP avant d'ouvrir le navigateur ;
6. utiliser une URL stable, par exemple `http://127.0.0.1:8080/` ;
7. journaliser uniquement les erreurs de démarrage et le PID ;
8. permettre un arrêt propre en vérifiant le processus ;
9. ouvrir l'application avec le profil navigateur habituel ;
10. ne jamais exposer le serveur sur `0.0.0.0`.

Le dépôt documente déjà Python avec `python -m http.server 8080`. Cette solution peut servir de variante personnelle si Python est installé, mais elle doit être vérifiée sur le poste cible. Pour une distribution destinée à plusieurs postes, il faudra fournir un serveur statique approuvé ou un installeur, ce qui devient un chantier distinct.

### Origine et données IndexedDB

Les origines suivantes ne partagent pas automatiquement leurs données :

```text
https://tanguy-sudo.github.io/workspace/
http://127.0.0.1:8080/
http://localhost:8080/
file:///C:/...
```

Avant de passer de GitHub Pages à un serveur local, ou inversement :

1. exporter le workspace complet en JSON ;
2. ouvrir la nouvelle origine avec le même profil navigateur ;
3. importer le JSON ;
4. vérifier les tâches, projets, fichiers et coffre ;
5. ne supprimer l'ancienne origine qu'après validation.

Ne pas alterner `localhost` et `127.0.0.1`, ni changer de port sans raison. L'API File System Access nécessite un contexte sécurisé ; HTTPS est le cas nominal et `127.0.0.1` est généralement traité comme contexte local sécurisé par les navigateurs Chromium.

### Installation et désinstallation

Le mode GitHub Pages ne nécessite aucune installation : il suffit d'ouvrir l'URL dans le navigateur. Fournir des scripts d'installation et de désinstallation uniquement si le mode local hors ligne est retenu.

Si un script d'installation du mode local est ajouté, il doit :

- utiliser le compte courant ;
- ne pas demander de privilèges administrateur sans nécessité ;
- utiliser des chemins absolus et correctement quotés ;
- vérifier l'URL ou le fichier avant l'enregistrement ;
- permettre une désinstallation sans supprimer les données du navigateur ;
- ne jamais supprimer les sauvegardes automatiquement.


Le projet contient des données RH, des notes et un coffre local. La migration doit traiter les points suivants comme des exigences, pas comme des améliorations facultatives :

- ne jamais publier les données IndexedDB dans le dépôt ou les logs ;
- auto-héberger ou contrôler les scripts tiers autant que possible ;
- utiliser une politique CSP adaptée après stabilisation du build ;
- limiter les previews HTML/CSS par sandbox ;
- valider les imports avant écriture ;
- éviter les constructions Angular bypassant la sanitization ;
- ne pas afficher les secrets dans les messages d'erreur ou la console ;
- rappeler que GitHub Pages rend le code client public ;
- rappeler que le coffre ne chiffre pas toutes les données Workspace ;
- protéger les fichiers JSON exportés, qui peuvent contenir des informations sensibles ;
- ne jamais ouvrir un serveur local sur le réseau.


| Risque | Mesure minimale |
|---|---|
| écrasement par deux onglets | un seul onglet éditeur documenté pendant la coexistence ; coordination multi-onglets uniquement si le besoin est confirmé |
| perte lors d'un import | validation complète avant écriture et sauvegarde préalable avant remplacement |
| rupture du coffre | fixtures cryptographiques et conservation exacte du format |
| XSS par contenu importé | interpolation Angular, sanitation maîtrisée et sandbox des previews |
| route profonde en 404 | hash routing initial ou fallback testé |
| CDN indisponible ou compromis | auto-hébergement ou versionnement avec intégrité |
| quota IndexedDB | message utilisateur, export préventif et tests proches de la limite |
| permissions navigateur refusées | fallback téléchargement, presse-papier et notifications facultatives |


### 10.1 Tests unitaires

Tester d'abord les fonctions pures et les services :

- normalisation des valeurs par défaut ;
- migration `workspace_data` ;
- lecture/écriture Dexie ;
- fusion d'import ;
- validation des payloads ;
- parcours d'arbres ;
- déplacements et anti-cycles ;
- réordonnancement ;
- corbeille et purge à 30 jours ;
- récurrence quotidienne, hebdomadaire et mensuelle ;
- parser d'estimation de temps ;
- filtres de tâches ;
- recherche globale ;
- formatage de dates et fuseaux ;
- exports Markdown, CSV, JSON et ZIP ;
- noms de fichiers sûrs ;
- chiffrement/déchiffrement et mauvais mot de passe ;
- préférences localStorage/sessionStorage avec stockage indisponible.

### 10.2 Tests d'intégration

- ouverture d'une vraie base IndexedDB ;
- migration d'un workspace legacy ;
- round-trip export JSON/import ;
- round-trip avec coffre activé ;
- conservation des fichiers joints ;
- passage legacy -> Angular -> legacy ;
- permissions refusées pour Clipboard, Notification et File System Access ;
- quota proche de la limite ;
- flush après changement de visibilité ;
- import invalide sans modification de la base ;
- changement de route sans perte d'un formulaire en cours.

### 10.3 Tests end-to-end

Avec un profil navigateur persistant :

- démarrage de l'application ;
- navigation topbar et recherche globale ;
- rechargement de toutes les routes profondes ;
- bouton précédent/suivant dans les arbres ;
- création, modification et suppression de chaque domaine ;
- drag and drop souris et clavier lorsque disponible ;
- sélection multiple ;
- import/export ;
- activation, verrouillage et déverrouillage du coffre ;
- récurrence et planification ;
- affichage mobile et raccourcis clavier ;
- fermeture puis réouverture du navigateur ;
- ouverture manuelle de l'URL avec le profil navigateur attendu après connexion et redémarrage.

### 10.4 Tests sécurité

- titres et tags contenant du HTML ;
- Markdown contenant des scripts, URLs dangereuses et images externes ;
- imports avec types incorrects, identifiants dupliqués et arbres cycliques ;
- previews HTML/CSS contenant des scripts ;
- fichiers trop gros ou noms de fichiers avec chemins relatifs ;
- absence de secret en clair dans les exports non prévus, logs et erreurs ;
- lecture d'une route de projet sans coffre déverrouillé ;

## 11. Critères d'acceptation finaux

### Données

- une base `workspace` existante s'ouvre sans perte de sections, identifiants, ordre, dates, fichiers ni secrets chiffrés ;
- la migration depuis `workspace_data` est idempotente ;
- un export JSON complet historique peut être importé ;
- les imports invalides ne modifient aucune donnée ;
- les données Angular restent lisibles par une page legacy pendant la coexistence ;
- aucune écriture simultanée non documentée ne peut écraser silencieusement un cache plus récent.

### Fonctionnel

- CRUD, corbeille et restauration fonctionnent pour chaque domaine ;
- les arbres conservent leur ordre et empêchent les cycles ;
- les tâches récurrentes produisent les mêmes occurrences ;
- dépendances, filtres, vues, rappels et planification restent équivalents ;
- Markdown, wiki-links, snippets, pièces jointes et previews restent utilisables ;
- les raccourcis, modales, notifications best effort et focus restent accessibles au clavier.

### Routage et hébergement

- les anciennes URL ouvrent l'écran correct ou une redirection documentée ;
- les paramètres `id`, `parent`, `folder`, `path`, `focus`, `kind`, `savedView` et filtres restent interprétés ;
- une route Angular profonde se recharge correctement sur GitHub Pages ;
- le `base href` fonctionne en publication et en local ;
- l'artifact CI ne publie pas le dépôt complet après bascule.

### Windows

- l'utilisateur peut ouvrir manuellement l'URL HTTPS avec le profil navigateur souhaité ;
- un redémarrage de Windows ne change pas l'origine ni les données du profil navigateur ;
- aucune installation, tâche planifiée, élévation ou exécution de Node.js n'est nécessaire pour le mode GitHub Pages.

## 12. Rollback et gestion des incidents

Avant chaque phase avec écriture dans la base :

1. exporter le workspace complet ;
2. noter la version du build utilisé ;
3. vérifier que l'export est réimportable dans la version précédente ;
4. ne pas supprimer les pages legacy ;
5. conserver l'URL legacy accessible pour un retour manuel.

En cas de problème :

- arrêter les écritures Angular ;
- conserver l'export et les logs techniques sans données sensibles ;
- revenir à l'URL legacy ;
- réimporter uniquement après analyse, jamais avec un écrasement aveugle ;
- ouvrir une correction ciblée avec une fixture reproduisant le problème ;
- ne supprimer le code legacy qu'après la fin de la période d'observation.

## 13. Découpage de travail recommandé pour les agents

Les analyses préparatoires ont déjà été séparées en deux axes : migration applicative et utilisation Windows. Pour l'implémentation future, répartir les travaux ainsi, avec des contrats explicites :

| Agent ou lot | Responsabilité | Dépendance |
|---|---|---|
| Lot 1 - contrat de données | fixtures, types, adapter Dexie et migration legacy | aucune |
| Lot 2 - shell Angular | bootstrap, layout, thème, routeur et composants communs | socle Angular |
| Lot 3 - services métier | portage des fonctions pures de `storage.js` | contrat de données |
| Lot 4 - fonctionnalités verticales | journal, RH, snippets puis projets/tâches | shell + services |
| Lot 5 - coffre et fichiers | Web Crypto, import/export de fichiers et permissions | contrat de données |
| Lot 6 - CI/CD | build, tests, artifact GitHub Pages, smoke tests | socle Angular |
| Lot 7 - Utilisation Windows | valider ouverture manuelle, profil et persistance navigateur | URL/build final |
| Lot 8 - non-régression | parcours navigateur, compatibilité legacy et rollback | fonctionnalité migrée |

Règles de collaboration :

- un agent ne modifie pas le contrat de données sans fixture et test ;
- un agent ne supprime pas une page legacy avant validation de la route équivalente ;
- un agent ne touche pas au coffre sans test de déchiffrement d'une fixture historique ;
- un agent ne crée pas de nouvelle dépendance pour remplacer quelques fonctions natives ;
- chaque lot produit une note de sortie courte, les fichiers modifiés et les commandes de vérification ;
- les changements transverses sont fusionnés avant les composants de fonctionnalité ;
- les conflits dans `storage.js`, `components.js` et les styles globaux sont traités par un seul responsable.

## 14. Ordre concret de réalisation

L'ordre le plus sûr et le moins coûteux est :

1. confirmer URL, navigateur, routage et mode hors ligne ;
2. créer fixtures et export de référence ;
3. initialiser Angular et la CI sans toucher aux pages legacy ;
4. porter l'adaptateur Dexie et les préférences ;
5. porter les fonctions pures et leurs tests ;
6. porter shell, thème, modales, toasts et recherche ;
7. porter journal ;
8. porter RH ;
9. porter snippets ;
10. porter settings, fichiers, export/import et coffre ;
11. porter projets ;
12. porter tâches ;
13. porter planification ;
14. porter tableau de bord ;
15. tester la coexistence et les anciennes URL ;
16. publier Angular avec artifact dédié ;
17. valider l'ouverture manuelle dans le profil navigateur retenu et la persistance après redémarrage ;
18. observer, puis retirer progressivement le legacy.

## 15. Conclusion

La migration est faisable sans réécrire immédiatement tout le projet, à condition de traiter IndexedDB, les URL et le coffre comme des contrats de compatibilité. Le risque principal n'est pas le passage des templates HTML vers Angular : c'est une perte ou une écrasement de données pendant la coexistence, suivi par les routes GitHub Pages et le rendu de contenu importé.

Le chemin recommandé est donc : **Angular standalone + services typés + Dexie compatible + hash routing initial + migration verticale + GitHub Pages + ouverture manuelle dans le navigateur**.

La variante locale hors ligne doit rester optionnelle. Elle nécessite un serveur statique distribué et une migration d'origine navigateur, alors que la version GitHub Pages s'ouvre directement dans le navigateur sans processus local permanent.
