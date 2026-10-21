# Workspace

Workspace est une application Angular statique pour navigateur. Elle n'a pas de serveur applicatif et n'envoie pas les donnees vers un backend ; elles restent dans IndexedDB du profil navigateur.

## Resume

- Stack: Angular + TypeScript + IndexedDB (Dexie)
- Persistance: base `workspace` (table `kv`) avec cache memoire et flush automatique
- Cible: usage quotidien perso/equipe (taches, projets, RH, snippets, journal)
- Confidentialite: donnees stockees localement dans le navigateur

Le [Wiki GitHub](https://github.com/tanguy-sudo/workspace/wiki) fournit un demarrage rapide complementaire.

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
- Frequence configurable dans Parametres
- Dossier prefere selectionnable via l'API File System Access pour les sauvegardes manuelles (quand supportee)
- Sauvegarde automatique et fallback via telechargement classique du navigateur

### Import/export

- Export workspace complet en JSON, Markdown ou ZIP
- Export par section en JSON/Markdown; CSV pour les taches; ZIP pour les snippets, le journal et les projets
- Import de fichiers JSON uniquement
- Import par fusion; mode ecrasement disponible uniquement pour une sauvegarde complete Workspace

## Raccourcis clavier utiles

| Raccourci                | Action                                                                                     |
| ------------------------ | ------------------------------------------------------------------------------------------ |
| `Ctrl+Espace` / `Ctrl+K` | Ouvrir la recherche globale; `Ctrl+K` sert aussi a inserer un lien dans l'editeur Markdown |
| `Ctrl+N`                 | Creer un nouvel element (selon la page)                                                    |
| `N`                      | Creer un nouvel element (hors champs saisie)                                               |
| `Escape`                 | Fermer modale / palette                                                                    |
| `?` ou `,`               | Afficher l'aide des raccourcis                                                             |
| `g` + lettre             | Navigation rapide (`h`, `t`, `s`, `j`, `p`, `r`, `e`, `n`)                                 |

## Demarrage rapide

Depuis `angular/`, lancer le serveur de developpement Angular :

```powershell
npm ci
npm start
```

Puis ouvrir l'URL affichee par Angular CLI.

## Application et URL

Angular est l'application de production, publiée à la racine GitHub Pages via
`/workspace/app/`, avec routage par hash. Les anciennes URL (`index.html`,
`todos.html`, `project.html?id=...`, etc.) redirigent vers la route Angular
équivalente. Les sources legacy ont été retirées de `main` ; le snapshot
`legacy-rollback-tan58` reste la source du rollback. L'application conserve la
même origine HTTPS, donc les données IndexedDB existantes restent accessibles.

### Rollback GitHub Pages

Depuis l'onglet Actions, lancer `CI/CD` avec `workflow_dispatch`, choisir le
mode `legacy` sur la branche `main` et vérifier le champ `legacy_ref` avant de confirmer. Il doit
pointer vers une branche, un tag ou un commit contenant le site legacy complet et le verrou de coexistence TAN-58
(par défaut `legacy-rollback-tan58`). Ce déploiement remplace le site public par le snapshot legacy ;
pour revenir à Angular (et aux redirections), relancer le workflow en mode `transition`. Un push sur
`main` publie aussi automatiquement le mode `transition` après validation CI.

Ne pas supprimer la branche `legacy-rollback-tan58` : elle est la source du
rollback. Les snapshots plus anciens que TAN-58
peuvent écraser des données si un onglet Angular est resté ouvert ; ne les utiliser
qu'après fermeture de toutes les fenêtres Workspace.

## Structure du dépôt

```text
angular/
  src/app/
  src/styles/
fixtures/
e2e/
```

Pour le développement Angular, les commandes de build et les tests, voir
[`angular/README.md`](angular/README.md). Pour les contrats internes, voir
`ARCHITECTURE.md` et `DATA-CONTRACT.md`.

## Notes techniques

- `angular/package-lock.json` verrouille les dependances de build et de test ;
  un override maintient Vite sur une version corrigée côté dépendance transitive.
- La CI vérifie les builds, tests, sécurité, redirections et parcours navigateur.
