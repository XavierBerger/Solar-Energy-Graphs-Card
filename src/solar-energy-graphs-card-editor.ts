import { LitElement, html } from "lit";
import type {
  SolarEnergyEntityRole,
  SolarEnergyGraphsCardConfig,
} from "./solar-energy-graphs-card-config";
import {
  getCompatibleSensorIds,
  type HomeAssistantEntityState,
} from "./home-assistant-energy-history";
import { cardLanguage, translations } from "./translations";

type EntityField = {
  name: SolarEnergyEntityRole;
  selector: { entity: { domain: "sensor"; include_entities: string[] } };
  required: true;
};

const ENTITY_ROLES: readonly SolarEnergyEntityRole[] = [
  "production",
  "consumption",
  "grid_import",
  "grid_export",
];

type EditorValues = Record<SolarEnergyEntityRole, string | null>;

type EditorHomeAssistant = {
  language?: string;
  states?: Readonly<Record<string, HomeAssistantEntityState | undefined>>;
};

function entityFields(
  compatibleSensorIds: readonly string[],
  values: EditorValues,
): EntityField[] {
  return ENTITY_ROLES.map((role) => ({
    name: role,
    selector: {
      entity: {
        domain: "sensor",
        include_entities: [...new Set([
          ...compatibleSensorIds,
          ...(values[role] ? [values[role]] : []),
        ])].sort(),
      },
    },
    required: true,
  }));
}

function sameStrings(first: readonly string[], second: readonly string[]): boolean {
  return first.length === second.length && first.every((value, index) => value === second[index]);
}

function sameValues(first: EditorValues, second: EditorValues): boolean {
  return ENTITY_ROLES.every((role) => first[role] === second[role]);
}

export class SolarEnergyGraphsCardEditor extends LitElement {
  static properties = {
    hass: { attribute: false },
    config: { state: true },
    values: { state: true },
    schema: { state: true },
  };

  declare hass?: EditorHomeAssistant;
  declare private config?: SolarEnergyGraphsCardConfig;
  declare private values: EditorValues;
  declare private schema: EntityField[];
  private compatibleSensorIds: string[] = [];
  private schemaValues: EditorValues;

  constructor() {
    super();
    this.values = {
      production: null,
      consumption: null,
      grid_import: null,
      grid_export: null,
    };
    this.schemaValues = { ...this.values };
    this.schema = entityFields(this.compatibleSensorIds, this.schemaValues);
  }

  setConfig(config: SolarEnergyGraphsCardConfig): void {
    this.config = config;
    this.values = { ...config.entities };
  }

  protected render() {
    return html`
      <ha-form
        .hass=${this.hass}
        .data=${this.values}
        .schema=${this.schema}
        .computeLabel=${this.computeLabel}
        @value-changed=${this.handleValueChanged}
      ></ha-form>
    `;
  }

  protected willUpdate(): void {
    const compatibleSensorIds = getCompatibleSensorIds(this.hass?.states ?? {}).sort();
    if (
      sameStrings(this.compatibleSensorIds, compatibleSensorIds) &&
      sameValues(this.schemaValues, this.values)
    ) {
      return;
    }
    this.compatibleSensorIds = compatibleSensorIds;
    this.schemaValues = { ...this.values };
    this.schema = entityFields(compatibleSensorIds, this.schemaValues);
  }

  private readonly computeLabel = (field: {
    name: SolarEnergyEntityRole;
  }): string =>
    translations(cardLanguage(this.hass?.language)).sensorLabels[field.name];

  private readonly handleValueChanged = (
    event: CustomEvent<{ value: Partial<EditorValues> }>,
  ): void => {
    const entities = { ...this.values };
    for (const role of ENTITY_ROLES) {
      if (Object.hasOwn(event.detail.value, role)) {
        entities[role] = event.detail.value[role] || null;
      }
    }
    this.values = entities;
    const config: SolarEnergyGraphsCardConfig = {
      ...this.config,
      type: this.config?.type ?? "custom:solar-energy-graphs-card",
      entities,
    };
    this.config = config;
    this.dispatchEvent(
      new CustomEvent("config-changed", {
        detail: { config },
        bubbles: true,
        composed: true,
      }),
    );
  };
}

if (!customElements.get("solar-energy-graphs-card-editor")) {
  customElements.define(
    // Stryker disable next-line StringLiteral: an empty name throws on import,
    // which Vitest reports as a failed file, not as a failed test.
    "solar-energy-graphs-card-editor",
    SolarEnergyGraphsCardEditor,
  );
}
