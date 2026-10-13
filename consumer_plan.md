# Plan de développement : Issue #6 - Prise en charge des consommateurs individuels dans le graphique de consommation

Ce document fixe les spécifications techniques complètes et validées pour étendre la carte `Solar-Energy-Graphs-Card` et son éditeur visuel afin de gérer une liste ordonnée de consommateurs individuels avec leurs couleurs hexadécimales personnalisées.

---

## 1. Spécifications fonctionnelles & visuelles validées

1. **Empilement de haut en bas :**
   - Les consommateurs sont des surfaces de couleurs et ne possèdent pas de courbes.
   - Les surfaces des consommateurs sont affichées devant les autres surface (mais dérrière les courbes).
   - Les consommateurs s'empilent à partir du haut (depuis la ligne de consommation globale $C(t)$ vers le bas) dans l'ordre défini dans le YAML/éditeur :
     - Consommateur 1 (premier dans la liste YAML) : occupe la bande $[C(t), L_1(t)]$ avec $L_1(t) = \max(0, C(t) - K_1(t))$.
     - Consommateur 2 : occupe la bande $[L_1(t), L_2(t)]$ avec $L_2(t) = \max(0, L_1(t) - K_2(t))$.
     - Consommateur $i$ : s'empile sous le précédent avec $L_i(t) = \max(0, L_{i-1}(t) - K_i(t))$.
2. **Plafonnement à 0 :**
   - L'empilement est borné inférieurement à 0 et ne descend jamais sous l'axe 0.
3. **Consommation non attribuée :**
   - La portion de consommation résiduelle sous le dernier consommateur empilé jusqu'à 0 conserve le remplissage rouge/rose d'origine de la consommation ("#e96e7d") ou vert claire en cas d'autoconsomation ("#9fd19d").  
     Note: A déterminer lors du developpement - S'il est nécessaire d'avoir une première zone entre 0 et la première zone d'un consommateur, cette zone peut-elle être transparente ("#00000000") ?
4. **Couleur Hexadécimale & Sélecteur :**
   - La couleur de chaque consommateur est stockée sous forme de chaîne hexadécimale `#RRGGBB` dans la configuration YAML (`color: "#8B5CF6"`).
   - Sélecteur de couleur HTML `<input type="color">` / `<ha-color-picker>` dans l’éditeur visuel.
5. **Réordonnancement dans l'éditeur :**
   - Boutons fléchés **Monter ($\uparrow$) / Descendre ($\downarrow$)** sur chaque ligne de la liste des consommateurs.
   - En fin de projet, une estimation d'éffort pour remplacée les flèche par des poignés et activer le drag-n-drop sera proposée comme évolution possible
6. **Gestion de l'affichage :**
   - Les surfaces et les entrées de légende des consommateurs sont masquées par défaut ; les autres courbes restent inchangées.
   - Un bouton permettant d'afficher ou de masquer les consommateurs est placé immédiatement à gauche du bouton de précision, dans les contrôles existants en haut à droite.
   - La visibilité est un état d'interface temporaire, non enregistré dans le YAML. Elle est conservée lors des mises à jour de données et des changements de jour ; elle n'entraîne ni nouvelle requête Home Assistant ni recalcul des données.
   - Le bouton n'est affiché que si au moins un consommateur est configuré. Son libellé accessible et son infobulle indiquent l'action disponible.

---

## 2. Découpage détaillé étape par étape

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
      const CONSUMER_DEFAULT_COLORS: string[] = [
      "#8B5CF6", // Violet
      "#F97316", // Orange
      "#10B981", // Emerald
      "#EC4899", // Pink
      "#06B6D4", // Cyan
      "#EF4444", // Red
      "#84CC16", // Lime
      "#6366F1", // Indigo
      "#F59E0B", // Amber
      "#14B8A6", // Teal
      "#D946EF", // Fuchsia
      "#3B82F6", // Blue
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
   - S'assurer que les bandes de couleur sont tracées en arrière-plan et que les lignes de Production, Consommation et Autoconsommation restent au premier plan. Les consommateurs restent des surfaces sans courbe.
2. **Affichage dans la légende :**
   - Afficher chaque consommateur dans la table de légende du graphique de consommation avec son nom/entité et sa valeur instantanée sous le curseur.
3. **Visibilité des consommateurs (`solar-energy-graphs-card.ts` et `translations.ts`) :**
   - Ajouter un état de visibilité initialisé à `false` et un bouton dans les contrôles existants, immédiatement à gauche du bouton de précision. Ne pas ajouter de nouvelle barre d'outils.
   - Le bouton n'est rendu que si au moins un consommateur est configuré. Son libellé accessible et son infobulle localisés indiquent l'action (« Afficher les consommateurs » / « Masquer les consommateurs »).
   - Transmettre l'état au renderer afin de masquer ou d'afficher ensemble les bandes et les entrées de légende des consommateurs ; les autres courbes et leurs légendes ne changent pas.
   - Conserver l'état lors des mises à jour, des changements de jour et des changements de précision. Le masquage ne doit ni interrompre le chargement des consommateurs ni déclencher une nouvelle requête ou projection.

#### **Tests unitaires (Vitest dans `energy-charts-renderer.test.ts`) :**
- Test de la génération dynamique des options uPlot (séries lignes et bandes d'arrière-plan).
- Test du rendu des légendes sous le survol du curseur.
- Vérifier que l'état masqué supprime les bandes et entrées de légende des consommateurs tout en conservant les courbes et légendes existantes, puis que l'état affiché les restaure.

#### **Tests unitaires (Vitest dans `solar-energy-graphs-card.test.ts` et `translations.test.ts`) :**
- Vérifier l'état masqué par défaut, l'absence du bouton sans consommateur et sa présence à gauche du bouton de précision lorsqu'il y a des consommateurs.
- Vérifier que le clic bascule la visibilité, met à jour le libellé accessible et conserve l'état lors des mises à jour et changements de jour/précision sans nouvelle requête.
- Vérifier les libellés localisés et les infobulles des deux états.

#### **Vérification Home Assistant :**
- Vérifier que le bouton apparaît à gauche du bouton de précision lorsque des consommateurs sont configurés, que les surfaces et entrées de légende sont masquées au chargement, puis qu'elles apparaissent/disparaissent au clic.
- Vérifier que Production, Consommation et Autoconsommation restent visibles, et que le choix d'affichage est conservé au changement de jour et de précision.

---

### **Étape 5 : Mutation Stryker, Thèmes & Validation globale**

**Attention : l'étape des tests de mutation ne sera faite qu'une seule fois à la fin du ceveloppement.**

#### **Spécifications techniques :**
- Exécution des tests de mutation avec Stryker (`./dev.sh mutation`) pour vérifier l'absence de mutant survivant.
- Validation du rendu visuel dans les thèmes clair et sombre, ainsi qu'aux différentes largeurs d'écran (responsive), avec et sans consommateurs affichés.
- Vérification de l'ordre et de la lisibilité du bouton d'affichage à côté du contrôle de précision, y compris sur écran étroit et au toucher.

---

## 3. Plan de vérification automatisé

| Commande             | Objectif                                                                 |
| :------------------- | :----------------------------------------------------------------------- |
| `./dev.sh typecheck` | Contrôle de la stricte conformité du typage TypeScript (`tsc --noEmit`). |
| `./dev.sh test`      | Exécution de l'ensemble de la suite de tests unitaires Vitest.           |
| `./dev.sh build`     | Compilation du bundle de production `dist/solar-energy-graphs-card.js`.  |
| `./dev.sh mutation`  | Tests de mutation Stryker (sur demande).                                 |
