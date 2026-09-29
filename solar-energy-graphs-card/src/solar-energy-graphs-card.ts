import { LitElement, css, html, unsafeCSS } from "lit";
import { EnergyChartsRenderer } from "./energy-charts-renderer";
import { uPlotStyles } from "./uplot-adapter";
import {
  buildHistoryRequest,
  getEnergyUnitScales,
  getLocalDateString,
  getLocalDayWindowForDate,
  historyStatesOf,
  mergeLiveEnergySamples,
  parseCompressedPowerSamples,
  parsePowerState,
  projectEnergyHistory,
  replaceSensorHistory,
  shiftLocalDate,
  type EnergyPowerSamples,
  type EnergyUnitScales,
  type EnergySensorMetadata,
  type EnergyHistoryResponse,
  type HistoryDuringPeriodMessage,
  type HistoryDuringPeriodResponse,
  type LivePowerSample,
  type LocalDayWindow,
  type NumericSample,
} from "./home-assistant-energy-history";

const CARD_TYPE = "custom:solar-energy-graphs-card";
const ELEMENT_NAME = "solar-energy-graphs-card";
// Home Assistant pushes each sensor separately; merge a burst in one pass.
const LIVE_UPDATE_COALESCE_MS = 250;
const LOADING_STATUS = "Loading Home Assistant history…";

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
  callWS(message: HistoryDuringPeriodMessage): Promise<HistoryDuringPeriodResponse>;
}

export class SolarEnergyGraphsCard extends LitElement {
  private chartRenderer?: EnergyChartsRenderer;
  private config?: SolarEnergyGraphsCardConfig;
  private hassContext?: HomeAssistantThemeContext;
  private darkMode = false;
  private historyData?: EnergyHistoryResponse;
  private historyModel?: {
    samples: EnergyPowerSamples;
    window: LocalDayWindow;
    unitScales: EnergyUnitScales;
    /** Sensors whose history request has not settled yet. */
    pending: number;
    loadError?: string;
  };
  private historyLoadKey = "";
  private historyRequestId = 0;
  private liveUpdateTimer?: ReturnType<typeof setTimeout>;
  private selectedDay?: string;
  private selectedDayTimeZone?: string;
  private mainStatus = "Waiting for Home Assistant data.";
  private gridStatus = "Waiting for Home Assistant data.";

  set hass(hass: HomeAssistantThemeContext) {
    const timeZoneChanged =
      this.selectedDayTimeZone !== hass.config.time_zone;
    this.hassContext = hass;
    this.darkMode = hass.themes?.darkMode === true;
    if (!this.selectedDay || timeZoneChanged) {
      this.selectedDay = getLocalDateString(
        new Date(),
        hass.config.time_zone,
      );
      this.selectedDayTimeZone = hass.config.time_zone;
      this.requestUpdate();
    }
    this.chartRenderer?.refreshTheme(this.darkMode);
    this.loadHistoryWhenNeeded(hass);
    this.scheduleLiveMerge();
  }

