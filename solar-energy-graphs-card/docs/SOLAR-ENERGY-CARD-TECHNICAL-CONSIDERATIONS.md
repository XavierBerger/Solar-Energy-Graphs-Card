# Considérations techniques — Solar Energy Graphs Card

## 1. Objectif

Afficher rapidement dans Home Assistant les deux graphiques de puissance du
viewer Fronius, sans embarquer le reste de son dashboard. Privilégier une
architecture simple, des requêtes d'historique ciblées et le moteur uPlot déjà
utilisé dans le viewer.

Le périmètre visuel est limité à :

1. production PV et décomposition de la consommation en solaire direct et
   apport réseau ;
2. import et export réseau autour d'une ligne zéro.

Les titres/axes/unités, remplissages, légende et curseur appartiennent aux
graphiques. Les KPIs, statistiques quotidiennes, métadonnées, statut, bandeau
d'erreur, toolbar, commande externe de zoom et sélection de période sont exclus.
Un état vide ou une erreur nécessaire à la compréhension des données reste
local au graphique.

## 2. Stack et distribution

| Besoin | Choix recommandé |
|---|---|
| Langage | TypeScript |
| Composant Lovelace | Web Component |
| Réactivité / templating | Lit |
| Graphiques temporels | uPlot |
| Accès aux données | Contexte Home Assistant et API historique/WebSocket ciblée |
| Build | Vite |
| Tests unitaires | Vitest avec happy-dom pour les tests du composant Lit |
| Distribution | Bundle JavaScript compact, chargeable comme ressource Lovelace |

Le dépôt de la carte ne contient actuellement que ses documents de planification.
Confirmer l'outillage et les contraintes de distribution lors de l'initialisation
avant d'ajouter des dépendances. Ne pas remplacer uPlot par du SVG : le viewer
de référence utilise déjà uPlot et son comportement doit être reproduit.

## 3. Référence de rendu : les deux graphiques du viewer

### Graphique principal

- Série de production solaire PV.
- Série de consommation électrique.
- Aplat de production et décomposition de la consommation en solaire direct et
  apport réseau.
- Axe temporel de journée et axe de puissance en watts.
- Grille, curseur et légende cohérents avec les séries affichées.

Le viewer dérive le solaire direct à partir des puissances PV et de
consommation, et l'apport réseau à partir du signal réseau. Ces équations ne
doivent pas être considérées comme la définition universelle des capteurs de la
carte : confirmer d'abord la disponibilité, la convention de signe et la
sémantique des entités Home Assistant de l'utilisateur.

### Graphique des échanges réseau

- Export tracé au-dessus de zéro.
- Import tracé au-dessous de zéro.
- Ligne de référence à zéro et axe de puissance en watts.
- Même base temporelle que le graphique principal.
- Curseur et zoom horizontal synchronisés entre les graphiques.

Le bouton « Réinitialiser le zoom » du viewer est un contrôle externe et n'est
pas repris. Le zoom horizontal par glissement et le curseur font partie du
comportement des graphiques.

## 4. Architecture des données et du rendu

Le renderer ne doit pas appeler directement Home Assistant. Normaliser les
données en un modèle indépendant de la source, puis les convertir vers le format
attendu par uPlot.

```ts
interface EnergyPoint {
  timestamp: number;
  productionW: number | null;
  consumptionW: number | null;
  solarToLoadW: number | null;
  gridImportW: number | null;
  gridExportW: number | null;
}
```

```text
Home Assistant history / states
              ↓
        Data provider
              ↓
      EnergyPoint[] normalisés
              ↓
        uPlot adapter
          ↙       ↘
  graphe principal  graphe réseau
```

Un point commun de timestamps permet de garder les deux graphes alignés et de
synchroniser le curseur. Les valeurs absentes restent représentables comme
valeurs manquantes au lieu d'être silencieusement confondues avec une puissance
nulle.

## 5. Données Home Assistant

- Utiliser le contexte `hass` pour les états déjà disponibles.
- Utiliser le mécanisme natif d'historique/statistiques le plus adapté aux
  capteurs confirmés, avec une fenêtre limitée à la journée affichée.
