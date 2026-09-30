# Nouvelles fonctionnalités
- [ ] Créer l'interface de configuration graphique
    - [ ] Choix des 4 entrées
    - [ ] Choix des couleurs des courbes et coloriages
    - [ ] Choix du rapport de taille entre les graphs
- [ ] Si une entrée vaut `null` ne pas planter, juste ne pas l'afficher
- [ ] Traduction en Français

# Qualité
- [ ] Corriger les tests qui ne passent pas (`./dev.sh test`)
- [ ] Corriger les tests qui ne resistent pas à la mutation
- [ ] Déplacer le résultat de la couverture de tests dans `reports/coverage`

# Corrections
- [ ] Faire disparaitre le bouton de précision au chargement d'un nouveau jour sans haure définition
- [ ] Clarifier le contrat de signe des quatre capteurs : import/export sont forcés positifs (`Math.max(value, 0)`), production et consommation ne sont pas vérifiées. Documenter la précondition (>= 0) ou représenter les valeurs hors contrat par `null`, sans rectifier silencieusement un capteur
- [ ] Traiter les historiques incomplets ou absents avec un état vide/erreur local au graphique


# Release
- [ ] Finaliser documentation, build de distribution et installation HACS/manuelle de test ; obtenir la validation avant release