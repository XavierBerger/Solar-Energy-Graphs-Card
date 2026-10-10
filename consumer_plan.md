# Plan de développement : Issue #6 - Prise en charge des consommateurs individuels dans le graphique de consommation

Ce document fixe les spécifications techniques complètes et validées pour étendre la carte `Solar-Energy-Graphs-Card` et son éditeur visuel afin de gérer une liste ordonnée de consommateurs individuels avec leurs couleurs hexadécimales personnalisées.

---

## 1. Spécifications fonctionnelles & visuelles validées

1. **Étape 0 (Prérequis indispensable) :**
   - Ajout de la **courbe d'autoconsommation en vert foncé** (`stroke: "#2e7d32"`, `width: 1.25`).
   - **Toutes les lignes de courbe** (Production solaire, Consommation globale, Autoconsommation vert foncé) sont tracées au **premier plan** et ne sont jamais recouvertes par un remplissage de couleur.
2. **Empilement de haut en bas :**
   - Les consommateurs sont des surfaces de couleurs et ne possèdent pas de courbes.
   - Les surfaces des consommateurs sont affichées devant les autres surface (mais dérrière les courbes).
   - Les consommateurs s'empilent à partir du haut (depuis la ligne de consommation globale $C(t)$ vers le bas) dans l'ordre défini dans le YAML/éditeur :
     - Consommateur 1 (premier dans la liste YAML) : occupe la bande $[C(t), L_1(t)]$ avec $L_1(t) = \max(0, C(t) - K_1(t))$.
     - Consommateur 2 : occupe la bande $[L_1(t), L_2(t)]$ avec $L_2(t) = \max(0, L_1(t) - K_2(t))$.
     - Consommateur $i$ : s'empile sous le précédent avec $L_i(t) = \max(0, L_{i-1}(t) - K_i(t))$.
3. **Plafonnement à 0 :**
   - L'empilement est borné inférieurement à 0 et ne descend jamais sous l'axe 0.
4. **Consommation non attribuée :**
   - La portion de consommation résiduelle sous le dernier consommateur empilé jusqu'à 0 conserve le remplissage rouge/rose d'origine de la consommation ("#e96e7d") ou vert claire en cas d'autoconsomation ("#9fd19d").  
     Note: A déterminer lors du developpement - S'il est nécessaire d'avoir une première zone entre 0 et la première zone d'un consommateur, cette zone peut-elle être transparente ("#00000000") ?
5. **Couleur Hexadécimale & Sélecteur :**
   - La couleur de chaque consommateur est stockée sous forme de chaîne hexadécimale `#RRGGBB` dans la configuration YAML (`color: "#8B5CF6"`).
   - Sélecteur de couleur HTML `<input type="color">` / `<ha-color-picker>` dans l’éditeur visuel.
6. **Réordonnancement dans l'éditeur :**
   - Boutons fléchés **Monter ($\uparrow$) / Descendre ($\downarrow$)** sur chaque ligne de la liste des consommateurs.
   - En fin de projet, une estimation d'éffort pour remplacée les flèche par des poignés et activer le drag-n-drop sera proposée comme évolution possible

---

## 2. Découpage détaillé étape par étape

---

### **Étape 0 (Prérequis) : Courbe d'autoconsommation vert foncé & Lignes au premier plan (`energy-charts-renderer.ts`)**

#### **Spécifications techniques :**
1. **Ajout de la série ligne d'autoconsommation :**
   - Ajout d'une série uPlot pour la ligne d'autoconsommation (`directSolar`) avec un trait en vert foncé : `stroke: "#2e7d32"`, `width: 1.25`.
2. **Superposition uPlot (Z-Index / Ordre de tracé) :**
   - S'assurer que uPlot trace toutes les bandes de couleur (*bands*) en arrière-plan et **toutes les lignes de séries** (*series*) au premier plan, afin qu'aucun remplissage ne vienne masquer une ligne de courbe.

#### **Tests unitaires (Vitest dans `energy-charts-renderer.test.ts`) :**
- Vérifier la présence et la configuration de la série ligne d'autoconsommation (`Self-consumption`, `stroke: "#2e7d32"`).
- Vérifier que toutes les lignes de courbes sont configurées au premier plan sans remplissage direct qui masquerait les autres lignes.

#### **Vérification Home Assistant :**
- Exécution de `./dev.sh test` et `./dev.sh build`.
- Vérification visuelle sur Home Assistant de la nouvelle ligne vert foncé d'autoconsommation et du maintien de toutes les lignes au premier plan.

---

### **Étape 1 : Modèle de données & Validation de configuration (`solar-energy-graphs-card-config.ts` & `solar-energy-graphs-card.ts`)**

#### **Spécifications techniques :**
1. **Interface `ConsumerConfig` dans `solar-energy-graphs-card-config.ts` :**
   ```ts
   export interface ConsumerConfig {
     entity: string;
     color?: string; // Format hexadécimal #RRGGBB
     name?: string;
   }
   ```
2. **Extension de `SolarEnergyGraphsCardConfig` :**
   ```ts
   export interface SolarEnergyGraphsCardConfig {
     type: string;
     entities: Record<SolarEnergyEntityRole, string | null>;
     consumers?: ConsumerConfig[];
   }
   ```
3. **Palette de couleurs hexadécimales par défaut (`CONSUMER_DEFAULT_COLORS`) :**
   ```ts
   const CONSUMER_DEFAULT_COLORS = [
     "#8B5CF6", // Violet
     "#EC4899", // Pink
     "#10B981", // Emerald
     "#F59E0B", // Amber
     "#6366F1", // Indigo
     "#06B6D4", // Cyan
   ];
   ```