- Ne pas réutiliser `/simulation/day` ni dépendre du format du simulateur.
- Confirmer les entités, unités, horodatages, fuseaux horaires, convention de
  signe et historique disponible avec l'utilisateur.
- Définir explicitement comment dériver l'autoconsommation si aucun capteur
  dédié n'existe ; ne pas appliquer automatiquement les hypothèses du
  simulateur.
- Présenter les erreurs et données indisponibles sans planter la carte, dans la
  zone concernée par le graphique.

Éviter le polling avec `setInterval`. Ne requêter que lorsqu'une configuration,
une période ou une source change, ou utiliser le mécanisme réactif de Home
Assistant pertinent.

## 6. Rendu efficace et cycle de vie

- Créer et détruire proprement les deux instances uPlot.
- Observer le redimensionnement des conteneurs et ajuster la taille des graphes.
- Pour la présentation de la carte, utiliser une hauteur quasi plein écran sous
  l'en-tête Home Assistant, avec une grille verticale de 70 % pour le graphe
  supérieur et 30 % pour le graphe inférieur.
- Définir explicitement les couleurs des axes, graduations et grilles uPlot à
  partir des variables du thème Home Assistant : le canvas uPlot ne récupère
  pas automatiquement les couleurs CSS du thème. Rafraîchir les couleurs quand
  le thème change, sans redessiner si elles sont identiques.
- Synchroniser le curseur et les échelles temporelles sans provoquer de mises à
  jour circulaires ou de reconstructions inutiles.
- Éviter de recalculer l'historique lors d'un changement d'état sans rapport.
- Charger les ressources uPlot selon la stratégie de bundle Lovelace du projet
  et vérifier que CSS et JavaScript sont inclus une seule fois.
- Mesurer récupération, parsing, normalisation et rendu avant d'ajouter cache ou
  réduction des points.

## 7. Tests et validation

Tests automatisés à ajouter selon la structure finale du projet :

- Tester les deux conteneurs de graphes, leurs titres, le cycle de vie de leur
  renderer, le redimensionnement, les instances multiples et leur destruction.
- Tester le ratio 70/30, les couleurs du thème appliquées aux axes/grilles et
  leur rafraîchissement quand Home Assistant change de thème.
- normalisation et alignement temporel des points ;
- calcul des séries dérivées et conventions de signe ;
- gestion de trous et données indisponibles ;
- formes des données fournies aux deux graphiques ;
- synchro temporelle, redimensionnement et destruction autant que le runner le
  permet.

Tout comportement ou logique ajouté ou modifié doit être couvert par des tests
unitaires ciblés. Les tests sont exécutés avec Vitest dans l'environnement
Podman du projet ; happy-dom sert aux tests du composant Lit, tandis que les
fonctions pures restent testées sans DOM lorsqu'il est possible. Simuler les
frontières Home Assistant et uPlot afin de tester le comportement de la carte,
pas l'implémentation interne de ses dépendances. Chaque test possède juste
avant lui un commentaire de but en anglais de deux lignes maximum. Tous les
commentaires de code sont en anglais ; la documentation et les plans restent
en français pendant la phase de développement.

Les tests manuels dans Home Assistant vérifient la parité visuelle avec le
viewer, la lisibilité des unités, les interactions tactiles, le responsive, les
thèmes et le comportement avec les entités réelles. Chaque étape importante
reste en attente de validation explicite de l'utilisateur avant la suivante.

## 8. Gestion des dépendances et performance

Avant d'ajouter une dépendance, déterminer le besoin concret, l'alternative sans
dépendance et l'impact sur le bundle. Garder uPlot pour les graphiques et éviter
un second moteur ou un framework applicatif supplémentaire.

Ne pas optimiser prématurément. Mesurer la quantité de données, le temps de
récupération, de transformation et de rendu ; ajouter cache ou échantillonnage
uniquement si les mesures le justifient et si la forme des courbes est
préservée.

## 9. Principe directeur

La carte est un composant Lovelace de visualisation, pas un dashboard complet :
deux graphiques uPlot fidèles au viewer, alimentés par des données Home
Assistant définies et validées, avec le minimum de dépendances et de logique
nécessaire.
