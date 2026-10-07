I am now implementing touch pan with one finger, and ensuring vertical scrolling is respected. I've attached touch event listeners to the graph containers and implemented horizontal panning when a graph is zoomed. I'm also detecting...
  Voici la proposition de plan étape par étape pour résoudre l'issue #4 https://github.com/XavierBerger/Solar-Energy-Graphs-Card/issues/4 (Support touch gestures for graph zooming and panning).

  Le plan est conçu pour avancer de manière progressive, avec pour chaque étape du code livré, des tests unitaires ciblés (Vitest + tests de mutation Stryker) et des consignes de vérification visuelle manuelles dans Home Assistant.
  ──────
  ### Étape 1 : Fonctions pures de calcul des gestes tactiles

  • Fonctionnalité :
      • Ajout/adaptation des fonctions pures de calcul dans energy-charts-renderer.ts :
          • computePinchZoomRange : calcul du zoom horizontal à 2 doigts à partir du point médian et du rapport d'écartement des doigts.
          • Détection de l'orientation du geste (horizontal vs vertical) pour préserver le défilement naturel de la page.

  • Tests unitaires (Vitest) :
      • Tests sans DOM des calculs de zoom par pincement (point pivot, bornage dans la journée, zooms successifs).
      • Invariant : chaque test est précédé d'un commentaire en anglais de 2 lignes maximum.
  • Vérification Home Assistant :
      • Validation automatique via ./dev.sh test. (Pas de changement visuel à tester sur HA lors de cette étape purement mathématique).

  ──────
  ### Étape 2 : Panoramique tactile à 1 doigt (Touch Pan) & défilement vertical de la page

  • Fonctionnalité :
      • Prise en charge des événements touchstart, touchmove, touchend, touchcancel sur les conteneurs des graphiques.
      • Gestion du déplacement horizontal à 1 doigt lorsque le graphique est zoomé : glissement fluide et synchronisé des deux graphiques.
      • Conservation du comportement par défaut (preventDefault() appelé uniquement si le mouvement est principalement horizontal) afin que l'utilisateur puisse continuer à faire défiler la page Home Assistant verticalement.
      • Nettoyage approprié des écouteurs dans destroy().
  • Tests unitaires (Vitest) :
      • Simulation d'événements tactiles à 1 doigt.
      • Vérification de la synchronisation de l'échelle x (setScale) sur les deux cartes et du non-blocage du défilement vertical.
  • Procédure de test Home Assistant :
      1. Construire la carte avec ./dev.sh build et copier dist/solar-energy-graphs-card.js vers /config/www/ sur Home Assistant.
      2. Sur smartphone/tablette ou via l'émulation tactile des outils de développement du navigateur :
	  • Zoomer au préalable (molette ou sélection), puis glisser 1 doigt horizontalement sur l'un des graphiques : vérifier que les deux graphiques défilent ensemble.
	  • Glisser le doigt verticalement depuis le graphique : vérifier que la page Home Assistant défile normalement.


  ──────
  ### Étape 3 : Zoom tactile à 2 doigts (Pinch-to-zoom)

  • Fonctionnalité :
      • Prise en charge du geste multi-touch (2 doigts) sur les graphiques.
      • Zoom/dézoom progressif et fluide centré entre les deux doigts en temps réel pendant le pincement.
      • Synchronisation instantanée entre le graphique supérieur (production/consommation) et le graphique inférieur (échanges réseau).
      • Gestion propre des transitions (passer de 2 doigts à 1 doigt ou interruption touchcancel).
  • Tests unitaires (Vitest) :
      • Simulation d'événements multi-touch à 2 doigts (TouchList).
      • Vérification du zoom arrière/avant et du maintien des bornes de la journée.
  • Procédure de test Home Assistant :
      1. Construire et déployer le bundle sur Home Assistant.
      2. Sur un écran tactile (smartphone ou tablette) :
	  • Écarter ou rapprocher 2 doigts sur l'un des graphiques : vérifier le zoom synchronisé sur les deux graphiques.
	  • Vérifier l'absence d'à-coups lors du relâchement des doigts.


  ──────
  ### Étape 4 : Validation des tests de mutation Stryker & vérification des thèmes

  • Fonctionnalité :
      • Consolidation et élimination de tout mutant survivant généré par le nouveau code (./dev.sh mutation).
      • Vérification visuelle finale sur les thèmes clair et sombre et sur différents types d'écrans (mobile portrait, mobile paysage, tablette).
  • Tests unitaires & Mutation :
      • Score de mutation vérifié avec Stryker sur energy-charts-renderer.ts.
  • Procédure de test Home Assistant :
      • Validation complète des critères d'acceptation de l'issue #4 sur un vrai dashboard Home Assistant.

  ──────
  Dis-moi si ce plan te convient ou si tu souhaites ajuster des étapes avant de commencer la mise en œuvre de l'Étape 1 !

  Le plan est prêt et le projet est dans un état où tous les tests (193/193) passent au vert.

  Dès que tu valides ce plan, nous pourrons attaquer l'Étape 1 !

  Je suis à ta disposition pour lancer la première étape dès que tu m'en donnes le signal !
