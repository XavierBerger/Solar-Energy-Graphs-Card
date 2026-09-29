# Plan de développement — Solar Energy Graphs Card

## 1. Objectif et périmètre

Développer une carte Lovelace personnalisée pour Home Assistant, destinée à
visualiser sur une journée les flux de puissance d'une installation solaire.
La référence visuelle et fonctionnelle est le viewer de `fronius-simulator/`.

La carte reprend ses deux graphiques :

1. **Production solaire et décomposition de la consommation** : production PV,
   puissance solaire utilisée directement et part de la consommation couverte
   par le réseau.
2. **Échanges avec le réseau** : export positif et import négatif autour de
   zéro.

La carte n'intègre que ces graphiques et les éléments nécessaires à leur
lecture (titres de graphiques, axes, unités, légende et curseur), ainsi qu'un
sélecteur journalier fait sur mesure, placé en haut à droite, avec la date
affichée et des flèches pour naviguer d'un jour à la fois. Cette étape n'ajoute
ni calendrier ni sélection directe de date. Elle ne reprend pas l'interface
générale du viewer :
KPIs/statistiques, statut, métadonnées, bandeau d'erreur ni bouton de
réinitialisation du zoom. Le zoom horizontal et le curseur synchronisé des deux
graphiques font partie du rendu graphique à reproduire.

La source de données de la carte est Home Assistant. Les endpoints et données
propres au simulateur ne sont pas une dépendance de la carte.

## 2. État initial

Le socle TypeScript/Lit/Vite/uPlot est en place dans
`solar-energy-graphs-card/`. Les tests Vitest/happy-dom s'exécutent dans
l'environnement Podman du projet.

## 3. Règle de progression et validation

Le développement est incrémental. À chaque étape significative :

1. décrire le changement et ses limites ;
2. donner les étapes précises de test dans Home Assistant ;
3. demander à l'utilisateur de vérifier le résultat ;
4. corriger les problèmes constatés ;
5. ne marquer l'étape comme validée qu'après confirmation explicite de
   l'utilisateur.

Les tests automatisés et la compilation vérifient le comportement technique ;
ils ne remplacent pas la validation visuelle dans Home Assistant. Une étape
bloquée reste indiquée comme telle dans la TODO list.

Chaque comportement ou logique ajouté ou modifié doit être couvert par des
tests unitaires ciblés, exécutés avec Vitest et happy-dom dans l'environnement
Podman. Chaque test (`it`/`test`) est précédé d'un commentaire en anglais
d'une ou deux lignes maximum décrivant son objectif. Tous les commentaires de
code restent en anglais ; les README, plans et documents du projet sont rédigés
en français pendant la phase de développement.

## 4. TODO list de développement

Mettre cette liste à jour au fil du développement : passer une tâche à
**En cours** au démarrage, à **Validée** après les tests techniques et la
confirmation utilisateur requise, ou à **Bloquée** en indiquant la raison.
Ajouter les tâches découvertes sans effacer l'historique utile.

- [x] **Validée** — Confirmer la structure du projet, le build, le chargement
  Lovelace et la méthode de distribution. Le socle TypeScript/Lit/Vite/uPlot
  et l'environnement Podman isolé sont initialisés ; build et service du
  bundle par `/local/` dans `ha-dev` sont vérifiés. Le chargement de la carte
  dans Lovelace a été confirmé par l'utilisateur. Dans le formulaire de
  ressource Lovelace, saisir `local/solar-energy-graphs-card.js` sans barre
  oblique initiale ; l'URL HTTP de test conserve `/local/`.
- [x] **Validée** — Ajouter Vitest/happy-dom à l'environnement Podman et
  vérifier le composant Lovelace minimal avec des tests unitaires sur sa
  configuration, sa taille et son rendu. Exécution : `./dev.sh test`.
- [x] **Validée** — Créer les deux zones uPlot responsives, leur cycle de vie,
  leur redimensionnement, la hauteur quasi plein écran et le ratio 70/30.
  La correction de redraw garde les callbacks uPlot stables ; le thème clair
  conserve sa palette et le thème sombre affiche des axes blancs et une grille
  grise fine. Tests/build réussis et rendu visuel validé dans Home Assistant.
