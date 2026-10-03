# Plan — traiter les mutants `ConditionalExpression`

## Problème et approche

Le rapport Stryker totalise 1 721 mutants répartis entre 17 mutateurs. Le type
qui en génère le plus est `ConditionalExpression` : 411 mutants, soit 323 tués,
87 survivants et 1 timeout. Le fichier `reports/mutation.txt` donne le total
général et détaille les mutants survivants/sans couverture, mais pas le
décompte complet par mutateur. Les totaux ci-dessous sont calculés à partir de
`reports/stryker-incremental.json`, le cache associé à cette exécution.

| Mutateur | Générés | Tués | Survivants | Sans couverture | Timeout |
| --- | ---: | ---: | ---: | ---: | ---: |
| ConditionalExpression | 411 | 323 | 87 | 0 | 1 |
| BlockStatement | 235 | 192 | 22 | 18 | 3 |
| StringLiteral | 193 | 142 | 46 | 5 | 0 |
| EqualityOperator | 177 | 159 | 18 | 0 | 0 |
| ObjectLiteral | 120 | 109 | 9 | 2 | 0 |
| LogicalOperator | 112 | 78 | 34 | 0 | 0 |
| BooleanLiteral | 106 | 93 | 11 | 2 | 0 |
| ArithmeticOperator | 81 | 77 | 4 | 0 | 0 |
| CallExpression | 73 | 52 | 21 | 0 | 0 |
| ArrayDeclaration | 64 | 51 | 13 | 0 | 0 |
| ArrowFunction | 43 | 42 | 1 | 0 | 0 |
| OptionalChaining | 36 | 9 | 27 | 0 | 0 |
| MethodExpression | 35 | 29 | 6 | 0 | 0 |
| Regex | 18 | 17 | 1 | 0 | 0 |
| AssignmentOperator | 8 | 4 | 4 | 0 | 0 |
| UnaryOperator | 7 | 7 | 0 | 0 | 0 |
| UpdateOperator | 2 | 0 | 2 | 0 | 0 |

La tranche proposée traite les 87 survivants `ConditionalExpression`, pas les
323 mutants déjà tués. Ils se répartissent entre `energy-charts-renderer.ts`
(22), `home-assistant-energy-history.ts` (10) et
`solar-energy-graphs-card.ts` (55). Le timeout unique sera examiné pour
confirmer qu'il s'agit bien d'un mutant tué par timeout et non d'un problème de
test instable.

## État après les premiers changements

Après les changements ciblés aux tests et au parsing, l'utilisateur a relancé
Stryker. Le rapport actualisé compte 407 mutants `ConditionalExpression` :
327 tués, 79 survivants et 1 timeout. Les 79 survivants se répartissent entre
`energy-charts-renderer.ts` (18), `home-assistant-energy-history.ts` (8) et
`solar-energy-graphs-card.ts` (53). Le nombre de survivants a diminué de 8 ;
le traitement du mutateur n'est donc pas terminé et l'item de
`docs/TODO.md` reste décoché. L'utilisateur a confirmé que les vérifications
manuelles dans Home Assistant sont bonnes.

Les tests automatisés, le type-check et le build ont été exécutés avec
`./dev.sh` et ont réussi. L'assistant n'a pas lancé de test de mutation ; le
nouveau rapport a été produit par l'utilisateur.

## Étapes

1. Reprendre l'item « Corriger les tests qui ne résistent pas à la mutation »
   de `docs/TODO.md` et examiner les survivants du mutateur choisi, en les
   regroupant par comportement et par fichier.
2. Pour chaque survivant, comparer la condition d'origine à sa variante et
   vérifier le comportement utilisateur ou le contrat concerné. Les zones
   concernées incluent notamment les gardes de cycle de vie et de requêtes
   asynchrones de la carte, la navigation entre jours, les contrôles de zoom /
   déplacement et les conditions de parsing.
3. Pour un comportement important mais insuffisamment vérifié, renforcer le
   bloc de test comportemental existant, avec une entrée et une assertion qui
   rendent la branche mutée observable. Le guide du projet proscrit l'ajout
   d'un nouveau bloc `it`/`test` pour un mutant survivant. Un mutant équivalent
   ne justifie pas un test artificiel : confirmer l'équivalence, puis simplifier
   le code si c'est sûr ou documenter l'exclusion du mutant avec une raison
   précise.
4. Valider les changements avec `./dev.sh test`, `./dev.sh typecheck` et
   `./dev.sh build`. Ne pas lancer `./dev.sh mutation`, Stryker ou un autre
   test de mutation : cette exécution reste à la charge de l'utilisateur.
5. Présenter les résultats et les étapes de vérification manuelle dans Home
   Assistant pour les comportements touchés. Ne pas cocher l'item TODO avant
   les contrôles techniques et la confirmation explicite de l'utilisateur.

## Décisions et limites

- Cette tranche vise uniquement le mutateur ayant le plus grand nombre de
  mutants dans le rapport fourni ; les survivants des autres mutateurs restent
  hors périmètre.
- L'utilisateur a autorisé le traitement des survivants jugés les plus faciles.
- Les tests automatisés ne remplacent pas la vérification visuelle et
  fonctionnelle dans Home Assistant.

## Deuxième tranche — corrections simples

Les changements suivants ciblent quelques survivants simples après accord :

- Le test existant de configuration invalide vérifie désormais aussi qu'un
  identifiant non textuel est rejeté avec le message de configuration, sans
  ajouter de nouveau bloc de test.
- Le rendu du zoom vérifie seulement que `clientX` est fini ; `WheelEvent`
  garantit déjà son type numérique. Les cas `Infinity` et `NaN` conservent le
  repli vers le centre dans le test de zoom existant.
- La largeur de la zone de tracé est testée directement avec `> 0`, et le test
  de zoom vérifie le comportement pour une largeur nulle.
- La normalisation de valeurs statistiques utilise `Number.isFinite` pour
  convertir `null`, `undefined`, NaN et les infinis en `null`; le test existant
  vérifie les lectures finies et invalides.

Validation locale : `./dev.sh typecheck`, `./dev.sh test` (177 tests) et
`./dev.sh build` ont réussi. Le bundle n'a pas de dépendance ajoutée.
Aucun test de mutation n'a été lancé par l'assistant. Le rapport fourni
précédemment ne mesure pas ces dernières modifications ; il faudra que
l'utilisateur relance Stryker s'il souhaite vérifier leur effet sur le nombre
de survivants. Aucun item de `docs/TODO.md` n'est coché.

L'utilisateur a ensuite relancé Stryker et confirmé les vérifications manuelles
Home Assistant. Le nouveau rapport compte 398 mutants
`ConditionalExpression` : 324 tués, 73 survivants et 1 timeout. Les survivants
se répartissent entre le renderer (16), le traitement historique (5) et la
carte (52). Les survivants associés au type de `clientX`, à la largeur positive
du graphique, à la conversion des valeurs statistiques finies/non finies et à
la validation du type d'identifiant configuré ne figurent plus dans la liste.
Le nombre de survivants de ce mutateur a diminué de 6 depuis le rapport
précédent. Le score global est de 81,56 % ; d'autres mutants et le reste des
survivants demeurent hors de cette tranche. Ne pas cocher le TODO global.
