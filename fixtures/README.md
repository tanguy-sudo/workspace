# Fixtures de migration

Ces fichiers sont des donnees synthetiques versionnees pour les tests de migration legacy/Angular.

## Fichiers

| Fichier | Usage |
|---|---|
| `workspace-empty.json` | export complet d'un workspace vide |
| `workspace-full.json` | export complet avec toutes les sections, arbres profonds, recurrentes, favoris, activite, corbeille et piece jointe |
| `workspace-with-vault.json` | export complet avec coffre actif et deux secrets chiffres |
| `workspace-legacy-local-storage.json` | valeur brute a placer dans `localStorage["workspace_data"]` |
| `invalid/workspace-cycle.json` | charge volontairement invalide pour tester le refus d'un arbre cyclique |

## Regles de confidentialite

- Toutes les valeurs sont inventees et ne correspondent a aucune personne, URL privee, cle ou mot de passe reel.
- Le mot de passe du coffre de test est `fixture-master-password`.
- Les secrets du fichier `workspace-with-vault.json` sont stockes uniquement sous forme chiffree.
- Ces fichiers sont destines aux tests et ne doivent jamais etre importes dans un workspace personnel.
- Le repertoire `fixtures/` est exclu de l'artifact GitHub Pages par le workflow CI/CD.

## Utilisation legacy

`workspace-full.json` et `workspace-with-vault.json` sont des exports complets au format actuel :

```js
const payload = await fetch("fixtures/workspace-full.json").then((r) => r.json());
// payload.data est la racine Workspace.
```

Pour simuler l'ancien `localStorage`, charger le contenu de `workspace-legacy-local-storage.json` puis executer :

```js
localStorage.setItem("workspace_data", JSON.stringify(legacyObject));
```

Le fichier legacy contient deja l'objet `legacyObject`, pas une chaine JSON doublement encodee.

## Validation

Depuis la racine du projet :

```bash
python3 .github/scripts/validate-fixtures.py
```

Le validateur verifie la structure des exports, les trois types de recurrence, les pieces jointes, les deux secrets chiffres, les sections principales et le rejet de la fixture cyclique.
