# Nouvelles fonctionnalités
- [ ] Créer l'interface de configuration graphique
    - [ ] Choix des 4 entrées
    - [ ] Choix des couleurs des courbes et coloriages
    - [ ] Choix du rapport de taille entre les graphs
- [x] Si une entrée vaut `null` ne pas planter, juste ne pas l'afficher
- [ ] Traduction en Français

# Qualité
- [ ] Corriger les tests qui ne resistent pas à la mutation
    - [ ] `solar-energy-graphs-card.ts` : jamais évalué avant la correction de `vite.config.ts` (score 60 %, 183 survivants, 45 sans couverture)
    - [ ] `energy-charts-renderer.ts` : score 68 %, 153 survivants, 20 sans couverture
    - [ ] `home-assistant-energy-history.ts` : score 84 %, 66 survivants, 10 sans couverture
- [ ] CI: faire tourner les tests à chaque push et mettre à disposition les rapport de coverage dans les artifacts
- [ ] CI: Faire tourner les tests de mutatin à chaque PR et exiger un succès
- [ ] Déplacer le résultat de la couverture de tests dans `reports/coverage`

# Corrections
- [ ] Faire disparaitre le bouton de précision au chargement d'un nouveau jour sans haure définition
- [ ] Clarifier le contrat de signe des quatre capteurs : import/export sont forcés positifs (`Math.max(value, 0)`), production et consommation ne sont pas vérifiées. Documenter la précondition (>= 0) ou représenter les valeurs hors contrat par `null`, sans rectifier silencieusement un capteur
- [ ] Traiter les historiques incomplets ou absents avec un état vide/erreur local au graphique

# Release
- [ ] Finaliser documentation, build de distribution et installation HACS/manuelle de test ; obtenir la validation avant release

# Les évolutions futures après publication de la v1.0
- [ ] Empiler les consommateurs sour forme d'arc en ciel
- [ ] Ajouter un bouton pour afficher/masquer l'arc en ciel
- [ ] Définir l'affichage par défaut, simple/arc en ciel
- [ ] Définit si l'arc en ciel ne doit être affiché par défaut qu'en mode détaillé