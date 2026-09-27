import { describe, expect, it } from "vitest";
import {
  buildHistoryApiPath,
  getEnergyUnitScales,
  getLocalDayWindow,
  normalizeEnergyHistory,
  type HomeAssistantHistoryState,
} from "./home-assistant-energy-history";

const SENSOR_IDS = [
  "sensor.solar",
  "sensor.consumption",
  "sensor.grid_import",
  "sensor.grid_export",
] as const;

function state(timestamp: number, value: number | string): HomeAssistantHistoryState {
  return {
    state: String(value),
    last_changed: new Date(timestamp * 1000).toISOString(),
  };
}

describe("Home Assistant energy history", () => {
  // Accepts W and kW power sensors and converts every input to watts.
  it("normalizes configured sensor units to watts", () => {
    const scales = getEnergyUnitScales([
      {
        unit_of_measurement: "kW",
        device_class: "power",
        state_class: "measurement",
      },
      {
        unit_of_measurement: "W",
        device_class: "power",
        state_class: "measurement",
      },
      {
        unit_of_measurement: "kW",
        device_class: "power",
        state_class: "measurement",
      },
      {
        unit_of_measurement: "W",
        device_class: "power",
        state_class: "measurement",
      },
    ]);

    expect(scales).toEqual({
      productionToW: 1000,
      consumptionToW: 1,
      gridImportToW: 1000,
      gridExportToW: 1,
    });
  });

  // Rejects sensors that are not instantaneous power measurements.
  it("rejects incompatible sensor classes and units", () => {
    expect(() =>
      getEnergyUnitScales([
        {
          unit_of_measurement: "Wh",
          device_class: "energy",
          state_class: "total_increasing",
        },
        {
          unit_of_measurement: "W",
          device_class: "power",
          state_class: "measurement",
        },
        {
          unit_of_measurement: "W",
          device_class: "power",
          state_class: "measurement",
        },
        {
          unit_of_measurement: "W",
          device_class: "power",
          state_class: "measurement",
        },
      ]),
    ).toThrow("device_class=power");
  });

  // Resolves midnight and the next midnight in the configured HA time zone.
  it("creates a local-day window using Europe/Paris offsets", () => {
    const window = getLocalDayWindow(
      new Date("2026-09-27T12:00:00Z"),
      "Europe/Paris",
    );

    expect(window.start).toBe(Date.parse("2026-09-26T22:00:00Z") / 1000);
    expect(window.end).toBe(Date.parse("2026-09-27T22:00:00Z") / 1000);
  });

  // Keeps the queried day correct across spring and autumn daylight-saving changes.
  it("creates 23-hour and 25-hour days at daylight-saving transitions", () => {
    const spring = getLocalDayWindow(
      new Date("2026-03-29T12:00:00Z"),
      "Europe/Paris",
    );
    const autumn = getLocalDayWindow(
      new Date("2026-10-25T12:00:00Z"),
      "Europe/Paris",
    );

    expect(spring.end - spring.start).toBe(23 * 60 * 60);
    expect(autumn.end - autumn.start).toBe(25 * 60 * 60);
  });

  // Creates one plotted point per minute while preserving 23-hour and 25-hour days.
  it("generates minute-resolution points across daylight-saving days", () => {
    const spring = getLocalDayWindow(
      new Date("2026-03-29T12:00:00Z"),
      "Europe/Paris",
    );
    const autumn = getLocalDayWindow(
      new Date("2026-10-25T12:00:00Z"),
      "Europe/Paris",
    );
    const emptyHistory = [[], [], [], []] as const;
    const springData = normalizeEnergyHistory(
      emptyHistory,
      spring,
      spring.end,
    );
    const autumnData = normalizeEnergyHistory(
      emptyHistory,
      autumn,
      autumn.end,
    );

    expect(springData.mainData[0].length).toBe(23 * 60 + 2);
    expect(autumnData.mainData[0].length).toBe(25 * 60 + 2);
  });

  // Requests four configured power entities with a baseline before local midnight.
  it("builds a bounded Home Assistant history API request", () => {
    const window = { start: 1000, end: 1000 + 24 * 60 * 60 };
    const path = buildHistoryApiPath(SENSOR_IDS, window, 2000);
    const [encodedStart, query] = path.slice("history/period/".length).split("?");
    const params = new URLSearchParams(query);

    expect(decodeURIComponent(encodedStart)).toBe(
      new Date((window.start - 10 * 60) * 1000).toISOString(),
    );
    expect(params.get("filter_entity_id")).toBe(SENSOR_IDS.join(","));
    expect(params.get("end_time")).toBe(new Date(2000 * 1000).toISOString());
    expect(params.get("minimal_response")).toBe("1");
    expect(params.get("no_attributes")).toBe("1");
  });

  // Averages power readings per interval and keeps measured import/export separate.
  it("normalizes direct power, autoconsumption and separate grid flows", () => {
    const start = 1_000_020;
    const window = { start, end: start + 180 };
    const data = normalizeEnergyHistory(
      [
        [
          state(start + 5, 1000),
          state(start + 35, 1200),
          state(start + 65, 2000),
          state(start + 95, 1800),
        ],
        [
          state(start + 5, 500),
          state(start + 35, 700),
          state(start + 65, 800),
          state(start + 95, 1000),
        ],
        [
          state(start + 5, 400),
          state(start + 35, 500),
          state(start + 65, 600),
          state(start + 95, 800),
        ],
        [
          state(start + 5, 0),
          state(start + 35, 0),
          state(start + 65, 200),
          state(start + 95, 300),
        ],
      ],
      window,
      start + 120,
    );

    const production = data.mainData[1]!;
    const directSolar = data.mainData[3]!;
    const gridSupplied = data.mainData[5]!;
    const exported = data.gridData[1]!;
    const imported = data.gridData[2]!;

    expect(production).toEqual([null, 1100, 1900, null]);
    expect(directSolar).toEqual([null, 600, 900, null]);
    expect(gridSupplied).toEqual([null, 0, 0, null]);
    expect(exported).toEqual([null, 0, 250, null]);
    expect(imported).toEqual([null, -450, -700, null]);
    expect(data.hasProduction).toBe(true);
    expect(data.hasConsumption).toBe(true);
    expect(data.hasGridImport).toBe(true);
    expect(data.hasGridExport).toBe(true);
    expect(Array.from(data.mainData[0])).toEqual([
      start,
      start + 30,
      start + 90,
      window.end,
    ]);
  });

  // Reuses known readings for up to ten minutes and preserves unavailable gaps.
  it("marks unavailable readings as missing and carries recent values forward", () => {
    const start = 1_000_000;
    const data = normalizeEnergyHistory(
      [
        [state(start, 500), state(start + 300, 10), state(start + 600, 20)],
        [state(start, "unknown"), state(start + 300, 50)],
        [],
        [],
      ],
      { start, end: start + 600 },
      start + 600,
    );

    expect(data.mainData[1]!).toEqual([
      null, 500, 500, 500, 500, 500, 10, 10, 10, 10, 10, null,
    ]);
    expect(data.mainData[7]!).toEqual([
      null, null, null, null, null, null, 50, 50, 50, 50, 50, null,
    ]);
    expect(data.gridData[1]!).toEqual(Array(12).fill(null));
    expect(data.gridData[2]!).toEqual(Array(12).fill(null));
    expect(data.hasProduction).toBe(true);
    expect(data.hasConsumption).toBe(true);
    expect(data.hasGridImport).toBe(false);
    expect(data.hasGridExport).toBe(false);
  });

  // Stops carrying a sensor value after the ten-minute freshness limit.
  it("leaves a gap when the last power reading exceeds ten minutes", () => {
    const start = 1_000_020;
    const data = normalizeEnergyHistory(
      [[state(start, 500)], [], [], []],
      { start, end: start + 12 * 60 },
      start + 12 * 60,
    );
    const production = data.mainData[1]!;

    expect(production.slice(1, 12)).toEqual(Array(11).fill(500));
    expect(production[12]).toBeNull();
    expect(production[13]).toBeNull();
  });
});
