const MAX_POWER_STALENESS_SECONDS = 10 * 60;

export interface HomeAssistantHistoryState {
  state: string;
  last_changed?: string;
  last_updated?: string;
}

/** Recorder state in the WebSocket compressed format, timestamps in seconds. */
export interface HomeAssistantCompressedState {
  s: string;
  lu?: number;
  lc?: number;
}

/** Response of `history/history_during_period`, keyed by entity ID. */
export type HistoryDuringPeriodResponse = Record<
  string,
  readonly HomeAssistantCompressedState[] | undefined
>;

export interface HistoryDuringPeriodMessage {
  type: "history/history_during_period";
  start_time: string;
  end_time: string;
  entity_ids: string[];
  include_start_time_state: true;
  significant_changes_only: false;
  minimal_response: false;
  no_attributes: true;
}

export type StatisticsPeriod = "5minute" | "hour";

export interface StatisticsDuringPeriodMessage {
  type: "recorder/statistics_during_period";
  start_time: string;
  end_time: string;
  statistic_ids: string[];
  period: StatisticsPeriod;
  types: ["mean", "min", "max"];
  units: { power: "W" };
}

/** Recorder statistic row; `start` and `end` are in milliseconds. */
export interface HomeAssistantStatisticRow {
  start: number;
  end: number;
  mean?: number | null;
  min?: number | null;
  max?: number | null;
}

/** Response of `recorder/statistics_during_period`, keyed by statistic ID. */
export type StatisticsDuringPeriodResponse = Record<
  string,
  readonly HomeAssistantStatisticRow[] | undefined
>;

/** One statistics interval in W, bounds in seconds. */
export interface StatisticSample {
  start: number;
  end: number;
  mean: number | null;
  min: number | null;
  max: number | null;
}

/** Chronological statistics for production, consumption, grid import and grid export. */
export type EnergyStatistics = readonly [
  readonly StatisticSample[],
  readonly StatisticSample[],
  readonly StatisticSample[],
  readonly StatisticSample[],
];

export const NO_STATISTICS: EnergyStatistics = [[], [], [], []];

export interface EnergySensorMetadata {
  unit_of_measurement?: string;
  device_class?: string;
  state_class?: string;
}

export interface EnergyUnitScales {
  productionToW: number;
  consumptionToW: number;
  gridImportToW: number;
  gridExportToW: number;
}

export interface EnergyHistoryResponse {
  mainData: EnergyChartPlotData;
  gridData: EnergyChartPlotData;
  hasProduction: boolean;
  hasConsumption: boolean;
  hasGridImport: boolean;
  hasGridExport: boolean;
}

export type EnergyChartPlotData = [
  Float64Array,
  ...Array<Array<number | null>>,
];

export interface LocalDayWindow {
  start: number;
  end: number;
}

export interface NumericSample {
  timestamp: number;
  value: number | null;
}

/** Chronological samples in W for production, consumption, grid import and grid export. */
export type EnergyPowerSamples = readonly [
  readonly NumericSample[],
  readonly NumericSample[],
  readonly NumericSample[],
  readonly NumericSample[],
];

const WATT_UNIT_SCALES: EnergyUnitScales = {
  productionToW: 1,
  consumptionToW: 1,
  gridImportToW: 1,
  gridExportToW: 1,
};

export function getLocalDayWindow(now: Date, timeZone: string): LocalDayWindow {
  const dateParts = getZonedDateParts(now, timeZone);
  return getLocalDayWindowForDate(
    formatDateParts(dateParts.year, dateParts.month, dateParts.day),
    timeZone,
  );
}

export function getLocalDateString(now: Date, timeZone: string): string {
  const dateParts = getZonedDateParts(now, timeZone);
  return formatDateParts(dateParts.year, dateParts.month, dateParts.day);
}

export function shiftLocalDate(date: string, days: number): string {
  const { year, month, day } = parseLocalDate(date);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return formatDateParts(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth() + 1,
    shifted.getUTCDate(),
  );
}

