# Revue de code — Solar Energy Graphs Card

## 1. Contexte et périmètre

- Dépôt : `XavierBerger/Solar-Router-for-ESPHome-Card`
- Branche revue : `feat/solar-energy-graphs-card`
- Référence : `main`
- Commit analysé : `ebccb120ae40a9e69fce7ac821735149946f5605`
- Écart : 60 commits d'avance sur `main`, sans divergence (`ahead_by=60`, `behind_by=0`).
- Date du commit analysé : 2026-09-27.
- Périmètre : code de la carte, normalisation des données Home Assistant, rendu uPlot, cycle de vie Lit, tests, build/outillage, CI et documentation associée.
- Méthode : lecture du diff complet, des fichiers de la carte, des tests et de la documentation de conception ; contrôle des chemins d'exécution et des invariants métier. La revue est volontairement sceptique : les validations décrites dans le plan ne sont pas considérées comme une preuve suffisante lorsqu'elles ne sont pas automatisées ou reproductibles.

## 2. Synthèse exécutive

La branche présente une base technique solide : séparation raisonnable entre récupération/normalisation des données et rendu, typage TypeScript, tests unitaires substantiels, gestion explicite du fuseau horaire/DST, protection contre les réponses HTTP obsolètes, nettoyage du renderer et synchronisation uPlot.

Cependant, je ne considérerais pas cette branche comme prête pour une release sans corriger au minimum les points suivants :

1. **[Élevé] La CI ne lance ni les tests ni le typecheck/build de `solar-energy-graphs-card/`.** Le workflow ajouté exécute uniquement le simulateur Fronius. Une régression de la carte peut donc être fusionnée avec une CI verte.
2. **[Élevé] Les mises à jour d'état Home Assistant peuvent provoquer des requêtes `history/period` excessives.** La signature inclut `last_updated` et les attributs des quatre capteurs ; chaque changement peut relancer la requête, y compris lorsque l'utilisateur consulte un jour passé. Il n'y a ni debounce ni coalescence.
3. **[Élevé] Le changement de fuseau horaire ne reconstruit pas le renderer uPlot.** Les données sont rechargées avec le nouveau fuseau, mais l'instance existante conserve le callback `tzDate` créé avec l'ancien fuseau. L'axe temporel peut donc afficher les nouvelles données avec une représentation horaire obsolète.
4. **[Moyen] Le groupe de synchronisation uPlot est créé par instance mais n'est pas explicitement désenregistré.** Le renderer détruit les deux charts mais pas le groupe `uPlot.sync`. Si la bibliothèque conserve le groupe global, les montages/démontages répétés peuvent laisser de l'état ou des références inutiles. Cela doit être confirmé contre l'API exacte de la version uPlot utilisée.
5. **[Moyen] La logique métier impose implicitement des conventions de signe.** Import/export sont forcés positifs et seule l'import est inversée pour le second graphe ; production et consommation ne sont pas normalisées de la même manière. Le plan insiste pourtant sur la nécessité de confirmer les conventions des capteurs.
6. **[Moyen] Les erreurs de données sont affichées comme un statut textuel permanent alors que le document technique exclut un panneau de statut.** Ce n'est pas nécessairement fonctionnellement mauvais, mais le périmètre documentaire et l'implémentation ne sont plus parfaitement alignés.
7. **[Moyen] La validation est très orientée mocks/unit tests et ne couvre pas suffisamment les invariants d'intégration Home Assistant/uPlot.** Les tests ne prouvent notamment pas le comportement réel de l'API History, le changement de fuseau avec renderer vivant, ni les performances lors d'une rafale de changements d'états.

## 3. Points positifs

### Architecture

- Le renderer `EnergyChartsRenderer` ne connaît pas l'API Home Assistant.
- La normalisation est isolée dans `home-assistant-energy-history.ts`, ce qui rend les transformations testables sans DOM.
- L'adaptateur uPlot est minimal et évite d'éparpiller les imports de la bibliothèque.
- Les données manquantes restent représentées par `null`, plutôt que transformées silencieusement en zéro.
- Les identifiants d'entités sont configurables et non codés en dur.

