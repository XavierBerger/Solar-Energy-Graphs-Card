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
- Aucun changement de code ou test ne sera fait avant l'accord de l'utilisateur.
- Les tests automatisés ne remplacent pas la vérification visuelle et
  fonctionnelle dans Home Assistant.
