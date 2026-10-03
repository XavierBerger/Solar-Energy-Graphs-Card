import { LitElement, html } from "lit";
import type {
  SolarEnergyEntityRole,
  SolarEnergyGraphsCardConfig,
} from "./solar-energy-graphs-card-config";

const ENTITY_FIELDS: readonly {
  name: SolarEnergyEntityRole;
  selector: { entity: { domain: "sensor" } };
  required: true;
}[] = [
  {
    name: "production",
    selector: { entity: { domain: "sensor" } },
    required: true,
  },
  {
    name: "consumption",
    selector: { entity: { domain: "sensor" } },
    required: true,
  },
  {
    name: "grid_import",
    selector: { entity: { domain: "sensor" } },
    required: true,
  },
  {
    name: "grid_export",
    selector: { entity: { domain: "sensor" } },
    required: true,
  },
];

type EditorValues = Record<SolarEnergyEntityRole, string | null>;
const FIELD_LABELS: Record<SolarEnergyEntityRole, string> = {
  production: "Solar production",
  consumption: "Consumption",
  grid_import: "Grid import",
  grid_export: "Grid export",
};

export class SolarEnergyGraphsCardEditor extends LitElement {
  static properties = {
    hass: { attribute: false },
    config: { state: true },
    values: { state: true },
  };

  declare hass?: unknown;
  declare private config?: SolarEnergyGraphsCardConfig;
  declare private values: EditorValues;

  constructor() {
    super();
    this.values = {
      production: null,
      consumption: null,
      grid_import: null,
      grid_export: null,
    };
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
        .schema=${ENTITY_FIELDS}
        .computeLabel=${this.computeLabel}
        @value-changed=${this.handleValueChanged}
      ></ha-form>
    `;
  }

  private readonly computeLabel = (field: {
    name: SolarEnergyEntityRole;
  }): string => FIELD_LABELS[field.name];

  private readonly handleValueChanged = (
    event: CustomEvent<{ value: Partial<EditorValues> }>,
  ): void => {
    const entities = { ...this.values };
    for (const { name: role } of ENTITY_FIELDS) {
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
    "solar-energy-graphs-card-editor",
    SolarEnergyGraphsCardEditor,
  );
}