- [x] **Validée** — Valider la disposition des deux graphiques, le ratio 70/30,
  la hauteur utilisée et les thèmes clair/sombre dans Home Assistant.
- [x] **Validée** — Afficher des données fictives dans le graphique principal :
  production PV, autoconsommation directe et consommation couverte par le
  réseau, avec les aplats et courbes du viewer. Profil déterministe sur une
  journée ; tests unitaires, build, déploiement et validation visuelle dans
  Home Assistant effectués.
- [x] **Validée** — Ajouter le graphique import/export réseau avec export
  positif, import négatif, ligne zéro et données fictives cohérentes. Synchroniser
  le curseur et le zoom horizontal avec le graphe principal ; tests/build et
  rendu fonctionnel validés dans Home Assistant.
- [x] **Validée** — Garder les légendes des deux graphes dans leurs cadres,
  sans chevauchement des titres ; préserver les valeurs numériques au survol
  et ne montrer que Production solaire, Consommation et Autoconsommation dans
  la légende supérieure, avec l'indicateur `Time` visible comme sur le graphe
  inférieur. Validation visuelle reçue dans Home Assistant.
- [x] **Validée** — Définir quatre capteurs Home Assistant de puissance
  instantanée en W (`power/measurement`) : production PV, consommation de la
  charge, import réseau et export réseau. Import et export sont séparés ; sans
  batterie, autoconsommation estimée par `min(production, consommation)`.
- [x] **Validée** — Lire l'historique journalier des quatre mesures par
  l'API native Home Assistant, convertir kW en W, agréger les valeurs en
  intervalles de cinq minutes, gérer le fuseau HA/DST et alimenter les deux
  graphes. Les 36 tests passent, le typecheck/build réussit et les quatre
  historiques sont disponibles dans `ha-dev`. L'implémentation, ses tests et sa
  documentation sont commitées séparément ; cette première résolution a été
  validée visuellement.
- [x] **Validée** — Augmenter la résolution à une minute sur demande utilisateur.
  La normalisation moyenne les mesures par minute, conserve les valeurs au plus
  dix minutes, puis marque les données périmées comme manquantes. Tests DST,
  agrégation et fraîcheur inclus ; 38 tests et build/typecheck réussis, puis
  validation visuelle reçue dans Home Assistant.
- [x] **Chargée dans Home Assistant** — Configurer les quatre entités Solarnet
  dans le tableau de bord `Énergie Solaire`. Après actualisation du navigateur,
  l'utilisateur a confirmé que l'erreur de configuration avait disparu.
- [x] **Validée visuellement** — Vérifier les courbes des capteurs réels dans
  Home Assistant. Validation utilisateur reçue après actualisation du
  tableau de bord.
- [ ] **À faire** — Traiter les historiques incomplets ou absents avec un état
  vide/erreur local au graphique, sans réintroduire de panneau de statut ou de
  KPIs.
- [ ] **À faire** — Tester responsive, thèmes Home Assistant, plusieurs cartes,
  changement de jour et robustesse ; maintenir les tests unitaires Vitest
  adaptés au comportement du code.
- [ ] **À faire** — Finaliser documentation, build de distribution et
  installation HACS/manuelle de test ; obtenir la validation avant release.
- [x] **Validée** — Développer from scratch un contrôle de navigation
  journalière en haut à droite : date visible et flèches jour précédent/suivant,
  sans calendrier ni sélection de date directe. Initialiser au jour courant HA,
  empêcher la navigation dans le futur et recharger le jour sélectionné. Les
  deux graphes sont synchronisés. La normalisation conserve tous les timestamps
  source sans agrégation ni downsampling ; les 43 tests, le typecheck/build
  Podman et la validation visuelle utilisateur sont réussis.
- [x] **Remplacée par l'étape 10** — Accélérer le chargement de l'historique
  (~4 s pour ~9 000 états × 4 capteurs via REST) sans perdre de point :
  WebSocket `history/history_during_period` au format compressé, une requête
  par capteur en parallèle, affichage progressif. Implémentée et commitée
  (tests/build réussis), non mesurée dans HA ; l'utilisateur a ensuite choisi
  les statistiques 5 min. Voir l'étape 9.
