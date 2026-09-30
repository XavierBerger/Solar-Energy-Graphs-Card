# Nouvelles fonctionnalités
- [ ] Ne pas changer le zoom quand de nouvelles données arrivent
    - [ ] Conserver le niveau de détail (haute/basse précision) lors de mise à jour. Idéalement ajouter les nouvelles données sans tout recharger
- [ ] zoomer sur l'axe temporelle avec le molette. 
  - [ ] Zoom avant pas limité, zomm arrière limité à la journée. 
  - [ ] Le zoom en se fait qu'à la molette
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
- [ ] Ajouter des tests de mutation pour vérifier que les tests sont de vrais tests

# Release
- [ ] Finaliser documentation, build de distribution et installation HACS/manuelle de test ; obtenir la validation avant release