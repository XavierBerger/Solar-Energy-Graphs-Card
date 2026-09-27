const DAY_START_SECONDS = Date.UTC(2025, 0, 1) / 1000;
const SAMPLE_INTERVAL_SECONDS = 30 * 60;
const SAMPLES_PER_HOUR = 2;
const DAY_HOURS = 24;
const SUNRISE_HOUR = 6;
const SUNSET_HOUR = 18;
const PEAK_SOLAR_POWER_W = 5200;

export interface DemoEnergyData {
  timestamps: Float64Array;
  production: Float32Array;
  consumption: Float32Array;
  solarDirect: Float32Array;
  gridSupplied: Float32Array;
  gridImport: Float32Array;
  gridExport: Float32Array;
}

export function createDemoEnergyData(): DemoEnergyData {
  const sampleCount = DAY_HOURS * SAMPLES_PER_HOUR + 1;
  const timestamps = new Float64Array(sampleCount);
  const production = new Float32Array(sampleCount);
  const consumption = new Float32Array(sampleCount);
  const solarDirect = new Float32Array(sampleCount);
  const gridSupplied = new Float32Array(sampleCount);
  const gridImport = new Float32Array(sampleCount);
  const gridExport = new Float32Array(sampleCount);

  for (let index = 0; index < sampleCount; index += 1) {
    const hour = index / SAMPLES_PER_HOUR;
    const daylightProgress =
      (hour - SUNRISE_HOUR) / (SUNSET_HOUR - SUNRISE_HOUR);
    const solarPower =
      daylightProgress > 0 && daylightProgress < 1
        ? PEAK_SOLAR_POWER_W * Math.sin(Math.PI * daylightProgress)
        : 0;
    const morningPeak =
      900 * Math.exp(-(((hour - 7.5) / 1.5) ** 2));
    const eveningPeak = 1400 * Math.exp(-(((hour - 19) / 2) ** 2));
    const baseLoad =
      750 + 180 * Math.sin(((hour - 5) * Math.PI) / 12);
    const loadPower = baseLoad + morningPeak + eveningPeak;
    const directSolarPower = Math.min(solarPower, loadPower);
    const gridPower = loadPower - solarPower;

    timestamps[index] = DAY_START_SECONDS + index * SAMPLE_INTERVAL_SECONDS;
    production[index] = solarPower;
    consumption[index] = loadPower;
    solarDirect[index] = directSolarPower;
    gridSupplied[index] = loadPower - directSolarPower;
    gridImport[index] = Math.max(gridPower, 0);
    gridExport[index] = Math.max(-gridPower, 0);
  }

  return {
    timestamps,
    production,
    consumption,
    solarDirect,
    gridSupplied,
    gridImport,
    gridExport,
  };
}
