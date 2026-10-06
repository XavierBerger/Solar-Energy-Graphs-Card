import { describe, expect, it } from "vitest";
import { cardLanguage, translations } from "./translations";

describe("translations", () => {
  // Uses French for HA profile values in French and its sub-locales.
  it("detects French locales from Home Assistant language codes", () => {
    expect(cardLanguage("fr")).toBe("fr");
    expect(cardLanguage("fr-CA")).toBe("fr");
    expect(cardLanguage("en")).toBe("en");
    expect(cardLanguage("de")).toBe("en");
    expect(cardLanguage("fro")).toBe("en");
    expect(cardLanguage("xfr")).toBe("en");
    expect(cardLanguage("")).toBe("en");
    expect(cardLanguage(undefined)).toBe("en");
  });

  // Keeps the Parisian French wording and labels separate from the current English copy.
  it("provides the French translation table for the card UI", () => {
    const text = translations("fr");

    expect(text.dayNavigation).toBe("Navigation par jour");
    expect(text.previousDay).toBe("Jour précédent");
    expect(text.returnToToday).toBe("Revenir à aujourd'hui");
    expect(text.nextDay).toBe("Jour suivant");
    expect(text.graphTitles).toEqual({
      productionConsumption: "Production solaire et consommation",
      gridExchange: "Échanges avec le réseau",
    });
    expect(text.precision).toMatchObject({
      standardAria: "Utiliser la précision standard",
      highAria: "Charger la haute précision",
      highAriaUnavailable:
        "Charger la haute précision (échec de la vérification de disponibilité)",
      standardTitle: "Précision standard",
      highTitle: "Haute précision",
    });
    expect(text.precision.highTitleUnavailable("history")).toBe(
      "Échec de la vérification de disponibilité de la haute précision : history",
    );
    expect(text.statuses).toMatchObject({
      waiting: "En attente des données de Home Assistant.",
      loading: "Chargement de l'historique de Home Assistant…",
      readyMain: "Statistiques de puissance : moyenne avec plage min–max.",
      readyGrid: "L'import et l'export réseau sont mesurés séparément.",
    });
    expect(text.statuses.sensorError("grid_import", "class")).toBe(
      "Erreur de configuration du capteur : Le capteur d'import réseau doit avoir device_class=power et state_class=measurement.",
    );
    expect(text.statuses.unavailableMain("2024-04-12")).toBe(
      "Erreur : l'historique de production ou de consommation du 2024-04-12 est indisponible.",
    );
    expect(text.statuses.loadError("timeout")).toBe(
      "Erreur de chargement de l'historique : timeout",
    );
    expect(text.sensorLabels).toEqual({
      production: "Production solaire",
      consumption: "Consommation",
      grid_import: "Import réseau",
      grid_export: "Export réseau",
    });
    expect(text.sensorProblem("grid_export", "unit")).toBe(
      "Le capteur d'export réseau doit utiliser W ou kW.",
    );
    expect(text.dateLocale).toBe("fr-FR");
    expect(text.chart).toEqual({
      power: "Puissance (W)",
      time: "Heure",
      selfConsumption: "Autoconsommation",
      solarProduction: "Production solaire",
      consumption: "Consommation",
      gridImport: "Import réseau",
      gridExport: "Export réseau",
      gridExportPositive: "Export réseau (+W)",
      gridImportNegative: "Import réseau (-W)",
    });
    expect(text.setConfig).toEqual({
      expectedType: 'Type de carte attendu : "custom:solar-energy-graphs-card".',
      missingEntities:
        'Configurez "entities.production", "entities.consumption", "entities.grid_import" et "entities.grid_export".',
    });
    expect(text.cardPickerDescription).toBe(
      "Deux graphiques d'énergie solaire synchronisés.",
    );
  });
});
