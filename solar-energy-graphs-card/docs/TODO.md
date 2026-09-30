# Nouvelles fonctionnalités
- [x] zoomer sur l'axe temporelle avec la molette. 
  - [x] Zoom avant pas limité, zoom arrière limité à la journée. 
  - [ ] Le zoom ne se fait qu'à la molette (à finaliser avec le déplacement par press+drag)
- [ ] En zoom, permettre de déplacer le graphe de droite à gauche avec un "press + drag" du bouton gauche de la souris
- [ ] Créer l'interface de configuration graphique
    - [ ] Choix des 4 entrées
    - [ ] Choix des couleurs des courbes et coloriages
    - [ ] Choix du rapport de taille entre les graphs
- [ ] Traduction en Français

# Corrections
- [ ] Clarifier le contrat de signe des quatre capteurs : import/export sont forcés positifs (`Math.max(value, 0)`), production et consommation ne sont pas vérifiées. Documenter la précondition (>= 0) ou représenter les valeurs hors contrat par `null`, sans rectifier silencieusement un capteur
- [ ] Traiter les historiques incomplets ou absents avec un état vide/erreur local au graphique

# Qualité
- [ ] Corriger les 6 tests de `solar-energy-graphs-card.test.ts` qui comptent ou indexent `.day-navigation button` : ils échouent depuis l'ajout du bouton de précision (422eb81)
- [ ] Ajouter la génération de la couverture de tests
- [ ] Ajouter des tests de mutation pour vérifier que les tests sont de vrais tests
- [ ] Tester le bouton haute précision : chargement de l'historique brut, retour en basse précision, masquage quand aucune donnée plus précise n'existe, désactivation pendant le chargement

# Release
- [ ] Finaliser documentation, build de distribution et installation HACS/manuelle de test ; obtenir la validation avant release