- [x] **Validée** — Afficher les statistiques Recorder 5 min : ligne `mean`
  et bande `min`–`max` sur les quatre capteurs, repli horaire pour les jours
  purgés, prolongation brute en direct pour le jour courant. Remplace la règle
  « tous les points » de l'étape 8. Marqueurs de points uPlot désactivés
  (points blancs sur les intervalles espacés). 71 tests et build Podman
  réussis, validation visuelle utilisateur reçue. Voir l'étape 10.

La connexion aux capteurs, la navigation journalière et la présentation de la
légende sont implémentées, testées, déployées et validées visuellement dans
Home Assistant. Les historiques sont affichés sur tous les timestamps source
disponibles, sans agrégation à la minute.

## 5. Étapes d'implémentation

### Étape 1 — Vérifier et initialiser le projet

- Examiner la structure existante avant de choisir ou compléter l'outillage.
- Établir comment le bundle sera chargé comme ressource Lovelace : le script
  `solar-energy-graphs-card/dev.sh deploy` construit dans Podman puis copie le
  bundle dans `docker/ha-config/www/`, servi par `ha-dev` sous `/local/`.
- Utiliser `solar-energy-graphs-card/dev.sh install` pour générer le lockfile
  dans le conteneur ; le volume Podman conserve les dépendances entre
  exécutions, sans créer de `node_modules` sur l'hôte. Utiliser `build`,
  `typecheck` ou `deploy` pour les commandes correspondantes.
- Créer le composant de carte minimal et intégrer uPlot dans le build.
- Éviter d'introduire les données métier ou les éléments de dashboard du viewer.

**Validation :** build réussi, bundle servi par `/local/` et carte chargeable
dans l'instance `ha-dev` après ajout manuel de la ressource
`local/solar-energy-graphs-card.js` (sans barre oblique initiale dans le champ
de ressource) et d'une carte
`type: custom:solar-energy-graphs-card`. Attendre la confirmation explicite de
l'utilisateur avant de passer à l'étape suivante.

### Étape 2 — Poser la structure des deux graphiques

Créer les deux conteneurs nécessaires au rendu, avec leurs titres et dimensions.
N'ajouter ni KPIs, ni statistiques, ni statut, ni contrôles de zoom extérieurs
aux graphiques. Le sélecteur temporel ajouté au périmètre est traité à l'étape 8.

**Validation :** tests unitaires de présence des deux conteneurs, cycle de vie,
instances multiples, destruction, redimensionnement, ratio 70/30 et couleurs de
thème réussis ; l'utilisateur confirme la hauteur utilisée et la lisibilité
dans la vue Lovelace en thèmes clair et sombre, sur desktop et mobile, avant de
poursuivre.

### Étape 3 — Reproduire le graphique principal avec des données fictives

Intégrer par étapes les séries du viewer :

- production solaire ;
- consommation totale ;
- autoconsommation directe ;
- consommation alimentée par le réseau, représentée en complément de
  l'autoconsommation directe.

Reproduire les remplissages, couleurs, axes temporel et de puissance, unités,
grille, curseur et légende utiles à ce graphique. Les données restent
explicitement fictives à cette étape.

**Validation :** comparer le graphe avec le viewer, puis faire valider son rendu
dans Home Assistant.

### Étape 4 — Reproduire les échanges réseau

Ajouter le second graphique avec l'export au-dessus de zéro et l'import
au-dessous, sa propre échelle de puissance, sa ligne zéro et ses styles du
viewer. Synchroniser le curseur et le zoom horizontal avec le graphique
principal. Le bouton du viewer qui réinitialise le zoom reste exclu.

**Validation :** confirmer l'orientation des signes, l'alignement temporel,
l'interaction synchronisée et le rendu responsive.

### Étape 5 — Définir et normaliser les données Home Assistant — Implémentée

Les entrées convenues sont des mesures instantanées en W de production PV,
consommation de charge, import réseau et export réseau. La carte valide les
métadonnées, prend en charge W/kW, lit `history/period` dans le fuseau de HA,
agrège par intervalles d'une minute et garde les valeurs manquantes pour les
historiques absents ou périmés. L'autoconsommation est estimée par
`min(production PV, consommation de la charge)`, sans prise en compte d'une
batterie. Les imports et exports proviennent de capteurs distincts.

Code, tests et documentation sont livrés en commits séparés. Les tests de
normalisation couvrent fuseau/DST, unités, agrégation, autoconsommation,
import/export et données manquantes.