export function getLocalDayWindowForDate(
  date: string,
  timeZone: string,
): LocalDayWindow {
  const dateParts = parseLocalDate(date);
  const start = getLocalMidnightTimestamp(
    dateParts.year,
    dateParts.month,
    dateParts.day,
    timeZone,
  );
  const nextDate = new Date(
    Date.UTC(dateParts.year, dateParts.month - 1, dateParts.day + 1),
  );
  const end = getLocalMidnightTimestamp(
    nextDate.getUTCFullYear(),
    nextDate.getUTCMonth() + 1,
    nextDate.getUTCDate(),
    timeZone,
  );
  return { start, end };
}

/**
 * Moves `now` onto `window`'s day, keeping the time elapsed since local
 * midnight; clamped to the day's end, so DST days shift it by up to an hour.
 */
export function getSameTimeOfDay(
  window: LocalDayWindow,
  now: number,
  timeZone: string,
): number {
  const today = getLocalDayWindow(new Date(now * 1000), timeZone);
  return Math.min(window.start + now - today.start, window.end);
}

/**
 * Builds a WebSocket request for every recorded state of the given sensors.
 * `minimal_response` would drop repeated values and the significant-changes
 * filter would drop other states.
 */
export function buildHistoryRequest(
  entityIds: readonly string[],
  start: number,
  end: number,
): HistoryDuringPeriodMessage {
  return {
    type: "history/history_during_period",
    start_time: new Date(start * 1000).toISOString(),
    end_time: new Date(end * 1000).toISOString(),
    entity_ids: [...entityIds],
    include_start_time_state: true,
    significant_changes_only: false,
    minimal_response: false,
    no_attributes: true,
  };
}

/** Requests mean, min and max in W of the sensors over the day, up to `now`. */
export function buildStatisticsRequest(
  entityIds: readonly string[],
  window: LocalDayWindow,
  now: number,
  period: StatisticsPeriod,
): StatisticsDuringPeriodMessage {
  return {
    type: "recorder/statistics_during_period",
    start_time: new Date(window.start * 1000).toISOString(),
    end_time: new Date(Math.min(now, window.end) * 1000).toISOString(),
    statistic_ids: [...entityIds],
    period,
    types: ["mean", "min", "max"],
    units: { power: "W" },
  };
}

/** Extracts the rows of `entityId`; Home Assistant omits entities without data. */
export function entityRowsOf<Row>(
  response: Readonly<Record<string, readonly Row[] | undefined>>,
  entityId: string,
): readonly Row[] {
  if (typeof response !== "object" || response === null) {
    throw new Error("Home Assistant returned an invalid history response.");
  }
  const rows = response[entityId] ?? [];
  if (!Array.isArray(rows)) {
    throw new Error("Home Assistant returned an invalid history response.");
  }
  return rows;
}

/** Converts statistic rows to chronological samples with bounds in seconds. */
export function parseStatisticRows(
  rows: readonly HomeAssistantStatisticRow[],
): StatisticSample[] {
  return rows
    .filter((row) => Number.isFinite(row.start) && Number.isFinite(row.end))
    .map((row) => ({
      start: row.start / 1000,
      end: row.end / 1000,
      mean: finiteOrNull(row.mean),
      min: finiteOrNull(row.min),
      max: finiteOrNull(row.max),
    }))
    .sort((first, second) => first.start - second.start);
}

/**
 * Uses 5-minute statistics, completed by the hourly ones only before the
 * first 5-minute interval: the recorder purges 5-minute statistics first.
 */
export function combineStatistics(
  fiveMinute: readonly StatisticSample[],
  hourly: readonly StatisticSample[],
): StatisticSample[] {
  const firstFiveMinute = fiveMinute[0]?.start ?? Number.POSITIVE_INFINITY;
  return [
    ...hourly.filter((sample) => sample.end <= firstFiveMinute),
    ...fiveMinute,
  ];
}

function finiteOrNull(value: number | null | undefined): number | null {
  return Number.isFinite(value) ? value ?? null : null;
}

