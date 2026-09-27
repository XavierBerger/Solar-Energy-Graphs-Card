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
lecture (titres de graphiques, axes, unités, légende et curseur). Elle ne reprend
pas l'interface générale du viewer : KPIs/statistiques, statut, métadonnées,
bandeau d'erreur, barre d'outils ni bouton de réinitialisation du zoom.
Le zoom horizontal et le curseur synchronisé des deux graphiques font partie du
rendu graphique à reproduire.

La source de données de la carte est Home Assistant. Les endpoints et données
propres au simulateur ne sont pas une dépendance de la carte.

## 2. État initial

Le répertoire `solar-energy-graphs-card/` contient actuellement les documents de
planification, mais pas encore le code de la carte. Le plan technique
recommande TypeScript, Lit, Vite, Vitest et uPlot ; le choix du moteur est ici
tranché en faveur de **uPlot**, déjà utilisé par le viewer de référence. La
structure effective du projet et son outillage seront confirmés avant de les
initialiser.

## 3. Règle de progression et validation

Le développement est incrémental. À chaque étape significative :

1. décrire le changement et ses limites ;
2. donner les étapes précises de test dans Home Assistant ;
3. demander à l'utilisateur de vérifier le résultat ;
4. corriger les problèmes constatés ;
5. ne marquer l'étape comme validée et ne poursuivre qu'après confirmation
   explicite de l'utilisateur.

Les tests automatisés et la compilation vérifient le comportement technique ;
ils ne remplacent pas la validation visuelle dans Home Assistant. Une étape
bloquée reste indiquée comme telle dans la TODO list.

## 4. TODO list de développement

Mettre cette liste à jour au fil du développement : passer une tâche à
**En cours** au démarrage, à **Validée** après les tests techniques et la
confirmation utilisateur requise, ou à **Bloquée** en indiquant la raison.
Ajouter les tâches découvertes sans effacer l'historique utile.

- [ ] **À faire** — Confirmer la structure du projet, le build, le chargement
  Lovelace et la méthode de distribution.
- [ ] **À faire** — Créer une carte Lovelace minimale avec deux zones de
  graphique uPlot, sans interface hors graphique.
- [ ] **À faire** — Afficher des données fictives dans le graphique principal :
  production PV, autoconsommation directe et consommation couverte par le
  réseau, avec les aplats et courbes du viewer.
- [ ] **À faire** — Valider le graphique principal dans Home Assistant avant de
  poursuivre.
- [ ] **À faire** — Ajouter le graphique import/export réseau, la ligne zéro,
  puis le curseur partagé et le zoom horizontal synchronisé.
- [ ] **À faire** — Valider le second graphique et les interactions dans Home
  Assistant.
- [ ] **À faire** — Définir avec l'utilisateur les capteurs Home Assistant,
  leurs unités, leur sémantique et la définition des flux représentés.
- [ ] **À faire** — Implémenter l'accès ciblé à l'historique quotidien,
  l'adaptation et la normalisation des données Home Assistant.
- [ ] **À faire** — Connecter les deux graphiques aux données réelles et valider
  valeurs, timestamps, fuseau horaire, unités, signes et granularité.
- [ ] **À faire** — Traiter les historiques incomplets ou absents avec un état
  vide/erreur local au graphique, sans réintroduire de panneau de statut ou de
  KPIs.
- [ ] **À faire** — Tester responsive, thèmes Home Assistant, plusieurs cartes,
  changement de jour et robustesse ; ajouter les tests automatisés adaptés.
- [ ] **À faire** — Finaliser documentation, build de distribution et
  installation HACS/manuelle de test ; obtenir la validation avant release.

Les cases ne sont pas cochées à l'avance : aucune fonctionnalité de la carte
n'est encore implémentée ou validée.

## 5. Étapes d'implémentation

### Étape 1 — Vérifier et initialiser le projet

- Examiner la structure existante avant de choisir ou compléter l'outillage.
- Établir comment le bundle sera chargé comme ressource Lovelace.
- Créer le composant de carte minimal et intégrer uPlot dans le build.
- Éviter d'introduire les données métier ou les éléments de dashboard du viewer.

**Validation :** build réussi et carte chargeable dans Home Assistant.

### Étape 2 — Poser la structure des deux graphiques

Créer les deux conteneurs nécessaires au rendu, avec leurs titres et dimensions.
N'ajouter ni KPIs, ni statistiques, ni statut, ni contrôles de période/zoom
extérieurs aux graphiques.

**Validation :** disposition correcte dans une vue Lovelace, notamment sur
mobile et desktop.

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

### Étape 5 — Définir et normaliser les données Home Assistant

Demander les entités pertinentes plutôt que d'en supposer les noms ou le sens :
production, consommation et, selon la configuration, puissance réseau ou
autoconsommation. Confirmer unités, signe import/export, disponibilité
d'historique et définition de l'autoconsommation avant d'implémenter les
transformations.

Séparer l'accès Home Assistant, la normalisation des points et l'adaptateur
uPlot. Documenter les hypothèses et préserver les timestamps et valeurs
manquantes nécessaires à la représentation.

**Validation :** vérifier les transformations sur des données connues et faire
confirmer les définitions métier avant le branchement des courbes.

### Étape 6 — Relier les données réelles et fiabiliser

- Récupérer seulement l'historique nécessaire pour la journée affichée.
- Comparer les deux graphiques aux valeurs de référence dans Home Assistant.
- Vérifier les unités, fuseaux horaires, changements de jour et signes.
- Traiter données absentes, entités indisponibles et trous d'historique sans
  faire échouer le rendu Lovelace ; rester dans le périmètre graphique.
- Mesurer les coûts de requête, de transformation et de rendu avant d'ajouter
  cache ou réduction des données.

**Validation :** l'utilisateur confirme les résultats pour ses entités avant
tout ajout de fonctionnalités.

### Étape 7 — Qualité, documentation et distribution

Tester le build, les transformations et le cycle de vie des graphiques
(redimensionnement, mises à jour, destruction). Vérifier plusieurs cartes, les
thèmes, les tailles d'écran et le changement de journée. Documenter
l'installation, la configuration des capteurs, les limites et le dépannage,
puis vérifier une installation propre avant la release.

## 6. Règles permanentes

- Ne pas inventer les capteurs, les unités ni la sémantique des flux.
- Ne pas ajouter KPIs, statistiques, statut, toolbar, bouton de zoom ou
  sélection de période : ils sont hors périmètre convenu.
- Conserver une version compilable et les comportements validés à chaque étape.
- Ne pas considérer un test automatisé comme une validation utilisateur.
- Mettre à jour cette TODO list au fur et à mesure, sans marquer comme validé un
  élément dont la confirmation requise n'a pas été reçue.