### Robustesse des données

- Validation de `device_class=power`, `state_class=measurement` et des unités W/kW.
- Conversion explicite kW -> W.
- Fenêtre de fraîcheur de dix minutes explicitement codée.
- Prise en compte du fuseau Home Assistant et des changements DST.
- Conservation des fractions de seconde au-delà de la milliseconde dans `parseTimestampSeconds`.
- Protection contre les réponses asynchrones obsolètes grâce à `historyRequestId`.

### Cycle de vie UI

- Les deux instances uPlot sont détruites lors de la déconnexion.
- `ResizeObserver` est déconnecté.
- Les callbacks de thème sont conservés sous forme de fonctions stables et la palette est modifiée via l'état du renderer.
- Les deux graphes partagent un groupe de synchronisation et un axe temporel commun.
- La navigation journalière bloque la navigation vers le futur.

### Tests

- La branche contient des tests unitaires dédiés aux trois grandes zones fonctionnelles :
  - normalisation/history ;
  - renderer ;
  - composant Lovelace.
- Les tests couvrent notamment DST, unités, fraîcheur, navigation, réponses obsolètes, thème, redimensionnement, destruction et instances multiples.
- Les tests sont commentés conformément à la règle du plan.

## 4. Constats détaillés

### CR-01 — CI : la carte n'est pas testée

**Sévérité : élevée**

Fichier : `.github/workflows/ci.yml`

Le workflow exécute le job `fronius-simulator` et lance Rust/Node pour le viewer du simulateur, mais aucune étape ne fait :

- `cd solar-energy-graphs-card && npm test` ;
- `npm run typecheck` ;
- `npm run build`.

Le projet contient pourtant explicitement ces scripts dans `solar-energy-graphs-card/package.json`.

**Risque**

Une modification cassant TypeScript, Vitest, Vite ou la carte Lovelace peut être fusionnée avec une CI verte.

**Recommandation**

Ajouter un job indépendant, avec Node 22, `npm ci`, puis `npm run test`, `npm run typecheck` et `npm run build`. Le build doit être testé sur chaque push/PR de la branche, pas uniquement localement dans Podman.

---

### CR-02 — Requêtes History déclenchées par les changements d'état

**Sévérité : élevée**

Fichier : `solar-energy-graphs-card/src/solar-energy-graphs-card.ts`

`loadHistoryWhenNeeded()` construit une signature contenant :

- l'ID de chaque entité ;
- `last_updated` ;
- `state` ;
- `JSON.stringify(state.attributes)`.

La signature est donc différente dès qu'un capteur est mis à jour. Le setter `hass` appelle immédiatement `loadHistoryWhenNeeded()`.

Cela signifie notamment :

- sur le jour courant, plusieurs changements rapprochés peuvent provoquer plusieurs requêtes History ;
- sur un jour passé, les changements actuels des capteurs peuvent quand même provoquer une nouvelle requête du jour historique affiché ;
- des changements d'attributs peuvent aussi déclencher une requête ;
- quatre capteurs qui se mettent à jour séparément peuvent provoquer quatre requêtes successives.

**Risque**

Charge inutile sur Home Assistant et sur la carte, latence accrue, concurrence de requêtes et travail de normalisation/rendu répété.

La protection `historyRequestId` évite l'affichage d'une réponse obsolète, mais ne supprime pas le coût des requêtes obsolètes.

**Recommandation**

Séparer explicitement :

1. changement de période/fuseau/configuration -> requête immédiate ;
2. changement de capteur pendant le jour courant -> rafraîchissement coalescé/debouncé ;
3. changement de capteur alors qu'un jour passé est sélectionné -> ne pas recharger, sauf action explicite de navigation.

Une signature devrait idéalement porter sur les propriétés réellement nécessaires à décider d'un rafraîchissement, pas sur tous les attributs sérialisés.

---

### CR-03 — Changement de fuseau avec renderer déjà créé

**Sévérité : élevée**

