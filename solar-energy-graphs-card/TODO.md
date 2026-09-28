# A faire avant toute nouvelle modification
- [ ] Revoir les commentaires dans le document de code review

# Bugs constatés
- [ ] La courbe bleue n'est pas affichée quand il n'y a pas de production solaire (production == null ou == 0 ?)
  - [ ] Pour rappel la zone sous la courbe bleu (qui n'est pas de l'autoconso) doit être rouge (entre 0 et la courbe quand il n'y a pas de production solaire)
  - [ ] Ne pas toucher à la partie qui s'affiche quand il ya a de la production, ça marche

# Nouvelles fonctionnalités (à ajouter dans le plan de développement)
- [ ] Sélectionner une date en cliquant sur la date (ouverture d'un calendrier)
- [ ] Ajouter des doubles flèches pour naviguer de 7 jours : `<<` et `>>`
- [ ] zoomer sur l'axe temporelle avec le molette. 
  - [ ] Zoom avant pas limité, zomm arrière limité à la journée. 
  - [ ] Le zoom en se fait qu'à la molette
- [ ] En zoom, permettre de déplacer le graphe de droite à gauche avec un "press + drag" du bouton gauche de la souris
- [ ] Optimiser la vitesse d'affichage
  - [ ] Identifier ce qui prend du temps
  - [ ] Propose des solutions d'accélération
    - [ ] Optionnel: Envisager un affichage progressif pour donner une meilleur experience utilisateur