# Workspace

Application de productivite locale cote navigateur: pas de serveur applicatif, pas de build obligatoire et pas d'envoi des donnees Workspace vers un backend. Les pages de code utilisent toutefois Highlight.js et sa feuille de style depuis cdnjs.

## Resume

- Stack: HTML/CSS/JavaScript vanilla + IndexedDB (Dexie)
- Persistance: base `workspace` (table `kv`) avec cache memoire et flush automatique
- Cible: usage quotidien perso/equipe (taches, projets, RH, snippets, journal)
- Confidentialite: donnees stockees localement dans le navigateur

Le [Wiki GitHub](https://github.com/tanguy-sudo/workspace/wiki) fournit un demarrage rapide complementaire.

## Pages principales

| Page | Description |
|------|-------------|
| `index.html` | Tableau de bord (rappels, activite, sante de l'organisation, revue hebdomadaire) |
| `todos.html` | Gestion des taches (vues, filtres, rappels, recurrence, estimation, dependances) |
| `projects.html` | Liste et hierarchie des projets |
| `project.html` | Detail d'un projet (dossiers, items, drag and drop, taches liees, plein ecran) |
| `snippets.html` | Bibliotheque de snippets (dossiers, recherche, langage, tags, favoris) |
| `rh.html` | Notes et documents RH en arborescence, avec tags |
| `journal.html` | Journal date (Markdown, humeur, tags, recherche locale) |
| `smart-planning.html` | Planification par temps, contexte, date, projet et mode |
| `settings.html` | Parametres du site, sauvegardes et coffre de mots de passe |
| `export.html` | Export par section, sauvegarde complete et import JSON |

## Fonctionnalites cle

### Recherche globale

- Palette via `Ctrl+Espace` (ou `Ctrl+K`)
- Filtres supportes: `type:`, `tag:`, `priority:`, `status:`, `context:`, `lang:`, `in:`, `folder:` et recherche exacte `"..."`
- Les resultats couvrent les projets, les items de projets, les dossiers, les fiches RH, les taches et les snippets
- Les resultats naviguent vers la page cible avec focus automatique sur l'element
- Le journal dispose de sa propre recherche locale; ses entrees ne sont pas indexees par la recherche globale

### Taches avancees

- Statuts: a faire, en attente d'information, en cours et termine
- Priorites personnalisables, vues sauvegardees, contexte, tags et rattachement projet
- Champ `Rattache a` (ex: personne ayant signale une anomalie)
- Dependances entre taches
- Recurrence: quotidienne, hebdomadaire (jours choisis), mensuelle (nieme jour de semaine)
- Temps estime acceptant des expressions arithmetiques (ex: `60*5`, `(30+15)*2`)
- Rappels date+heure
- Revue hebdomadaire et planification intelligente

### Projets et secrets

- Items de type lien, memo, info, code et mot de passe
- Vue plein ecran pour les items (dont code et mot de passe)
- Coffre secret optionnel (mot de passe maitre):
	- chiffrement AES-GCM des identifiants/mots de passe
	- derive de cle PBKDF2
	- etat deverrouille stocke en session

### Snippets systeme

Les modeles par defaut sont initialises automatiquement au demarrage.

### Sauvegarde automatique

- Sauvegarde JSON configurable, verifiee au chargement de chaque page lorsque l'intervalle est echu
- Pas de timer de sauvegarde actif en arriere-plan entre deux chargements de page
- Frequence configurable dans `settings.html`
- Dossier prefere selectionnable via l'API File System Access pour les sauvegardes manuelles (quand supportee)
- Sauvegarde automatique et fallback via telechargement classique du navigateur

### Import/export

- Export workspace complet en JSON, Markdown ou ZIP
- Export par section en JSON/Markdown; CSV pour les taches; ZIP pour les snippets, le journal et les projets
- Import de fichiers JSON uniquement
- Import par fusion; mode ecrasement disponible uniquement pour une sauvegarde complete Workspace

## Raccourcis clavier utiles

| Raccourci | Action |
|-----------|--------|
| `Ctrl+Espace` / `Ctrl+K` | Ouvrir la recherche globale; `Ctrl+K` sert aussi a inserer un lien dans l'editeur Markdown |
| `Ctrl+N` | Creer un nouvel element (selon la page) |
| `N` | Creer un nouvel element (hors champs saisie) |
| `Escape` | Fermer modale / palette |
| `?` ou `,` | Afficher l'aide des raccourcis |
| `g` + lettre | Navigation rapide (`h`, `t`, `s`, `j`, `p`, `r`, `e`, `n`) |

## Demarrage rapide

Option 1 (simple): ouvrir `index.html` dans le navigateur.

Option 2 (recommande pour certains navigateurs): lancer un serveur statique local, puis ouvrir `index.html`.

Exemple PowerShell:

```powershell
# Depuis la racine du projet
python -m http.server 8080
```

Puis ouvrir `http://localhost:8080/index.html`.

## Transition Angular

Pendant la migration, le build Angular est publié sous
`/workspace/app/`. La version legacy reste disponible à la racine, notamment
via `index.html`, `todos.html` et les autres pages HTML existantes. Le workflow
GitHub Pages construit Angular puis copie uniquement son artifact de production
dans `app/`; le code source Angular, `node_modules` et les fixtures ne sont pas
publiés.

La route Angular `/export` conserve les exports JSON, Markdown, CSV et ZIP
pendant que `export.html` reste disponible pour le rollback legacy.

### Rollback GitHub Pages

Depuis l'onglet Actions, lancer `CI/CD` avec `workflow_dispatch`, choisir le
mode `legacy` sur la branche `main` et vérifier le champ `legacy_ref` avant de confirmer. Il doit
pointer vers une branche, un tag ou un commit contenant le site legacy complet et le verrou de coexistence TAN-58
(par défaut `legacy-rollback-tan58`). Ce déploiement remplace le site public par le snapshot legacy ;
pour revenir à Angular, relancer le workflow en mode `transition`. Un push sur
`main` publie aussi automatiquement le mode `transition` après validation CI.

Ne retirer les pages legacy de `main` qu'après la recette TAN-61 et la période
d'observation documentée d'au moins 7 jours. Garder le commit legacy référencé par
`legacy_ref` jusqu'à ce que le rollback ait été essayé et que les exports/imports
aient été validés sur la version cible. Les snapshots plus anciens que TAN-58
peuvent écraser des données si un onglet Angular est resté ouvert ; ne les utiliser
qu'après fermeture de toutes les fenêtres Workspace.

## Structure du projet

```text
assets/
  vendor/dexie.min.js
css/
	base.css
	components.css
	layout.css
	pages/
js/
	db.js
	storage.js
	password-vault.js
	global-search.js
	drag-drop.js
	pages/
*.html
```

Pour plus de details techniques (ordre de chargement, modules, patterns), voir `ARCHITECTURE.md`.

## Notes techniques

- `package.json` est minimal et ne pilote pas le runtime de l'application
- Les tests Angular, les checks legacy et le smoke navigateur sont configures pendant la transition
- Le coeur applicatif fonctionne sans transpilation
- Highlight.js est charge depuis cdnjs uniquement sur `project.html` et `snippets.html`