/** Validates sensor units; null marks an unconfigured sensor, which is not validated. */
export function getEnergyUnitScales(
  metadata: readonly [
    EnergySensorMetadata | null | undefined,
    EnergySensorMetadata | null | undefined,
    EnergySensorMetadata | null | undefined,
    EnergySensorMetadata | null | undefined,
  ],
): EnergyUnitScales {
  const [production, consumption, gridImport, gridExport] = metadata;

  return {
    productionToW: powerUnitScale(production, "production"),
    consumptionToW: powerUnitScale(consumption, "consumption"),
    gridImportToW: powerUnitScale(gridImport, "grid import"),
    gridExportToW: powerUnitScale(gridExport, "grid export"),
  };
}

export function normalizeEnergyHistory(
  history: readonly (readonly HomeAssistantCompressedState[])[],
  window: LocalDayWindow,
  now: number,
  unitScales: EnergyUnitScales = WATT_UNIT_SCALES,
): EnergyHistoryResponse {
  return projectEnergyHistory(parseEnergyHistory(history, unitScales), window, now);
}

export function parseEnergyHistory(
  history: readonly (readonly HomeAssistantCompressedState[])[],
  unitScales: EnergyUnitScales = WATT_UNIT_SCALES,
): EnergyPowerSamples {
  if (history.length !== 4) {
    throw new Error("Home Assistant returned an invalid history response.");
  }

  return [
    parseCompressedPowerSamples(history[0], unitScales.productionToW),
    parseCompressedPowerSamples(history[1], unitScales.consumptionToW),
    parseCompressedPowerSamples(history[2], unitScales.gridImportToW),
    parseCompressedPowerSamples(history[3], unitScales.gridExportToW),
  ];
}

export interface LivePowerSample extends NumericSample {
  /** Index in EnergyPowerSamples: production, consumption, grid import, grid export. */
  sensor: 0 | 1 | 2 | 3;
}

/**
 * Appends live samples in W to each sensor at its own timestamp. A sample
 * older than the sensor's last one is ignored; one at the same timestamp
 * replaces it. Returns `samples` itself when nothing changed.
 */
export function mergeLiveEnergySamples(
  samples: EnergyPowerSamples,
  live: readonly LivePowerSample[],
): EnergyPowerSamples {
  const merged = [...samples] as [
    readonly NumericSample[],
    readonly NumericSample[],
    readonly NumericSample[],
    readonly NumericSample[],
  ];
  let changed = false;
  for (const { sensor, timestamp, value } of live) {
    const series = merged[sensor];
    const last = series.at(-1);
    if (!Number.isFinite(timestamp) || (last && timestamp < last.timestamp)) {
      continue;
    }
    if (last?.timestamp === timestamp) {
      if (last.value === value) {
        continue;
      }
      merged[sensor] = [...series.slice(0, -1), { timestamp, value }];
    } else {
      merged[sensor] = [...series, { timestamp, value }];
    }
    changed = true;
  }
  return changed ? merged : samples;
}

/**
 * Sets the recorded history of one sensor, keeping the live samples merged
 * while it was loading when they are newer than its last recorded state.
 */
export function replaceSensorHistory(
  samples: EnergyPowerSamples,
  sensor: LivePowerSample["sensor"],
  history: readonly NumericSample[],
): EnergyPowerSamples {
  const lastRecorded = history.at(-1)?.timestamp ?? Number.NEGATIVE_INFINITY;
  const replaced = [...samples] as [
    readonly NumericSample[],
    readonly NumericSample[],
    readonly NumericSample[],
    readonly NumericSample[],
  ];
  replaced[sensor] = [
    ...history,
    ...samples[sensor].filter((sample) => sample.timestamp > lastRecorded),
  ];
  return replaced;
}

/**
 * Projects statistics, then raw samples after each sensor's last statistics
 * interval, onto the uPlot series of both charts, up to `now`.
 */
