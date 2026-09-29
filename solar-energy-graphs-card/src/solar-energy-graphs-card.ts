import { LitElement, css, html, unsafeCSS } from "lit";
import { EnergyChartsRenderer } from "./energy-charts-renderer";
import { uPlotStyles } from "./uplot-adapter";
import {
  buildHistoryRequest,
  buildStatisticsRequest,
  combineStatistics,
  entityRowsOf,
  getEnergyUnitScales,
  getLocalDateString,
  getLocalDayWindowForDate,
  mergeLiveEnergySamples,
  NO_STATISTICS,
  parseCompressedPowerSamples,
  parsePowerState,
  parseStatisticRows,
  projectEnergyHistory,
  replaceSensorHistory,
  shiftLocalDate,
  type EnergyPowerSamples,
  type EnergyStatistics,
  type EnergyUnitScales,
  type EnergySensorMetadata,
  type EnergyHistoryResponse,
  type HistoryDuringPeriodMessage,
  type HistoryDuringPeriodResponse,
  type LivePowerSample,
  type LocalDayWindow,
  type StatisticsDuringPeriodMessage,
  type StatisticsDuringPeriodResponse,
} from "./home-assistant-energy-history";

const CARD_TYPE = "custom:solar-energy-graphs-card";
const ELEMENT_NAME = "solar-energy-graphs-card";
// Home Assistant pushes each sensor separately; merge a burst in one pass.
const LIVE_UPDATE_COALESCE_MS = 250;
const LOADING_STATUS = "Loading Home Assistant history…";
const STATISTICS_PERIOD_SECONDS = 5 * 60;
// Home Assistant compiles 5-minute statistics shortly after each boundary.
const STATISTICS_REFRESH_DELAY_SECONDS = 30;
// Raw states cover the current day after its last compiled interval.
const RAW_TAIL_SECONDS = 15 * 60;

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
  callWS(
    message: StatisticsDuringPeriodMessage,
  ): Promise<StatisticsDuringPeriodResponse>;
}