4. **Validation dans `setConfig(config)` ([`solar-energy-graphs-card.ts`](file:///workspace/Solar-Energy-Graphs-Card/src/solar-energy-graphs-card.ts)) :**
   - Nettoyer les identifiants d'entités consommateurs (`entity.trim()`).
   - Assigner automatiquement une couleur hexadécimale de fallback si le champ `color` est manquant.
   - Rétrocompatibilité garantie : si `consumers` n'est pas spécifié, initialiser à `[]`.

#### **Tests unitaires (Vitest dans `solar-energy-graphs-card.test.ts`) :**
- Vérifier la validation des configurations avec et sans consommateurs.
- Vérifier la normalisation des ID d'entités consommateurs avec espaces.
- Vérifier l'attribution des couleurs hexadécimales par défaut.

---

### **Étape 2 : Éditeur visuel Lovelace (`solar-energy-graphs-card-editor.ts`)**

#### **Spécifications techniques :**
1. **Interface d'édition des consommateurs :**
   - Section dédiée "Consommateurs individuels".
   - Pour chaque consommateur :
     - Sélecteur d'entité capteur (`selector: { entity: { domain: "sensor" } }`).
     - Sélecteur de couleur HTML `<input type="color">` qui sauvegarde la valeur hexadécimale `#RRGGBB`.
     - Boutons fléchés **Monter ($\uparrow$) / Descendre ($\downarrow$)** pour réordonner les consommateurs dans le YAML.
     - Bouton de suppression.
   - Bouton "+ Ajouter un consommateur".
2. **Émission d'événements :**
   - Émettre l'événement Lovelace `"config-changed"` à chaque modification.

#### **Tests unitaires (Vitest dans `solar-energy-graphs-card-editor.test.ts`) :**
- Rendu de l'éditeur avec 0, 1 et plusieurs consommateurs.
- Test de l'ajout, de la modification de couleur hexadécimale, du réordonnancement (Monter/Descendre) et de la suppression.

#### **Vérification Home Assistant :**
- `./dev.sh build` et test manuel dans l'éditeur visuel de Home Assistant.

---

### **Étape 3 : Pipeline de données & Calcul de l'empilement de haut en bas (`home-assistant-energy-history.ts`)**

#### **Spécifications techniques :**
1. **Requêtes WebSocket (`buildStatisticsRequest` / `buildHistoryRequest`) :**
   - Inclure les ID d'entités consommateurs dans les requêtes de statistiques (5min et heure) et de tail raw.
2. **Validation des échelles d'unités (`getEnergyUnitScales`) :**
   - Vérifier `device_class === "power"`, `state_class === "measurement"`, et les unités (`W` / `kW`) pour chaque consommateur.
3. **Calcul d'empilement depuis le haut dans `projectEnergyHistory` :**
   - Aligner la série de chaque consommateur $K_i(t)$ sur l'axe $X$ commun.
   - $U_1(t) = C(t)$, $L_1(t) = \max(0, C(t) - K_1(t))$.
   - Pour le consommateur $i$ : $U_i(t) = L_{i-1}(t)$ et $L_i(t) = \max(0, L_{i-1}(t) - K_i(t))$.
   - Consommation non attribuée (reste) = zone sous $L_n(t)$ jusqu'à 0, conservant la couleur rouge/rose `#e96e7d`.

#### **Tests unitaires (Vitest dans `home-assistant-energy-history.test.ts`) :**
- Validation de la mise à l'échelle (`kW` $\to$ `W`).
- Test du calcul d'empilement de haut en bas avec 0, 1 et plusieurs consommateurs.
- Test du plafonnement à 0 lorsque la somme des consommateurs s'approche ou dépasse la consommation totale.
- Test de la gestion des données manquantes/nulles sur un capteur consommateur.

---

### **Étape 4 : Rendu uPlot dynamique, Bandes & Légendes (`energy-charts-renderer.ts`)**

#### **Spécifications techniques :**
1. **Bandes uPlot dynamiques :**
   - Créer pour chaque consommateur $i$ la bande d'empilement `[U_i, L_i]` avec sa couleur hexadécimale configurée.
   - S'assurer que les bandes de couleur sont tracées en arrière-plan et que **toutes les lignes de courbe** (Production, Consommation, Autoconsommation vert foncé, Consommateurs) restent au **premier plan**.
2. **Affichage dans la légende :**
   - Afficher chaque consommateur dans la table de légende du graphique de consommation avec son nom/entité et sa valeur instantanée sous le curseur.

#### **Tests unitaires (Vitest dans `energy-charts-renderer.test.ts`) :**
- Test de la génération dynamique des options uPlot (séries lignes et bandes d'arrière-plan).
- Test du rendu des légendes sous le survol du curseur.

---

### **Étape 5 : Mutation Stryker, Thèmes & Validation globale**

#### **Spécifications techniques :**
- Exécution des tests de mutation avec Stryker (`./dev.sh mutation`) pour vérifier l'absence de mutant survivant.
- Validation du rendu visuel dans les thèmes clair et sombre, ainsi qu'aux différentes largeurs d'écran (responsive).

---

## 3. Plan de vérification automatisé

| Commande             | Objectif                                                                 |
| :------------------- | :----------------------------------------------------------------------- |
| `./dev.sh typecheck` | Contrôle de la stricte conformité du typage TypeScript (`tsc --noEmit`). |
| `./dev.sh test`      | Exécution de l'ensemble de la suite de tests unitaires Vitest.           |
| `./dev.sh build`     | Compilation du bundle de production `dist/solar-energy-graphs-card.js`.  |
| `./dev.sh mutation`  | Tests de mutation Stryker (sur demande).                                 |
