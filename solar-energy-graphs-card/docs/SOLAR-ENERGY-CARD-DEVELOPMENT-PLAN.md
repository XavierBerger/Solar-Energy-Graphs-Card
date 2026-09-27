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
sélecteur de journée inspiré des visualisations Home Assistant : calendrier et
navigation par jour précédent/suivant. Elle ne reprend pas l'interface
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
- [ ] **À planifier** — Ajouter un sélecteur de journée avec un calendrier pour
  choisir une date et des flèches pour aller au jour précédent/suivant. Ne
  proposer ni périodes semaine/mois/année, ni plage horaire personnalisée.
  Initialiser au jour courant du fuseau Home Assistant et empêcher la
  navigation vers le futur. Vérifier si un composant calendrier HA est
  réellement utilisable depuis la carte ; sinon créer un contrôle local simple.
  Afficher tous les points historiques du jour sélectionné, sans downsampling
  ni plafond.

La connexion aux capteurs, la résolution d'une minute et la présentation de la
légende sont implémentées, testées, déployées et validées visuellement dans
Home Assistant.

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

Ajouter au-dessus des deux graphes un sélecteur limité à une journée, composé
d'un calendrier pour choisir la date et de flèches pour aller au jour précédent
ou suivant. Ne proposer ni vues semaine/mois/année, ni plage personnalisée. La
sélection initiale reste le jour courant dans le fuseau HA ; aucun jour futur
ne peut être sélectionné.

- **Choisir le contrôle.** `<ha-date-range-nav>`, utilisé par History et
  Logbook, inclut aussi des heures et est une API interne non documentée pour
  les custom cards. Dans `ha-dev` (HA 2026.9.3), les bundles initiaux ne
  contiennent pas son nom et la vérification d'exécution reste bloquée faute de
  session authentifiée. Ne pas en dépendre sans preuve d'accessibilité dans
  Lovelace. Avant l'implémentation, vérifier si HA expose un composant calendrier
  plus simple ; sinon utiliser un contrôle local léger et stylé selon le thème
  HA.
- **Modéliser la sélection.** Garder une date civile dans
  `hass.config.time_zone`, initialisée à aujourd'hui. Chaque flèche déplace d'un
  jour civil, en gérant les passages de mois et d'année ; désactiver/refuser la
  navigation au-delà d'aujourd'hui.
- **Charger l'historique du jour.** Réutiliser le calcul de bornes et la requête
  journalière `history/period` existants autant que possible. Envoyer les bornes
  de la journée sélectionnée dans le fuseau HA, avec début inclus et fin exclue,
  converties en UTC, et traiter les journées de 23/25 heures. Conserver le
  baseline de dix minutes et la fraîcheur maximale actuels. Recharger après
  chaque changement de date et ignorer les réponses obsolètes si la sélection
  change ou si la carte est déconnectée.
- **Garder la totalité des mesures et la cohérence des graphes.** Afficher tous
  les états historiques disponibles du jour, sans downsampling ni plafond.
  Préserver les règles d'alignement des capteurs, de maintien maximal de dix
  minutes et de trous pour les mesures indisponibles/périmées. Remplacer
  ensemble les deux jeux uPlot, avec axe temporel, curseur et zoom synchronisés.
  Rendre visibles l'absence d'historique et les erreurs de requête.
- **Tester et livrer.** Ajouter des tests Vitest pour le jour initial, les
  flèches, les changements de mois/année, le blocage du futur, fuseau/DST,
  bornes de requête, conservation des points, trous de données et réponses
  obsolètes. Mettre à jour le README, exécuter tests/build dans Podman, déployer
  dans `ha-dev` et demander la validation visuelle avant des commits séparés
  code/tests/documentation.

**Validation :** confirmer dans Lovelace le calendrier, les flèches, la date
active, l'interdiction du futur et les courbes des jours sélectionnés. Les deux
graphes doivent rester alignés. Tests et build ne remplacent pas la validation
visuelle dans `ha-dev`.

## 6. Règles permanentes

- Ne pas inventer les capteurs, les unités ni la sémantique des flux.
- Ne pas ajouter KPIs, statistiques, statut, toolbar générale ni bouton de
  réinitialisation du zoom. Le sélecteur journalier décrit à l'étape 8 est
  désormais inclus dans le périmètre.
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
