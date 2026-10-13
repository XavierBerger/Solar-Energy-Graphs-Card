import { css, html, LitElement, unsafeCSS } from "lit";
import { EnergyChartsRenderer } from "./energy-charts-renderer";
import type {
  ConsumerConfig,
  SolarEnergyEntityRole,
  SolarEnergyGraphsCardConfig,
} from "./solar-energy-graphs-card-config";
import { CONSUMER_DEFAULT_COLORS } from "./solar-energy-graphs-card-config";
import {
  buildHistoryRequest,
  buildStatisticsRequest,
  combineStatistics,
  entityRowsOf,
  getEnergyUnitScales,
  getLocalDateString,
  getLocalDayWindowForDate,
  getSameTimeOfDay,
  mergeLiveEnergySamples,
  NO_STATISTICS,
  parseCompressedPowerSamples,
  parsePowerState,
  parseStatisticRows,
  projectEnergyHistory,
  replaceSensorHistory,
  shiftLocalDate,
  type EnergyHistoryResponse,
  type EnergyPowerSamples,
  type EnergySensorMetadata,
  type EnergyStatistics,
  type EnergyStatisticsCollection,
  type EnergyUnitScales,
  type StatisticSample,
  type HistoryDuringPeriodMessage,
  type HistoryDuringPeriodResponse,
  type LivePowerSample,
  type LocalDayWindow,
  type NumericSample,
  type StatisticsDuringPeriodMessage,
  type StatisticsDuringPeriodResponse,
} from "./home-assistant-energy-history";
import { cardLanguage, translations, type CardLanguage } from "./translations";
import { uPlotStyles } from "./uplot-adapter";

const CARD_TYPE = "custom:solar-energy-graphs-card";
const ELEMENT_NAME = "solar-energy-graphs-card";
// Home Assistant pushes each sensor separately; merge a burst in one pass.
const LIVE_UPDATE_COALESCE_MS = 250;
const STATISTICS_PERIOD_SECONDS = 5 * 60;
// Home Assistant compiles 5-minute statistics shortly after each boundary.
const STATISTICS_REFRESH_DELAY_SECONDS = 30;
// Raw states cover the current day after its last compiled interval.
const RAW_TAIL_SECONDS = 15 * 60;
// Raw history is probed over the minute before the current time of day.
const PRECISION_PROBE_SECONDS = 60;

type HistoryPrecision = "statistics" | "raw";

type CardStatusDescriptor =
  | { kind: "waiting" }
  | { kind: "loading" }
  | { kind: "ready" }
  | { kind: "unavailable" }
  | { kind: "sensorError"; role: SolarEnergyEntityRole; problem: "class" | "unit" }
  | { kind: "loadError"; detail: string };

