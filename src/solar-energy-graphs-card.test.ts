import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { hasHigherPrecisionSamples, SolarEnergyGraphsCard } from "./solar-energy-graphs-card";
import {
  getLocalDateString,
  getLocalDayWindowForDate,
  shiftLocalDate,
  type EnergyHistoryResponse,
  type HistoryDuringPeriodMessage,
  type HistoryDuringPeriodResponse,
  type StatisticsDuringPeriodMessage,
  type StatisticsDuringPeriodResponse,
} from "./home-assistant-energy-history";
import { SolarEnergyGraphsCardEditor } from "./solar-energy-graphs-card-editor";

const { rendererInstances } = vi.hoisted(() => ({
  rendererInstances: [] as Array<{
    containers: HTMLElement[];
    legendContainers: HTMLElement[];
    data: EnergyHistoryResponse;
    timeZone: string;
    darkMode: boolean;
    destroy: ReturnType<typeof vi.fn>;
    refreshTheme: ReturnType<typeof vi.fn>;
    updateData: ReturnType<typeof vi.fn>;
  }>,
}));

vi.mock("./energy-charts-renderer", () => ({
  EnergyChartsRenderer: class {
    readonly destroy = vi.fn();
    readonly refreshTheme = vi.fn();
    readonly updateData = vi.fn();

    constructor(
      readonly containers: HTMLElement[],
      readonly legendContainers: HTMLElement[],
      readonly data: EnergyHistoryResponse,
      readonly timeZone: string,
      readonly darkMode: boolean,
    ) {
      rendererInstances.push(this);
    }
  },
}));

const CARD_CONFIG = {
  type: "custom:solar-energy-graphs-card",
  entities: {
    production: "sensor.solar",
    consumption: "sensor.consumption",
    grid_import: "sensor.grid_import",
    grid_export: "sensor.grid_export",
  },
};

const SENSOR_IDS = Object.values(CARD_CONFIG.entities);

type WebSocketMessage = HistoryDuringPeriodMessage | StatisticsDuringPeriodMessage;
type WebSocketResponse = HistoryDuringPeriodResponse | StatisticsDuringPeriodResponse;
// Returns `any` to satisfy the overloaded callWS of the card context.
type HistoryApi = (message: WebSocketMessage) => Promise<any>;

/** Names a request by its type and, for statistics, its period. */
function requestKind(message: WebSocketMessage): string {
  return message.type === "recorder/statistics_during_period"
    ? `statistics:${message.period}`
    : "history";
}

function createHassContext(
  callWS: ReturnType<typeof vi.fn<HistoryApi>> = vi.fn<HistoryApi>(
    async () => ({}),
  ),
) {

  return {
    config: { time_zone: "Europe/Paris" },
    themes: { darkMode: false },
    states: {
      "sensor.consumption": {
        state: "200",
        last_updated: "2026-09-27T10:00:00Z",
        attributes: {
          unit_of_measurement: "W",
          device_class: "power",
          state_class: "measurement",
        },
      },
      "sensor.solar": {
        state: "100",
        last_updated: "2026-09-27T10:00:00Z",
        attributes: {
          unit_of_measurement: "W",
          device_class: "power",
          state_class: "measurement",
        },
      },
      "sensor.grid_import": {
        state: "100",
        last_updated: "2026-09-27T10:00:00Z",
        attributes: {
          unit_of_measurement: "W",
          device_class: "power",
          state_class: "measurement",
        },
      },
      "sensor.grid_export": {
        state: "0",
        last_updated: "2026-09-27T10:00:00Z",
        attributes: {
          unit_of_measurement: "W",
          device_class: "power",
          state_class: "measurement",
        },
      },
    },
    callWS,
  };
}

function withSensorState(
  hass: ReturnType<typeof createHassContext>,
  entityId: keyof ReturnType<typeof createHassContext>["states"],
  state: string,
  lastUpdated: string,
): ReturnType<typeof createHassContext> {
  return {
    ...hass,
    states: {
      ...hass.states,
      [entityId]: { ...hass.states[entityId], state, last_updated: lastUpdated },
    },
  };
}

/** Mocks WebSocket requests that resolve or fail on demand. */
function deferredHistoryApi() {
  const pending: Array<{
    kind: string;
    resolve: (response: WebSocketResponse) => void;
    reject: (error: Error) => void;
  }> = [];
  const callWS = vi.fn<HistoryApi>(
    (message) =>
      new Promise((resolve, reject) =>
        pending.push({ kind: requestKind(message), resolve, reject }),
      ),
  );
  return { callWS, pending };
}

/** Mocks WebSocket requests answered from fixed responses by request kind. */
function fixedHistoryApi(responses: Record<string, WebSocketResponse | Error>) {
  return vi.fn<HistoryApi>(async (message) => {
    const response = responses[requestKind(message)] ?? {};
    if (response instanceof Error) {
      throw response;
    }
    return response;
  });
}

function statisticRow(start: string, mean: number, min: number, max: number) {
  const startMs = Date.parse(start);
  return { start: startMs, end: startMs + 5 * 60 * 1000, mean, min, max };
}

/** Settles history responses and the live merge scheduled while loading. */
async function flushHistoryResponse(): Promise<void> {
  await vi.advanceTimersByTimeAsync(250);
}