export class SolarEnergyGraphsCard extends LitElement {
  private chartRenderer?: EnergyChartsRenderer;
  private config?: SolarEnergyGraphsCardConfig;
  private hassContext?: HomeAssistantThemeContext;
  private darkMode = false;
  private historyData?: EnergyHistoryResponse;
  private historyModel?: {
    statistics: EnergyStatistics;
    /** Raw states in W, drawn after each sensor's last statistics interval. */
    samples: EnergyPowerSamples;
    window: LocalDayWindow;
    unitScales: EnergyUnitScales;
    loading: boolean;
    loadError?: string;
  };
  private historyLoadKey = "";
  private historyRequestId = 0;
  private liveUpdateTimer?: ReturnType<typeof setTimeout>;
  private statisticsRefreshTimer?: ReturnType<typeof setTimeout>;
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
      white-space: nowrap;
    }

    .day-navigation .selected-day {
      background: transparent;
      border: 0;
      color: inherit;
      font: inherit;
      padding: 0.5rem;
      width: 75%
    }

    .day-navigation .selected-day:focus-visible {
      border-radius: 0.25rem;
      outline: 2px solid var(--primary-color);
      outline-offset: 2px;
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
    this.cancelStatisticsRefresh();
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
    this.cancelStatisticsRefresh();
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
          <button
            type="button"
            class="selected-day"
            aria-label="Return to today"
            title="Return to today"
            @click=${this.showToday}
          >
            <time datetime=${this.selectedDay ?? ""} aria-live="polite">
              ${this.formatSelectedDay()}
            </time>
          </button>
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
    this.cancelStatisticsRefresh();
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
      this.mainStatus = `Sensor configuration error: ${errorMessage(error)}`;
      this.gridStatus = this.mainStatus;
      queueMicrotask(() => {
        if (this.isConnected && requestId === this.historyRequestId) {
          this.requestUpdate();
        }
      });
      return;
    }

    this.historyModel = {
      statistics: NO_STATISTICS,
      samples: [[], [], [], []],
      window: dayWindow,
      unitScales,
      loading: true,
    };
    void this.fetchHistory(hass, entityIds, requestId);
  }

  private async fetchHistory(
    hass: HomeAssistantThemeContext,
    entityIds: readonly [string, string, string, string],
    requestId: number,
  ): Promise<void> {
    const model = this.historyModel;
    if (!model) {
      return;
    }
    const now = Date.now() / 1000;
    const today = this.isTodaySelected();
    const [statistics, tail] = await Promise.allSettled([
      fetchStatistics(hass, entityIds, model.window, now),
      today
        ? hass.callWS(
          buildHistoryRequest(entityIds, now - RAW_TAIL_SECONDS, now),
        )
        : Promise.resolve<HistoryDuringPeriodResponse>({}),
    ]);
    const current = this.historyModel;
    if (!this.isConnected || requestId !== this.historyRequestId || !current) {
      return;
    }

    let samples = current.samples;
    let loadError =
      statistics.status === "rejected" ? errorMessage(statistics.reason) : undefined;
    try {
      if (tail.status === "rejected") {
        throw tail.reason;
      }
      const scales = sensorUnitScales(current.unitScales);
      entityIds.forEach((entityId, sensor) => {
        samples = replaceSensorHistory(
          samples,
          sensor as LivePowerSample["sensor"],
          parseCompressedPowerSamples(
            entityRowsOf(tail.value, entityId),
            scales[sensor],
          ),
        );
      });
    } catch (error) {
      loadError ??= errorMessage(error);
    }
    this.historyModel = {
      ...current,
      statistics:
        statistics.status === "fulfilled" ? statistics.value : current.statistics,
      samples,
      loading: false,
      loadError,
    };
    this.showCurrentModel();
    if (today) {
      this.scheduleStatisticsRefresh(hass, entityIds, requestId);
    }
  }

  private scheduleStatisticsRefresh(
    hass: HomeAssistantThemeContext,
    entityIds: readonly [string, string, string, string],
    requestId: number,
  ): void {
    const now = Date.now() / 1000;
    const nextBoundary =
      (Math.floor(now / STATISTICS_PERIOD_SECONDS) + 1) * STATISTICS_PERIOD_SECONDS;
    const delay = nextBoundary + STATISTICS_REFRESH_DELAY_SECONDS - now;
    this.cancelStatisticsRefresh();
    this.statisticsRefreshTimer = setTimeout(() => {
      this.statisticsRefreshTimer = undefined;
      void this.refreshStatistics(hass, entityIds, requestId);
    }, delay * 1000);
  }

  private cancelStatisticsRefresh(): void {
    clearTimeout(this.statisticsRefreshTimer);
    this.statisticsRefreshTimer = undefined;
  }

  private async refreshStatistics(
    hass: HomeAssistantThemeContext,
    entityIds: readonly [string, string, string, string],
    requestId: number,
  ): Promise<void> {
    const model = this.historyModel;
    if (!model || !this.isTodaySelected()) {
      return;
    }
    let statistics: EnergyStatistics | undefined;
    let loadError: string | undefined;
    try {
      statistics = await fetchStatistics(
        hass,
        entityIds,
        model.window,
        Date.now() / 1000,
      );
    } catch (error) {
      loadError = errorMessage(error);
    }
    const current = this.historyModel;
    if (!this.isConnected || requestId !== this.historyRequestId || !current) {
      return;
    }

    this.historyModel = {
      ...current,
      statistics: statistics ?? current.statistics,
      loadError,
    };
    this.showCurrentModel();
    this.scheduleStatisticsRefresh(hass, entityIds, requestId);
  }

  private showCurrentModel(): void {
    const model = this.historyModel;
    if (model) {
      this.showHistoryData(
        projectEnergyHistory(
          model.samples,
          model.window,
          Date.now() / 1000,
          model.statistics,
        ),
      );
    }
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
    this.showCurrentModel();
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
    // Missing series are expected until every request has settled.
    if (model?.loading) {
      this.mainStatus = LOADING_STATUS;
      this.gridStatus = LOADING_STATUS;
      return;
    }
    if (model?.loadError !== undefined) {
      this.mainStatus = `History loading error: ${model.loadError}`;
      this.gridStatus = this.mainStatus;
      return;
    }
    this.mainStatus =
      data.hasProduction && data.hasConsumption
        ? "Power statistics: mean line with min–max range."
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

  private showToday = (): void => {
    const hass = this.hassContext;
    if (!hass) {
      return;
    }
    const today = getLocalDateString(new Date(), hass.config.time_zone);
    if (this.selectedDay === today) {
      return;
    }
    this.selectedDay = today;
    this.requestUpdate();
    this.loadHistoryWhenNeeded(hass);
  };

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

/** Fetches 5-minute statistics, completed by hourly ones where purged. */
async function fetchStatistics(
  hass: HomeAssistantThemeContext,
  entityIds: readonly [string, string, string, string],
  window: LocalDayWindow,
  now: number,
): Promise<EnergyStatistics> {
  const [fiveMinute, hourly] = await Promise.all([
    hass.callWS(buildStatisticsRequest(entityIds, window, now, "5minute")),
    hass.callWS(buildStatisticsRequest(entityIds, window, now, "hour")),
  ]);
  const [production, consumption, gridImport, gridExport] = entityIds.map(
    (entityId) =>
      combineStatistics(
        parseStatisticRows(entityRowsOf(fiveMinute, entityId)),
        parseStatisticRows(entityRowsOf(hourly, entityId)),
      ),
  );
  return [production, consumption, gridImport, gridExport];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
