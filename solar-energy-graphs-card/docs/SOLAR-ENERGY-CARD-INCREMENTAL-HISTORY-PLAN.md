# Plan de développement — Rafraîchissement incrémental des historiques

## 1. Objectif

Remplacer le comportement actuel de la carte, qui peut relancer une requête complète `history/period` lors des mises à jour Home Assistant, par une stratégie de rafraîchissement incrémental.

Objectifs :

- ne jamais recharger inutilement un jour historique ;
- coalescer les mises à jour rapprochées du jour courant ;
- ajouter les nouveaux échantillons au graphe sans reconstruire les données de toute la journée ;
- conserver les règles actuelles de fraîcheur, d'alignement, d'états indisponibles et de fuseau/DST ;
- conserver une possibilité de réconciliation périodique avec Home Assistant History afin de corriger les éventuels écarts entre événements live et historique persistant ;
- éviter toute dégradation perceptible lors de mises à jour fréquentes des quatre capteurs.

Le principe important est de distinguer **historique persistant** et **flux live**.

## 2. Proposition d'architecture

### 2.1 Chargement initial

Pour le jour sélectionné :

1. calculer la fenêtre locale du jour ;
2. appeler `history/period` une première fois ;
3. normaliser la réponse ;
4. conserver, en plus des tableaux uPlot, un état interne permettant de connaître :
   - le dernier timestamp source connu pour chaque capteur ;
   - le dernier timestamp de données affiché ;
   - le jour/fuseau correspondant ;
   - la dernière valeur connue de chaque capteur ;
   - l'état de fraîcheur de chaque capteur.

Le chargement initial reste donc complet.

### 2.2 Jour historique sélectionné

Si `selectedDay < today` :

- les changements actuels de `hass.states` ne doivent **jamais** provoquer de requête History ;
- les graphes restent immobiles tant que l'utilisateur ne change pas de jour ;
- une navigation vers un autre jour déclenche un nouveau chargement complet.

C'est le cas le plus simple et doit être garanti par un test explicite.

### 2.3 Jour courant : ajout des points live

Pour le jour courant, le setter `hass` reçoit déjà les états actuels des quatre entités.

Au lieu de relancer immédiatement `history/period` :

1. détecter uniquement les changements pertinents des quatre capteurs ;
2. extraire `state` + `last_updated` ;
3. ignorer les mises à jour dont le timestamp n'est pas plus récent que le dernier échantillon accepté ;
4. coalescer les changements reçus dans une courte fenêtre de debounce ;
5. construire un lot de nouveaux échantillons ;
6. mettre à jour uniquement la partie terminale du modèle de données ;
7. appeler `uPlot.setData()` avec les tableaux résultants.

Important : uPlot ne propose pas ici une opération générique « append une ligne » indépendante de ses tableaux parallèles. Le modèle interne peut donc être incrémental, tandis que l'appel uPlot reste un remplacement des tableaux. Le coût évité est alors surtout le réseau, la récupération et la normalisation de toute la journée.

## 3. Modèle de données recommandé

Ne pas tenter d'ajouter directement des valeurs dans `EnergyHistoryResponse`.

Introduire un modèle interne distinct, par exemple conceptuellement :

- échantillons bruts par capteur ;
- timestamps union ;
- valeurs alignées ;
- état courant des capteurs ;
- borne jusqu'à laquelle l'historique est connu.

Ce modèle doit permettre :

```
historique initial
        ↓
  modèle mutable
        ↓
nouveau point live
        ↓
mise à jour du dernier segment
        ↓
projection uPlot
```

La fonction pure actuelle `normalizeEnergyHistory()` peut rester utilisée pour le chargement initial.

Le modèle mutable est constitué des échantillons bruts par capteur, déjà convertis en W. Les tableaux uPlot n'en sont qu'une projection, recalculée par une fonction unique partagée entre le chargement initial et la fusion live : les deux chemins ne peuvent donc pas diverger.

Ajouter une fonction pure dédiée à la fusion, par exemple :

`mergeLiveSamples(samples, incoming)`

Elle devra :

- rejeter les doublons temporels ;
- remplacer un échantillon ayant exactement le même timestamp si nécessaire ;
- conserver l'ordre chronologique ;
- recalculer les séries dérivées affectées ;
- respecter la fenêtre du jour ;
- respecter la limite de fraîcheur de dix minutes ;
- produire les trous nécessaires lorsque les capteurs deviennent indisponibles.

## 4. Point important : les séries dérivées

Les graphes contiennent des séries dérivées :

- autoconsommation directe ;
- consommation couverte par le réseau ;
- import réseau signé ;
- séries auxiliaires de remplissage.

Un nouveau point ne doit donc pas être ajouté uniquement à la série du capteur ayant changé.

Chaque capteur est fusionné à son propre timestamp. La projection aligne ensuite les quatre capteurs sur l'union des timestamps, en propageant la dernière valeur connue de chacun dans la limite de fraîcheur, puis recalcule toutes les séries dérivées. Deux capteurs qui arrivent à des instants différents sont ainsi traités comme au chargement initial.

