const MAX_POWER_STALENESS_SECONDS = 10 * 60;
const HISTORY_BASELINE_SECONDS = MAX_POWER_STALENESS_SECONDS;

export interface HomeAssistantHistoryState {
  state: string;
  last_changed?: string;
  last_updated?: string;
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

interface NumericSample {
  timestamp: number;
  value: number | null;
}

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

export function buildHistoryApiPath(
  entityIds: readonly [string, string, string, string],
  window: LocalDayWindow,
  now: number,
): string {
  const start = new Date(
    (window.start - HISTORY_BASELINE_SECONDS) * 1000,
  ).toISOString();
  const end = new Date(Math.min(now, window.end) * 1000).toISOString();
  const query = new URLSearchParams({
    filter_entity_id: entityIds.join(","),
    end_time: end,
    minimal_response: "1",
    no_attributes: "1",
  });
  return `history/period/${encodeURIComponent(start)}?${query.toString()}`;
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
  history: readonly (readonly HomeAssistantHistoryState[])[],
  window: LocalDayWindow,
  now: number,
  unitScales: EnergyUnitScales = {
    productionToW: 1,
    consumptionToW: 1,
    gridImportToW: 1,
    gridExportToW: 1,
  },
): EnergyHistoryResponse {
  if (history.length !== 4) {
    throw new Error("Home Assistant returned an invalid history response.");
  }

  const lastSample = Math.max(window.start, Math.min(now, window.end));
  const productionSamples = parsePowerSamples(
    history[0],
    unitScales.productionToW,
    lastSample,
  );
  const consumptionSamples = parsePowerSamples(
    history[1],
    unitScales.consumptionToW,
    lastSample,
  );
  const gridImportSamples = parsePowerSamples(
    history[2],
    unitScales.gridImportToW,
    lastSample,
  );
  const gridExportSamples = parsePowerSamples(
    history[3],
    unitScales.gridExportToW,
    lastSample,
  );
  const sourceTimes = [
    ...productionSamples,
    ...consumptionSamples,
    ...gridImportSamples,
    ...gridExportSamples,
  ]
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
  const gridSupplied = consumption.map((value, index) => {
    const solar = directSolar[index];
    return value === null || solar === null ? null : value - solar;
  });
  const x = Float64Array.from(sampleTimes);
  const productionSeries = production.slice();
  const consumptionSeries = consumption.slice();
  const mainData: EnergyChartPlotData = [
    x,
    production,
    zero,
    directSolar,
    directSolar.slice(),
    gridSupplied,
    productionSeries,
    consumptionSeries,
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

function parsePowerSamples(
  history: readonly HomeAssistantHistoryState[],
  unitScale: number,
  lastSample: number,
): NumericSample[] {
  const samples = history.flatMap((state) => {
    const timestamp = Date.parse(state.last_updated ?? state.last_changed ?? "");
    const value = state.state.trim() ? Number(state.state) : Number.NaN;
    const timestampSeconds = timestamp / 1000;
    return Number.isFinite(timestamp) && timestampSeconds <= lastSample
      ? [
          {
            timestamp: timestampSeconds,
            value: Number.isFinite(value) ? value * unitScale : null,
          },
        ]
      : [];
  });

  samples.sort((first, second) => first.timestamp - second.timestamp);
  return samples.filter(
    (sample, index) =>
      index === 0 || sample.timestamp !== samples[index - 1].timestamp,
  );
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
