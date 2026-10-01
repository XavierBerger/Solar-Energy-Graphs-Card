# Tests de mutation avec Stryker

## Contexte

La couverture dit quelles lignes les tests *exécutent*, pas si les tests
*vérifient* quelque chose. Les tests de mutation répondent à cette deuxième
question. L'outil modifie le code source par petites touches (des « mutants »),
par exemple `<` devient `<=`, `&&` devient `||`, `true` devient `false`, une
chaîne devient `""` ou un bloc est vidé. Il relance les tests sur chaque mutant :

- **tué** : au moins un test échoue, donc le test protège ce comportement ;
- **survivant** : tous les tests passent encore, donc il manque une assertion
  ou le test est vert par construction ;
- **sans couverture** : aucun test n'exécute cette ligne ;
- **équivalent** : le mutant ne change pas le comportement observable. C'est un
  faux positif, qu'on marque explicitement.

Le score de mutation (tués / total) mesure la pertinence des tests. Le travail
utile consiste à examiner les survivants un par un. Cela correspond à l'item
`docs/TODO.md` « Ajouter des tests de mutation pour vérifier que les tests sont
de vrais tests ».

## Dépendance, à valider (règle d'`AGENTS.md`)

- **Besoin** : générer et exécuter les mutants sur le TypeScript avec le runner
  Vitest existant, puis produire un rapport HTML par mutant.
- **Ajout** : `@stryker-mutator/core` et `@stryker-mutator/vitest-runner` en
  devDependencies, à la même version majeure.
- **Alternative sans dépendance** : un script qui applique quelques mutations à
  la main (sed) et relance `npm test`. Il ne couvre qu'une poignée d'opérateurs,
  ne produit pas de rapport et oblige à restaurer les fichiers soi-même. Je la
  déconseille.
- **Impact bundle** : aucun. Ce sont des dépendances de développement, et
  `dist/` reste identique.
- **À vérifier à l'installation** : que la version du runner accepte bien
  Vitest 4.1. Si ce n'est pas le cas, je m'arrête et je te le signale, sans
  contournement.
- **Non retenu pour l'instant** : `@stryker-mutator/typescript-checker`. Il
  écarte les mutants qui ne compilent pas, mais il ajoute une dépendance et
  ralentit l'exécution. On pourra l'ajouter si le rapport contient trop de
  mutants invalides.

## Modifications

1. **`package.json`** : les deux devDependencies, plus le script
   `"mutation": "stryker run"`.
2. **`stryker.config.json`** (nouveau fichier, à la racine de la carte) :
   - `testRunner: "vitest"` ; le runner Vitest impose l'analyse de couverture
     par test, donc chaque mutant ne relance que les tests qui le couvrent ;
   - `mutate` : `src/**/*.ts`, sans `src/**/*.test.ts`, `src/index.ts`,
     `src/uplot-adapter.ts` ni `src/vite-env.d.ts`. Ces trois fichiers ne sont
     que du câblage, à 0 % de couverture parce que les tests les remplacent par
     des mocks ;
   - `reporters: ["clear-text", "progress", "html"]`, avec le rapport HTML dans
     `reports/mutation/mutation.html` ;
   - pas de seuil `break` : la mesure d'abord, un seuil éventuel plus tard.
3. **`dev.sh`** : ajouter l'action `mutation` à la liste et au message
   d'usage, et recopier `reports/mutation` vers `/source`, comme le fait
   l'action `coverage`.
4. **`.gitignore`** : `reports/` et `.stryker-tmp/` (le bac à sable de
   Stryker).
5. **`README.md`** (en français) : un paragraphe `./dev.sh mutation` après
   celui sur la couverture.
6. **`package-lock.json`** : mis à jour par `./dev.sh install`.

Cette tranche ne modifie aucun test ni aucun code source. Elle livre l'outillage
et le premier rapport.

## Vérification

1. `./dev.sh install`, puis `./dev.sh mutation` : le run se termine et
   `reports/mutation/mutation.html` existe.
2. Contrôle de l'outil : dans le rapport, le mutant `<` → `<=` de
   `hasHigherPrecisionSamples` (`src/solar-energy-graphs-card.ts`) doit être
   **tué**, par le test « hides the precision button when no finer history
   exists ». S'il survit, c'est la configuration qui est fausse, pas le test.
3. `./dev.sh test`, `./dev.sh coverage` et `./dev.sh build` restent verts, et
   la taille du bundle ne change pas.
4. Je te transmets le score par fichier, la durée du run et la liste des
   survivants, classés en trois catégories : test manquant, assertion faible,
   équivalent probable.

## Étape suivante (hors de cette tranche, sur ta validation)

Traiter les survivants un fichier à la fois :

- soit un test ciblé, avec son commentaire d'intention en tête ;
- soit, pour un mutant équivalent, `// Stryker disable next-line <mutator>: <raison>`.

Un commit par thème. L'item du TODO ne sera coché qu'après ta confirmation.

## Commits prévus

`build: add Stryker mutation testing`, séparé des deux commits en attente
(`test:` pour les tests de haute précision, `build:` pour la couverture).