Fichiers :
- `solar-energy-graphs-card/src/solar-energy-graphs-card.ts`
- `solar-energy-graphs-card/src/energy-charts-renderer.ts`

Le setter `hass` détecte un changement de `hass.config.time_zone` et réinitialise `selectedDay`. Les nouvelles données sont donc demandées avec le nouveau fuseau.

En revanche, `chartRenderer` n'est pas détruit/recréé.

Le renderer construit son option uPlot une seule fois avec :

`tzDate: (timestamp) => uPlot.tzDate(new Date(timestamp * 1000), timeZone)`

Le `timeZone` reçu au constructeur reste donc celui du premier montage.

**Risque**

Après changement de fuseau Home Assistant, les timestamps peuvent être normalisés avec le nouveau fuseau alors que l'affichage uPlot continue d'utiliser l'ancien fuseau.

**Recommandation**

Lors d'un changement de fuseau :

- invalider la requête en cours ;
- détruire le renderer ;
- remettre `chartRenderer` à `undefined` ;
- recharger les données ;
- recréer les charts avec le nouveau fuseau.

Ajouter un test spécifique avec renderer vivant : créer en fuseau A, changer en fuseau B, vérifier que l'instance de renderer est remplacée et que le callback d'axe utilise B.

---

### CR-04 — Cycle de vie du groupe uPlot sync à vérifier

**Sévérité : moyenne**

Fichier : `solar-energy-graphs-card/src/energy-charts-renderer.ts`

Chaque renderer crée :

`uPlot.sync(`solar-energy-graphs-card-${++nextSyncGroupId}`)`

Le `destroy()` des charts est bien appelé, mais aucun nettoyage du groupe de synchronisation n'est effectué.

**Risque**

Selon l'implémentation de la version uPlot utilisée, le registre global de synchronisation peut conserver des références ou des souscriptions après destruction.

Le risque est particulièrement pertinent avec plusieurs cartes et les montages/démontages répétés de Lovelace.

**Recommandation**

Vérifier l'API uPlot 1.6.32 et encapsuler le groupe sync dans l'adaptateur afin de disposer d'un nettoyage explicite si l'API le permet. Ajouter un test de plusieurs cycles connect/disconnect et plusieurs cartes.

**Vérification (uPlot 1.6.32)**

`destroy()` appelle `sync.unsub(self)` : aucun graphe détruit ne reste référencé. Seul un groupe vide `{ key, plots: [] }` reste dans le registre global `syncs`, un par renderer créé. La fuite est réelle mais négligeable.

---

### CR-05 — Conventions de signe partiellement implicites

**Sévérité : moyenne**

Fichier : `solar-energy-graphs-card/src/home-assistant-energy-history.ts`

`gridImport` et `gridExport` sont transformés par :

`Math.max(value, 0)`

Puis l'import est inversé pour le graphe réseau.

Cette décision suppose que les deux capteurs sont déjà exprimés comme des puissances positives et séparées. C'est cohérent avec le plan final, mais la documentation technique rappelle que les conventions de signe doivent être confirmées.

Production et consommation, elles, ne sont pas protégées contre des valeurs négatives.

**Risque**

Une entité HA correctement classée `power/measurement` mais signée différemment peut produire un graphe faux sans erreur explicite.

**Recommandation**

Documenter comme précondition contractuelle :

- production >= 0 ;
- consommation >= 0 ;
- import >= 0 ;
- export >= 0.

Ou, mieux, valider les valeurs hors contrat et les représenter comme données invalides/null plutôt que les corriger silencieusement.

Ne pas inverser ou rectifier automatiquement un capteur dont la sémantique n'est pas explicitement connue.

---

### CR-06 — Contrat documentaire incohérent sur le statut

**Sévérité : moyenne**

Le document `SOLAR-ENERGY-CARD-TECHNICAL-CONSIDERATIONS.md` exclut un panneau de statut général mais l'implémentation affiche dans chaque graphe un `.chart-status`, notamment :

- `Loading Home Assistant history…` ;
- `Recorded power samples.` ;
- `Error: ... history is unavailable.` ;
- `History loading error: ...`.