export function projectEnergyHistory(
  samples: EnergyPowerSamples,
  window: LocalDayWindow,
  now: number,
  statistics: EnergyStatistics = NO_STATISTICS,
): EnergyHistoryResponse {
  const lastSample = Math.max(window.start, Math.min(now, window.end));
  const rawStarts = statistics.map(
    (sensor) => sensor.at(-1)?.end ?? Number.NEGATIVE_INFINITY,
  );
  const sourceTimes = [
    ...statistics.flatMap((sensor, index) => [
      ...sensor.map((sample) => (sample.start + sample.end) / 2),
      rawStarts[index],
    ]),
    ...samples.flatMap((sensor, index) =>
      sensor
        .map((sample) => sample.timestamp)
        .filter((timestamp) => timestamp >= rawStarts[index]),
    ),
  ].filter((timestamp) => timestamp >= window.start && timestamp < lastSample);
  const sampleTimes = Array.from(
    new Set([window.start, ...sourceTimes, lastSample, window.end]),
  ).sort((first, second) => first - second);
  const [production, consumption, gridImport, gridExport] = [0, 1, 2, 3].map(
    (sensor) =>
      alignPowerSamples(
        statistics[sensor],
        samples[sensor],
        rawStarts[sensor],
        sampleTimes,
      ),
  );
  const nonNegative = (values: Array<number | null>) =>
    values.map((value) => (value === null ? null : Math.max(value, 0)));
  const negated = (values: Array<number | null>) =>
    values.map((value) => (value === null || value === 0 ? value : -value));
  const importMean = nonNegative(gridImport.mean);
  const exportMean = nonNegative(gridExport.mean);
  const directSolar = production.mean.map((value, index) => {
    const load = consumption.mean[index];
    return value === null || load === null ? null : Math.min(value, load);
  });
  const zero = directSolar.map((value) => (value === null ? null : 0));
  const x = Float64Array.from(sampleTimes);
  const mainData: EnergyChartPlotData = [
    x,
    production.mean,
    zero,
    directSolar,
    // The red band spans consumption above self-consumption, or above zero
    // when there is no solar production to cover it.
    directSolar.map((value, index) =>
      value ?? (consumption.mean[index] === null ? null : 0),
    ),
    consumption.mean.slice(),
    production.mean.slice(),
    consumption.mean.slice(),
    importMean,
    exportMean,
    production.max,
    production.min,
    consumption.max,
    consumption.min,
  ];
  const gridData: EnergyChartPlotData = [
    x,
    exportMean,
    negated(importMean),
    nonNegative(gridExport.max),
    nonNegative(gridExport.min),
    negated(nonNegative(gridImport.min)),
    negated(nonNegative(gridImport.max)),
  ];

  return {
    mainData,
    gridData,
    hasProduction: production.mean.some((value) => value !== null),
    hasConsumption: consumption.mean.some((value) => value !== null),
    hasGridImport: importMean.some((value) => value !== null),
    hasGridExport: exportMean.some((value) => value !== null),
  };
}

function getZonedDateParts(
  date: Date,
  timeZone: string,
): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
} {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (type: string): number => {
    const part = parts.find((candidate) => candidate.type === type)?.value;
    if (part === undefined) {
      throw new Error(`Unable to determine ${type} in time zone "${timeZone}".`);
    }
    return Number(part);
  };
  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: value("hour"),
    minute: value("minute"),
    second: value("second"),
  };
}

