# Corrections
- [ ] Le champ date doit avoir une taille fixe pour évité de voir les boutons de gauche bouger
- [ ] Faire disparaitre le bouton de précision au chargement d'un nouveau jour sans haure définition
- [ ] Clarifier le contrat de signe des quatre capteurs : import/export sont forcés positifs (`Math.max(value, 0)`), production et consommation ne sont pas vérifiées. Documenter la précondition (>= 0) ou représenter les valeurs hors contrat par `null`, sans rectifier silencieusement un capteur
- [ ] Traiter les historiques incomplets ou absents avec un état vide/erreur local au graphique

# Qualité
- [ ] Corriger les tests qui ne resistent pas à la mutation
    - [ ] `solar-energy-graphs-card.ts` : jamais évalué avant la correction de `vite.config.ts` (score 60 %, 183 survivants, 45 sans couverture)
    - [ ] `energy-charts-renderer.ts` : score 68 %, 153 survivants, 20 sans couverture
    - [ ] `home-assistant-energy-history.ts` : score 84 %, 66 survivants, 10 sans couverture
- [ ] CI: faire tourner les tests à chaque push et mettre à disposition les rapport de coverage dans les artifacts
- [ ] CI: Faire tourner les tests de mutatin à chaque PR et exiger un succès (> 90%)

# Nouvelles fonctionnalités
- [ ] Traduction en Français (Anglais pas défaut - Français si c'est la langue de HA)

# Release
- [ ] Finaliser documentation, build de distribution et installation HACS/manuelle de test ; obtenir la validation avant release

# Les évolutions futures après publication de la v1.0
- [ ] Dans l'interface de configuration graphique
    - [ ] Choix des couleurs des courbes et coloriages
    - [ ] Choix du rapport de taille entre les graphs
- [ ] Définir dans l'interface de configuration toute les entités qui font partie de la consommation (les `consommateurs`)
  - [ ] Ces consommateurs sont dans une liste ordonnée
  - [ ] On peut ajouter autant de consommateurs dans la liste que nécessaire
  - [ ] Chaque element de la lists peut être modifié ou supprimer 
  - [ ] La liste ordonnée peu être réarrangée par drag&drop en attrapant des poignées
  - [ ] A coté de chaque element de la liste une coleur. Cliquer dessus ouvre un color picker
- [ ] Empiler les consommateurs sous forme d'arc en ciel dans l'ordre défini en configuration.
  - [ ] Les couleurs doivent s'empiller par le haut. La partie basse du graphe représentant les consommation inconnues.
- [ ] Déterminer s'il es possible d'afficher les consommateurs dans toutes les définitions. Si oui:
  - [ ] Ajouter un bouton pour afficher/masquer l'arc en ciel des consommateurs
  - [ ] Définir l'affichage par défaut, avec ou sans arc en ciel
  - [ ] Définit si l'arc en ciel ne doit être toujours affiché lors du passage en mode détaillé par défaut qu'en mode détaillé