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
  type HomeAssistantHistoryState,
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

type HistoryApi = (
  method: string,
  path: string,
) => Promise<readonly (readonly HomeAssistantHistoryState[])[]>;

function createHassContext(
  callApi: ReturnType<typeof vi.fn<HistoryApi>> = vi.fn<HistoryApi>(
    async () => [[], [], [], []],
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
    callApi,
    apiCalls: callApi,
  };
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
    await vi.waitFor(() => expect(hass.apiCalls).toHaveBeenCalledTimes(2));
    await card.updateComplete;

    expect(date?.dateTime).toBe(previousDay);
    expect(buttons?.[1].disabled).toBe(false);
    const [, historyPath] = hass.apiCalls.mock.calls[1];
    const previousWindow = getLocalDayWindowForDate(
      previousDay,
      "Europe/Paris",
    );
    expect(decodeURIComponent(historyPath.split("?")[0].split("/").pop()!)).toBe(
      new Date((previousWindow.start - 10 * 60) * 1000).toISOString(),
    );

    buttons?.[1].click();
    await vi.waitFor(() => expect(hass.apiCalls).toHaveBeenCalledTimes(3));
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
    await vi.waitFor(() => expect(hass.apiCalls).toHaveBeenCalledTimes(2));
    const selectedDay = card.shadowRoot?.querySelector("time")?.dateTime;

    card.hass = { ...hass, states: { ...hass.states } };
    await card.updateComplete;

    expect(card.shadowRoot?.querySelector("time")?.dateTime).toBe(selectedDay);
    expect(hass.apiCalls).toHaveBeenCalledTimes(2);
  });

  // Ignores an earlier day's response when a later navigation request finishes first.
  it("does not replace selected-day data with a stale history response", async () => {
    const pendingResponses: Array<
      (history: readonly (readonly HomeAssistantHistoryState[])[]) => void
    > = [];
    const callApi = vi.fn(
      (_method: string, _path: string) =>
        new Promise<readonly (readonly HomeAssistantHistoryState[])[]>(
          (resolve) => pendingResponses.push(resolve),
        ),
    );
    card = new SolarEnergyGraphsCard();
    const hass = createHassContext(callApi);
    card.setConfig(CARD_CONFIG);
    document.body.append(card);
    card.hass = hass;
    await vi.waitFor(() => expect(hass.apiCalls).toHaveBeenCalledTimes(1));

    card.shadowRoot
      ?.querySelector<HTMLButtonElement>(".day-navigation button")
      ?.click();
    await vi.waitFor(() => expect(hass.apiCalls).toHaveBeenCalledTimes(2));

    pendingResponses[0]([[], [], [], []]);
    await Promise.resolve();
    await Promise.resolve();
    expect(rendererInstances).toHaveLength(0);

    pendingResponses[1]([[], [], [], []]);
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
    expect(hass.apiCalls).toHaveBeenCalledOnce();
    expect(hass.apiCalls).toHaveBeenCalledWith(
      "GET",
      expect.stringContaining("history/period/"),
    );
    const [, historyPath] = hass.apiCalls.mock.calls[0];
    const query = new URLSearchParams(historyPath.split("?")[1]);
    expect(query.get("filter_entity_id")).toBe(
      "sensor.solar,sensor.consumption,sensor.grid_import,sensor.grid_export",
    );
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
    expect(hass.apiCalls).toHaveBeenCalledOnce();
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
    expect(hass.apiCalls).toHaveBeenCalledOnce();

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
    expect(hass.apiCalls).toHaveBeenCalledOnce();
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
