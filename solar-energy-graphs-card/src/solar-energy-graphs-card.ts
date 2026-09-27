import { LitElement, css, html, unsafeCSS } from "lit";
import { EnergyChartsRenderer } from "./energy-charts-renderer";
import { uPlotStyles } from "./uplot-adapter";

const CARD_TYPE = "custom:solar-energy-graphs-card";
const ELEMENT_NAME = "solar-energy-graphs-card";

interface SolarEnergyGraphsCardConfig {
  type: string;
}

export class SolarEnergyGraphsCard extends LitElement {
  private chartRenderer?: EnergyChartsRenderer;

  static styles = css`
    ${unsafeCSS(uPlotStyles)}

    :host {
      display: block;
    }

    ha-card {
      padding: 1rem;
    }

    .graphs {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      gap: 1.5rem;
    }

    .graph {
      min-width: 0;
    }

    .graph h2 {
      margin: 0 0 0.5rem;
      color: var(--primary-text-color);
      font-size: var(--ha-font-size-l, 1.25rem);
      font-weight: var(--ha-font-weight-medium, 500);
    }

    .graph-note {
      margin: 0 0 0.5rem;
      color: var(--secondary-text-color);
      font-size: var(--ha-font-size-s, 0.875rem);
    }

    .chart {
      width: 100%;
      height: 180px;
    }
  `;

  setConfig(config: SolarEnergyGraphsCardConfig): void {
    if (config.type !== CARD_TYPE) {
      throw new Error(`Expected card type "${CARD_TYPE}".`);
    }
  }

  getCardSize(): number {
    return 9;
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
      this.chartRenderer = new EnergyChartsRenderer([first, second]);
    }
  }
}

if (!customElements.get(ELEMENT_NAME)) {
  customElements.define(ELEMENT_NAME, SolarEnergyGraphsCard);
}