### Étape 6 — Relier les données réelles et fiabiliser — Validée

- [x] Récupérer l'historique nécessaire pour la journée affichée.
- [x] Comparer visuellement les graphiques aux données dans Home Assistant.
  L'utilisateur a confirmé la validation après actualisation du navigateur ;
  l'erreur de configuration précédente venait du cache.
- Traiter données absentes, entités indisponibles et trous d'historique sans
  faire échouer le rendu Lovelace ; rester dans le périmètre graphique.
- Les longues plages peuvent augmenter la durée des requêtes et du rendu ; tous
  les points retournés par Home Assistant restent affichés selon le choix de
  l'utilisateur, sans réduction silencieuse.

Les cas de robustesse et les optimisations éventuelles restent des tâches de
qualité complémentaires ; ils ne bloquent pas la validation du branchement
actuel.

### Étape 7 — Qualité, documentation et distribution

Tester le build, les transformations et le cycle de vie des graphiques
(redimensionnement, mises à jour, destruction) avec des tests unitaires
Vitest/happy-dom, en plus des validations manuelles Home Assistant. Vérifier plusieurs cartes, les
thèmes, les tailles d'écran et le changement de journée. Documenter
l'installation, la configuration des capteurs, les limites et le dépannage,
puis vérifier une installation propre avant la release.

### Étape 8 — Intégrer la navigation journalière

Créer from scratch un contrôle compact placé dans le coin supérieur droit,
affichant la date active et deux flèches pour naviguer vers le jour précédent ou
suivant. Cette première version ne contient ni calendrier, ni date-picker, ni
sélection directe d'une date. Le jour courant du fuseau HA est l'état initial ;
il est impossible de naviguer dans le futur.

- **Représenter la date civile.** Stocker le jour actif sous forme
  `YYYY-MM-DD`, calculé et interprété dans `hass.config.time_zone`. Les flèches
  changent d'un jour civil, y compris aux changements de mois/année et de DST.
  Afficher une date lisible en anglais. Désactiver la flèche suivante lorsque
  le jour affiché est aujourd'hui.
- **Recharger l'historique.** Calculer début du jour et début du jour suivant
  dans le fuseau HA, convertir en UTC pour `history/period`, préserver la
  baseline de dix minutes et la fraîcheur maximale déjà approuvée. Une
  navigation déclenche une nouvelle requête ; des changements HA ordinaires ne
  réinitialisent pas la sélection. Ignorer les réponses obsolètes après une
  navigation ou la déconnexion de la carte.
- **Conserver tous les points.** Retirer l'agrégation/moyenne artificielle par
  minute et utiliser les timestamps source distincts disponibles sur la journée
  comme axe x partagé. À chaque timestamp, aligner les quatre capteurs sur leur
  dernière mesure connue, appliquer le plafond de fraîcheur de dix minutes,
  traiter les états invalides comme des trous et recalculer les séries dérivées.
  Passer explicitement `significant_changes_only=0` à l'API History, dont le
  défaut exclut certains changements d'état. Omettre aussi
  `minimal_response`, qui peut dédupliquer des entrées identiques ; garder
  `no_attributes` pour retirer uniquement les attributs inutiles. Préserver les
  fractions de timestamp au-delà des millisecondes afin de ne pas fusionner des
  points source rapprochés. Aucun downsampling ni plafond de points.
- **Synchroniser et signaler.** Mettre à jour les deux graphes ensemble tout en
  conservant l'axe partagé, le curseur et le zoom synchronisés. Garder les
  statuts d'erreur/historique absent visibles dans leurs zones de graphique.
- **Tester et livrer.** Tester le jour initial, date affichée, navigation,
  désactivation au jour courant, changements de mois/année, fuseau/DST,
  requêtes journalières, timestamps source complets, trous/fraîcheur et réponses
  obsolètes. Mettre à jour le README, exécuter tests/build dans Podman, déployer
  dans `ha-dev`, puis demander la validation visuelle avant les commits séparés
  code/tests/documentation.

**Validation :** confirmer dans Lovelace la position en haut à droite, la date,
les deux flèches, l'impossibilité d'aller dans le futur, le changement
d'historique et la cohérence des graphes. Aucun calendrier ou choix direct
d'une date n'est attendu dans cette version.