## 5. Coalescence des événements

Le setter `hass` peut être appelé fréquemment.

Mettre en place un mécanisme de coalescence :

1. le setter détecte un changement pertinent ;
2. il stocke l'état courant dans une structure pending ;
3. il programme un seul rafraîchissement différé ;
4. les autres changements arrivant avant son exécution sont fusionnés ;
5. le traitement consomme le lot en une seule fois.

La durée exacte du debounce doit être mesurée plutôt que choisie arbitrairement. Une fenêtre courte de l'ordre de quelques centaines de millisecondes constitue un bon point de départ pour les tests.

Ne pas utiliser de debounce pour la navigation manuelle ou un changement de configuration : ces événements doivent rester immédiats.

## 6. Détection des changements pertinents

La signature actuelle basée sur `JSON.stringify(attributes)` doit être supprimée de la logique de rafraîchissement.

Pour les quatre capteurs, le chemin live doit comparer principalement :

- `state` ;
- `last_updated` ;
- éventuellement `last_changed` si nécessaire au contrat retenu.

Les attributs ne doivent déclencher aucune mise à jour live sauf si une fonctionnalité future dépend explicitement d'eux.

Les métadonnées `device_class`, `state_class` et unité restent validées lors du chargement/configuration, pas à chaque tick.

## 7. Gestion des états indisponibles

Un changement vers `unknown` ou `unavailable` constitue un événement de données.

Il doit pouvoir être ajouté au modèle comme un échantillon invalide/null avec son timestamp, afin que le graphe cesse de prolonger artificiellement la dernière mesure.

Lorsqu'une nouvelle valeur valide arrive, elle reprend le flux normalement.

Les règles existantes de fraîcheur maximale de dix minutes restent inchangées.

## 8. Réconciliation avec History

L'approche live ne doit pas être considérée comme une garantie que chaque événement sera persistantement représenté.

Ajouter une stratégie de réconciliation, par exemple :

- après le chargement initial ;
- périodiquement pour le jour courant ;
- lors d'un retour de visibilité de la carte ;
- éventuellement après une déconnexion/reconnexion Home Assistant.

La réconciliation doit utiliser une fenêtre courte autour de la dernière zone connue plutôt que recharger toute la journée.

Conceptuellement :

`history/period(lastKnownTimestamp - baseline, now)`

Puis fusion des résultats avec le modèle local.

La baseline existante de dix minutes peut servir de marge pour récupérer un changement antérieur nécessaire à l'alignement et à la fraîcheur.

Il faudra vérifier expérimentalement le comportement exact de l'API History pour les états successifs et les timestamps avant de figer cette stratégie.

## 9. Pourquoi ne pas faire uniquement une requête incrémentale History ?

C'est possible et doit être évalué, mais ce ne devrait pas être la première optimisation.

Une requête History incrémentale à chaque changement :

- réduit la quantité de données transférées ;
- mais conserve une requête HTTP par événement ;
- introduit de la concurrence et des réponses potentiellement obsolètes ;
- dépend du comportement exact de l'API autour des bornes temporelles ;
- ne profite pas du fait que le setter `hass` contient déjà l'état courant.

Pour une carte Lovelace temps réel, exploiter d'abord `hass.states` puis réconcilier périodiquement est donc plus simple et plus économique.

## 10. Mise à jour uPlot

Le modèle interne peut être mis à jour par ajout de points.

La projection finale vers uPlot peut continuer à produire :

`EnergyHistoryResponse`

et appeler `chart.setData()`.

Cela signifie que l'optimisation porte principalement sur :

- absence de requête HTTP complète ;
- absence de parsing de toute la journée ;
- absence de recalcul de toutes les données historiques.

Une optimisation ultérieure pourra déterminer si le coût de `setData()` lui-même devient significatif. Elle ne doit pas être introduite avant mesure.

## 11. Cas nécessitant un rechargement complet

Un chargement complet reste obligatoire lorsque :

- la carte vient d'être montée ;
- la configuration des entités change ;
- le jour sélectionné change ;
- le fuseau Home Assistant change : le renderer doit aussi être détruit puis recréé, car son callback `tzDate` fige le fuseau à la construction ;
- les métadonnées d'un capteur changent de façon significative ;
- le modèle local est invalidé ;
- une réconciliation détecte un trou ou une divergence impossible à fusionner.

Le changement de thème ne doit pas recharger les données.

## 12. Tests à ajouter

### Modèle de fusion

- ajoute un nouveau timestamp ;
- fusionne plusieurs capteurs arrivant à des timestamps différents ;
- remplace un point ayant le même timestamp ;
- ignore un point plus ancien ;
- conserve l'ordre chronologique ;
- recalcule les séries dérivées ;
- gère `unknown`/`unavailable` ;
- respecte la fraîcheur de dix minutes ;
- ne sort pas de la fenêtre du jour.

### Composant Lovelace

