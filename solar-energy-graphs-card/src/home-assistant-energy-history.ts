const MAX_POWER_STALENESS_SECONDS = 10 * 60;
const HISTORY_BASELINE_SECONDS = MAX_POWER_STALENESS_SECONDS;

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
  entity_ids: [string];
  include_start_time_state: true;
  significant_changes_only: false;
  minimal_response: false;
  no_attributes: true;
}

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
 * Builds the WebSocket history request of one sensor. Every recorded state is
 * requested: `minimal_response` would drop repeated values and the
 * significant-changes filter would drop other states.
 */
export function buildHistoryRequest(
  entityId: string,
  window: LocalDayWindow,
  now: number,
): HistoryDuringPeriodMessage {
  return {
    type: "history/history_during_period",
    start_time: new Date(
      (window.start - HISTORY_BASELINE_SECONDS) * 1000,
    ).toISOString(),
    end_time: new Date(Math.min(now, window.end) * 1000).toISOString(),
    entity_ids: [entityId],
    include_start_time_state: true,
    significant_changes_only: false,
    minimal_response: false,
    no_attributes: true,
  };
}

/** Extracts the states of `entityId`; Home Assistant omits entities without history. */
export function historyStatesOf(
  response: HistoryDuringPeriodResponse,
  entityId: string,
): readonly HomeAssistantCompressedState[] {
  if (typeof response !== "object" || response === null) {
    throw new Error("Home Assistant returned an invalid history response.");
  }
  const states = response[entityId] ?? [];
  if (!Array.isArray(states)) {
    throw new Error("Home Assistant returned an invalid history response.");
  }
  return states;
}

export function getEnergyUnitScales(
  metadata: readonly [
    EnergySensorMetadata | undefined,
    EnergySensorMetadata | undefined,
    EnergySensorMetadata | undefined,
    EnergySensorMetadata | undefined,
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

/** Projects raw samples onto the uPlot series of both charts, up to `now`. */
export function projectEnergyHistory(
  samples: EnergyPowerSamples,
  window: LocalDayWindow,
  now: number,
): EnergyHistoryResponse {
  const lastSample = Math.max(window.start, Math.min(now, window.end));
  const [
    productionSamples,
    consumptionSamples,
    gridImportSamples,
    gridExportSamples,
  ] = samples;
  const sourceTimes = samples
    .flat()
    .map((sample) => sample.timestamp)
    .filter((timestamp) => timestamp >= window.start && timestamp < lastSample);
  const sampleTimes = Array.from(
    new Set([window.start, ...sourceTimes, lastSample, window.end]),
  ).sort((first, second) => first - second);
  const production = alignPowerSamples(productionSamples, sampleTimes);
  const consumption = alignPowerSamples(consumptionSamples, sampleTimes);
  const gridImport = alignPowerSamples(gridImportSamples, sampleTimes).map(
    (value) => (value === null ? null : Math.max(value, 0)),
  );
  const gridExport = alignPowerSamples(gridExportSamples, sampleTimes).map(
    (value) => (value === null ? null : Math.max(value, 0)),
  );
  const directSolar = production.map((value, index) => {
    const load = consumption[index];
    return value === null || load === null ? null : Math.min(value, load);
  });
  const zero = directSolar.map((value) => (value === null ? null : 0));
  const x = Float64Array.from(sampleTimes);
  const productionSeries = production.slice();
  const consumptionSeries = consumption.slice();
  const mainData: EnergyChartPlotData = [
    x,
    production,
    zero,
    directSolar,
    // The red band spans consumption above self-consumption, or above zero
    // when there is no solar production to cover it.
    directSolar.map((value, index) =>
      value ?? (consumption[index] === null ? null : 0),
    ),
    consumption.slice(),
    productionSeries,
    consumptionSeries,
    gridImport,
    gridExport,
  ];
  const negativeImport = gridImport.map((value) =>
    value === null || value === 0 ? value : -value,
  );
  const gridData: EnergyChartPlotData = [x, gridExport, negativeImport];

  return {
    mainData,
    gridData,
    hasProduction: production.some((value) => value !== null),
    hasConsumption: consumption.some((value) => value !== null),
    hasGridImport: gridImport.some((value) => value !== null),
    hasGridExport: gridExport.some((value) => value !== null),
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
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() + 1 !== month ||
    parsed.getUTCDate() !== day
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
  metadata: EnergySensorMetadata | undefined,
  entityName: string,
): number {
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
    return typeof timestamp === "number" && Number.isFinite(timestamp)
      ? [{ timestamp, value: parsePowerValue(state.s, unitScale) }]
      : [];
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

function alignPowerSamples(
  samples: readonly NumericSample[],
  timestamps: readonly number[],
): Array<number | null> {
  let sampleIndex = 0;
  let latest: NumericSample | undefined;
  return timestamps.map((timestamp) => {
    if (timestamp >= timestamps[timestamps.length - 1]) {
      return null;
    }
    while (
      sampleIndex < samples.length &&
      samples[sampleIndex].timestamp <= timestamp
    ) {
      latest = samples[sampleIndex];
      sampleIndex += 1;
    }
    if (
      !latest ||
      latest.value === null ||
      timestamp - latest.timestamp > MAX_POWER_STALENESS_SECONDS
    ) {
      return null;
    }
    return latest.value;
  });
}
