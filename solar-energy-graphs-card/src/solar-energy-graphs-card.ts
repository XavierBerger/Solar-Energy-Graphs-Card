import { LitElement, css, html, unsafeCSS } from "lit";
import { EnergyChartsRenderer } from "./energy-charts-renderer";
import { uPlotStyles } from "./uplot-adapter";
import {
  buildHistoryApiPath,
  getEnergyUnitScales,
  getLocalDayWindow,
  normalizeEnergyHistory,
  type EnergyUnitScales,
  type EnergySensorMetadata,
  type EnergyHistoryResponse,
  type HomeAssistantHistoryState,
} from "./home-assistant-energy-history";

const CARD_TYPE = "custom:solar-energy-graphs-card";
const ELEMENT_NAME = "solar-energy-graphs-card";

interface SolarEnergyGraphsCardConfig {
  type: string;
  entities: {
    production: string;
    consumption: string;
    grid_import: string;
    grid_export: string;
  };
}

interface HomeAssistantThemeContext {
  themes?: {
    darkMode?: boolean;
  };
  config: {
    time_zone: string;
  };
  states?: Record<
    string,
    {
      state: string;
      last_updated?: string;
      last_changed?: string;
      attributes?: EnergySensorMetadata;
    }
  >;
  callApi(
    method: string,
    path: string,
  ): Promise<readonly (readonly HomeAssistantHistoryState[])[]>;
}

export class SolarEnergyGraphsCard extends LitElement {
  private chartRenderer?: EnergyChartsRenderer;
  private config?: SolarEnergyGraphsCardConfig;
  private hassContext?: HomeAssistantThemeContext;
  private darkMode = false;
  private historyData?: EnergyHistoryResponse;
  private historySignature = "";
  private historyRequestId = 0;
  private mainStatus = "En attente des données Home Assistant.";
  private gridStatus = "En attente des données Home Assistant.";

  set hass(hass: HomeAssistantThemeContext) {
    this.hassContext = hass;
    this.darkMode = hass.themes?.darkMode === true;
    this.chartRenderer?.refreshTheme(this.darkMode);
    this.loadHistoryWhenNeeded(hass);
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
      display: flex;
      flex: 1 1 0;
      flex-direction: column;
      min-width: 0;
      min-height: 0;
    }

    .chart-plot {
      flex: 1 1 0;
      min-width: 0;
      min-height: 0;
    }

    .chart-legend {
      flex: 0 0 auto;
      max-width: 100%;
      min-width: 0;
      overflow-x: auto;
      overflow-y: hidden;
    }

    .chart-legend .u-legend {
      margin: 0 auto;
      max-width: 100%;
      width: max-content;
      white-space: nowrap;
    }

    .chart .u-legend .u-series.hide-helper-legend {
      display: none;
    }

    .chart-status {
      flex: 0 0 auto;
      margin: 0 0 0.25rem;
      color: var(--secondary-text-color);
      font-size: var(--ha-font-size-s, 0.875rem);
    }

