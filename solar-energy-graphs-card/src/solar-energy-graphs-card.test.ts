import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { SolarEnergyGraphsCard } from "./solar-energy-graphs-card";
import {
  getLocalDateString,
  getLocalDayWindowForDate,
  shiftLocalDate,
  type EnergyHistoryResponse,
  type HistoryDuringPeriodMessage,
  type HistoryDuringPeriodResponse,
} from "./home-assistant-energy-history";

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

type HistoryApi = (
  message: HistoryDuringPeriodMessage,
) => Promise<HistoryDuringPeriodResponse>;

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

/** Mocks WebSocket history requests that resolve or fail on demand. */
function deferredHistoryApi() {
  const pending: Array<{
    entityId: string;
    resolve: (response: HistoryDuringPeriodResponse) => void;
    reject: (error: Error) => void;
  }> = [];
  const callWS = vi.fn<HistoryApi>(
    (message) =>
      new Promise((resolve, reject) =>
        pending.push({ entityId: message.entity_ids[0], resolve, reject }),
      ),
  );
  return { callWS, pending };
}

/** Settles history responses and the live merge scheduled while loading. */
async function flushHistoryResponse(): Promise<void> {
  await vi.advanceTimersByTimeAsync(250);
}

describe("SolarEnergyGraphsCard", () => {
  let card: SolarEnergyGraphsCard;

  async function mountConfiguredCard(target: SolarEnergyGraphsCard): Promise<void> {
    target.setConfig(CARD_CONFIG);
    document.body.append(target);
    target.hass = createHassContext();
    await vi.waitFor(() => expect(rendererInstances).toHaveLength(1));
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
      card.shadowRoot?.querySelectorAll<HTMLButtonElement>(
        ".day-navigation button",
      ),
    ).toHaveLength(2);
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
    const navigation = card.shadowRoot?.querySelector(".day-navigation");
    const buttons = navigation?.querySelectorAll<HTMLButtonElement>("button");
    const date = navigation?.querySelector("time");

    expect(date?.dateTime).toBe(today);
    expect(buttons?.[1].disabled).toBe(true);

    buttons?.[0].click();
    await vi.waitFor(() => expect(hass.callWS).toHaveBeenCalledTimes(8));
    await card.updateComplete;

    expect(date?.dateTime).toBe(previousDay);
    expect(buttons?.[1].disabled).toBe(false);
    const [request] = hass.callWS.mock.calls[4];
    const previousWindow = getLocalDayWindowForDate(
      previousDay,
      "Europe/Paris",
    );
    expect(request.start_time).toBe(
      new Date((previousWindow.start - 10 * 60) * 1000).toISOString(),
    );

    buttons?.[1].click();
    await vi.waitFor(() => expect(hass.callWS).toHaveBeenCalledTimes(12));
    await card.updateComplete;

    expect(date?.dateTime).toBe(today);
    expect(buttons?.[1].disabled).toBe(true);
  });

  // Keeps a user-selected day when Home Assistant sends unrelated state updates.
  it("does not reset the selected day on ordinary Home Assistant updates", async () => {
    card = new SolarEnergyGraphsCard();
    const hass = createHassContext();
    card.setConfig(CARD_CONFIG);
    document.body.append(card);
    card.hass = hass;
    await vi.waitFor(() => expect(rendererInstances).toHaveLength(1));

    const button = card.shadowRoot?.querySelector<HTMLButtonElement>(
      ".day-navigation button",
    );
    button?.click();
    await vi.waitFor(() => expect(hass.callWS).toHaveBeenCalledTimes(8));
    const selectedDay = card.shadowRoot?.querySelector("time")?.dateTime;

    card.hass = { ...hass, states: { ...hass.states } };
    await card.updateComplete;

    expect(card.shadowRoot?.querySelector("time")?.dateTime).toBe(selectedDay);
    expect(hass.callWS).toHaveBeenCalledTimes(8);
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

    card.shadowRoot
      ?.querySelector<HTMLButtonElement>(".day-navigation button")
      ?.click();
    await vi.waitFor(() => expect(hass.callWS).toHaveBeenCalledTimes(8));

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
    expect(
      hass.callWS.mock.calls.map(([request]) => [request.type, request.entity_ids]),
    ).toEqual(
      SENSOR_IDS.map((entityId) => ["history/history_during_period", [entityId]]),
    );
  });

  // Requests the four sensor histories together instead of one after another.
  it("sends one history request per sensor in parallel", async () => {
    const { callWS, pending } = deferredHistoryApi();
    card = new SolarEnergyGraphsCard();
    card.setConfig(CARD_CONFIG);
    document.body.append(card);

    card.hass = createHassContext(callWS);
    await card.updateComplete;

    expect(pending.map(({ entityId }) => entityId)).toEqual(SENSOR_IDS);
  });

  // Draws a sensor as soon as its history arrives and reports loading until the last one.
  it("renders each sensor history progressively", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-27T10:10:00Z") });
    const { callWS, pending } = deferredHistoryApi();
    card = new SolarEnergyGraphsCard();
    card.setConfig(CARD_CONFIG);
    document.body.append(card);
    card.hass = createHassContext(callWS);
    await vi.waitFor(() => expect(pending).toHaveLength(4));
    const firstState = Date.parse("2026-09-27T09:00:00Z") / 1000;
    const statuses = () =>
      Array.from(card.shadowRoot?.querySelectorAll(".chart-status") ?? []).map(
        (status) => status.textContent?.trim(),
      );

    pending[3].resolve({ "sensor.grid_export": [{ s: "250", lu: firstState }] });
    await flushHistoryResponse();
    await card.updateComplete;
    const renderer = rendererInstances[0];
    const partial: EnergyHistoryResponse =
      renderer.updateData.mock.lastCall?.[0] ?? renderer.data;
    const partialStatuses = statuses();
    pending.slice(0, 3).forEach(({ resolve }) => resolve({}));
    await flushHistoryResponse();
    await card.updateComplete;

    const index = Array.from(partial.mainData[0]).indexOf(firstState);
    expect(partial.gridData[1][index]).toBe(250);
    expect(partialStatuses).toEqual([
      "Loading Home Assistant history…",
      "Loading Home Assistant history…",
    ]);
    expect(statuses()[0]).toBe("Recorded power samples.");
  });

  // Reports a failed sensor request once all requests settle, keeping received data.
  it("keeps received sensors when one history request fails", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-27T10:10:00Z") });
    const { callWS, pending } = deferredHistoryApi();
    card = new SolarEnergyGraphsCard();
    card.setConfig(CARD_CONFIG);
    document.body.append(card);
    card.hass = createHassContext(callWS);
    await vi.waitFor(() => expect(pending).toHaveLength(4));
    const firstState = Date.parse("2026-09-27T09:00:00Z") / 1000;

    pending[0].resolve({ "sensor.solar": [{ s: "800", lu: firstState }] });
    pending[1].reject(new Error("Connection lost"));
    pending[2].resolve({});
    pending[3].resolve({});
    await vi.waitFor(() =>
      expect(card.shadowRoot?.querySelector(".chart-status")?.textContent).toContain(
        "History loading error: Connection lost",
      ),
    );

    const renderer = rendererInstances[0];
    const data: EnergyHistoryResponse =
      renderer.updateData.mock.lastCall?.[0] ?? renderer.data;
    const index = Array.from(data.mainData[0]).indexOf(firstState);
    expect(data.mainData[1][index]).toBe(800);
  });

  // Keeps a live state received while its sensor history was still loading.
  it("keeps live states merged before the history response", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-27T10:10:00Z") });
    const { callWS, pending } = deferredHistoryApi();
    card = new SolarEnergyGraphsCard();
    const hass = createHassContext(callWS);
    card.setConfig(CARD_CONFIG);
    document.body.append(card);
    card.hass = hass;
    await vi.waitFor(() => expect(pending).toHaveLength(4));
    card.hass = withSensorState(hass, "sensor.solar", "300", "2026-09-27T10:05:00Z");
    await vi.advanceTimersByTimeAsync(250);
    const recorded = Date.parse("2026-09-27T10:00:00Z") / 1000;

    pending[0].resolve({ "sensor.solar": [{ s: "100", lu: recorded }] });
    await flushHistoryResponse();

    const data: EnergyHistoryResponse =
      rendererInstances[0].updateData.mock.lastCall![0];
    const x = Array.from(data.mainData[0]);
    expect(data.mainData[1][x.indexOf(recorded)]).toBe(100);
    expect(
      data.mainData[1][x.indexOf(Date.parse("2026-09-27T10:05:00Z") / 1000)],
    ).toBe(300);
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
    card.shadowRoot
      ?.querySelectorAll<HTMLButtonElement>(".day-navigation button")[0]
      .click();
    await vi.waitFor(() => expect(hass.callWS).toHaveBeenCalledTimes(8));
    await flushHistoryResponse();
    const renderer = rendererInstances[0];
    renderer.updateData.mockClear();

    card.hass = withSensorState(hass, "sensor.solar", "300", "2026-09-27T10:05:00Z");
    await vi.advanceTimersByTimeAsync(250);

    expect(renderer.updateData).not.toHaveBeenCalled();
    expect(hass.callWS).toHaveBeenCalledTimes(8);
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