describe("SolarEnergyGraphsCard", () => {

  // Detects raw history only when its sampling interval is finer than statistics.
  it("detects higher precision history", () => {
    expect(hasHigherPrecisionSamples(
      [[{ timestamp: 1, value: 1 }, { timestamp: 1.5, value: 2 }], [], [], []],
      [[{ start: 0, end: 60, mean: 1, min: 1, max: 1 }], [], [], []],
    )).toBe(true);
    expect(hasHigherPrecisionSamples([[], [], [], []], [[{ start: 0, end: 60, mean: 1, min: 1, max: 1 }], [], [], []])).toBe(false);
  });

  // Checks the zero-interval boundary: raw samples sharing one timestamp are not
  // finer than statistics, whatever the statistics period.
  it("does not treat a zero raw sampling interval as higher precision", () => {
    expect(hasHigherPrecisionSamples(
      [[{ timestamp: 1, value: 1 }, { timestamp: 1, value: 2 }], [], [], []],
      [[{ start: 0, end: 60, mean: 1, min: 1, max: 1 }], [], [], []],
    )).toBe(false);
  });

  let card: SolarEnergyGraphsCard;

  async function mountConfiguredCard(target: SolarEnergyGraphsCard): Promise<void> {
    target.setConfig(CARD_CONFIG);
    document.body.append(target);
    target.hass = createHassContext();
    await vi.waitFor(() => expect(rendererInstances).toHaveLength(1));
  }

  /** Finds a day-navigation button by its accessible label, whatever its position. */
  function navigationButton(
    target: SolarEnergyGraphsCard,
    label: string,
  ): HTMLButtonElement | null | undefined {
    return target.shadowRoot?.querySelector<HTMLButtonElement>(
      `.day-navigation button[aria-label="${label}"]`,
    );
  }

  beforeEach(() => {
    rendererInstances.length = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
    card?.remove();
    document.body.replaceChildren();
  });

  // Confirms that Lovelace accepts the card type with its required entities.
  it("accepts its configured Lovelace type", () => {
    card = new SolarEnergyGraphsCard();

    expect(() => card.setConfig(CARD_CONFIG)).not.toThrow();
  });

  // Exposes the graphical editor and an empty, role-preserving card stub to Lovelace.
  it("provides its configuration editor and four empty entity defaults", () => {
    expect(SolarEnergyGraphsCard.getConfigElement()).toBeInstanceOf(
      SolarEnergyGraphsCardEditor,
    );
    expect(SolarEnergyGraphsCard.getStubConfig()).toEqual({
      type: CARD_CONFIG.type,
      entities: {
        production: null,
        consumption: null,
        grid_import: null,
        grid_export: null,
      },
    });
  });

  // Prevents unrelated Lovelace card configurations from being accepted.
  it("rejects a different Lovelace card type", () => {
    card = new SolarEnergyGraphsCard();

    expect(() => card.setConfig({ ...CARD_CONFIG, type: "custom:another-card" }))
      .toThrow('Expected card type "custom:solar-energy-graphs-card".');
  });

  // Requires production, consumption, import and export power entities.
  it("rejects a configuration with a missing sensor entity", () => {
    card = new SolarEnergyGraphsCard();

    expect(() =>
      card.setConfig({
        ...CARD_CONFIG,
        entities: { ...CARD_CONFIG.entities, grid_export: "" },
      }),
    ).toThrow('Configure "entities.production", "entities.consumption", "entities.grid_import", and "entities.grid_export".');
  });

  // Renders without an unconfigured sensor and leaves it out of every Home Assistant request.
  it("accepts null entities and omits them from Home Assistant requests", async () => {
    card = new SolarEnergyGraphsCard();
    const hass = createHassContext();
    const config = {
      ...CARD_CONFIG,
      entities: { ...CARD_CONFIG.entities, grid_import: null },
    };
    card.setConfig(config);
    document.body.append(card);
    card.hass = hass;
    await vi.waitFor(() => expect(rendererInstances).toHaveLength(1));

    const expectedIds = SENSOR_IDS.filter((id) => id !== "sensor.grid_import");
    const requests = hass.callWS.mock.calls.map(([request]) => request);
    expect(requests.map((request) =>
      "statistic_ids" in request ? request.statistic_ids : request.entity_ids,
    )).toEqual([expectedIds, expectedIds, expectedIds, expectedIds]);
    expect(rendererInstances[0].data.hasGridImport).toBe(false);
  });

  // Trims spaces around configured entity IDs before querying Home Assistant.
  it("trims configured entity IDs", async () => {
    card = new SolarEnergyGraphsCard();
    const hass = createHassContext();
    card.setConfig({
      ...CARD_CONFIG,
      entities: { ...CARD_CONFIG.entities, production: "  sensor.solar  " },
    });
    document.body.append(card);
    card.hass = hass;
    await vi.waitFor(() => expect(rendererInstances).toHaveLength(1));

    const requests = hass.callWS.mock.calls.map(([request]) => request);
    expect(requests.map((request) =>
      "statistic_ids" in request ? request.statistic_ids : request.entity_ids,
    )).toEqual([SENSOR_IDS, SENSOR_IDS, SENSOR_IDS, SENSOR_IDS]);
  });

  // Keeps Home Assistant's layout estimate aligned with the viewport-height card.
  it("reports a card size of twelve rows", () => {
    card = new SolarEnergyGraphsCard();

    expect(card.getCardSize()).toBe(12);
  });

  // Renders both data-driven chart areas and their local status text.
  it("renders both chart areas after history is loaded", async () => {
    card = new SolarEnergyGraphsCard();
    await mountConfiguredCard(card);

    expect(card.shadowRoot?.querySelectorAll(".chart-plot")).toHaveLength(2);
    expect(card.shadowRoot?.querySelectorAll(".chart-legend")).toHaveLength(2);
    expect(card.shadowRoot?.textContent).toContain(
      "Solar Production and Consumption",
    );
    expect(card.shadowRoot?.textContent).toContain("Grid Exchange");
    expect(card.shadowRoot?.querySelectorAll(".chart-status")).toHaveLength(2);
    expect(card.shadowRoot?.querySelector(".day-navigation")).not.toBeNull();
    expect(
      Array.from(
        card.shadowRoot?.querySelectorAll<HTMLButtonElement>(
          ".day-navigation button",
        ) ?? [],
        (button) => button.getAttribute("aria-label"),
      ),
    ).toEqual(["Previous day", "Return to today", "Next day"]);
  });

  // Navigates between adjacent local days and prevents navigation into the future.
  it("loads adjacent days from the top-right day navigation", async () => {
    card = new SolarEnergyGraphsCard();
    const hass = createHassContext();
    card.setConfig(CARD_CONFIG);
    document.body.append(card);
    card.hass = hass;
    await vi.waitFor(() => expect(rendererInstances).toHaveLength(1));

    const today = getLocalDateString(new Date(), "Europe/Paris");
    const previousDay = shiftLocalDate(today, -1);
    const previousButton = navigationButton(card, "Previous day");
    const nextButton = navigationButton(card, "Next day");
    const date = card.shadowRoot?.querySelector("time");

    expect(date?.dateTime).toBe(today);
    expect(nextButton?.disabled).toBe(true);

    previousButton?.click();
    await vi.waitFor(() => expect(hass.callWS).toHaveBeenCalledTimes(7));
    await card.updateComplete;

    expect(date?.dateTime).toBe(previousDay);
    expect(nextButton?.disabled).toBe(false);
    const previousDayRequests = hass.callWS.mock.calls
      .slice(4)
      .map(([request]) => request);
    const previousWindow = getLocalDayWindowForDate(
      previousDay,
      "Europe/Paris",
    );
    expect(previousDayRequests.map(requestKind)).toEqual([
      "statistics:5minute",
      "statistics:hour",
      "history",
    ]);
    expect(previousDayRequests[2].end_time).toBe(
      new Date((previousWindow.start + 60) * 1000).toISOString(),
    );
    expect(previousDayRequests[0].start_time).toBe(
      new Date(previousWindow.start * 1000).toISOString(),
    );

    nextButton?.click();
    await vi.waitFor(() => expect(hass.callWS).toHaveBeenCalledTimes(11));
    await card.updateComplete;

    expect(date?.dateTime).toBe(today);
    expect(nextButton?.disabled).toBe(true);
  });

  // Returns to the current local day when the displayed date is clicked.
  it("returns to today when the selected date is clicked", async () => {
    card = new SolarEnergyGraphsCard();
    const hass = createHassContext();
    card.setConfig(CARD_CONFIG);
    document.body.append(card);
    card.hass = hass;
    await vi.waitFor(() => expect(rendererInstances).toHaveLength(1));

    const today = getLocalDateString(new Date(), "Europe/Paris");
    const previousDay = shiftLocalDate(today, -1);
    const nextButton = navigationButton(card, "Next day");
    const date = card.shadowRoot?.querySelector("time");

    navigationButton(card, "Previous day")?.click();
    await vi.waitFor(() => expect(hass.callWS).toHaveBeenCalledTimes(7));
    await card.updateComplete;
    expect(date?.dateTime).toBe(previousDay);

    date?.click();
    await vi.waitFor(() => expect(hass.callWS).toHaveBeenCalledTimes(11));
    await card.updateComplete;

    expect(date?.dateTime).toBe(today);
    expect(nextButton?.disabled).toBe(true);
  });

  // Keeps a user-selected day when Home Assistant sends unrelated state updates.
  it("does not reset the selected day on ordinary Home Assistant updates", async () => {
    card = new SolarEnergyGraphsCard();
    const hass = createHassContext();
    card.setConfig(CARD_CONFIG);
    document.body.append(card);
    card.hass = hass;
    await vi.waitFor(() => expect(rendererInstances).toHaveLength(1));

    navigationButton(card, "Previous day")?.click();
    await vi.waitFor(() => expect(hass.callWS).toHaveBeenCalledTimes(7));
    const selectedDay = card.shadowRoot?.querySelector("time")?.dateTime;

    card.hass = { ...hass, states: { ...hass.states } };
    await card.updateComplete;

    expect(card.shadowRoot?.querySelector("time")?.dateTime).toBe(selectedDay);
    expect(hass.callWS).toHaveBeenCalledTimes(7);
  });

  // Ignores an earlier day's response when a later navigation request finishes first.
  it("does not replace selected-day data with a stale history response", async () => {
    const { callWS, pending } = deferredHistoryApi();
    card = new SolarEnergyGraphsCard();
    const hass = createHassContext(callWS);
    card.setConfig(CARD_CONFIG);
    document.body.append(card);
    card.hass = hass;
    await vi.waitFor(() => expect(hass.callWS).toHaveBeenCalledTimes(4));

    navigationButton(card, "Previous day")?.click();
    await vi.waitFor(() => expect(hass.callWS).toHaveBeenCalledTimes(7));

    pending.slice(0, 4).forEach(({ resolve }) => resolve({}));
    await Promise.resolve();
    await Promise.resolve();
    expect(rendererInstances).toHaveLength(0);

    pending.slice(4).forEach(({ resolve }) => resolve({}));
    await vi.waitFor(() => expect(rendererInstances).toHaveLength(1));
  });

  // Keeps both chart regions at the requested 70/30 viewport-height split.
  it("allocates seven parts to the upper graph and three to the lower graph", () => {
    expect(SolarEnergyGraphsCard.styles.cssText).toContain(
      "grid-template-rows: minmax(0, 7fr) minmax(0, 3fr)",
    );
    expect(SolarEnergyGraphsCard.styles.cssText).toContain(
      "height: calc(100dvh - var(--header-height, 64px) - 2rem)",
    );
  });

  // Keeps each legend in its own layout row without hiding numeric legend values.
  it("reserves an in-flow row for each chart legend", () => {
    expect(SolarEnergyGraphsCard.styles.cssText).toContain(".chart-legend");
    expect(SolarEnergyGraphsCard.styles.cssText).toContain("overflow-x: auto");
    expect(SolarEnergyGraphsCard.styles.cssText).toContain(
      ".chart .u-legend .u-series.hide-helper-legend",
    );
    expect(SolarEnergyGraphsCard.styles.cssText).toMatch(
      /\.chart \.u-legend \.u-series\.legend-values-only\s*\{\s*pointer-events: none;/,
    );
    expect(SolarEnergyGraphsCard.styles.cssText).toMatch(
      /\.chart \.u-legend \.u-series\.legend-values-only > \*\s*\{\s*opacity: 1;/,
    );
    expect(SolarEnergyGraphsCard.styles.cssText).toContain("display: none");
  });

  // Passes normalized data, time zone and both chart/legend containers to uPlot.
  it("initializes the renderer from Home Assistant history", async () => {
    card = new SolarEnergyGraphsCard();
    const hass = createHassContext();
    card.setConfig(CARD_CONFIG);
    document.body.append(card);
    card.hass = hass;
    await vi.waitFor(() => expect(rendererInstances).toHaveLength(1));

    expect(rendererInstances).toHaveLength(1);
    expect(rendererInstances[0].containers).toEqual([
      card.shadowRoot?.querySelector('[data-chart="one"]'),
      card.shadowRoot?.querySelector('[data-chart="two"]'),
    ]);
    expect(rendererInstances[0].legendContainers).toEqual([
      card.shadowRoot?.querySelector('[data-legend="one"]'),
      card.shadowRoot?.querySelector('[data-legend="two"]'),
    ]);
    expect(rendererInstances[0].data.hasGridImport).toBe(false);
    expect(rendererInstances[0].data.hasGridExport).toBe(false);
    expect(rendererInstances[0].timeZone).toBe("Europe/Paris");
    const requests = hass.callWS.mock.calls.map(([request]) => request);
    expect(requests.map(requestKind)).toEqual([
      "statistics:5minute",
      "statistics:hour",
      "history",
      "history",
    ]);
    expect(requests.map((request) =>
      "statistic_ids" in request ? request.statistic_ids : request.entity_ids,
    )).toEqual([SENSOR_IDS, SENSOR_IDS, SENSOR_IDS, SENSOR_IDS]);
  });

  // Requests today's raw history tail over the last 15 minutes, ending now.
  it("requests the last 15 minutes of raw history for today", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-27T10:10:00Z") });
    card = new SolarEnergyGraphsCard();
    const hass = createHassContext();
    card.setConfig(CARD_CONFIG);
    document.body.append(card);
    card.hass = hass;
    await vi.waitFor(() => expect(rendererInstances).toHaveLength(1));

    const tail = hass.callWS.mock.calls
      .map(([request]) => request)
      .find((request) => requestKind(request) === "history");
    expect(tail).toMatchObject({
      start_time: "2026-09-27T09:55:00.000Z",
      end_time: "2026-09-27T10:10:00.000Z",
    });
  });

  // Checks the selected day's first local minute before showing the precision toggle.
  it("shows the precision button only after a positive one-minute probe", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-27T10:10:00Z") });
    const probeStart = Date.parse("2026-09-26T22:00:00Z") / 1000;
    const { callWS, pending } = deferredHistoryApi();
    card = new SolarEnergyGraphsCard();
    card.setConfig(CARD_CONFIG);
    document.body.append(card);
    card.hass = createHassContext(callWS);
    await vi.waitFor(() => expect(pending).toHaveLength(4));
    await card.updateComplete;

    expect(navigationButton(card, "Load high precision")).toBeNull();
    expect(callWS.mock.calls[3][0]).toMatchObject({
      type: "history/history_during_period",
      start_time: "2026-09-26T22:00:00.000Z",
      end_time: "2026-09-26T22:01:00.000Z",
      entity_ids: SENSOR_IDS,
    });

    pending[0].resolve({
      "sensor.solar": [
        statisticRow("2026-09-26T22:00:00Z", 500, 400, 600),
      ],
    });
    pending[1].resolve({});
    pending[2].resolve({});
    pending[3].resolve({
      "sensor.solar": [
        { s: "700", lu: probeStart + 10 },
        { s: "900", lu: probeStart + 20 },
      ],
    });
    await flushHistoryResponse();
    await card.updateComplete;

    expect(navigationButton(card, "Load high precision")).not.toBeNull();
  });

  // Draws each statistics interval at its midpoint with its min-max range.
  it("draws statistics as a mean line with a min-max band", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-27T10:10:00Z") });
    card = new SolarEnergyGraphsCard();
    card.setConfig(CARD_CONFIG);
    document.body.append(card);

    card.hass = createHassContext(
      fixedHistoryApi({
        "statistics:5minute": {
          "sensor.solar": [statisticRow("2026-09-27T09:00:00Z", 500, 400, 600)],
          "sensor.grid_import": [statisticRow("2026-09-27T09:00:00Z", 100, 50, 150)],
        },
      }),
    );
    await vi.waitFor(() => expect(rendererInstances).toHaveLength(1));
    await flushHistoryResponse();

    const renderer = rendererInstances[0];
    const data: EnergyHistoryResponse =
      renderer.updateData.mock.lastCall?.[0] ?? renderer.data;
    const index = Array.from(data.mainData[0]).indexOf(
      Date.parse("2026-09-27T09:02:30Z") / 1000,
    );
    expect([data.mainData[1][index], data.mainData[10][index], data.mainData[11][index]])
      .toEqual([500, 600, 400]);
    expect([data.gridData[2][index], data.gridData[5][index], data.gridData[6][index]])
      .toEqual([-100, -50, -150]);
  });

  // Reloads the day's statistics once Home Assistant has compiled a new interval.
  it("refreshes statistics after each 5-minute boundary", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-27T10:10:00Z") });
    card = new SolarEnergyGraphsCard();
    const hass = createHassContext();
    card.setConfig(CARD_CONFIG);
    document.body.append(card);
    card.hass = hass;
    await vi.waitFor(() => expect(rendererInstances).toHaveLength(1));
    await flushHistoryResponse();
    const initialCalls = hass.callWS.mock.calls.length;

    await vi.advanceTimersByTimeAsync(
      Date.parse("2026-09-27T10:15:30Z") - Date.now() - 1,
    );
    const beforeRefresh = hass.callWS.mock.calls.length;
    await vi.advanceTimersByTimeAsync(1);

    expect(initialCalls).toBe(4);
    expect(beforeRefresh).toBe(4);
    expect(
      hass.callWS.mock.calls.slice(4).map(([request]) => requestKind(request)),
    ).toEqual(["statistics:5minute", "statistics:hour"]);
  });

  /** Mounts today's card at 10:10Z and switches it to high precision. */
  async function mountInHighPrecision() {
    vi.useFakeTimers({ now: new Date("2026-09-27T10:10:00Z") });
    const rawStart = Date.parse("2026-09-27T09:00:00Z") / 1000;
    const hass = createHassContext(
      fixedHistoryApi({
        history: {
          "sensor.solar": [
            { s: "100", lu: rawStart },
            { s: "150", lu: rawStart + 60 },
          ],
        },
        "statistics:5minute": {
          "sensor.solar": [statisticRow("2026-09-27T09:00:00Z", 500, 400, 600)],
        },
      }),
    );
    card = new SolarEnergyGraphsCard();
    card.setConfig(CARD_CONFIG);
    document.body.append(card);
    card.hass = hass;
    await vi.waitFor(() => expect(rendererInstances).toHaveLength(1));
    await flushHistoryResponse();
    await card.updateComplete;
    precisionButton("Load high precision").click();
    await flushHistoryResponse();
    await card.updateComplete;
    return hass;
  }

  function precisionButton(label: string): HTMLButtonElement {
    const button = card.shadowRoot?.querySelector<HTMLButtonElement>(
      `.day-navigation button[aria-label="${label}"]`,
    );
    expect(button).toBeTruthy();
    return button!;
  }

  /** Tells whether the drawn data holds the 09:00Z statistics interval midpoint. */
  function drawsStatistics(data: EnergyHistoryResponse): boolean {
    return Array.from(data.mainData[0]).includes(
      Date.parse("2026-09-27T09:02:30Z") / 1000,
    );
  }

  // In high precision, a 5-minute boundary requests nothing: raw history is loaded.
  it("does not refresh statistics in high precision", async () => {
    const hass = await mountInHighPrecision();
    const beforeBoundary = hass.callWS.mock.calls.length;

    await vi.advanceTimersByTimeAsync(
      Date.parse("2026-09-27T10:15:31Z") - Date.now(),
    );

    expect(hass.callWS).toHaveBeenCalledTimes(beforeBoundary);
  });

  // Appends live states in high precision without falling back to statistics.
  it("keeps high precision when live states and boundaries arrive", async () => {
    const hass = await mountInHighPrecision();
    const renderer = rendererInstances[0];
    await vi.advanceTimersByTimeAsync(
      Date.parse("2026-09-27T10:15:31Z") - Date.now(),
    );
    renderer.updateData.mockClear();

    card.hass = withSensorState(hass, "sensor.solar", "300", "2026-09-27T10:15:00Z");
    await vi.advanceTimersByTimeAsync(250);
    await card.updateComplete;

    const data: EnergyHistoryResponse = renderer.updateData.mock.lastCall![0];
    const index = Array.from(data.mainData[0]).indexOf(
      Date.parse("2026-09-27T10:15:00Z") / 1000,
    );
    expect(data.mainData[1][index]).toBe(300);
    expect(drawsStatistics(data)).toBe(false);
    expect(precisionButton("Use standard precision")).toBeTruthy();
  });

  // Resumes the statistics refresh after a boundary spent in high precision.
  it("refreshes statistics again after leaving high precision", async () => {
    const hass = await mountInHighPrecision();
    const renderer = rendererInstances[0];
    await vi.advanceTimersByTimeAsync(
      Date.parse("2026-09-27T10:15:31Z") - Date.now(),
    );
    precisionButton("Use standard precision").click();
    const beforeBoundary = hass.callWS.mock.calls.length;
    renderer.updateData.mockClear();

    await vi.advanceTimersByTimeAsync(
      Date.parse("2026-09-27T10:20:31Z") - Date.now(),
    );

    expect(
      hass.callWS.mock.calls.slice(beforeBoundary).map(([request]) => requestKind(request)),
    ).toEqual(["statistics:5minute", "statistics:hour"]);
    expect(renderer.updateData).toHaveBeenCalledOnce();
    expect(drawsStatistics(renderer.updateData.mock.lastCall![0])).toBe(true);
  });

  // Keeps the raw states drawn and reports the failed statistics request.
  it("reports a failed statistics request", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-27T10:10:00Z") });
    const recorded = Date.parse("2026-09-27T10:08:00Z") / 1000;
    card = new SolarEnergyGraphsCard();
    card.setConfig(CARD_CONFIG);
    document.body.append(card);

    card.hass = createHassContext(
      fixedHistoryApi({
        "statistics:hour": new Error("Connection lost"),
        history: { "sensor.solar": [{ s: "800", lu: recorded }] },
      }),
    );
    await vi.waitFor(() => expect(rendererInstances).toHaveLength(1));
    await flushHistoryResponse();
    await card.updateComplete;

    const renderer = rendererInstances[0];
    const data: EnergyHistoryResponse =
      renderer.updateData.mock.lastCall?.[0] ?? renderer.data;
    expect(card.shadowRoot?.querySelector(".chart-status")?.textContent).toContain(
      "History loading error: Connection lost",
    );
    expect(data.mainData[1][Array.from(data.mainData[0]).indexOf(recorded)]).toBe(800);
  });

  // Keeps a live state received while the recent raw history was still loading.
  it("keeps live states merged before the history response", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-27T10:10:00Z") });
    const { callWS, pending } = deferredHistoryApi();
    card = new SolarEnergyGraphsCard();
    const hass = createHassContext(callWS);
    card.setConfig(CARD_CONFIG);
    document.body.append(card);
    card.hass = hass;
    await vi.waitFor(() => expect(pending).toHaveLength(4));
    card.hass = withSensorState(hass, "sensor.solar", "300", "2026-09-27T10:09:00Z");
    await vi.advanceTimersByTimeAsync(250);
    const recorded = Date.parse("2026-09-27T10:05:00Z") / 1000;

    pending[0].resolve({});
    pending[1].resolve({});
    pending[2].resolve({ "sensor.solar": [{ s: "100", lu: recorded }] });
    pending[3].resolve({});
    await flushHistoryResponse();

    const data: EnergyHistoryResponse =
      rendererInstances[0].updateData.mock.lastCall![0];
    const x = Array.from(data.mainData[0]);
    expect(data.mainData[1][x.indexOf(recorded)]).toBe(100);
    expect(
      data.mainData[1][x.indexOf(Date.parse("2026-09-27T10:09:00Z") / 1000)],
    ).toBe(300);
  });

  // Requests the whole day's raw states and draws them in place of statistics.
  it("loads the day's raw history at high precision", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-27T10:10:00Z") });
    const recorded = Date.parse("2026-09-27T09:01:00Z") / 1000;
    card = new SolarEnergyGraphsCard();
    const hass = createHassContext(
      fixedHistoryApi({
        "statistics:5minute": {
          "sensor.solar": [statisticRow("2026-09-27T09:00:00Z", 500, 400, 600)],
        },
        history: {
          "sensor.solar": [
            { s: "700", lu: recorded },
            { s: "900", lu: recorded + 10 },
          ],
        },
      }),
    );
    card.setConfig(CARD_CONFIG);
    document.body.append(card);
    card.hass = hass;
    await vi.waitFor(() => expect(rendererInstances).toHaveLength(1));
    await flushHistoryResponse();
    const clickedAt = new Date().toISOString();

    navigationButton(card, "Load high precision")?.click();
    await flushHistoryResponse();
    await card.updateComplete;

    expect(hass.callWS).toHaveBeenCalledTimes(5);
    expect(hass.callWS.mock.calls[4][0]).toMatchObject({
      type: "history/history_during_period",
      start_time: "2026-09-26T22:00:00.000Z",
      end_time: clickedAt,
      entity_ids: SENSOR_IDS,
    });
    const data: EnergyHistoryResponse =
      rendererInstances[0].updateData.mock.lastCall![0];
    const x = Array.from(data.mainData[0]);
    expect(data.mainData[1][x.indexOf(recorded)]).toBe(700);
    expect(data.mainData[1][x.indexOf(recorded + 10)]).toBe(900);
    expect(x).not.toContain(Date.parse("2026-09-27T09:02:30Z") / 1000);
    expect(navigationButton(card, "Use standard precision")).not.toBeNull();
  });

  // Switches back to statistics from the already loaded model, without a new request.
  it("returns to standard precision without reloading history", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-27T10:10:00Z") });
    const recorded = Date.parse("2026-09-27T09:01:00Z") / 1000;
    card = new SolarEnergyGraphsCard();
    const hass = createHassContext(
      fixedHistoryApi({
        "statistics:5minute": {
          "sensor.solar": [statisticRow("2026-09-27T09:00:00Z", 500, 400, 600)],
        },
        history: {
          "sensor.solar": [
            { s: "700", lu: recorded },
            { s: "900", lu: recorded + 10 },
          ],
        },
      }),
    );
    card.setConfig(CARD_CONFIG);
    document.body.append(card);
    card.hass = hass;
    await vi.waitFor(() => expect(rendererInstances).toHaveLength(1));
    await flushHistoryResponse();
    navigationButton(card, "Load high precision")?.click();
    await flushHistoryResponse();
    await card.updateComplete;

    navigationButton(card, "Use standard precision")?.click();
    await card.updateComplete;

    expect(hass.callWS).toHaveBeenCalledTimes(5);
    const data: EnergyHistoryResponse =
      rendererInstances[0].updateData.mock.lastCall![0];
    const x = Array.from(data.mainData[0]);
    expect(data.mainData[1][x.indexOf(Date.parse("2026-09-27T09:02:30Z") / 1000)])
      .toBe(500);
    expect(x).not.toContain(recorded);
    expect(navigationButton(card, "Load high precision")).not.toBeNull();
  });

  // Hides the toggle when the one-minute probe finds no finer history.
  it("hides the precision button when the probe finds no finer history", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-27T10:10:00Z") });
    card = new SolarEnergyGraphsCard();
    const hass = createHassContext(
      fixedHistoryApi({
        "statistics:5minute": {
          "sensor.solar": [statisticRow("2026-09-27T09:00:00Z", 500, 400, 600)],
        },
      }),
    );
    card.setConfig(CARD_CONFIG);
    document.body.append(card);
    card.hass = hass;
    await vi.waitFor(() => expect(rendererInstances).toHaveLength(1));
    await flushHistoryResponse();

    expect(hass.callWS).toHaveBeenCalledTimes(4);
    expect(hass.callWS.mock.calls[3][0]).toMatchObject({
      type: "history/history_during_period",
      start_time: "2026-09-26T22:00:00.000Z",
      end_time: "2026-09-26T22:01:00.000Z",
    });
    expect(navigationButton(card, "Load high precision")).toBeNull();
    expect(navigationButton(card, "Use standard precision")).toBeNull();
    const data: EnergyHistoryResponse =
      rendererInstances[0].updateData.mock.lastCall![0];
    const x = Array.from(data.mainData[0]);
    expect(data.mainData[1][x.indexOf(Date.parse("2026-09-27T09:02:30Z") / 1000)])
      .toBe(500);
  });

  // Leaves the full-day precision action available when the short probe fails.
  it("reports a failed precision probe without hiding the action", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-27T10:10:00Z") });
    card = new SolarEnergyGraphsCard();
    const hass = createHassContext(
      fixedHistoryApi({ history: new Error("Recorder unavailable") }),
    );
    card.setConfig(CARD_CONFIG);
    document.body.append(card);
    card.hass = hass;
    await vi.waitFor(() => expect(rendererInstances).toHaveLength(1));
    await flushHistoryResponse();
    await card.updateComplete;

    const button = navigationButton(
      card,
      "Load high precision (availability check failed)",
    );
    expect(button?.title).toContain("Recorder unavailable");
  });

  // Disables the toggle during the initial load and the raw history request.
  it("disables the precision button while history is loading", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-27T10:10:00Z") });
    const recorded = Date.parse("2026-09-27T09:01:00Z") / 1000;
    const { callWS, pending } = deferredHistoryApi();
    card = new SolarEnergyGraphsCard();
    card.setConfig(CARD_CONFIG);
    document.body.append(card);
    card.hass = createHassContext(callWS);
    await vi.waitFor(() => expect(pending).toHaveLength(4));
    await card.updateComplete;
    const initialLoad = navigationButton(card, "Load high precision");
    pending.slice(0, 3).forEach(({ resolve }) => resolve({}));
    pending[3].resolve({
      "sensor.solar": [
        { s: "700", lu: recorded },
        { s: "900", lu: recorded + 10 },
      ],
    });
    await flushHistoryResponse();
    await card.updateComplete;
    const afterInitialLoad = navigationButton(card, "Load high precision")?.disabled;

    navigationButton(card, "Load high precision")?.click();
    await card.updateComplete;
    const rawLoad = navigationButton(card, "Load high precision")?.disabled;
    pending[4].resolve({
      "sensor.solar": [
        { s: "700", lu: recorded },
        { s: "900", lu: recorded + 10 },
      ],
    });
    await flushHistoryResponse();
    await card.updateComplete;

    expect(initialLoad).toBeNull();
    expect([afterInitialLoad, rawLoad]).toEqual([false, true]);
    expect(pending).toHaveLength(5);
    expect(navigationButton(card, "Use standard precision")?.disabled).toBe(false);
  });

  // Passes Home Assistant's explicit dark-mode state to the renderer.
  it("updates chart theme mode when hass changes", async () => {
    card = new SolarEnergyGraphsCard();
    const hass = createHassContext();
    card.setConfig(CARD_CONFIG);
    document.body.append(card);
    card.hass = hass;
    await vi.waitFor(() => expect(rendererInstances).toHaveLength(1));

    card.hass = { ...hass, themes: { darkMode: true } };

    expect(rendererInstances[0].refreshTheme).toHaveBeenCalledWith(true);
    expect(hass.callWS).toHaveBeenCalledTimes(4);
  });

  // Keeps the loaded history when a configured sensor changes; live states are merged instead.
  it("does not reload history for live sensor state changes", async () => {
    card = new SolarEnergyGraphsCard();
    const hass = createHassContext();
    card.setConfig(CARD_CONFIG);
    document.body.append(card);
    card.hass = hass;
    await vi.waitFor(() => expect(rendererInstances).toHaveLength(1));

    card.hass = { ...hass, states: { ...hass.states } };
    expect(hass.callWS).toHaveBeenCalledTimes(4);

    card.hass = {
      ...hass,
      states: {
        ...hass.states,
        "sensor.solar": {
          ...hass.states["sensor.solar"],
          last_updated: "2026-09-27T10:05:00Z",
        },
      },
    };

    await card.updateComplete;
    expect(hass.callWS).toHaveBeenCalledTimes(4);
  });

  // Adds a live sensor state to the current day's charts without a new history request.
  it("merges live sensor states into the current day's charts", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-27T10:10:00Z") });
    card = new SolarEnergyGraphsCard();
    const hass = createHassContext();
    card.setConfig(CARD_CONFIG);
    document.body.append(card);
    card.hass = hass;
    await vi.waitFor(() => expect(rendererInstances).toHaveLength(1));
    await flushHistoryResponse();
    const renderer = rendererInstances[0];
    renderer.updateData.mockClear();

    card.hass = withSensorState(hass, "sensor.solar", "300", "2026-09-27T10:05:00Z");
    await vi.advanceTimersByTimeAsync(250);

    expect(hass.callWS).toHaveBeenCalledTimes(4);
    expect(renderer.updateData).toHaveBeenCalledOnce();
    const data: EnergyHistoryResponse = renderer.updateData.mock.calls[0][0];
    const index = Array.from(data.mainData[0]).indexOf(
      Date.parse("2026-09-27T10:05:00Z") / 1000,
    );
    expect(data.mainData[1][index]).toBe(300);
    expect(data.mainData[7][index]).toBe(200);
  });

  // Merges a burst of live updates once, from the last state of each sensor.
  it("coalesces live updates for the current day", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-27T10:10:00Z") });
    card = new SolarEnergyGraphsCard();
    const hass = createHassContext();
    card.setConfig(CARD_CONFIG);
    document.body.append(card);
    card.hass = hass;
    await vi.waitFor(() => expect(rendererInstances).toHaveLength(1));
    await flushHistoryResponse();
    const renderer = rendererInstances[0];
    renderer.updateData.mockClear();

    const firstUpdate = withSensorState(
      hass,
      "sensor.solar",
      "300",
      "2026-09-27T10:05:00Z",
    );
    card.hass = firstUpdate;
    card.hass = withSensorState(
      firstUpdate,
      "sensor.consumption",
      "400",
      "2026-09-27T10:05:01Z",
    );
    await vi.advanceTimersByTimeAsync(249);
    const beforeWindow = renderer.updateData.mock.calls.length;
    await vi.advanceTimersByTimeAsync(1);

    expect(beforeWindow).toBe(0);
    expect(renderer.updateData).toHaveBeenCalledOnce();
    const data: EnergyHistoryResponse = renderer.updateData.mock.calls[0][0];
    const index = Array.from(data.mainData[0]).indexOf(
      Date.parse("2026-09-27T10:05:01Z") / 1000,
    );
    expect(data.mainData[1][index]).toBe(300);
    expect(data.mainData[7][index]).toBe(400);
    expect(hass.callWS).toHaveBeenCalledTimes(4);
  });

  // Leaves a past day untouched when the current sensor states change.
  it("does not merge live states while a past day is shown", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-27T10:10:00Z") });
    card = new SolarEnergyGraphsCard();
    const hass = createHassContext();
    card.setConfig(CARD_CONFIG);
    document.body.append(card);
    card.hass = hass;
    await vi.waitFor(() => expect(rendererInstances).toHaveLength(1));
    navigationButton(card, "Previous day")?.click();
    await vi.waitFor(() => expect(hass.callWS).toHaveBeenCalledTimes(7));
    await flushHistoryResponse();
    const renderer = rendererInstances[0];
    renderer.updateData.mockClear();

    card.hass = withSensorState(hass, "sensor.solar", "300", "2026-09-27T10:05:00Z");
    await vi.advanceTimersByTimeAsync(250);

    expect(renderer.updateData).not.toHaveBeenCalled();
    expect(hass.callWS).toHaveBeenCalledTimes(7);
  });

  // Initializes charts using the theme received before history returns.
  it("initializes the renderer in the current Home Assistant theme", async () => {
    card = new SolarEnergyGraphsCard();
    card.setConfig(CARD_CONFIG);
    card.hass = { ...createHassContext(), themes: { darkMode: true } };
    document.body.append(card);
    await vi.waitFor(() => expect(rendererInstances).toHaveLength(1));

    expect(rendererInstances[0].darkMode).toBe(true);
  });

  // Releases chart resources when Home Assistant removes the card.
  it("destroys the renderer when disconnected", async () => {
    card = new SolarEnergyGraphsCard();
    await mountConfiguredCard(card);

    card.remove();

    expect(rendererInstances[0].destroy).toHaveBeenCalledOnce();
  });

  // Recreates chart resources if Home Assistant reconnects the same card element.
  it("recreates the renderer when reconnected", async () => {
    card = new SolarEnergyGraphsCard();
    await mountConfiguredCard(card);

    card.remove();
    document.body.append(card);
    await vi.waitFor(() => expect(rendererInstances).toHaveLength(2));

    expect(rendererInstances).toHaveLength(2);
  });

  // Keeps each card instance responsible for its own chart containers.
  it("creates independent renderers for multiple card instances", async () => {
    const firstCard = new SolarEnergyGraphsCard();
    const secondCard = new SolarEnergyGraphsCard();
    firstCard.setConfig(CARD_CONFIG);
    secondCard.setConfig(CARD_CONFIG);
    document.body.append(firstCard, secondCard);
    firstCard.hass = createHassContext();
    secondCard.hass = createHassContext();
    await vi.waitFor(() => expect(rendererInstances).toHaveLength(2));
    card = firstCard;

    expect(rendererInstances[0].containers[0]).not.toBe(
      rendererInstances[1].containers[0],
    );
    secondCard.remove();
  });
});
