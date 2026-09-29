# Corrections
- [ ] Clarifier le contrat de signe des quatre capteurs : import/export sont forcés positifs (`Math.max(value, 0)`), production et consommation ne sont pas vérifiées. Documenter la précondition (>= 0) ou représenter les valeurs hors contrat par `null`, sans rectifier silencieusement un capteur
- [ ] Remplacer `showAdjacentDay(-1)` / `showAdjacentDay(1)` du template par deux handlers stables (`previousDay`, `nextDay`)
- [ ] Traiter les historiques incomplets ou absents avec un état vide/erreur local au graphique, sans panneau de statut ni KPIs

# Qualité
- [ ] Ajouter la génération de la couverture de tests
- [ ] Ajouter la documentation d'architecture et d'explicatoin du fonctionnement du programme
- [ ] Ajouter des test de mutation pour vérifier que les tests sont de vrais tests
- [ ] Tester une réponse partielle (un capteur absent de la réponse) et le rendu attendu
- [ ] Tester des valeurs négatives sur les quatre capteurs
- [ ] Tester une chaîne vide et des valeurs non numériques dans les états bruts et live
- [ ] Tester la recréation après un changement de configuration : ni anciennes données ni anciennes ressources réutilisées
- [ ] Vérifier le contrat réel des messages WebSocket `recorder/statistics_during_period` et `history/history_during_period` : test d'intégration contre `ha-dev` ou fixture générée par Home Assistant
- [ ] Isoler la politique de rafraîchissement des données (chargement, live, statistiques) de l'élément Lit
- [ ] Remplacer les tuples anonymes des quatre capteurs par un type explicite
- [ ] Tester dans Home Assistant : responsive, thèmes, plusieurs cartes, changement de jour, robustesse

# Release
- [ ] Finaliser documentation, build de distribution et installation HACS/manuelle de test ; obtenir la validation avant release

# Nouvelles fonctionnalités
- [x] Cliquer sur la date pour revenir au jour courant
- [ ] Si des données plus précises sont disponibles, ajouter un bouton haute précision et les charger sur clique
- [ ] Ne pas changer le zoom quand de nouvelles données arrivent
- [ ] zoomer sur l'axe temporelle avec le molette. 
  - [ ] Zoom avant pas limité, zomm arrière limité à la journée. 
  - [ ] Le zoom en se fait qu'à la molette
- [ ] En zoom, permettre de déplacer le graphe de droite à gauche avec un "press + drag" du bouton gauche de la souris