Le plan de développement autorise désormais un état vide/erreur local au graphique, donc l'intention fonctionnelle est défendable.

**Recommandation**

Clarifier la documentation : un message local au graphe est autorisé, mais aucun panneau de statut global/KPI ne l'est. Cela évitera une dérive de périmètre future.

---

### CR-07 — Rafraîchissement de données : comportement réel à préciser

**Sévérité : moyenne**

Le renderer fait `chart.setData()` lorsqu'une nouvelle réponse arrive.

C'est efficace par rapport à une reconstruction complète des charts, mais les séries ont des tableaux potentiellement volumineux et le changement de jour remplace la totalité des données.

Ce choix est acceptable pour une journée, mais il n'est pas protégé contre des fréquences d'état élevées.

**Recommandation**

Traiter CR-02 en priorité avant toute optimisation de rendu. Ensuite mesurer :

- nombre de points ;
- durée de la requête ;
- durée de normalisation ;
- durée de `setData`/redraw.

Ne pas introduire de downsampling sans mesure.

---

### CR-08 — Test d'intégration Home Assistant manquant dans la CI

**Sévérité : moyenne**

Les tests unitaires mockent `hass.callApi` et uPlot, ce qui est approprié pour une grande partie du code.

Mais aucun test CI ne vérifie le contrat réel avec :

`history/period/{start}?filter_entity_id=...&end_time=...`

Les tests peuvent donc valider une forme de réponse simulée tout en laissant passer une incompatibilité avec une version réelle de Home Assistant.

**Recommandation**

Ajouter au minimum un test d'intégration léger contre l'instance Home Assistant de développement déjà prévue par le projet, ou une validation automatisée du contrat HTTP sur une fixture représentative générée par Home Assistant.

---

### CR-09 — `stateSignature` utilise tous les attributs

**Sévérité : faible à moyenne**

Le calcul :

`JSON.stringify(state?.attributes)`

rend la décision de rechargement dépendante de l'ensemble des attributs.

**Risque**

Un changement d'attribut non pertinent pour l'historique ou une représentation JSON différente peut invalider le cache logique.

**Recommandation**

Ne garder que les informations nécessaires au rafraîchissement, par exemple `last_updated` et éventuellement l'unité/classe de mesure si celles-ci sont réellement dynamiques.

---

### CR-10 — `showAdjacentDay()` crée une nouvelle closure à chaque render

**Sévérité : faible**

Le template utilise :

`@click=${this.showAdjacentDay(-1)}`

et idem pour +1.

La méthode retourne une nouvelle fonction à chaque rendu.

**Impact**

Faible dans cette carte, mais inutilement allocateur et moins lisible.

**Recommandation**

Définir deux handlers stables, par exemple `previousDay` et `nextDay`, puis les référencer directement dans le template.

---

## 5. Analyse des tests

### Ce qui est bien couvert

Les tests couvrent un ensemble inhabituellement large pour une première implémentation :

- validation de configuration ;
- taille de carte ;
- rendu des deux zones ;
- navigation journalière ;
- impossibilité d'aller dans le futur ;
- conservation du jour sélectionné ;
- réponses asynchrones obsolètes ;
- ratio 70/30 ;
- thème ;
- cycle de vie ;
- instances multiples ;
- unités ;
- historique ;
- DST et normalisation ;
- resize uPlot ;
- destruction.

### Lacunes à ajouter

1. **Changement de fuseau après création du renderer.**
2. **Rafale de changements HA** et nombre de requêtes effectivement émises.
3. **Jour passé + changement d'état live** : aucune requête supplémentaire attendue.
4. **Changement d'attribut sans changement de mesure** : aucune requête supplémentaire attendue.
5. **Réponse History vide/partielle** avec comportement visuel attendu.
6. **Valeurs négatives** des quatre capteurs.
7. **Valeurs `unknown`, `unavailable`, chaîne vide et valeurs non numériques**.
8. **Transitions DST réelles**, notamment une journée de 23 h et une journée de 25 h.
9. **Plusieurs cycles connect/disconnect** afin de détecter une fuite éventuelle du groupe uPlot sync.
10. **Recréation après changement de configuration** : vérifier que les anciennes données et ressources ne sont pas réutilisées de façon incorrecte.
11. **CI** : test du projet de carte réellement exécuté sur une machine propre.