### Étape 9 — Accélérer le chargement de l'historique

Le chargement REST `history/period` des quatre capteurs (~9 000 états chacun)
prend environ 4 s. L'API History ne sous-échantillonne pas et la règle « tous
les points » de l'étape 8 reste en vigueur : on réduit le poids de chaque
point, pas leur nombre.

- **WebSocket compressé.** Remplacer la requête REST par
  `history/history_during_period` (`significant_changes_only: false`,
  `minimal_response: false`, `no_attributes: true`, même fenêtre et même
  baseline de dix minutes). Chaque état arrive sous la forme
  `{ "s": "1234", "lu": 1759140000.123456 }` (`lc` seulement s'il diffère) au
  lieu de `entity_id`, `attributes` et deux dates ISO.
- **Parallèle et progressif.** Une requête par capteur, envoyées ensemble.
  Chaque réponse est projetée et dessinée dès son arrivée ; les états live
  reçus pendant le chargement sont conservés s'ils sont plus récents que
  l'historique. Le statut « Loading » reste affiché tant qu'une requête est en
  attente ; une erreur n'est signalée qu'une fois toutes les requêtes
  terminées, sans retirer les capteurs déjà reçus. Les réponses obsolètes
  restent ignorées.

**Validation :** dans DevTools → Network → WS, comparer taille et durée des
quatre réponses à l'ancienne requête REST ; vérifier l'apparition progressive
des courbes, leur identité avec l'affichage précédent (jour courant et jour
passé), la navigation pendant un chargement et les mises à jour live.

### Étape 10 — Statistiques 5 min : moyenne et bande min/max — Validée

Décision utilisateur : remplacer l'historique brut par les statistiques du
Recorder (~288 intervalles par capteur et par jour au lieu de ~9 000 états).
La règle « tous les points » de l'étape 8 est abandonnée.

- **Source.** `recorder/statistics_during_period` avec `types: mean, min, max`
  et `units: { power: "W" }`, en périodes `5minute` et `hour` envoyées en
  parallèle. Pour chaque capteur, les intervalles horaires ne comblent que la
  partie du jour antérieure au premier intervalle 5 min (jours purgés au-delà
  de `purge_keep_days`, 10 jours par défaut).
- **Rendu.** Chaque intervalle est placé en son milieu. Les aires existantes
  (production, autoconsommation, consommation non couverte, export/import)
  utilisent `mean` ; une bande pâle `min`–`max` est ajoutée pour production,
  consommation, export et import. Entre deux points, la valeur de
  l'intervalle qui les contient est maintenue ; un intervalle manquant laisse
  un trou.
- **Jour courant.** Après le dernier intervalle clôturé, la ligne est
  prolongée par les états bruts (15 dernières minutes d'historique puis états
  live), sans bande. Les statistiques sont rechargées 30 s après chaque
  frontière de 5 min, le temps que HA les compile.
- **Statuts.** « Loading » jusqu'à la fin des requêtes ; toute requête en
  échec est signalée sans retirer les données reçues.

**Validation :** vérifier dans Lovelace la ligne moyenne et les bandes sur les
deux graphes, un jour passé récent, un jour de plus de 10 jours (horaire), la
prolongation en direct et le rafraîchissement toutes les 5 min.

## 6. Règles permanentes

- Ne pas inventer les capteurs, les unités ni la sémantique des flux.
- Ne pas ajouter KPIs, statistiques, statut, toolbar générale ni bouton de
  réinitialisation du zoom. La navigation journalière fléchée décrite à
  l'étape 8 est désormais incluse dans le périmètre.
- Conserver une version compilable et les comportements validés à chaque étape.
- Couvrir les comportements et logiques du code par des tests unitaires ciblés ;
  un changement de code ne peut pas être considéré comme techniquement validé
  sans exécuter les tests pertinents.
- Décrire en anglais le but de chaque test par un commentaire immédiatement
  précédent de deux lignes maximum. Tous les commentaires de code sont en
  anglais.
- Rédiger README, plans et documentation en français pendant la phase de
  développement.
- Ne pas considérer un test automatisé comme une validation utilisateur.
- Mettre à jour cette TODO list au fur et à mesure, sans marquer comme validé un
  élément dont la confirmation requise n'a pas été reçue.