interface HomeAssistantThemeContext {
  language?: string;
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
    statistics: EnergyStatisticsCollection;
    /** Raw states in W, drawn after each sensor's last statistics interval. */
    samples: EnergyPowerSamples;
    consumerSamples: readonly (readonly NumericSample[])[];
    window: LocalDayWindow;
    unitScales: EnergyUnitScales;
    loading: boolean;
    loadError?: string;
    precision: HistoryPrecision;
    highPrecisionAvailable?: boolean;
    highPrecisionCheckError?: string;
  };
  private historyLoadKey = "";
  private historyRequestId = 0;
  private liveUpdateTimer?: ReturnType<typeof setTimeout>;
  private statisticsRefreshTimer?: ReturnType<typeof setTimeout>;
  private selectedDay?: string;
  private selectedDayTimeZone?: string;
  private consumersVisible = false;
  private mainStatus: CardStatusDescriptor = { kind: "waiting" };
  private gridStatus: CardStatusDescriptor = { kind: "waiting" };

  get language(): CardLanguage {
    return cardLanguage(this.hassContext?.language ?? document.documentElement.lang);
  }

  set hass(hass: HomeAssistantThemeContext) {
    const previousLanguage = this.language;
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
    if (previousLanguage !== this.language) {
      this.chartRenderer?.destroy();
      this.chartRenderer = undefined;
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
      width: 150px
    }

    .chart .u-legend .u-series.consumer-legend {
      display: none;
    }

    .chart.consumers-visible .u-legend .u-series.consumer-legend {
      display: block;
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

    .chart .u-legend .u-series.hide-helper-legend {
      display: none;
    }

    .chart .u-legend .u-series.legend-values-only > * {
      opacity: 1;
    }

    .chart .u-over .u-legend {
      background: color-mix(in srgb, var(--ha-card-background, var(--card-background-color, #fff)) 85%, transparent);
      border-radius: 0.25rem;
      left: 0.25rem;
      pointer-events: none;
      position: absolute;
      text-align: left;
      top: 0.25rem;
      white-space: nowrap;
      z-index: 1;
    }

    .chart .u-over .u-legend tr {
      display: block;
      margin-right: 0;
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
    const t = translations(this.language);
    if (config.type !== CARD_TYPE) {
      throw new Error(t.setConfig.expectedType);
    }
    const entities = config.entities;
    if (
      !entities ||
      ![
        entities.production,
        entities.consumption,
        entities.grid_import,
        entities.grid_export,
      ].every((entityId) => entityId === null || (typeof entityId === "string" && entityId.trim().length > 0))
    ) {
      throw new Error(t.setConfig.missingEntities);
    }
    const consumers = config.consumers === undefined ? [] : config.consumers;
    if (!Array.isArray(consumers) || !consumers.every(isValidConsumerConfig)) {
      throw new Error(t.setConfig.invalidConsumers);
    }
    this.config = {
      ...config,
      entities: {
        production: normalizeEntityId(entities.production),
        consumption: normalizeEntityId(entities.consumption),
        grid_import: normalizeEntityId(entities.grid_import),
        grid_export: normalizeEntityId(entities.grid_export),
      },
      consumers: consumers.map((consumer, index) => ({
        ...consumer,
        entity: consumer.entity.trim(),
        color:
          consumer.color ??
          CONSUMER_DEFAULT_COLORS[index % CONSUMER_DEFAULT_COLORS.length],
      })),
    };
    this.chartRenderer?.destroy();
    this.chartRenderer = undefined;
    this.historyData = undefined;
    this.historyModel = undefined;
    this.historyLoadKey = "";
    this.historyRequestId += 1;
    this.cancelLiveMerge();
    this.cancelStatisticsRefresh();
    this.loadHistoryWhenNeeded(this.hassContext);
    this.requestUpdate();
  }

  static getConfigElement(): HTMLElement {
    return document.createElement("solar-energy-graphs-card-editor");
  }

  static getStubConfig(): SolarEnergyGraphsCardConfig {
    return {
      type: CARD_TYPE,
      entities: {
        production: null,
        consumption: null,
        grid_import: null,
        grid_export: null,
      },
      consumers: [],
    };
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

  private statusText(status: CardStatusDescriptor, isMain: boolean): string {
    const t = translations(this.language);
    switch (status.kind) {
      case "waiting":
        return t.statuses.waiting;
      case "loading":
        return t.statuses.loading;
      case "ready":
        return isMain ? t.statuses.readyMain : t.statuses.readyGrid;
      case "unavailable":
        return isMain
          ? t.statuses.unavailableMain(this.formatSelectedDay())
          : t.statuses.unavailableGrid(this.formatSelectedDay());
      case "sensorError":
        return t.statuses.sensorError(status.role, status.problem);
      case "loadError":
        return t.statuses.loadError(status.detail);
      default:
        return "";
    }
  }

  render() {
    const t = translations(this.language);
    return html`
      <ha-card>
        <nav class="day-navigation" aria-label=${t.dayNavigation}>
          ${this.renderConsumersButton()}
          ${this.renderPrecisionButton()}
          <button
            type="button"
            aria-label=${t.previousDay}
            title=${t.previousDay}
            @click=${this.showAdjacentDay(-1)}
          >
            <span aria-hidden="true">←</span>
          </button>
          <button
            type="button"
            class="selected-day"
            aria-label=${t.returnToToday}
            title=${t.returnToToday}
            @click=${this.showToday}
          >
            <time datetime=${this.selectedDay ?? ""} aria-live="polite">
              ${this.formatSelectedDay()}
            </time>
          </button>
          <button
            type="button"
            aria-label=${t.nextDay}
            title=${t.nextDay}
            ?disabled=${this.isTodaySelected()}
            @click=${this.showAdjacentDay(1)}
          >
            <span aria-hidden="true">→</span>
          </button>
        </nav>
        <div class="graphs">
          <section class="graph" aria-labelledby="graph-one-title">
            <h2 id="graph-one-title">${t.graphTitles.productionConsumption}</h2>
            <p
              class="chart-status"
              role=${this.mainStatus.kind === "unavailable" ? "alert" : "status"}
              aria-live="polite"
            >
              ${this.statusText(this.mainStatus, true)}
            </p>
            <div class="chart">
              <div class="chart-plot" data-chart="one"></div>
            </div>
          </section>
          <section class="graph" aria-labelledby="graph-two-title">
            <h2 id="graph-two-title">${t.graphTitles.gridExchange}</h2>
            <p
              class="chart-status"
              role=${this.gridStatus.kind === "unavailable" ? "alert" : "status"}
              aria-live="polite"
            >
              ${this.statusText(this.gridStatus, false)}
            </p>
            <div class="chart">
              <div class="chart-plot" data-chart="two"></div>
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

    if (first && second) {
      this.chartRenderer = new EnergyChartsRenderer(
        [first, second],
        this.historyData,
        this.hassContext.config.time_zone,
        this.darkMode,
        this.language,
      );
      if (this.consumersVisible) {
        this.chartRenderer.setConsumersVisible(true);
      }
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
    this.mainStatus = { kind: "loading" };
    this.gridStatus = { kind: "loading" };
    queueMicrotask(() => {
      if (this.isConnected && requestId === this.historyRequestId) {
        this.requestUpdate();
      }
    });
    let unitScales: EnergyUnitScales;
    try {
      unitScales = getEnergyUnitScales([
        entityIds[0] ? hass.states?.[entityIds[0]]?.attributes : null,
        entityIds[1] ? hass.states?.[entityIds[1]]?.attributes : null,
        entityIds[2] ? hass.states?.[entityIds[2]]?.attributes : null,
        entityIds[3] ? hass.states?.[entityIds[3]]?.attributes : null,
      ], entityIds.slice(4).map((entityId) =>
        entityId ? hass.states?.[entityId]?.attributes : null,
      ));
    } catch (error) {
      const sensorError: CardStatusDescriptor =
        error instanceof Error && "role" in error && "problem" in error
          ? {
              kind: "sensorError",
              role: error.role as SolarEnergyEntityRole,
              problem: error.problem as "class" | "unit",
            }
          : { kind: "loadError", detail: errorMessage(error) };
      this.mainStatus = sensorError;
      this.gridStatus = sensorError;
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
      consumerSamples: (config.consumers ?? []).map(() => []),
      window: dayWindow,
      unitScales,
      loading: true,
      precision: "statistics",
      highPrecisionAvailable: undefined,
      highPrecisionCheckError: undefined,
    };
    void this.fetchHistory(hass, entityIds, requestId);
  }

  private async fetchHistory(
    hass: HomeAssistantThemeContext,
    entityIds: readonly (string | null)[],
    requestId: number,
  ): Promise<void> {
    const model = this.historyModel;
    if (!model) {
      return;
    }
    const now = Date.now() / 1000;
    const today = this.isTodaySelected();
    const activeIds = activeEntityIds(entityIds);
    const probeEnd = getSameTimeOfDay(model.window, now, hass.config.time_zone);
    const hasProbeEntities = activeIds.length > 0;
    const [statistics, tail, precisionProbe] = await Promise.allSettled([
      fetchStatistics(hass, entityIds, model.window, now),
      today && activeIds.length > 0
        ? hass.callWS(
          buildHistoryRequest(activeIds, now - RAW_TAIL_SECONDS, now),
        )
        : Promise.resolve<HistoryDuringPeriodResponse>({}),
      hasProbeEntities
        ? hass.callWS(
          buildHistoryRequest(
            activeIds,
            probeEnd - PRECISION_PROBE_SECONDS,
            probeEnd,
          ),
        )
        : Promise.resolve<HistoryDuringPeriodResponse>({}),
    ]);
    const current = this.historyModel;
    if (!this.isConnected || requestId !== this.historyRequestId || !current) {
      return;
    }

    let samples = current.samples;
    let consumerSamples = current.consumerSamples;
    let precisionSamples: EnergyPowerSamples = [[], [], [], []];
    let precisionConsumerSamples: readonly (readonly NumericSample[])[] = current.consumerSamples.map(
      () => [],
    );
    let loadError =
      statistics.status === "rejected" ? errorMessage(statistics.reason) : undefined;
    let highPrecisionAvailable = false;
    let highPrecisionCheckError: string | undefined;
    try {
      if (tail.status === "rejected") {
        throw tail.reason;
      }
      const scales = sensorUnitScales(current.unitScales);
      entityIds.forEach((entityId, sensor) => {
        if (!entityId || sensor >= 4) {
          return;
        }
        samples = replaceSensorHistory(
          samples,
          sensor as LivePowerSample["sensor"],
          parseCompressedPowerSamples(
            entityRowsOf(tail.value, entityId),
            scales[sensor],
          ),
        );
      });
      entityIds.slice(4).forEach((entityId, consumer) => {
        if (!entityId) {
          return;
        }
        consumerSamples = replaceConsumerHistory(
          consumerSamples,
          consumer,
          parseCompressedPowerSamples(
            entityRowsOf(tail.value, entityId),
            current.unitScales.consumersToW[consumer],
          ),
        );
      });
    } catch (error) {
      loadError ??= errorMessage(error);
    }
    if (!hasProbeEntities) {
      highPrecisionAvailable = false;
    } else if (precisionProbe.status === "rejected") {
      // Keep the manual full-day action available when a probe fails.
      highPrecisionAvailable = true;
      highPrecisionCheckError = errorMessage(precisionProbe.reason);
    } else {
      try {
        const scales = sensorUnitScales(current.unitScales);
        entityIds.forEach((entityId, sensor) => {
          if (!entityId) {
            return;
          }
          const parsed = parseCompressedPowerSamples(
            entityRowsOf(precisionProbe.value, entityId),
            sensor < 4
              ? scales[sensor]
              : current.unitScales.consumersToW[sensor - 4],
          );
          if (sensor < 4) {
            precisionSamples = replaceSensorHistory(
              precisionSamples,
              sensor as LivePowerSample["sensor"],
              parsed,
            );
          } else {
            precisionConsumerSamples = replaceConsumerHistory(
              precisionConsumerSamples,
              sensor - 4,
              parsed,
            );
          }
        });
        highPrecisionAvailable = hasHigherPrecisionSamples(
          [...precisionSamples, ...precisionConsumerSamples],
          statistics.status === "fulfilled"
            ? statistics.value
            : current.statistics,
        );
      } catch (error) {
        highPrecisionAvailable = true;
        highPrecisionCheckError = errorMessage(error);
      }
    }
    this.historyModel = {
      ...current,
      statistics:
        statistics.status === "fulfilled" ? statistics.value : current.statistics,
      samples,
      loading: false,
      loadError,
      precision: current.precision,
      highPrecisionAvailable,
      highPrecisionCheckError,
    };
    this.showCurrentModel();
    if (today) {
      this.scheduleStatisticsRefresh(hass, entityIds, requestId);
    }
  }

  private scheduleStatisticsRefresh(
    hass: HomeAssistantThemeContext,
    entityIds: readonly (string | null)[],
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
    entityIds: readonly (string | null)[],
    requestId: number,
  ): Promise<void> {
    const model = this.historyModel;
    if (!model || !this.isTodaySelected()) {
      return;
    }
    // Raw history already covers the day and live states extend it; the
    // statistics are refreshed at the first boundary after switching back.
    if (model.precision === "raw") {
      this.scheduleStatisticsRefresh(hass, entityIds, requestId);
      return;
    }
    let statistics: EnergyStatisticsCollection | undefined;
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
          model.precision === "raw"
            ? NO_STATISTICS
            : baseStatistics(model.statistics),
          (this.config?.consumers ?? [])
            .map((consumer, index) => ({
              ...consumer,
              color: consumer.color ?? CONSUMER_DEFAULT_COLORS[index % CONSUMER_DEFAULT_COLORS.length],
              samples: model.consumerSamples[index] ?? [],
              statistics:
                model.precision === "raw"
                  ? []
                  : model.statistics[index + 4] ?? [],
            }))
            .filter((consumer) => consumer.entity.length > 0),
        ),
      );
    }
  }

  private renderPrecisionButton() {
    const model = this.historyModel;
    if (!model || model.highPrecisionAvailable === undefined) {
      return html``;
    }

    if (model?.highPrecisionAvailable === false) {
      return html``;
    }
    const t = translations(this.language);
    const highPrecision = model?.precision === "raw";
    const checkFailed = model.highPrecisionCheckError !== undefined;
    return html`
      <button
        type="button"
        aria-label=${highPrecision
          ? t.precision.standardAria
          : checkFailed
          ? t.precision.highAriaUnavailable
          : t.precision.highAria}
        title=${highPrecision
          ? t.precision.standardTitle
          : checkFailed
          ? t.precision.highTitleUnavailable(model.highPrecisionCheckError ?? "")
          : t.precision.highTitle}
        ?disabled=${model?.loading === true}
        @click=${this.togglePrecision}
      >
        <span aria-hidden="true">${highPrecision ? "≋" : "▤"}</span>
      </button>
    `;
  }

  private renderConsumersButton() {
    if (!this.config?.consumers?.some((consumer) => consumer.entity.length > 0)) {
      return html``;
    }
    const t = translations(this.language);
    const label = this.consumersVisible ? t.hideConsumers : t.showConsumers;
    return html`
      <button
        type="button"
        aria-label=${label}
        title=${label}
        aria-pressed=${this.consumersVisible}
        @click=${this.toggleConsumers}
      >
        <span aria-hidden="true">▰</span>
      </button>
    `;
  }

  private toggleConsumers = (): void => {
    this.consumersVisible = !this.consumersVisible;
    this.chartRenderer?.setConsumersVisible(this.consumersVisible);
    this.requestUpdate();
  };

  private togglePrecision = (): void => {
    const hass = this.hassContext;
    const model = this.historyModel;
    const config = this.config;
    if (!hass || !model || !config || model.loading) {
      return;
    }
    if (model.precision === "raw") {
      this.historyModel = { ...model, precision: "statistics" };
      this.showCurrentModel();
      return;
    }
    void this.loadHighPrecision(hass, config, model);
  };

  private async loadHighPrecision(
    hass: HomeAssistantThemeContext,
    config: SolarEnergyGraphsCardConfig,
    model: NonNullable<SolarEnergyGraphsCard["historyModel"]>,
  ): Promise<void> {
    // Keep the load's id: a new one would stop its statistics refresh chain.
    const requestId = this.historyRequestId;
    this.historyModel = {
      ...model,
      loading: true,
      loadError: undefined,
      highPrecisionCheckError: undefined,
    };
    this.mainStatus = { kind: "loading" };
    this.gridStatus = { kind: "loading" };
    this.requestUpdate();

    try {
      const now = Date.now() / 1000;
      const end = Math.min(now, model.window.end);
      const response = await hass.callWS(
        buildHistoryRequest(
          activeEntityIds(configuredEntityIds(config)),
          model.window.start,
          end,
        ),
      );
      const current = this.historyModel;
      if (!this.isConnected || requestId !== this.historyRequestId || !current) {
        return;
      }
      const scales = sensorUnitScales(current.unitScales);
      let samples = [[], [], [], []] as EnergyPowerSamples;
      let consumerSamples: readonly (readonly NumericSample[])[] = (config.consumers ?? []).map(
        () => [],
      );
      configuredEntityIds(config).forEach((entityId, sensor) => {
        if (!entityId) {
          return;
        }
        const parsed = parseCompressedPowerSamples(
          entityRowsOf(response, entityId),
          sensor < 4
            ? scales[sensor]
            : current.unitScales.consumersToW[sensor - 4],
        );
        if (sensor < 4) {
          samples = replaceSensorHistory(
            samples,
            sensor as LivePowerSample["sensor"],
            parsed,
          );
        } else {
          consumerSamples = replaceConsumerHistory(
            consumerSamples,
            sensor - 4,
            parsed,
          );
        }
      });
      if (!hasHigherPrecisionSamples(
        [...samples, ...consumerSamples],
        current.statistics,
      )) {
        this.historyModel = {
          ...current,
          loading: false,
          highPrecisionAvailable: false,
          precision: "statistics",
        };
        this.showCurrentModel();
        return;
      }
      this.historyModel = {
        ...current,
        samples,
        consumerSamples,
        loading: false,
        precision: "raw",
        highPrecisionAvailable: true,
      };
      this.showCurrentModel();
    } catch (error) {
      const current = this.historyModel;
      if (!this.isConnected || requestId !== this.historyRequestId || !current) {
        return;
      }
      this.historyModel = {
        ...current,
        loading: false,
        loadError: errorMessage(error),
      };
      this.showCurrentModel();
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
    const configured = configuredEntityIds(this.config);
    const live = configured.slice(0, 4).flatMap(
      (entityId, sensor): LivePowerSample[] => {
        if (!entityId) {
          return [];
        }
        const state = hass.states?.[entityId];
        const sample = state && parsePowerState(state, scales[sensor]);
        return sample ? [{ ...sample, sensor: sensor as 0 | 1 | 2 | 3 }] : [];
      },
    );
    const samples = mergeLiveEnergySamples(model.samples, live);
    let consumerSamples = model.consumerSamples;
    configured.slice(4).forEach((entityId, consumer) => {
      if (!entityId) {
        return;
      }
      const state = hass.states?.[entityId];
      const sample =
        state &&
        parsePowerState(state, model.unitScales.consumersToW[consumer]);
      if (sample) {
        consumerSamples = mergeConsumerLiveSample(
          consumerSamples,
          consumer,
          sample,
        );
      }
    });
    if (samples === model.samples && consumerSamples === model.consumerSamples) {
      return;
    }

    this.historyModel = { ...model, samples, consumerSamples };
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
    const t = translations(this.language);
    // Missing series are expected until every request has settled.
    if (model?.loading) {
      this.mainStatus = { kind: "loading" };
      this.gridStatus = { kind: "loading" };
      return;
    }
    if (model?.loadError !== undefined) {
      this.mainStatus = { kind: "loadError", detail: model.loadError };
      this.gridStatus = { kind: "loadError", detail: model.loadError };
      return;
    }
    this.mainStatus =
      data.hasProduction && data.hasConsumption
        ? { kind: "ready" }
        : { kind: "unavailable" };
    this.gridStatus =
      data.hasGridImport && data.hasGridExport
        ? { kind: "ready" }
        : { kind: "unavailable" };
  }

  private formatSelectedDay(): string {
    if (!this.selectedDay) {
      return "";
    }
    const [year, month, day] = this.selectedDay.split("-").map(Number);
    return new Intl.DateTimeFormat(translations(this.language).dateLocale, {
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

function replaceConsumerHistory(
  consumers: readonly (readonly NumericSample[])[],
  consumer: number,
  history: readonly NumericSample[],
): readonly (readonly NumericSample[])[] {
  const replaced = consumers.map((samples) => [...samples]);
  const lastRecorded = history.at(-1)?.timestamp ?? Number.NEGATIVE_INFINITY;
  replaced[consumer] = [
    ...history,
    ...(consumers[consumer] ?? []).filter(
      (sample) => sample.timestamp > lastRecorded,
    ),
  ];
  return replaced;
}

function mergeConsumerLiveSample(
  consumers: readonly (readonly NumericSample[])[],
  consumer: number,
  sample: NumericSample,
): readonly (readonly NumericSample[])[] {
  const current = consumers[consumer] ?? [];
  const last = current.at(-1);
  if (!Number.isFinite(sample.timestamp) || (last && sample.timestamp < last.timestamp)) {
    return consumers;
  }
  if (last?.timestamp === sample.timestamp && last.value === sample.value) {
    return consumers;
  }
  const next =
    last?.timestamp === sample.timestamp
      ? [...current.slice(0, -1), sample]
      : [...current, sample];
  return consumers.map((samples, index) =>
    index === consumer ? next : [...samples],
  );
}

function isValidConsumerConfig(value: unknown): value is ConsumerConfig {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const entity = Reflect.get(value, "entity");
  const color = Reflect.get(value, "color");
  const name = Reflect.get(value, "name");
  return (
    typeof entity === "string" &&
    (name === undefined || typeof name === "string") &&
    (color === undefined ||
      (typeof color === "string" && /^#[\da-fA-F]{6}$/.test(color)))
  );
}

function configuredEntityIds(
  config: SolarEnergyGraphsCardConfig,
): Array<string | null> {
  return [
    config.entities.production,
    config.entities.consumption,
    config.entities.grid_import,
    config.entities.grid_export,
    ...(config.consumers ?? []).map((consumer) =>
      consumer.entity.trim() || null,
    ),
  ];
}

function activeEntityIds(entityIds: readonly (string | null)[]): string[] {
  return entityIds.filter((entityId): entityId is string => entityId !== null);
}

function baseStatistics(
  statistics: EnergyStatisticsCollection,
): EnergyStatistics {
  return [
    statistics[0] ?? [],
    statistics[1] ?? [],
    statistics[2] ?? [],
    statistics[3] ?? [],
  ];
}

function normalizeEntityId(entityId: string | null): string | null {
  return entityId === null ? null : entityId.trim();
}

/** Fetches 5-minute statistics, completed by hourly ones where purged. */
async function fetchStatistics(
  hass: HomeAssistantThemeContext,
  entityIds: readonly (string | null)[],
  window: LocalDayWindow,
  now: number,
): Promise<EnergyStatisticsCollection> {
  const activeIds = activeEntityIds(entityIds);
  if (activeIds.length === 0) {
    return NO_STATISTICS;
  }
  const [fiveMinute, hourly] = await Promise.all([
    hass.callWS(buildStatisticsRequest(activeIds, window, now, "5minute")),
    hass.callWS(buildStatisticsRequest(activeIds, window, now, "hour")),
  ]);
  return entityIds.map((entityId) =>
    entityId === null
      ? []
      : combineStatistics(
        parseStatisticRows(entityRowsOf(fiveMinute, entityId)),
        parseStatisticRows(entityRowsOf(hourly, entityId)),
      ),
  );
}

export function hasHigherPrecisionSamples(
  samples: readonly (readonly NumericSample[])[],
  statistics: EnergyStatisticsCollection,
): boolean {
  for (let sensor = 0; sensor < samples.length; sensor += 1) {
    const raw = samples[sensor];
    const stat = statistics[sensor] ?? [];
    if (raw.length < 2) {
      continue;
    }
    const rawInterval = raw[1].timestamp - raw[0].timestamp;
    const statInterval = stat[0] ? stat[0].end - stat[0].start : Number.POSITIVE_INFINITY;
    if (rawInterval > 0 && rawInterval < statInterval) {
      return true;
    }
  }
  return false;
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