- une mise à jour d'état ne provoque pas de requête History complète ;
- plusieurs mises à jour rapprochées ne provoquent qu'un seul traitement ;
- une mise à jour d'un jour passé ne provoque aucun traitement live ;
- la navigation déclenche exactement un chargement complet ;
- une modification de configuration déclenche un chargement ;
- un changement de fuseau invalide le modèle et recharge ;
- une réponse History obsolète est ignorée ;
- les points live continuent d'être ajoutés après une réponse History initiale.

### Réconciliation

- fusionne une réponse History courte avec les données live ;
- ne duplique pas les timestamps ;
- corrige un point live provisoire ;
- récupère un trou manquant ;
- ne remplace pas inutilement toute la journée.

### Performance

Ajouter un test de scénario simulant plusieurs dizaines de mises à jour sur quelques secondes et vérifier :

- une seule opération coalescée ;
- aucune requête complète supplémentaire ;
- nombre limité de recalculs ;
- absence de croissance non bornée des structures temporaires.

## 13. Découpage de développement

### P0.1 — Introduire le modèle de rafraîchissement

- Séparer explicitement chargement initial et mises à jour live.
- Supprimer la signature basée sur tous les attributs.
- Ajouter l'état interne des derniers échantillons.
- Conserver le comportement visuel actuel.

**Validation :** tests unitaires et aucune régression fonctionnelle.

### P0.2 — Coalescer les mises à jour HA

- Ajouter la file/l'état `pending`.
- Ajouter le traitement différé.
- Garantir une seule opération par rafale.
- Ne pas appliquer ce mécanisme à la navigation.

**Validation :** tests avec rafales de mises à jour.

### P0.3 — Fusionner les nouveaux points

- Ajouter la fonction pure de fusion.
- Exploiter `hass.states` pour les quatre capteurs.
- Mettre à jour les séries dérivées.
- Appeler le renderer avec les données fusionnées.

**Validation :** tests temporels, états indisponibles et fraîcheur.

### P0.4 — Réconcilier avec History

- Implémenter une requête History courte.
- Fusionner sa réponse avec le modèle local.
- Gérer les bornes temporelles et les doublons.
- Mesurer le gain réel.

**Validation :** test de récupération après perte/retard d'événement.

### P0.5 — Mesurer avant optimisation uPlot

Mesurer séparément :

- fréquence des appels `hass` ;
- requêtes HTTP ;
- volume de données History ;
- temps de normalisation ;
- temps de fusion ;
- coût de `setData()`.

Si `setData()` est négligeable, ne pas complexifier le renderer.

### TODO list

Mettre cette liste à jour selon la convention de
[`SOLAR-ENERGY-CARD-DEVELOPMENT-PLAN.md`](SOLAR-ENERGY-CARD-DEVELOPMENT-PLAN.md) :
**En cours** au démarrage, **Validée** après les tests techniques et la
confirmation utilisateur dans Home Assistant, **Bloquée** avec la raison.

- [ ] **En cours** — P0.1 : séparer chargement initial et mises à jour live.
  La clé de chargement ne dépend plus que du fuseau, du jour et des entités.
  Implémenté et testé ; validation dans Home Assistant en attente.
- [ ] **En cours** — P0.2 : coalescer les mises à jour HA. Fenêtre de 250 ms,
  fusion depuis le dernier `hass` reçu. Implémenté et testé ; validation dans
  Home Assistant en attente.
- [ ] **En cours** — P0.3 : fusionner les nouveaux points. Échantillons bruts
  par capteur et projection partagée avec le chargement initial. Implémenté et
  testé ; validation dans Home Assistant en attente.
- [ ] **À faire** — P0.4 : réconcilier avec History.
- [ ] **À faire** — P0.5 : mesurer avant optimisation uPlot.

## 14. Critères d'acceptation

La fonctionnalité sera considérée comme réussie lorsque :

- consulter un jour passé n'entraîne aucune requête History lors des mises à jour live ;
- le jour courant ne recharge pas toute sa journée à chaque changement de capteur ;
- une rafale de mises à jour est traitée en une seule opération coalescée ;
- les nouveaux points apparaissent sans perte de données ;
- les séries dérivées restent cohérentes ;
- les états indisponibles créent correctement des trous ;
- DST et fuseaux restent corrects ;
- une navigation de jour reste déterministe ;
- une réconciliation peut corriger un événement live manquant ;
- les tests automatisés couvrent les invariants ci-dessus ;
- aucune optimisation uPlot supplémentaire n'est ajoutée sans mesure démontrant son intérêt.

## 15. Décision d'architecture proposée

**Approche recommandée :**

`History complet initial` → `modèle local` → `points live depuis hass.states` → `coalescence` → `fusion incrémentale` → `setData()` → `réconciliation History périodique`.

Cette approche conserve l'API History comme source de vérité historique tout en utilisant efficacement l'état déjà fourni par Home Assistant pour le temps réel.

Elle est préférable à une simple répétition de requêtes History plus petites, car elle réduit à la fois la fréquence réseau et le volume de données à parser, tout en restant réconciliable avec la source historique.