    .chart-status[role="alert"] {
      color: var(--error-color, #db4437);
    }
  `;

  setConfig(config: SolarEnergyGraphsCardConfig): void {
    if (config.type !== CARD_TYPE) {
      throw new Error(`Expected card type "${CARD_TYPE}".`);
    }
    const entities = config.entities;
    if (
      !entities ||
      ![
        entities.production,
        entities.consumption,
        entities.grid_import,
        entities.grid_export,
      ].every((entityId) => typeof entityId === "string" && entityId.trim().length > 0)
    ) {
      throw new Error(
        'Configure "entities.production", "entities.consumption", "entities.grid_import", and "entities.grid_export".',
      );
    }
    this.config = {
      ...config,
      entities: {
        production: entities.production.trim(),
        consumption: entities.consumption.trim(),
        grid_import: entities.grid_import.trim(),
        grid_export: entities.grid_export.trim(),
      },
    };
    this.historyData = undefined;
    this.historySignature = "";
    this.historyRequestId += 1;
    this.loadHistoryWhenNeeded(this.hassContext);
    this.requestUpdate();
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
          this.loadHistoryWhenNeeded(this.hassContext);
        }
      });
    }
  }

  disconnectedCallback(): void {
    this.historyRequestId += 1;
    this.historySignature = "";
    this.chartRenderer?.destroy();
    this.chartRenderer = undefined;
    super.disconnectedCallback();
  }

  protected updated(): void {
    this.initializeCharts();
    this.loadHistoryWhenNeeded(this.hassContext);
  }

  render() {
    return html`
      <ha-card>
        <div class="graphs">
          <section class="graph" aria-labelledby="graph-one-title">
            <h2 id="graph-one-title">Production et consommation</h2>
            <p
              class="chart-status"
              role=${this.mainStatus.startsWith("Erreur") ? "alert" : "status"}
              aria-live="polite"
            >
              ${this.mainStatus}
            </p>
            <div class="chart">
              <div class="chart-plot" data-chart="one"></div>
              <div class="chart-legend" data-legend="one"></div>
            </div>
          </section>
          <section class="graph" aria-labelledby="graph-two-title">
            <h2 id="graph-two-title">Échanges avec le réseau</h2>
            <p
              class="chart-status"
              role=${this.gridStatus.startsWith("Erreur") ? "alert" : "status"}
              aria-live="polite"
            >
              ${this.gridStatus}
            </p>
            <div class="chart">
              <div class="chart-plot" data-chart="two"></div>
              <div class="chart-legend" data-legend="two"></div>
            </div>
          </section>
        </div>
      </ha-card>
    `;
  }

  private initializeCharts(): void {
    if (
      !this.isConnected ||
      this.chartRenderer ||
      !this.historyData ||
      !this.hassContext
    ) {
      return;
    }

    const first = this.shadowRoot?.querySelector<HTMLElement>(
      '[data-chart="one"]',
    );
    const second = this.shadowRoot?.querySelector<HTMLElement>(
      '[data-chart="two"]',
    );
    const firstLegend = this.shadowRoot?.querySelector<HTMLElement>(
      '[data-legend="one"]',
    );
    const secondLegend = this.shadowRoot?.querySelector<HTMLElement>(
      '[data-legend="two"]',
    );

    if (first && second && firstLegend && secondLegend) {
      this.chartRenderer = new EnergyChartsRenderer(
        [first, second],
        [firstLegend, secondLegend],
        this.historyData,
        this.hassContext.config.time_zone,
        this.darkMode,
      );
    }
  }

  private loadHistoryWhenNeeded(
    hass: HomeAssistantThemeContext | undefined,
  ): void {
    const config = this.config;
    if (!this.isConnected || !hass || !config) {
      return;
    }

    const timeZone = hass.config.time_zone;
    const now = new Date();
    const dayWindow = getLocalDayWindow(now, timeZone);
    const entityIds = [
      config.entities.production,
      config.entities.consumption,
      config.entities.grid_import,
      config.entities.grid_export,
    ] as const;
    const stateSignature = entityIds
      .map((entityId) => {
        const state = hass.states?.[entityId];
        return `${entityId}:${state?.last_updated ?? state?.state ?? "missing"}:${JSON.stringify(state?.attributes)}`;
      })
      .join("|");
    const signature = `${timeZone}:${dayWindow.start}:${stateSignature}`;
    if (signature === this.historySignature) {
      return;
    }

    this.historySignature = signature;
    const requestId = ++this.historyRequestId;
    this.mainStatus = "Chargement de l’historique Home Assistant…";
    this.gridStatus = this.mainStatus;
    queueMicrotask(() => {
      if (this.isConnected && requestId === this.historyRequestId) {
        this.requestUpdate();
      }
    });
    let unitScales: EnergyUnitScales;
    try {
      unitScales = getEnergyUnitScales([
        hass.states?.[entityIds[0]]?.attributes,
        hass.states?.[entityIds[1]]?.attributes,
        hass.states?.[entityIds[2]]?.attributes,
        hass.states?.[entityIds[3]]?.attributes,
      ]);
    } catch (error) {
      const details = error instanceof Error ? error.message : String(error);
      this.mainStatus = `Erreur de configuration des capteurs : ${details}`;
      this.gridStatus = this.mainStatus;
      queueMicrotask(() => {
        if (this.isConnected && requestId === this.historyRequestId) {
          this.requestUpdate();
        }
      });
      return;
    }

    const apiPath = buildHistoryApiPath(
      entityIds,
      dayWindow,
      now.getTime() / 1000,
    );
    void this.fetchHistory(
      hass,
      apiPath,
      dayWindow,
      timeZone,
      unitScales,
      requestId,
    );
  }

  private async fetchHistory(
    hass: HomeAssistantThemeContext,
    apiPath: string,
    dayWindow: ReturnType<typeof getLocalDayWindow>,
    timeZone: string,
    unitScales: EnergyUnitScales,
    requestId: number,
  ): Promise<void> {
    try {
      const history = await hass.callApi("GET", apiPath);
      const data = normalizeEnergyHistory(
        history,
        dayWindow,
        Date.now() / 1000,
        unitScales,
      );
      if (!this.isConnected || requestId !== this.historyRequestId) {
        return;
      }

      this.historyData = data;
      this.mainStatus =
        data.hasProduction && data.hasConsumption
          ? "Puissance moyenne par intervalle d’une minute."
          : "Erreur : historique de production ou de consommation indisponible pour aujourd’hui.";
      this.gridStatus =
        data.hasGridImport && data.hasGridExport
          ? "Import et export mesurés séparément."
          : "Erreur : historique d’import ou d’export indisponible pour aujourd’hui.";
      if (this.chartRenderer) {
        this.chartRenderer.updateData(data);
      } else {
        this.initializeCharts();
      }
      this.requestUpdate();
    } catch (error) {
      if (!this.isConnected || requestId !== this.historyRequestId) {
        return;
      }
      const details = error instanceof Error ? error.message : String(error);
      this.mainStatus = `Erreur de chargement de l’historique : ${details}`;
      this.gridStatus = this.mainStatus;
      this.requestUpdate();
    }
  }
}

if (!customElements.get(ELEMENT_NAME)) {
  customElements.define(ELEMENT_NAME, SolarEnergyGraphsCard);
}
