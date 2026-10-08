# Audit sécurité et accessibilité Angular

Date de l'audit : 2026-09-03
Périmètre : application Angular publiée sous `/workspace/app/` et contrôles
des pages legacy qui restent publiées pendant la coexistence.

## Résultat

- XSS : contenu Markdown et previews nettoyés ; aucune preview n'autorise les scripts.
- Pièces jointes : preview limitée aux signatures PNG, GIF, JPEG, WebP et PDF ; les autres fichiers sont téléchargés. Les PDF sont affichés dans une iframe avec `sandbox` vide.
- URLs : seuls `http`, `https` et `mailto` sont acceptés ; les schémas actifs, URLs protocol-relative, caractères de contrôle et credentials sont refusés.
- Imports : validation avant écriture, limite de 16 MiB, chaînes limitées à 1 000 000 caractères, arbres limités à 64 niveaux, pièces jointes limitées à 4 MiB et paramètres PBKDF2 bornés entre 100 000 et 1 000 000 itérations.
- Coffre : format legacy conservé, AES-GCM/PBKDF2 inchangé, secrets absents du DOM tant que le coffre est verrouillé et aucune valeur sensible n'est envoyée dans les logs applicatifs.
- Ressources tierces : Google Fonts supprimé ; Highlight.js legacy reste versionné sur cdnjs avec SRI SHA-384.
- Publication : l'artefact exclut `angular/`, fixtures, `node_modules` et exports `workspace-*.json`, puis vérifie la CSP générée.
- Clavier : skip link, focus visible, respect de `prefers-reduced-motion`, roving focus de l'arbre, interactions clavier des items, et piège/restauration du focus des dialogues Angular.
- Fallbacks : Clipboard, Notification et File System Access restent facultatifs ; les parcours de repli sont testés sans exposer les données.

## Politique CSP Angular

Le build Angular génère automatiquement une CSP meta via `security.autoCsp` :

```text
default-src 'self'; base-uri 'self'; object-src 'none'; form-action 'self'; frame-ancestors 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; frame-src 'self' blob:; child-src 'self' blob:; connect-src 'self'; font-src 'self';
```

La politique générée contient le hash du loader inline du build et bloque les
objets exécutables. Le script inline de thème a été déplacé dans le bootstrap
TypeScript. Les styles runtime sont contrôlés par la configuration de build.

La CSP meta couvre le chemin Angular. Les headers HTTP de GitHub Pages et les
pages legacy feront l'objet de la bascule de publication ; les ressources
legacy Highlight.js sont néanmoins contrôlées par SRI.

## Coffre et modèle de menace

Le coffre protège les identifiants des items password, pas toutes les données
Workspace. Quand la session est déverrouillée, la clé AES est temporairement
présente dans `sessionStorage` pour conserver la compatibilité legacy. Un XSS
exécuté dans la même origine peut donc lire cette clé pendant cette session.
Cette limite est acceptée ; elle ne doit pas être présentée comme une isolation
contre un script same-origin compromis.

Un export JSON complet est lossless et peut contenir des secrets en clair si le
coffre est désactivé. Les exports lisibles Markdown, CSV et fichiers individuels
omettent les secrets. Les exports doivent rester hors du dépôt et ne doivent
pas être joints aux artifacts CI.

## Accessibilité vérifiée

- landmarks : un seul `main` dans le shell Angular ; sections métier dans le contenu ;
- navigation : skip link, liens et boutons natifs, noms d'actions contextuels ;
- dialogues : `role=dialog`, `aria-modal`, titre, focus initial, boucle Tab et restauration ;
- arbres : `treeitem`, niveau/position, clavier et bouton interne retiré de l'ordre Tab ;
- état : onglets de rappels reliés à leur panneau par `aria-controls` ;
- contenu : wiki-links activables avec Entrée/Espace ;
- affichage : focus visible, contraste renforcé des textes secondaires et mouvement réduit.

## Vérifications

```text
npm run verify                         # build + 180 tests + TypeScript
npm audit --registry=https://registry.npmjs.org --audit-level=high
node --check js/drag-drop.js
node --check js/pages/export-import.js
node --check js/pages/project.js
node --check js/pages/snippets.js
python3 .github/scripts/check-security-controls.py
python3 .github/scripts/check-angular-transition.py
```

Le build de production mesure actuellement un bundle initial référencé de 513,6 kB. Le
budget informatif est fixé à 550 kB et le budget bloquant à 1 MB. Les styles
de composants sont bornés à 11 kB en avertissement et 12 kB en erreur ; le plus
grand style mesuré est `project-detail.component.css` à environ 10,18 kB.

La mesure reproductible est disponible avec :

```text
cd angular
npm run measure:performance
```

Le quota navigateur est affiché dans `/settings` et `/export`. `navigator.storage.estimate()`
est utilisé lorsqu'il est disponible ; l'interface signale un usage supérieur à
70 %. Le seuil opérationnel est de préparer un export à 70 %, puis de traiter
un usage supérieur à 85 % comme critique. Les navigateurs sans estimation
exposent `—` et conservent l'export manuel disponible.

## Écarts acceptés

- Les pages legacy conservent des scripts inline historiques ; le chemin Angular ne les charge pas.
- Highlight.js legacy est encore distant, mais sa version et son intégrité sont contrôlées par SRI ; un auto-hébergement complet reste possible avant la publication finale.
- La coordination multi-onglets legacy/Angular n'est pas livrée ; elle relève de TAN-58.
- Les tests multi-navigateurs et Task Scheduler restent hors périmètre de TAN-51.
