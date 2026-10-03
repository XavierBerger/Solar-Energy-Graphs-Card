import { describe, expect, it } from "vitest";
import {
  buildHistoryRequest,
  buildStatisticsRequest,
  combineStatistics,
  getEnergyUnitScales,
  getLocalDateString,
  getLocalDayWindow,
  getLocalDayWindowForDate,
  entityRowsOf,
  mergeLiveEnergySamples,
  normalizeEnergyHistory,
  parseCompressedPowerSamples,
  parseEnergyHistory,
  parsePowerState,
  parseStatisticRows,
  projectEnergyHistory,
  replaceSensorHistory,
  shiftLocalDate,
  type HistoryDuringPeriodResponse,
  type HomeAssistantCompressedState,
  type StatisticSample,
} from "./home-assistant-energy-history";

function statistic(
  start: number,
  mean: number | null,
  min: number | null,
  max: number | null,
  length = 300,
): StatisticSample {
  return { start, end: start + length, mean, min, max };
}

function state(
  timestamp: number,
  value: number | string,
): HomeAssistantCompressedState {
  return { s: String(value), lu: timestamp };
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

  // Skips validation of unconfigured (null) sensors instead of rejecting them.
  it("accepts unconfigured sensors without metadata", () => {
    const power = {
      unit_of_measurement: "kW",
      device_class: "power",
      state_class: "measurement",
    };
    const scales = getEnergyUnitScales([power, power, null, power]);

    expect(scales).toEqual({
      productionToW: 1000,
      consumptionToW: 1000,
      gridImportToW: 1,
      gridExportToW: 1000,
    });
  });

  // Still rejects a configured sensor whose state is missing from Home Assistant.
  it("rejects a configured sensor without metadata", () => {
    const power = {
      unit_of_measurement: "W",
      device_class: "power",
      state_class: "measurement",
    };

    expect(() => getEnergyUnitScales([power, power, undefined, power]))
      .toThrow("grid import sensor must have device_class=power");
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

  // Requires measurement state_class even when the device class is power.
  it("rejects a power sensor that is not a measurement", () => {
    expect(() =>
      getEnergyUnitScales([
        {
          unit_of_measurement: "W",
          device_class: "power",
          state_class: "total",
        },
        null,
        null,
        null,
      ]),
    ).toThrow("state_class=measurement");
  });

  // Rejects unrecognized units when the sensor classes are otherwise valid.
  it("rejects unsupported power units", () => {
    expect(() =>
      getEnergyUnitScales([
        {
          unit_of_measurement: "mW",
          device_class: "power",
          state_class: "measurement",
        },
        null,
        null,
        null,
      ]),
    ).toThrow("The production sensor must use W or kW.");
  });

  // Reports the correct role when any configured sensor has invalid metadata.
  it("names each sensor role when its metadata is invalid", () => {
    const invalidSensor = {
      unit_of_measurement: "W",
      device_class: "energy",
      state_class: "measurement",
    };
    const invalidRoles = [
      {
        sensors: [invalidSensor, null, null, null],
        message: "The production sensor must have device_class=power",
      },
      {
        sensors: [null, invalidSensor, null, null],
        message: "The consumption sensor must have device_class=power",
      },
      {
        sensors: [null, null, null, invalidSensor],
        message: "The grid export sensor must have device_class=power",
      },
    ] as const;

    for (const { sensors, message } of invalidRoles) {
      expect(() => getEnergyUnitScales(sensors)).toThrow(message);
    }
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

  // Keeps selected days as calendar dates in the configured Home Assistant time zone.
  it("formats and shifts local dates without UTC day drift", () => {
    expect(
      getLocalDateString(
        new Date("2026-09-27T22:30:00Z"),
        "Europe/Paris",
      ),
    ).toBe("2026-09-28");
    expect(shiftLocalDate("2026-01-01", -1)).toBe("2025-12-31");
    expect(shiftLocalDate("2025-12-31", 1)).toBe("2026-01-01");
  });

  // Rejects malformed dates and calendar values outside their valid ranges.
  it("rejects invalid local dates", () => {
    const invalidDates = [
      "2026-02-30",
      "prefix-2026-01-01",
      "2026-01-01-suffix",
      "2025-13-01",
      "2025-00-15",
      "2025-01-00",
      "2025-02-29",
    ];

    for (const date of invalidDates) {
      expect(() => shiftLocalDate(date, 1)).toThrow(
        `Invalid local date "${date}".`,
      );
    }
  });

  // Calculates day boundaries from a selected civil date in the HA time zone.
  it("creates selected local-day windows across daylight-saving changes", () => {
    const spring = getLocalDayWindowForDate(
      "2026-03-29",
      "Europe/Paris",
    );
    const autumn = getLocalDayWindowForDate(
      "2026-10-25",
      "Europe/Paris",
    );

    expect(spring.end - spring.start).toBe(23 * 60 * 60);
    expect(autumn.end - autumn.start).toBe(25 * 60 * 60);
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

  // Avoids inventing minute samples when a day has no recorded history points.
  it("keeps only the day boundaries when history is empty", () => {
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

    expect(Array.from(springData.mainData[0])).toEqual([
      spring.start,
      spring.end,
    ]);
    expect(Array.from(autumnData.mainData[0])).toEqual([
      autumn.start,
      autumn.end,
    ]);
    expect(springData.hasProduction).toBe(false);
    expect(springData.hasConsumption).toBe(false);
    expect(springData.hasGridImport).toBe(false);
    expect(springData.hasGridExport).toBe(false);
  });

  // Excludes recorded samples later than now from the projected graph.
  it("does not project history beyond the current time", () => {
    const start = 1_000_000;
    const now = start + 60;
    const window = { start, end: start + 180 };
    const data = normalizeEnergyHistory(
      [[state(start + 90, 500)], [], [], []],
      window,
      now,
    );

    expect(Array.from(data.mainData[0])).toEqual([start, now, window.end]);
    expect(data.mainData[1]).toEqual([null, null, null]);
  });

  // Clamps an earlier current time to the selected day's start.
  it("clamps the projection when now precedes the day window", () => {
    const start = 1_000_000;
    const window = { start, end: start + 180 };
    const data = normalizeEnergyHistory(
      [[], [], [], []],
      window,
      start - 60,
    );

    expect(Array.from(data.mainData[0])).toEqual([start, window.end]);
    expect(data.mainData[1]).toEqual([null, null]);
  });

  // Requests every recorded state of the sensors over the given period.
  it("builds an unfiltered WebSocket history request", () => {
    const request = buildHistoryRequest(["sensor.solar", "sensor.load"], 1000, 2000);

    expect(request).toEqual({
      type: "history/history_during_period",
      start_time: new Date(1000 * 1000).toISOString(),
      end_time: new Date(2000 * 1000).toISOString(),
      entity_ids: ["sensor.solar", "sensor.load"],
      include_start_time_state: true,
      significant_changes_only: false,
      minimal_response: false,
      no_attributes: true,
    });
  });

  // Keeps the history request independent from later edits to the caller's ID list.
  it("copies the history request entity IDs", () => {
    const entityIds = ["sensor.solar"];
    const request = buildHistoryRequest(entityIds, 1000, 2000);

    entityIds.push("sensor.load");

    expect(request.entity_ids).toEqual(["sensor.solar"]);
  });

  // Requests mean, min and max in watts from midnight up to the current time.
  it("builds a statistics request in watts", () => {
    const window = { start: 1000, end: 1000 + 24 * 60 * 60 };

    const request = buildStatisticsRequest(["sensor.solar"], window, 2000, "5minute");

    expect(request).toEqual({
      type: "recorder/statistics_during_period",
      start_time: new Date(1000 * 1000).toISOString(),
      end_time: new Date(2000 * 1000).toISOString(),
      statistic_ids: ["sensor.solar"],
      period: "5minute",
      types: ["mean", "min", "max"],
      units: { power: "W" },
    });
  });

  // Keeps the statistics request independent from later edits to the caller's ID list.
  it("copies the statistics request entity IDs", () => {
    const entityIds = ["sensor.solar"];
    const request = buildStatisticsRequest(
      entityIds,
      { start: 1000, end: 2000 },
      1500,
      "hour",
    );

    entityIds.push("sensor.load");

    expect(request.statistic_ids).toEqual(["sensor.solar"]);
  });

  // Stops a past-day statistics request at midnight instead of the current time.
  it("ends a past-day statistics request at the end of the day", () => {
    const window = { start: 1000, end: 1000 + 24 * 60 * 60 };

    const request = buildStatisticsRequest(
      ["sensor.solar"],
      window,
      window.end + 5000,
      "hour",
    );

    expect(request.end_time).toBe(new Date(window.end * 1000).toISOString());
  });

  // Converts valid bounds to seconds, rejects non-finite bounds and sorts chronologically.
  it("parses statistic rows in chronological order", () => {
    const samples = parseStatisticRows([
      { start: 600_000, end: 900_000, mean: 2, min: 1, max: 3 },
      { start: 300_000, end: 600_000, mean: null, min: 1 },
      {
        start: 900_000,
        end: 1_200_000,
        mean: Number.POSITIVE_INFINITY,
        min: Number.NaN,
        max: Number.NEGATIVE_INFINITY,
      },
      { start: Number.NaN, end: 900_000, mean: 4, min: 3, max: 5 },
      { start: 900_000, end: Number.POSITIVE_INFINITY, mean: 6, min: 5, max: 7 },
    ]);

    expect(samples).toEqual([
      { start: 300, end: 600, mean: null, min: 1, max: null },
      { start: 600, end: 900, mean: 2, min: 1, max: 3 },
      { start: 900, end: 1200, mean: null, min: null, max: null },
    ]);
  });

  // Converts missing and non-finite statistic values to null while retaining finite negatives.
  it("normalizes optional statistic values without clamping finite readings", () => {
    const samples = parseStatisticRows([
      {
        start: 1000,
        end: 2000,
        mean: -2,
        min: Number.NEGATIVE_INFINITY,
        max: undefined,
      },
      {
        start: 2000,
        end: 3000,
        mean: Number.NaN,
        min: 0,
        max: 0,
      },
    ]);

    expect(samples).toEqual([
      {
        start: 1,
        end: 2,
        mean: -2,
        min: null,
        max: null,
      },
      {
        start: 2,
        end: 3,
        mean: null,
        min: 0,
        max: 0,
      },
    ]);
  });

  // Rejects a history response containing more sensor series than expected.
  it("rejects a history response with extra sensor series", () => {
    expect(() => parseEnergyHistory([[], [], [], [], []])).toThrow(
      "Home Assistant returned an invalid history response.",
    );
  });

  // Fills only the purged part of the day with hourly statistics.
  it("completes 5-minute statistics with earlier hourly ones", () => {
    const hourly = [
      statistic(0, 1, 1, 1, 3600),
      statistic(3600, 2, 2, 2, 3600),
      statistic(7200, 3, 3, 3, 3600),
    ];
    const fiveMinute = [statistic(3600, 4, 4, 4), statistic(3900, 5, 5, 5)];

    expect(combineStatistics(fiveMinute, hourly)).toEqual([
      hourly[0],
      ...fiveMinute,
    ]);
    expect(combineStatistics([], hourly)).toEqual(hourly);
    expect(combineStatistics(fiveMinute, [])).toEqual(fiveMinute);
  });

  // Places each interval mean at its midpoint with its min-max range.
  it("projects statistics as mean and min-max series", () => {
    const start = 1_000_200;
    const window = { start, end: start + 3600 };
    const data = projectEnergyHistory(
      [[], [], [], []],
      window,
      window.end,
      [
        [statistic(start, 500, 400, 600), statistic(start + 300, 700, 600, 900)],
        [statistic(start, 300, 200, 350), statistic(start + 300, 800, 750, 850)],
        [statistic(start, 100, 50, 150), statistic(start + 300, 0, 0, 0)],
        [statistic(start, 0, 0, 0), statistic(start + 300, 50, 20, 80)],
      ],
    );

    expect(Array.from(data.mainData[0])).toEqual([
      start,
      start + 150,
      start + 450,
      start + 600,
      window.end,
    ]);
    expect(data.mainData[1]).toEqual([500, 500, 700, null, null]);
    expect(data.mainData[3]).toEqual([300, 300, 700, null, null]);
    expect(data.mainData[10]).toEqual([600, 600, 900, null, null]);
    expect(data.mainData[11]).toEqual([400, 400, 600, null, null]);
    expect(data.mainData[12]).toEqual([350, 350, 850, null, null]);
    expect(data.mainData[13]).toEqual([200, 200, 750, null, null]);
    expect(data.gridData[3]).toEqual([0, 0, 80, null, null]);
    expect(data.gridData[4]).toEqual([0, 0, 20, null, null]);
    expect(data.gridData[5]).toEqual([-50, -50, 0, null, null]);
    expect(data.gridData[6]).toEqual([-150, -150, 0, null, null]);
  });

  // Includes a raw sample exactly at the selected day's start.
  it("projects a source sample at the day start", () => {
    const start = 1_000_200;
    const window = { start, end: start + 120 };
    const data = projectEnergyHistory(
      [[{ timestamp: start, value: 250 }], [], [], []],
      window,
      start + 60,
    );

    expect(Array.from(data.mainData[0])).toEqual([
      start,
      start + 60,
      window.end,
    ]);
    expect(data.mainData[1]).toEqual([250, 250, null]);
  });

  // Leaves a gap for a missing interval instead of bridging it.
  it("leaves a gap between non-contiguous statistics intervals", () => {
    const start = 1_000_200;
    const window = { start, end: start + 3600 };
    const data = projectEnergyHistory(
      [
        [],
        [{ timestamp: start + 300, value: 200 }],
        [],
        [],
      ],
      window,
      window.end,
      [
        [statistic(start, 500, 400, 600), statistic(start + 600, 700, 600, 900)],
        [],
        [],
        [],
      ],
    );

    expect(Array.from(data.mainData[0])).toEqual([
      start,
      start + 150,
      start + 300,
      start + 750,
      start + 900,
      window.end,
    ]);
    expect(data.mainData[1]).toEqual([500, 500, null, 700, null, null]);
    expect(data.mainData[3]).toEqual([null, null, null, 200, null, null]);
  });

  // Uses the next statistics interval at its exact start boundary.
  it("switches statistics values at the interval boundary", () => {
    const start = 1_000_200;
    const window = { start, end: start + 1200 };
    const data = projectEnergyHistory(
      [[], [{ timestamp: start + 300, value: 50 }], [], []],
      window,
      window.end,
      [
        [
          statistic(start, 100, 80, 120),
          statistic(start + 300, 200, 180, 220),
        ],
        [],
        [],
        [],
      ],
    );
    const boundaryIndex = Array.from(data.mainData[0]).indexOf(start + 300);

    expect(boundaryIndex).toBeGreaterThan(-1);
    expect(data.mainData[1][boundaryIndex]).toBe(200);
  });

  // Leaves values missing before a statistics interval begins.
  it("does not backfill before the first statistics interval", () => {
    const start = 1_000_200;
    const window = { start, end: start + 3600 };
    const data = projectEnergyHistory(
      [
        [],
        [{ timestamp: start + 150, value: 200 }],
        [],
        [],
      ],
      window,
      window.end,
      [[statistic(start + 300, 500, 400, 600)], [], [], []],
    );

    expect(Array.from(data.mainData[0])).toEqual([
      start,
      start + 150,
      start + 450,
      start + 600,
      window.end,
    ]);
    expect(data.mainData[1]).toEqual([null, null, 500, null, null]);
  });

  // Continues with raw samples, without range, after the last compiled interval.
  it("extends statistics with raw samples after the last interval", () => {
    const start = 1_000_200;
    const window = { start, end: start + 3600 };
    const data = projectEnergyHistory(
      [[state(start + 200, 999), state(start + 320, 650)].map((sample) => ({
        timestamp: sample.lu!,
        value: Number(sample.s),
      })), [], [], []],
      window,
      start + 400,
      [[statistic(start, 500, 400, 600)], [], [], []],
    );

    expect(Array.from(data.mainData[0])).toEqual([
      start,
      start + 150,
      start + 300,
      start + 320,
      start + 400,
      window.end,
    ]);
    expect(data.mainData[1]).toEqual([500, 500, 999, 650, 650, null]);
    expect(data.mainData[10]).toEqual([600, 600, null, null, null, null]);
  });

  // Includes a raw reading whose timestamp is exactly now.
  it("projects a raw sample at the current-time boundary", () => {
    const start = 1_000_200;
    const now = start + 60;
    const data = projectEnergyHistory(
      [[
        { timestamp: start + 30, value: 100 },
        { timestamp: now, value: 900 },
      ], [], [], []],
      { start, end: start + 120 },
      now,
    );

    expect(Array.from(data.mainData[0])).toEqual([
      start,
      start + 30,
      now,
      start + 120,
    ]);
    expect(data.mainData[1]).toEqual([null, 100, 900, null]);
  });

  // Retains min-max bounds for an interval whose mean is unavailable.
  it("keeps statistic ranges when the interval mean is missing", () => {
    const start = 1_000_200;
    const data = projectEnergyHistory(
      [[], [], [], []],
      { start, end: start + 1200 },
      start + 900,
      [[statistic(start, null, 400, 600)], [], [], []],
    );

    expect(data.mainData[1]).toEqual([null, null, null, null, null]);
    expect(data.mainData[10]).toEqual([600, 600, null, null, null]);
    expect(data.mainData[11]).toEqual([400, 400, null, null, null]);
    expect(data.hasProduction).toBe(false);
  });

  // Treats an entity absent from the response as a sensor without history.
  it("reads the states of one entity from a history response", () => {
    const response: HistoryDuringPeriodResponse = {
      "sensor.solar": [state(10, 500)],
    };

    expect(entityRowsOf(response, "sensor.solar")).toEqual([state(10, 500)]);
    expect(entityRowsOf({}, "sensor.solar")).toEqual([]);
  });

  // Returns an entity's existing row list without copying or changing it.
  it("returns the original history rows", () => {
    const rows = [state(10, 500)];
    const response: HistoryDuringPeriodResponse = { "sensor.solar": rows };

    expect(entityRowsOf(response, "sensor.solar")).toBe(rows);
  });

  // Rejects a malformed response instead of drawing an empty history.
  it("rejects an invalid history response", () => {
    const invalid = {
      "sensor.solar": "not a list",
    } as unknown as HistoryDuringPeriodResponse;

    expect(() => entityRowsOf(invalid, "sensor.solar")).toThrow(
      "Home Assistant returned an invalid history response.",
    );
    expect(() =>
      entityRowsOf(null as unknown as HistoryDuringPeriodResponse, "sensor.solar"),
    ).toThrow("Home Assistant returned an invalid history response.");
    expect(() =>
      entityRowsOf("not an object" as unknown as HistoryDuringPeriodResponse, "sensor.solar"),
    ).toThrow("Home Assistant returned an invalid history response.");
    expect(() => parseEnergyHistory([[]])).toThrow(
      "Home Assistant returned an invalid history response.",
    );
  });

  // Parses compressed states into sorted watt samples, one per timestamp.
  it("parses compressed recorder states", () => {
    const history: HomeAssistantCompressedState[] = [
      { s: "2", lu: 30 },
      { s: "unavailable", lu: 20 },
      { s: "   ", lu: 25 },
      { s: "1.5", lc: 10 },
      { s: "3", lu: 30 },
      { s: "6", lu: Number.NaN },
      { s: "7", lu: Number.POSITIVE_INFINITY },
      { s: "4" },
    ];

    const samples = parseCompressedPowerSamples(history, 1000);

    expect(samples).toEqual([
      { timestamp: 10, value: 1500 },
      { timestamp: 20, value: null },
      { timestamp: 25, value: null },
      { timestamp: 30, value: 2000 },
    ]);
  });

  // Uses the update time when a compressed state also carries its change time.
  it("prefers the last update over the last change of a compressed state", () => {
    const samples = parseCompressedPowerSamples([{ s: "5", lu: 20, lc: 10 }], 1);

    expect(samples).toEqual([{ timestamp: 20, value: 5 }]);
  });

  // Keeps a valid zero update timestamp instead of falling back to last_changed.
  it("prefers a zero compressed update timestamp", () => {
    const samples = parseCompressedPowerSamples(
      [{ s: "5", lu: 0, lc: 10 }],
      1,
    );

    expect(samples).toEqual([{ timestamp: 0, value: 5 }]);
  });

  // Keeps sub-millisecond precision and rejects live states without a valid timestamp.
  it("parses live states with sub-millisecond timestamps", () => {
    const sample = parsePowerState(
      { state: "0.5", last_updated: "1970-01-12T13:47:05.123456Z" },
      1000,
    );
    const invalidTimestamp = parsePowerState(
      { state: "0.5", last_updated: "not-a-timestamp" },
      1000,
    );

    expect(sample?.timestamp).toBeCloseTo(1_000_025.123456, 6);
    expect(sample?.value).toBe(500);
    expect(invalidTimestamp).toBeUndefined();
  });

  // Uses last_changed when Home Assistant omits last_updated.
  it("falls back to last_changed for live timestamps", () => {
    const sample = parsePowerState(
      { state: "2.5", last_changed: "2026-06-01T10:00:00Z" },
      1000,
    );

    expect(sample).toEqual({
      timestamp: Date.parse("2026-06-01T10:00:00Z") / 1000,
      value: 2500,
    });
  });

  // Converts non-finite live states to missing values rather than charting infinity.
  it("rejects non-finite live power values", () => {
    const sample = parsePowerState(
      { state: "Infinity", last_updated: "2026-06-01T10:00:00Z" },
      1,
    );

    expect(sample).toEqual({
      timestamp: Date.parse("2026-06-01T10:00:00Z") / 1000,
      value: null,
    });
  });

  // Retains fractional seconds for timestamps with colon and compact UTC offsets.
  it("preserves sub-millisecond precision with numeric timezone offsets", () => {
    const colonOffset = parsePowerState(
      { state: "1", last_updated: "2026-06-01T12:00:00.123456+02:00" },
      1,
    );
    const compactOffset = parsePowerState(
      { state: "1", last_updated: "2026-06-01T12:00:00.654321+0200" },
      1,
    );

    expect(colonOffset?.timestamp).toBeCloseTo(
      Date.parse("2026-06-01T10:00:00.123Z") / 1000 + 0.000456,
      6,
    );
    expect(compactOffset?.timestamp).toBeCloseTo(
      Date.parse("2026-06-01T10:00:00.654Z") / 1000 + 0.000321,
      6,
    );
  });

  // Clears a raw sensor after an unavailable state until a usable reading returns.
  it("keeps unavailable raw samples as gaps between valid readings", () => {
    const start = 1_000_020;
    const data = normalizeEnergyHistory(
      [[state(start, 500), state(start + 30, "unavailable"), state(start + 60, 300)], [], [], []],
      { start, end: start + 120 },
      start + 90,
    );
    const timestamps = Array.from(data.mainData[0]);

    expect(timestamps).toEqual([
      start,
      start + 30,
      start + 60,
      start + 90,
      start + 120,
    ]);
    expect(data.mainData[1]).toEqual([500, null, 300, 300, null]);
  });

  // Keeps live samples merged during loading only when newer than the history.
  it("replaces one sensor history and keeps newer live samples", () => {
    const loading = mergeLiveEnergySamples(
      [[], [], [], []],
      [
        { sensor: 1, timestamp: 20, value: 100 },
        { sensor: 1, timestamp: 25, value: 150 },
        { sensor: 1, timestamp: 40, value: 200 },
      ],
    );

    const samples = replaceSensorHistory(loading, 1, [
      { timestamp: 10, value: 50 },
      { timestamp: 20, value: 100 },
      { timestamp: 30, value: 150 },
    ]);

    expect(samples[1]).toEqual([
      { timestamp: 10, value: 50 },
      { timestamp: 20, value: 100 },
      { timestamp: 30, value: 150 },
      { timestamp: 40, value: 200 },
    ]);
    expect(samples[0]).toBe(loading[0]);
  });

  // Uses the recorded value when a live sample shares the history boundary timestamp.
  it("replaces a live sample at the last recorded timestamp", () => {
    const loading = mergeLiveEnergySamples(
      [[], [], [], []],
      [
        { sensor: 1, timestamp: 30, value: 175 },
        { sensor: 1, timestamp: 40, value: 200 },
      ],
    );

    const samples = replaceSensorHistory(loading, 1, [
      { timestamp: 10, value: 50 },
      { timestamp: 30, value: 150 },
    ]);

    expect(samples[1]).toEqual([
      { timestamp: 10, value: 50 },
      { timestamp: 30, value: 150 },
      { timestamp: 40, value: 200 },
    ]);
  });

  // Adds a live sample at its own timestamp and keeps the other sensors' last values.
  it("merges a live sample and recomputes derived series", () => {
    const start = 1_000_020;
    const window = { start, end: start + 180 };
    const samples = parseEnergyHistory([
      [state(start + 5, 1000)],
      [state(start + 5, 1500)],
      [state(start + 5, 400)],
      [state(start + 5, 0)],
    ]);

    const merged = mergeLiveEnergySamples(samples, [
      { sensor: 0, timestamp: start + 35, value: 2000 },
    ]);
    const data = projectEnergyHistory(merged, window, start + 60);

    expect(Array.from(data.mainData[0])).toEqual([
      start,
      start + 5,
      start + 35,
      start + 60,
      window.end,
    ]);
    expect(data.mainData[1]).toEqual([null, 1000, 2000, 2000, null]);
    expect(data.mainData[3]).toEqual([null, 1000, 1500, 1500, null]);
    expect(data.mainData[7]).toEqual([null, 1500, 1500, 1500, null]);
    expect(data.gridData[2]).toEqual([null, -400, -400, -400, null]);
  });

  // Keeps the consumption curve when a live update arrives without solar production.
  it("keeps consumption after a live update without solar production", () => {
    const start = 1_000_020;
    const window = { start, end: start + 180 };
    const samples = parseEnergyHistory([
      [],
      [state(start + 5, 1500)],
      [state(start + 5, 400)],
      [],
    ]);

    const merged = mergeLiveEnergySamples(samples, [
      { sensor: 2, timestamp: start + 35, value: 500 },
    ]);
    const data = projectEnergyHistory(merged, window, start + 60);

    expect(data.mainData[4]).toEqual([null, 0, 0, 0, null]);
    expect(data.mainData[5]).toEqual([null, 1500, 1500, 1500, null]);
    expect(data.mainData[7]).toEqual([null, 1500, 1500, 1500, null]);
    expect(data.mainData[8]).toEqual([null, 400, 500, 500, null]);
  });

  // Ignores an older live sample, replaces one at the same timestamp and reports no-ops.
  it("orders live samples per sensor", () => {
    const start = 1_000_020;
    const samples = parseEnergyHistory([
      [state(start + 5, 1000)],
      [],
      [],
      [],
    ]);

    const unchanged = mergeLiveEnergySamples(samples, [
      { sensor: 0, timestamp: start + 4, value: 900 },
      { sensor: 0, timestamp: start + 5, value: 1000 },
    ]);
    const replaced = mergeLiveEnergySamples(samples, [
      { sensor: 0, timestamp: start + 5, value: 1100 },
    ]);

    expect(unchanged).toBe(samples);
    expect(replaced[0]).toEqual([{ timestamp: start + 5, value: 1100 }]);
    expect(samples[0]).toEqual([{ timestamp: start + 5, value: 1000 }]);
  });

  // Ignores non-finite live timestamps without replacing the existing samples.
  it("ignores non-finite live sample timestamps", () => {
    const samples = parseEnergyHistory([[state(20, 100)], [], [], []]);
    const merged = mergeLiveEnergySamples(samples, [
      { sensor: 0, timestamp: Number.NaN, value: 200 },
      { sensor: 0, timestamp: Number.POSITIVE_INFINITY, value: 300 },
    ]);

    expect(merged).toBe(samples);
    expect(merged[0]).toEqual([{ timestamp: 20, value: 100 }]);
  });

  // Retains all live samples when the replacement history has no rows.
  it("preserves live samples when replacing with empty history", () => {
    const samples = mergeLiveEnergySamples(
      [[], [], [], []],
      [
        { sensor: 2, timestamp: 10, value: 50 },
        { sensor: 2, timestamp: 20, value: 75 },
      ],
    );

    const replaced = replaceSensorHistory(samples, 2, []);

    expect(replaced[2]).toEqual([
      { timestamp: 10, value: 50 },
      { timestamp: 20, value: 75 },
    ]);
  });

  // Applies the ten-minute freshness limit and unavailable gaps to live samples.
  it("applies freshness and unavailable states to live samples", () => {
    const start = 1_000_020;
    const window = { start, end: start + 3600 };
    const samples = parseEnergyHistory([[], [], [], []]);

    const merged = mergeLiveEnergySamples(samples, [
      { sensor: 0, timestamp: start + 5, value: 1000 },
      { sensor: 1, timestamp: start + 5, value: 1500 },
      { sensor: 1, timestamp: start + 65, value: null },
    ]);
    const data = projectEnergyHistory(merged, window, start + 700);

    expect(Array.from(data.mainData[0])).toEqual([
      start,
      start + 5,
      start + 65,
      start + 700,
      window.end,
    ]);
    expect(data.mainData[1]).toEqual([null, 1000, 1000, null, null]);
    expect(data.mainData[7]).toEqual([null, 1500, null, null, null]);
  });

  // Fills consumption from zero when there is no solar production to cover it.
  it("fills the red band from zero without solar production", () => {
    const start = 1_000_020;
    const window = { start, end: start + 180 };

    const night = normalizeEnergyHistory(
      [[], [state(start + 5, 1500)], [state(start + 5, 400)], []],
      window,
      start + 30,
    );

    expect(Array.from(night.mainData[0])).toEqual([
      start,
      start + 5,
      start + 30,
      window.end,
    ]);
    expect(night.mainData[3]).toEqual([null, null, null, null]);
    expect(night.mainData[4]).toEqual([null, 0, 0, null]);
    expect(night.mainData[5]).toEqual([null, 1500, 1500, null]);
    expect(night.mainData[7]).toEqual([null, 1500, 1500, null]);
    expect(night.gridData[2]).toEqual([null, -400, -400, null]);
  });

  // Caps direct solar use at consumption when solar production is greater.
  it("does not count surplus production as direct solar consumption", () => {
    const start = 1_000_020;
    const data = normalizeEnergyHistory(
      [[state(start + 5, 2000)], [state(start + 5, 700)], [], []],
      { start, end: start + 60 },
      start + 30,
    );

    expect(data.mainData[1]).toEqual([null, 2000, 2000, null]);
    expect(data.mainData[3]).toEqual([null, 700, 700, null]);
    expect(data.mainData[4]).toEqual([null, 700, 700, null]);
  });

  // Keeps duplicated production and consumption plot series independently mutable.
  it("does not alias stacked area series to their mean lines", () => {
    const start = 1_000_020;
    const data = normalizeEnergyHistory(
      [[state(start + 5, 500)], [state(start + 5, 300)], [], []],
      { start, end: start + 60 },
      start + 30,
    );
    const productionMean = data.mainData[1]!;
    const productionArea = data.mainData[6]!;
    const consumptionMean = data.mainData[5]!;
    const consumptionArea = data.mainData[7]!;

    expect(productionArea).not.toBe(productionMean);
    expect(consumptionArea).not.toBe(consumptionMean);
    productionArea[1] = 999;
    consumptionArea[1] = 888;
    expect(productionMean[1]).toBe(500);
    expect(consumptionMean[1]).toBe(300);
  });

  // Treats a zero-valued reading as present data rather than an empty series.
  it("reports sensors with zero-valued readings as available", () => {
    const start = 1_000_020;
    const data = normalizeEnergyHistory(
      [[state(start + 5, 0)], [state(start + 5, 0)], [], []],
      { start, end: start + 60 },
      start + 30,
    );

    expect(data.mainData[1]).toEqual([null, 0, 0, null]);
    expect(data.mainData[7]).toEqual([null, 0, 0, null]);
    expect(data.hasProduction).toBe(true);
    expect(data.hasConsumption).toBe(true);
  });

  // Prevents negative grid statistics from creating reversed import/export bands.
  it("clamps negative grid means and ranges to zero", () => {
    const start = 1_000_020;
    const window = { start, end: start + 60 };
    const data = projectEnergyHistory(
      [[], [], [], []],
      window,
      start + 30,
      [
        [],
        [],
        [statistic(start, -20, -30, -10)],
        [statistic(start, -40, -50, -30)],
      ],
    );

    expect(data.mainData[8]).toEqual([0, 0, null]);
    expect(data.mainData[9]).toEqual([0, 0, null]);
    expect(data.gridData[1]).toEqual([0, 0, null]);
    expect(data.gridData[2]).toEqual([0, 0, null]);
    expect(data.gridData[3]).toEqual([0, 0, null]);
    expect(data.gridData[4]).toEqual([0, 0, null]);
    expect(data.gridData[5]).toEqual([0, 0, null]);
    expect(data.gridData[6]).toEqual([0, 0, null]);
  });

  // Preserves source timestamps and calculates direct power and separate grid flows.
  it("aligns direct power, autoconsumption and separate grid flows", () => {
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
          state(start + 5, 1500),
          state(start + 35, 1600),
          state(start + 65, 2200),
          state(start + 95, 2500),
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
    const zero = data.mainData[2]!;
    const directSolar = data.mainData[3]!;
    const stackedConsumption = data.mainData[5]!;
    const exported = data.gridData[1]!;
    const imported = data.gridData[2]!;

    expect(production).toEqual([null, 1000, 1200, 2000, 1800, 1800, null]);
    expect(zero).toEqual([null, 0, 0, 0, 0, 0, null]);
    expect(directSolar).toEqual([null, 1000, 1200, 2000, 1800, 1800, null]);
    expect(stackedConsumption).toEqual([
      null, 1500, 1600, 2200, 2500, 2500, null,
    ]);
    expect(
      stackedConsumption.slice(1, 5).every(
        (total, index) => total! > directSolar[index + 1]!,
      ),
    ).toBe(true);
    expect(exported).toEqual([null, 0, 0, 200, 300, 300, null]);
    expect(imported).toEqual([null, -400, -500, -600, -800, -800, null]);
    expect(data.mainData[8]).toEqual([null, 400, 500, 600, 800, 800, null]);
    expect(data.mainData[9]).toEqual([null, 0, 0, 200, 300, 300, null]);
    expect(data.hasProduction).toBe(true);
    expect(data.hasConsumption).toBe(true);
    expect(data.hasGridImport).toBe(true);
    expect(data.hasGridExport).toBe(true);
    expect(Array.from(data.mainData[0])).toEqual([
      start,
      start + 5,
      start + 35,
      start + 65,
      start + 95,
      start + 120,
      window.end,
    ]);
  });

  // Preserves every recorded source point even when consecutive values are equal.
  it("keeps repeated readings at distinct timestamps", () => {
    const start = 1_000_020;
    const window = { start, end: start + 60 };
    const data = normalizeEnergyHistory(
      [
        [state(start + 5, 500), state(start + 15, 500)],
        [state(start + 7, 300)],
        [],
        [],
      ],
      window,
      start + 30,
    );

    expect(Array.from(data.mainData[0])).toEqual([
      start,
      start + 5,
      start + 7,
      start + 15,
      start + 30,
      window.end,
    ]);
    expect(data.mainData[1]).toEqual([null, 500, 500, 500, 500, null]);
  });

  // Preserves sub-millisecond recorder timestamps as separate chart points.
  it("keeps source timestamps that differ only below millisecond precision", () => {
    const start = 1_000_020;
    const window = { start, end: start + 60 };
    const data = normalizeEnergyHistory(
      [
        [
          state(start + 5.123456, 500),
          state(start + 5.123789, 500),
        ],
        [],
        [],
        [],
      ],
      window,
      start + 30,
    );
    const x = Array.from(data.mainData[0]);

    expect(x).toContain(start + 5.123456);
    expect(x).toContain(start + 5.123789);
    expect(x.indexOf(start + 5.123456)).not.toBe(
      x.indexOf(start + 5.123789),
    );
  });

  // Carries recent readings forward and clears sensors after unavailable states.
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

    expect(Array.from(data.mainData[0])).toEqual([
      start,
      start + 300,
      start + 600,
    ]);
    expect(data.mainData[1]!).toEqual([500, 10, null]);
    expect(data.mainData[7]!).toEqual([null, 50, null]);
    expect(data.gridData[1]!).toEqual(Array(3).fill(null));
    expect(data.gridData[2]!).toEqual(Array(3).fill(null));
    expect(data.hasProduction).toBe(true);
    expect(data.hasConsumption).toBe(true);
    expect(data.hasGridImport).toBe(false);
    expect(data.hasGridExport).toBe(false);
  });

  // Keeps values right at the ten-minute freshness limit and drops only later stale ones.
  it("leaves a gap when the last power reading exceeds ten minutes", () => {
    const start = 1_000_020;
    const threshold = normalizeEnergyHistory(
      [[state(start, 500)], [state(start + 10 * 60, 200)], [], []],
      { start, end: start + 11 * 60 },
      start + 11 * 60,
    );
    const stale = normalizeEnergyHistory(
      [[state(start, 500)], [state(start + 11 * 60, 100)], [], []],
      { start, end: start + 12 * 60 },
      start + 12 * 60,
    );
    const thresholdProduction = threshold.mainData[1]!;
    const staleProduction = stale.mainData[1]!;

    expect(Array.from(threshold.mainData[0])).toEqual([
      start,
      start + 10 * 60,
      start + 11 * 60,
    ]);
    expect(thresholdProduction).toEqual([500, 500, null]);
    expect(Array.from(stale.mainData[0])).toEqual([
      start,
      start + 11 * 60,
      start + 12 * 60,
    ]);
    expect(staleProduction).toEqual([500, null, null]);
  });
});