  static styles = css`
    ${unsafeCSS(uPlotStyles)}

    :host {
      display: block;
      height: calc(100dvh - var(--header-height, 64px) - 2rem);
    }

    ha-card {
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      height: 100%;
      padding: 1rem;
    }

    .day-navigation {
      align-items: center;
      align-self: flex-end;
      display: flex;
      flex: 0 0 auto;
      gap: 0.5rem;
      margin-bottom: 0.5rem;
    }

    .day-navigation time {
      color: var(--primary-text-color);
      font-size: var(--ha-font-size-m, 1rem);
      font-weight: var(--ha-font-weight-medium, 500);
      text-align: center;
    }

    .day-navigation button {
      align-items: center;
      background: var(--secondary-background-color);
      border: 1px solid var(--divider-color);
      border-radius: var(--ha-card-border-radius, 0.5rem);
      color: var(--primary-text-color);
      cursor: pointer;
      display: inline-flex;
      font: inherit;
      height: 2.25rem;
      justify-content: center;
      padding: 0;
      width: 2.25rem;
    }

    .day-navigation button:focus-visible {
      outline: 2px solid var(--primary-color);
      outline-offset: 2px;
    }

    .day-navigation button:disabled {
      cursor: default;
      opacity: 0.45;
    }

    .graphs {
      display: grid;
      flex: 1 1 0;
      grid-template-columns: minmax(0, 1fr);
      grid-template-rows: minmax(0, 7fr) minmax(0, 3fr);
      gap: 0.75rem;
      min-height: 0;
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

    .chart .u-legend .u-series.legend-values-only {
      pointer-events: none;
    }

    .chart .u-legend .u-series.legend-values-only > * {
      opacity: 1;
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
    this.historyModel = undefined;
    this.historyLoadKey = "";
    this.historyRequestId += 1;
    this.cancelLiveMerge();
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
    this.historyLoadKey = "";
    this.historyModel = undefined;
    this.cancelLiveMerge();
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
        <nav class="day-navigation" aria-label="Day navigation">
          <button
            type="button"
            aria-label="Previous day"
            title="Previous day"
            @click=${this.showAdjacentDay(-1)}
          >
            <span aria-hidden="true">←</span>
          </button>
          <time datetime=${this.selectedDay ?? ""} aria-live="polite">
            ${this.formatSelectedDay()}
          </time>
          <button
            type="button"
            aria-label="Next day"
            title="Next day"
            ?disabled=${this.isTodaySelected()}
            @click=${this.showAdjacentDay(1)}
          >
            <span aria-hidden="true">→</span>
          </button>
        </nav>
        <div class="graphs">
          <section class="graph" aria-labelledby="graph-one-title">
            <h2 id="graph-one-title">Solar Production and Consumption</h2>
            <p
              class="chart-status"
              role=${this.mainStatus.startsWith("Error") ? "alert" : "status"}
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
            <h2 id="graph-two-title">Grid Exchange</h2>
            <p
              class="chart-status"
              role=${this.gridStatus.startsWith("Error") ? "alert" : "status"}
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
    const selectedDay = this.selectedDay ?? getLocalDateString(now, timeZone);
    const dayWindow = getLocalDayWindowForDate(selectedDay, timeZone);
    const entityIds = configuredEntityIds(config);
    // Live state changes are merged by mergeLiveStates, never reloaded here.
    const loadKey = `${timeZone}:${selectedDay}:${entityIds.join(",")}`;
    if (loadKey === this.historyLoadKey) {
      return;
    }

    this.historyLoadKey = loadKey;
    this.historyModel = undefined;
    const requestId = ++this.historyRequestId;
    this.mainStatus = LOADING_STATUS;
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
      this.mainStatus = `Sensor configuration error: ${details}`;
      this.gridStatus = this.mainStatus;
      queueMicrotask(() => {
        if (this.isConnected && requestId === this.historyRequestId) {
          this.requestUpdate();
        }
      });
      return;
    }

    this.historyModel = {
      samples: [[], [], [], []],
      window: dayWindow,
      unitScales,
      pending: entityIds.length,
    };
    const scales = sensorUnitScales(unitScales);
    const nowSeconds = now.getTime() / 1000;
    // One request per sensor: each chart series is drawn as soon as it arrives.
    entityIds.forEach((entityId, sensor) => {
      void this.fetchSensorHistory(
        hass,
        entityId,
        sensor as LivePowerSample["sensor"],
        buildHistoryRequest(entityId, dayWindow, nowSeconds),
        scales[sensor],
        requestId,
      );
    });
  }

  private async fetchSensorHistory(
    hass: HomeAssistantThemeContext,
    entityId: string,
    sensor: LivePowerSample["sensor"],
    request: HistoryDuringPeriodMessage,
    unitScale: number,
    requestId: number,
  ): Promise<void> {
    let history: NumericSample[] | undefined;
    let loadError: string | undefined;
    try {
      const response = await hass.callWS(request);
      history = parseCompressedPowerSamples(
        historyStatesOf(response, entityId),
        unitScale,
      );
    } catch (error) {
      loadError = error instanceof Error ? error.message : String(error);
    }
    const model = this.historyModel;
    if (!this.isConnected || requestId !== this.historyRequestId || !model) {
      return;
    }

    this.historyModel = {
      ...model,
      samples: history
        ? replaceSensorHistory(model.samples, sensor, history)
        : model.samples,
      pending: model.pending - 1,
      loadError: model.loadError ?? loadError,
    };
    this.showHistoryData(
      projectEnergyHistory(
        this.historyModel.samples,
        model.window,
        Date.now() / 1000,
      ),
    );
  }

  private scheduleLiveMerge(): void {
    if (this.liveUpdateTimer !== undefined || !this.historyModel) {
      return;
    }
    this.liveUpdateTimer = setTimeout(() => {
      this.liveUpdateTimer = undefined;
      // Read hass when the timer fires: it holds the last state of the burst.
      if (this.hassContext) {
        this.mergeLiveStates(this.hassContext);
      }
    }, LIVE_UPDATE_COALESCE_MS);
  }

  private cancelLiveMerge(): void {
    clearTimeout(this.liveUpdateTimer);
    this.liveUpdateTimer = undefined;
  }

  private mergeLiveStates(hass: HomeAssistantThemeContext): void {
    const model = this.historyModel;
    if (!model || !this.config || !this.isTodaySelected()) {
      return;
    }

    const scales = sensorUnitScales(model.unitScales);
    const live = configuredEntityIds(this.config).flatMap(
      (entityId, sensor): LivePowerSample[] => {
        const state = hass.states?.[entityId];
        const sample = state && parsePowerState(state, scales[sensor]);
        return sample ? [{ ...sample, sensor: sensor as 0 | 1 | 2 | 3 }] : [];
      },
    );
    const samples = mergeLiveEnergySamples(model.samples, live);
    if (samples === model.samples) {
      return;
    }

    this.historyModel = { ...model, samples };
    this.showHistoryData(
      projectEnergyHistory(samples, model.window, Date.now() / 1000),
    );
  }

  private showHistoryData(data: EnergyHistoryResponse): void {
    this.historyData = data;
    this.updateHistoryStatus(data);
    if (this.chartRenderer) {
      this.chartRenderer.updateData(data);
    } else {
      this.initializeCharts();
    }
    this.requestUpdate();
  }

  private updateHistoryStatus(data: EnergyHistoryResponse): void {
    const model = this.historyModel;
    if (model?.loadError !== undefined && model.pending === 0) {
      this.mainStatus = `History loading error: ${model.loadError}`;
      this.gridStatus = this.mainStatus;
      return;
    }
    // Missing series are expected until every sensor history has arrived.
    if (model && model.pending > 0) {
      this.mainStatus = LOADING_STATUS;
      this.gridStatus = LOADING_STATUS;
      return;
    }
    this.mainStatus =
      data.hasProduction && data.hasConsumption
        ? "Recorded power samples."
        : `Error: ${this.formatSelectedDay()} production or consumption history is unavailable.`;
    this.gridStatus =
      data.hasGridImport && data.hasGridExport
        ? "Grid import and export are measured separately."
        : `Error: ${this.formatSelectedDay()} grid import or export history is unavailable.`;
  }

  private formatSelectedDay(): string {
    if (!this.selectedDay) {
      return "";
    }
    const [year, month, day] = this.selectedDay.split("-").map(Number);
    return new Intl.DateTimeFormat("en-US", {
      dateStyle: "long",
      timeZone: "UTC",
    }).format(Date.UTC(year, month - 1, day, 12));
  }

  private isTodaySelected(): boolean {
    const hass = this.hassContext;
    return (
      !this.selectedDay ||
      !hass ||
      this.selectedDay >=
        getLocalDateString(new Date(), hass.config.time_zone)
    );
  }

  private showAdjacentDay(days: -1 | 1): () => void {
    return () => {
      const hass = this.hassContext;
      if (
        !hass ||
        !this.selectedDay ||
        (days === 1 && this.isTodaySelected())
      ) {
        return;
      }
      this.selectedDay = shiftLocalDate(this.selectedDay, days);
      this.requestUpdate();
      this.loadHistoryWhenNeeded(hass);
    };
  }
}

function configuredEntityIds(
  config: SolarEnergyGraphsCardConfig,
): readonly [string, string, string, string] {
  return [
    config.entities.production,
    config.entities.consumption,
    config.entities.grid_import,
    config.entities.grid_export,
  ];
}

function sensorUnitScales(
  unitScales: EnergyUnitScales,
): readonly [number, number, number, number] {
  return [
    unitScales.productionToW,
    unitScales.consumptionToW,
    unitScales.gridImportToW,
    unitScales.gridExportToW,
  ];
}

if (!customElements.get(ELEMENT_NAME)) {
  customElements.define(ELEMENT_NAME, SolarEnergyGraphsCard);
}