function formatDateParts(year: number, month: number, day: number): string {
  return `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
}

function parseLocalDate(date: string): {
  year: number;
  month: number;
  day: number;
} {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) {
    throw new Error(`Invalid local date "${date}".`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    formatDateParts(
      parsed.getUTCFullYear(),
      parsed.getUTCMonth() + 1,
      parsed.getUTCDate(),
    ) !== date
  ) {
    throw new Error(`Invalid local date "${date}".`);
  }
  return { year, month, day };
}

function getLocalMidnightTimestamp(
  year: number,
  month: number,
  day: number,
  timeZone: string,
): number {
  const targetWallTime = Date.UTC(year, month - 1, day);
  let candidate = targetWallTime;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = getZonedDateParts(new Date(candidate), timeZone);
    const observedWallTime = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    );
    const correction = targetWallTime - observedWallTime;
    candidate += correction;
    if (correction === 0) {
      break;
    }
  }

  return candidate / 1000;
}

function powerUnitScale(
  metadata: EnergySensorMetadata | null | undefined,
  entityName: string,
): number {
  if (metadata === null) {
    return 1;
  }
  if (
    metadata?.device_class !== "power" ||
    metadata.state_class !== "measurement"
  ) {
    throw new Error(
      `The ${entityName} sensor must have device_class=power and state_class=measurement.`,
    );
  }
  if (metadata.unit_of_measurement !== "W" && metadata.unit_of_measurement !== "kW") {
    throw new Error(`The ${entityName} sensor must use W or kW.`);
  }
  return metadata.unit_of_measurement === "kW" ? 1000 : 1;
}

/** Parses one live state; undefined when it has no usable timestamp. */
export function parsePowerState(
  state: HomeAssistantHistoryState,
  unitScale: number,
): NumericSample | undefined {
  const timestamp = parseTimestampSeconds(
    state.last_updated ?? state.last_changed ?? "",
  );
  return Number.isFinite(timestamp)
    ? { timestamp, value: parsePowerValue(state.state, unitScale) }
    : undefined;
}

/** Parses recorded states, sorted and with one sample per timestamp. */
export function parseCompressedPowerSamples(
  history: readonly HomeAssistantCompressedState[],
  unitScale: number,
): NumericSample[] {
  const samples = history.flatMap((state) => {
    const timestamp = state.lu ?? state.lc;
    if (timestamp === undefined || !Number.isFinite(timestamp)) {
      return [];
    }
    return [{ timestamp, value: parsePowerValue(state.s, unitScale) }];
  });

  samples.sort((first, second) => first.timestamp - second.timestamp);
  return samples.filter(
    (sample, index) =>
      index === 0 || sample.timestamp !== samples[index - 1].timestamp,
  );
}

function parsePowerValue(state: string, unitScale: number): number | null {
  const value = state.trim() ? Number(state) : Number.NaN;
  return Number.isFinite(value) ? value * unitScale : null;
}

function parseTimestampSeconds(value: string): number {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return Number.NaN;
  }

  const fractionalSeconds = /\.(\d+)(?=Z|[+-]\d{2}:?\d{2}$)/i.exec(value)?.[1];
  const subMillisecondSeconds = fractionalSeconds
    ? Number(`0.${fractionalSeconds.slice(3)}`) / 1000
    : 0;
  return timestamp / 1000 + subMillisecondSeconds;
}

interface AlignedPower {
  mean: Array<number | null>;
  min: Array<number | null>;
  max: Array<number | null>;
}

/**
 * Before `rawStart`, holds the statistics interval containing each timestamp;
 * from `rawStart`, carries raw samples forward without a min/max range.
 */
function alignPowerSamples(
  statistics: readonly StatisticSample[],
  samples: readonly NumericSample[],
  rawStart: number,
  timestamps: readonly number[],
): AlignedPower {
  const aligned: AlignedPower = { mean: [], min: [], max: [] };
  const push = (mean: number | null, min: number | null, max: number | null) => {
    aligned.mean.push(mean);
    aligned.min.push(min);
    aligned.max.push(max);
  };
  let statisticIndex = 0;
  let sampleIndex = 0;
  let latest: NumericSample | undefined;
  for (const timestamp of timestamps) {
    while (
      sampleIndex < samples.length &&
      samples[sampleIndex].timestamp <= timestamp
    ) {
      latest = samples[sampleIndex];
      sampleIndex += 1;
    }
    if (timestamp >= timestamps[timestamps.length - 1]) {
      push(null, null, null);
    } else if (timestamp < rawStart) {
      while (statistics[statisticIndex].end <= timestamp) {
        statisticIndex += 1;
      }
      const interval = statistics[statisticIndex];
      if (interval.start <= timestamp) {
        push(interval.mean, interval.min, interval.max);
      } else {
        push(null, null, null);
      }
    } else if (
      !latest ||
      timestamp - latest.timestamp > MAX_POWER_STALENESS_SECONDS
    ) {
      push(null, null, null);
    } else {
      push(latest.value, null, null);
    }
  }
  return aligned;
}