## 6. Qualité du code

### Bonnes pratiques observées

- TypeScript strict et interfaces locales.
- Fonctions pures pour les opérations de dates et de normalisation.
- Constantes nommées pour les règles métier importantes.
- Pas de dépendance au simulateur dans le code de la carte.
- Protection contre les réponses asynchrones périmées.
- Nettoyage du DOM du renderer.
- Commentaires de tests courts et orientés intention.
- Dépendances limitées à Lit/uPlot et à l'outillage nécessaire.

### Améliorations de conception possibles

- Introduire un petit objet de modèle intermédiaire `EnergyPoint[]`, comme prévu dans le document technique, plutôt que de construire directement plusieurs tableaux uPlot dans la fonction de normalisation. Cela rendrait les invariants métier plus explicites et simplifierait les tests.
- Isoler la politique de rafraîchissement des données de la logique de rendu Lit.
- Introduire un type explicite pour le contrat des quatre capteurs afin d'éviter les tuples anonymes répétés.
- Encapsuler la gestion du cycle de vie uPlot sync dans l'adaptateur.
- Éviter les corrections silencieuses de données invalides ; préférer une politique explicite de validation/null.

## 7. Axes d'amélioration priorisés

### P0 — Avant fusion/release

- [ ] Ajouter tests/typecheck/build de la carte à la CI.
- [ ] Corriger/coalescer le déclenchement des requêtes History.
- [ ] Corriger la reconstruction du renderer lors d'un changement de fuseau.
- [ ] Ajouter les tests correspondant à ces trois régressions.

### P1 — Avant release

- [ ] Vérifier et documenter le nettoyage de `uPlot.sync`.
- [ ] Tester les réponses History vides/partielles et les états invalides.
- [ ] Tester les journées DST 23 h / 25 h.
- [ ] Clarifier le contrat de signe des quatre capteurs.
- [ ] Clarifier dans la documentation la notion de statut local au graphique.

### P2 — Amélioration structurelle

- [ ] Simplifier le modèle interne avec `EnergyPoint[]`.
- [ ] Stabiliser les handlers Lit.
- [ ] Mesurer les performances réelles avant toute optimisation de nombre de points.
- [ ] Ajouter une validation d'intégration Home Assistant reproductible.

## 8. Conclusion

La branche montre un effort d'ingénierie sérieux et une bonne couverture unitaire pour une fonctionnalité encore récente. Les aspects les plus convaincants sont la séparation des responsabilités, le traitement des fuseaux/DST, la gestion des données manquantes et la protection contre les réponses asynchrones obsolètes.

Le principal risque n'est pas aujourd'hui un défaut algorithmique évident du tracé ; c'est la combinaison **rafraîchissement trop agressif + absence de couverture CI de la carte + changement de fuseau non propagé au renderer**.

Je recommande de traiter ces trois points avant de considérer la branche comme techniquement stabilisée. Les autres améliorations peuvent ensuite être traitées progressivement sans remettre en cause l'architecture actuelle.

## 9. Références internes

- `solar-energy-graphs-card/src/home-assistant-energy-history.ts`
- `solar-energy-graphs-card/src/energy-charts-renderer.ts`
- `solar-energy-graphs-card/src/solar-energy-graphs-card.ts`
- `solar-energy-graphs-card/src/uplot-adapter.ts`
- `solar-energy-graphs-card/src/*test.ts`
- `solar-energy-graphs-card/package.json`
- `.github/workflows/ci.yml`
- `solar-energy-graphs-card/docs/SOLAR-ENERGY-CARD-DEVELOPMENT-PLAN.md`
- `solar-energy-graphs-card/docs/SOLAR-ENERGY-CARD-TECHNICAL-CONSIDERATIONS.md`
