import { LitElement, css, html, unsafeCSS } from "lit";
import { uPlotStyles } from "./uplot-adapter";

const CARD_TYPE = "custom:solar-energy-graphs-card";
const ELEMENT_NAME = "solar-energy-graphs-card";

interface SolarEnergyGraphsCardConfig {
  type: string;
}

export class SolarEnergyGraphsCard extends LitElement {
  static styles = css`
    ${unsafeCSS(uPlotStyles)}

    :host {
      display: block;
    }

    .placeholder {
      display: grid;
      min-height: 6rem;
      place-items: center;
      color: var(--secondary-text-color);
    }
  `;

  setConfig(config: SolarEnergyGraphsCardConfig): void {
    if (config.type !== CARD_TYPE) {
      throw new Error(`Expected card type "${CARD_TYPE}".`);
    }
  }

  getCardSize(): number {
    return 2;
  }

  render() {
    return html`
      <ha-card>
        <div class="placeholder">Solar Energy Graphs Card</div>
      </ha-card>
    `;
  }
}

if (!customElements.get(ELEMENT_NAME)) {
  customElements.define(ELEMENT_NAME, SolarEnergyGraphsCard);
}
