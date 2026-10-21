# Angular

Package Angular de l'application Workspace. Pour la description fonctionnelle,
le déploiement et le rollback, voir le [README racine](../README.md).

## Commandes

Depuis ce dossier :

```sh
npm ci
npm start
```

`npm run build` produit le site sous `dist/workspace/app/browser/` avec le
`base href` GitHub Pages. `npm test -- --watch=false` lance les tests ;
`npm run verify` regroupe build, tests et vérification TypeScript.
