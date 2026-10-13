import { LitElement, css, html } from "lit";
import type {
  ConsumerConfig,
  SolarEnergyEntityRole,
  SolarEnergyGraphsCardConfig,
} from "./solar-energy-graphs-card-config";
import { CONSUMER_DEFAULT_COLORS } from "./solar-energy-graphs-card-config";
import { cardLanguage, translations } from "./translations";

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
const CONSUMER_SCHEMA = [
  { name: "entity", selector: { entity: { domain: "sensor" } } },
];

export class SolarEnergyGraphsCardEditor extends LitElement {
  static styles = css`
    .consumers {
      margin-top: 1rem;
    }

    .consumer-row {
      align-items: center;
      display: flex;
      gap: 0.5rem;
      margin: 0.5rem 0;
    }

    .consumer-row ha-form {
      flex: 1;
      min-width: 0;
    }

    .consumer-row button,
    .consumers > button {
      min-height: 2.5rem;
    }

    .consumer-row input {
      height: 2.5rem;
      padding: 0.125rem;
      width: 3rem;
    }
  `;

  static properties = {
    hass: { attribute: false },
    config: { state: true },
    values: { state: true },
    consumers: { state: true },
  };

  declare hass?: { language?: string };
  declare private config?: SolarEnergyGraphsCardConfig;
  declare private values: EditorValues;
  declare private consumers: ConsumerConfig[];

  constructor() {
    super();
    this.values = {
      production: null,
      consumption: null,
      grid_import: null,
      grid_export: null,
    };
    this.consumers = [];
  }

  setConfig(config: SolarEnergyGraphsCardConfig): void {
    this.config = config;
    this.values = { ...config.entities };
    this.consumers = (config.consumers ?? []).map((consumer) => ({ ...consumer }));
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
      <section class="consumers">
        <h3>${translations(cardLanguage(this.hass?.language)).consumersHeading}</h3>
        ${this.consumers.map(
          (consumer, index) => html`
            <div class="consumer-row">
              <ha-form
                .hass=${this.hass}
                .data=${{ entity: consumer.entity }}
                .schema=${CONSUMER_SCHEMA}
                .computeLabel=${() =>
                  translations(cardLanguage(this.hass?.language)).consumerEntity}
                @value-changed=${(event: CustomEvent<{ value: { entity?: string } }>) =>
                  this.handleConsumerEntityChanged(index, event)}
              ></ha-form>
              <input
                type="color"
                .value=${consumer.color ?? CONSUMER_DEFAULT_COLORS[index % CONSUMER_DEFAULT_COLORS.length]}
                aria-label=${`${translations(cardLanguage(this.hass?.language)).consumerColor} ${index + 1}`}
                @input=${(event: Event) =>
                  this.handleConsumerColorChanged(index, event)}
              />
              <button
                type="button"
                aria-label=${translations(cardLanguage(this.hass?.language)).moveConsumerUp}
                title=${translations(cardLanguage(this.hass?.language)).moveConsumerUp}
                ?disabled=${index === 0}
                @click=${() => this.moveConsumer(index, -1)}
              >↑</button>
              <button
                type="button"
                aria-label=${translations(cardLanguage(this.hass?.language)).moveConsumerDown}
                title=${translations(cardLanguage(this.hass?.language)).moveConsumerDown}
                ?disabled=${index === this.consumers.length - 1}
                @click=${() => this.moveConsumer(index, 1)}
              >↓</button>
              <button
                type="button"
                aria-label=${translations(cardLanguage(this.hass?.language)).removeConsumer}
                title=${translations(cardLanguage(this.hass?.language)).removeConsumer}
                @click=${() => this.removeConsumer(index)}
              >×</button>
            </div>
          `,
        )}
        <button type="button" @click=${this.addConsumer}>
          ${translations(cardLanguage(this.hass?.language)).addConsumer}
        </button>
      </section>
    `;
  }

  private readonly computeLabel = (field: {
    name: SolarEnergyEntityRole;
  }): string =>
    translations(cardLanguage(this.hass?.language)).sensorLabels[field.name];

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
      consumers: this.consumers,
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

  private readonly addConsumer = (): void => {
    this.consumers = [
      ...this.consumers,
      {
        entity: "",
        color:
          CONSUMER_DEFAULT_COLORS[
            this.consumers.length % CONSUMER_DEFAULT_COLORS.length
          ],
      },
    ];
    this.emitConfig();
  };

  private handleConsumerEntityChanged(
    index: number,
    event: CustomEvent<{ value: { entity?: string } }>,
  ): void {
    this.consumers = this.consumers.map((consumer, current) =>
      current === index
        ? { ...consumer, entity: event.detail.value.entity ?? "" }
        : consumer,
    );
    this.emitConfig();
  }

  private handleConsumerColorChanged(index: number, event: Event): void {
    const color = (event.currentTarget as HTMLInputElement).value;
    this.consumers = this.consumers.map((consumer, current) =>
      current === index ? { ...consumer, color } : consumer,
    );
    this.emitConfig();
  }

  private moveConsumer(index: number, direction: -1 | 1): void {
    const destination = index + direction;
    if (destination < 0 || destination >= this.consumers.length) {
      return;
    }
    const consumers = [...this.consumers];
    [consumers[index], consumers[destination]] = [
      consumers[destination],
      consumers[index],
    ];
    this.consumers = consumers;
    this.emitConfig();
  }

  private removeConsumer(index: number): void {
    this.consumers = this.consumers.filter((_, current) => current !== index);
    this.emitConfig();
  }

  private emitConfig(): void {
    const config: SolarEnergyGraphsCardConfig = {
      ...this.config,
      type: this.config?.type ?? "custom:solar-energy-graphs-card",
      entities: this.values,
      consumers: this.consumers,
    };
    this.config = config;
    this.dispatchEvent(
      new CustomEvent("config-changed", {
        detail: { config },
        bubbles: true,
        composed: true,
      }),
    );
  }
}

if (!customElements.get("solar-energy-graphs-card-editor")) {
  customElements.define(
    "solar-energy-graphs-card-editor",
    SolarEnergyGraphsCardEditor,
  );
}
