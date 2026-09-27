const BUCKET_SECONDS = 5 * 60;
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
  value: number;
}

export function getLocalDayWindow(now: Date, timeZone: string): LocalDayWindow {
  const dateParts = getZonedDateParts(now, timeZone);
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
    gridImportToW: powerUnitScale(gridImport, "import réseau"),
    gridExportToW: powerUnitScale(gridExport, "export réseau"),
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

  const productionSamples = parsePowerSamples(
    history[0],
    unitScales.productionToW,
  );
  const consumptionSamples = parsePowerSamples(
    history[1],
    unitScales.consumptionToW,
  );
  const gridImportSamples = parsePowerSamples(
    history[2],
    unitScales.gridImportToW,
  );
  const gridExportSamples = parsePowerSamples(
    history[3],
    unitScales.gridExportToW,
  );
  const sampleTimes = [window.start];
  const production: Array<number | null> = [null];
  const consumption: Array<number | null> = [null];
  const directSolar: Array<number | null> = [null];
  const gridImport: Array<number | null> = [null];
  const gridExport: Array<number | null> = [null];
  const lastSample = Math.min(now, window.end);

  for (
    let bucketStart = window.start;
    bucketStart < lastSample;
    bucketStart += BUCKET_SECONDS
  ) {
    const bucketEnd = Math.min(bucketStart + BUCKET_SECONDS, lastSample);
    const midpoint = (bucketStart + bucketEnd) / 2;
    const productionPower = powerForInterval(
      productionSamples,
      bucketStart,
      bucketEnd,
    );
    const consumptionPower = powerForInterval(
      consumptionSamples,
      bucketStart,
      bucketEnd,
    );
    const gridImportPower = powerForInterval(
      gridImportSamples,
      bucketStart,
      bucketEnd,
    );
    const gridExportPower = powerForInterval(
      gridExportSamples,
      bucketStart,
      bucketEnd,
    );

    sampleTimes.push(midpoint);
    production.push(productionPower);
    consumption.push(consumptionPower);
    directSolar.push(
      productionPower === null || consumptionPower === null
        ? null
        : Math.min(productionPower, consumptionPower),
    );
    gridImport.push(
      gridImportPower === null ? null : Math.max(gridImportPower, 0),
    );
    gridExport.push(
      gridExportPower === null ? null : Math.max(gridExportPower, 0),
    );
  }

  sampleTimes.push(window.end);
  production.push(null);
  consumption.push(null);
  directSolar.push(null);
  gridImport.push(null);
  gridExport.push(null);

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
      `Le capteur ${entityName} doit avoir device_class=power et state_class=measurement.`,
    );
  }
  if (metadata.unit_of_measurement !== "W" && metadata.unit_of_measurement !== "kW") {
    throw new Error(`Le capteur ${entityName} doit être en W ou en kW.`);
  }
  return metadata.unit_of_measurement === "kW" ? 1000 : 1;
}

function parsePowerSamples(
  history: readonly HomeAssistantHistoryState[],
  unitScale: number,
): NumericSample[] {
  return parseNumericSamples(history, unitScale);
}

function parseNumericSamples(
  history: readonly HomeAssistantHistoryState[],
  unitScale: number,
): NumericSample[] {
  const samples = history.flatMap((state) => {
    const timestamp = Date.parse(state.last_changed ?? state.last_updated ?? "");
    const value = state.state.trim() ? Number(state.state) : Number.NaN;
    return Number.isFinite(timestamp) && Number.isFinite(value)
      ? [{ timestamp: timestamp / 1000, value: value * unitScale }]
      : [];
  });

  samples.sort((first, second) => first.timestamp - second.timestamp);
  return samples.filter(
    (sample, index) =>
      index === 0 || sample.timestamp !== samples[index - 1].timestamp,
  );
}

function powerForInterval(
  samples: readonly NumericSample[],
  start: number,
  end: number,
): number | null {
  const values = samples
    .filter((sample) => sample.timestamp >= start && sample.timestamp < end)
    .map((sample) => sample.value);
  if (values.length > 0) {
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }

  let latest: NumericSample | undefined;
  for (const sample of samples) {
    if (sample.timestamp >= end) {
      break;
    }
    latest = sample;
  }
  if (!latest || start - latest.timestamp > MAX_POWER_STALENESS_SECONDS) {
    return null;
  }
  return latest.value;
}
