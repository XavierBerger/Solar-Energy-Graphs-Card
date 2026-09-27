import { LitElement, css, html, unsafeCSS } from "lit";
import { EnergyChartsRenderer } from "./energy-charts-renderer";
import { uPlotStyles } from "./uplot-adapter";

const CARD_TYPE = "custom:solar-energy-graphs-card";
const ELEMENT_NAME = "solar-energy-graphs-card";

interface SolarEnergyGraphsCardConfig {
  type: string;
}

interface HomeAssistantThemeContext {
  themes?: {
    darkMode?: boolean;
  };
}

export class SolarEnergyGraphsCard extends LitElement {
  private chartRenderer?: EnergyChartsRenderer;
  private darkMode = false;

  set hass(hass: HomeAssistantThemeContext) {
    this.darkMode = hass.themes?.darkMode === true;
    this.chartRenderer?.refreshTheme(this.darkMode);
  }

  static styles = css`
    ${unsafeCSS(uPlotStyles)}

    :host {
      display: block;
      height: calc(100dvh - var(--header-height, 64px) - 2rem);
    }

    ha-card {
      box-sizing: border-box;
      display: block;
      height: 100%;
      padding: 1rem;
    }

    .graphs {
      display: grid;
      height: 100%;
      grid-template-columns: minmax(0, 1fr);
      grid-template-rows: minmax(0, 7fr) minmax(0, 3fr);
      gap: 0.75rem;
    }

    .graph {
      display: flex;
      flex-direction: column;
      min-width: 0;
      min-height: 0;
    }

    .graph h2 {
      flex: 0 0 auto;
      margin: 0 0 0.25rem;
      color: var(--primary-text-color);
      font-size: var(--ha-font-size-l, 1.25rem);
      font-weight: var(--ha-font-weight-medium, 500);
    }

    .graph-note {
      flex: 0 0 auto;
      margin: 0 0 0.25rem;
      color: var(--secondary-text-color);
      font-size: var(--ha-font-size-s, 0.875rem);
    }

    .chart {
      flex: 1 1 0;
      min-width: 0;
      min-height: 0;
    }
  `;

  setConfig(config: SolarEnergyGraphsCardConfig): void {
    if (config.type !== CARD_TYPE) {
      throw new Error(`Expected card type "${CARD_TYPE}".`);
    }
  }

  getCardSize(): number {
    return 12;
  }

  connectedCallback(): void {
    super.connectedCallback();

    if (this.hasUpdated) {
      void this.updateComplete.then(() => {
        if (this.isConnected) {
          this.initializeCharts();
        }
      });
    }
  }

  disconnectedCallback(): void {
    this.chartRenderer?.destroy();
    this.chartRenderer = undefined;
    super.disconnectedCallback();
  }

  protected updated(): void {
    this.initializeCharts();
  }

  render() {
    return html`
      <ha-card>
        <div class="graphs">
          <section class="graph" aria-labelledby="graph-one-title">
            <h2 id="graph-one-title">Graphique de démonstration 1</h2>
            <p class="graph-note">Données artificielles de démonstration</p>
            <div class="chart" data-chart="one"></div>
          </section>
          <section class="graph" aria-labelledby="graph-two-title">
            <h2 id="graph-two-title">Graphique de démonstration 2</h2>
            <p class="graph-note">Données artificielles de démonstration</p>
            <div class="chart" data-chart="two"></div>
          </section>
        </div>
      </ha-card>
    `;
  }

  private initializeCharts(): void {
    if (!this.isConnected || this.chartRenderer) {
      return;
    }

    const first = this.shadowRoot?.querySelector<HTMLElement>(
      '[data-chart="one"]',
    );
    const second = this.shadowRoot?.querySelector<HTMLElement>(
      '[data-chart="two"]',
    );

    if (first && second) {
      this.chartRenderer = new EnergyChartsRenderer(
        [first, second],
        this.darkMode,
      );
    }
  }
}

if (!customElements.get(ELEMENT_NAME)) {
  customElements.define(ELEMENT_NAME, SolarEnergyGraphsCard);
}
