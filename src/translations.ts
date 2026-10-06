import type { SolarEnergyEntityRole } from "./solar-energy-graphs-card-config";

export type CardLanguage = "en" | "fr";

export function cardLanguage(language?: string): CardLanguage {
  return /^fr(?:-|$)/.test(language ?? "") ? "fr" : "en";
}

export interface CardTranslations {
  dayNavigation: string;
  previousDay: string;
  returnToToday: string;
  nextDay: string;
  graphTitles: {
    productionConsumption: string;
    gridExchange: string;
  };
  precision: {
    standardAria: string;
    highAria: string;
    highAriaUnavailable: string;
    standardTitle: string;
    highTitle: string;
    highTitleUnavailable: (detail: string) => string;
  };
  statuses: {
    waiting: string;
    loading: string;
    sensorError: (role: SolarEnergyEntityRole, problem: "class" | "unit") => string;
    readyMain: string;
    readyGrid: string;
    unavailableMain: (day: string) => string;
    unavailableGrid: (day: string) => string;
    loadError: (detail: string) => string;
  };
  sensorLabels: Record<SolarEnergyEntityRole, string>;
  sensorProblem: (role: SolarEnergyEntityRole, problem: "class" | "unit") => string;
  dateLocale: "en-US" | "fr-FR";
  chart: {
    power: string;
    time: string;
    selfConsumption: string;
    solarProduction: string;
    consumption: string;
    gridImport: string;
    gridExport: string;
    gridExportPositive: string;
    gridImportNegative: string;
  };
  setConfig: {
    expectedType: string;
    missingEntities: string;
  };
  cardPickerDescription: string;
}

const roleName = (role: SolarEnergyEntityRole): string => {
  switch (role) {
    case "production":
      return "production";
    case "consumption":
      return "consumption";
    case "grid_import":
      return "grid import";
    case "grid_export":
      return "grid export";
    default:
      return role;
  }
};

const sensorDescription = (role: SolarEnergyEntityRole): string => {
  switch (role) {
    case "production":
      return "de production";
    case "consumption":
      return "de consommation";
    case "grid_import":
      return "d'import réseau";
    case "grid_export":
      return "d'export réseau";
    default:
      return role;
  }
};

export const EN: CardTranslations = {
  dayNavigation: "Day navigation",
  previousDay: "Previous day",
  returnToToday: "Return to today",
  nextDay: "Next day",
  graphTitles: {
    productionConsumption: "Solar Production and Consumption",
    gridExchange: "Grid Exchange",
  },
  precision: {
    standardAria: "Use standard precision",
    highAria: "Load high precision",
    highAriaUnavailable: "Load high precision (availability check failed)",
    standardTitle: "Standard precision",
    highTitle: "High precision",
    highTitleUnavailable: (detail: string) =>
      `High precision availability check failed: ${detail}`,
  },
  statuses: {
    waiting: "Waiting for Home Assistant data.",
    loading: "Loading Home Assistant history…",
    sensorError: (role, problem) =>
      `Sensor configuration error: ${EN.sensorProblem(role, problem)}`,
    readyMain: "Power statistics: mean line with min–max range.",
    readyGrid: "Grid import and export are measured separately.",
    unavailableMain: (day: string) =>
      `Error: ${day} production or consumption history is unavailable.`,
    unavailableGrid: (day: string) =>
      `Error: ${day} grid import or export history is unavailable.`,
    loadError: (detail: string) => `History loading error: ${detail}`,
  },
  sensorLabels: {
    production: "Solar production",
    consumption: "Consumption",
    grid_import: "Grid import",
    grid_export: "Grid export",
  },
  sensorProblem: (role, problem) => {
    const subject = roleName(role);
    if (problem === "class") {
      return `The ${subject} sensor must have device_class=power and state_class=measurement.`;
    }
    return `The ${subject} sensor must use W or kW.`;
  },
  dateLocale: "en-US",
  chart: {
    power: "Power (W)",
    time: "Time",
    selfConsumption: "Self-consumption",
    solarProduction: "Solar production",
    consumption: "Consumption",
    gridImport: "Grid import",
    gridExport: "Grid export",
    gridExportPositive: "Grid export (+W)",
    gridImportNegative: "Grid import (-W)",
  },
  setConfig: {
    expectedType: 'Expected card type "custom:solar-energy-graphs-card".',
    missingEntities:
      'Configure "entities.production", "entities.consumption", "entities.grid_import", and "entities.grid_export".',
  },
  cardPickerDescription: "Two synchronized solar energy graphs.",
};

export const FR: CardTranslations = {
  dayNavigation: "Navigation par jour",
  previousDay: "Jour précédent",
  returnToToday: "Revenir à aujourd'hui",
  nextDay: "Jour suivant",
  graphTitles: {
    productionConsumption: "Production solaire et consommation",
    gridExchange: "Échanges avec le réseau",
  },
  precision: {
    standardAria: "Utiliser la précision standard",
    highAria: "Charger la haute précision",
    highAriaUnavailable: "Charger la haute précision (échec de la vérification de disponibilité)",
    standardTitle: "Précision standard",
    highTitle: "Haute précision",
    highTitleUnavailable: (detail: string) =>
      `Échec de la vérification de disponibilité de la haute précision : ${detail}`,
  },
  statuses: {
    waiting: "En attente des données de Home Assistant.",
    loading: "Chargement de l'historique de Home Assistant…",
    sensorError: (role, problem) =>
      `Erreur de configuration du capteur : ${FR.sensorProblem(role, problem)}`,
    readyMain: "Statistiques de puissance : moyenne avec plage min–max.",
    readyGrid: "L'import et l'export réseau sont mesurés séparément.",
    unavailableMain: (day: string) =>
      `Erreur : l'historique de production ou de consommation du ${day} est indisponible.`,
    unavailableGrid: (day: string) =>
      `Erreur : l'historique d'import ou d'export réseau du ${day} est indisponible.`,
    loadError: (detail: string) => `Erreur de chargement de l'historique : ${detail}`,
  },
  sensorLabels: {
    production: "Production solaire",
    consumption: "Consommation",
    grid_import: "Import réseau",
    grid_export: "Export réseau",
  },
  sensorProblem: (role, problem) => {
    const subject = sensorDescription(role);
    if (problem === "class") {
      return `Le capteur ${subject} doit avoir device_class=power et state_class=measurement.`;
    }
    return `Le capteur ${subject} doit utiliser W ou kW.`;
  },
  dateLocale: "fr-FR",
  chart: {
    power: "Puissance (W)",
    time: "Heure",
    selfConsumption: "Autoconsommation",
    solarProduction: "Production solaire",
    consumption: "Consommation",
    gridImport: "Import réseau",
    gridExport: "Export réseau",
    gridExportPositive: "Export réseau (+W)",
    gridImportNegative: "Import réseau (-W)",
  },
  setConfig: {
    expectedType: 'Type de carte attendu : "custom:solar-energy-graphs-card".',
    missingEntities:
      'Configurez "entities.production", "entities.consumption", "entities.grid_import" et "entities.grid_export".',
  },
  cardPickerDescription: "Deux graphiques d'énergie solaire synchronisés.",
};

export function translations(language: CardLanguage = "en"): CardTranslations {
  return language === "fr" ? FR : EN;
}
