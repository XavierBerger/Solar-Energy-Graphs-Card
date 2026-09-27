import { describe, expect, it } from "vitest";
import { createDemoEnergyData } from "./demo-energy-data";

describe("createDemoEnergyData", () => {
  // Covers one complete deterministic day with half-hour samples.
  it("creates matching samples from midnight through the next midnight", () => {
    const data = createDemoEnergyData();

    expect(data.timestamps).toHaveLength(49);
    expect(data.timestamps[0]).toBe(Date.UTC(2025, 0, 1) / 1000);
    expect(data.timestamps[48] - data.timestamps[0]).toBe(24 * 60 * 60);
    expect(data.production).toHaveLength(data.timestamps.length);
    expect(data.consumption).toHaveLength(data.timestamps.length);
    expect(data.solarDirect).toHaveLength(data.timestamps.length);
    expect(data.gridSupplied).toHaveLength(data.timestamps.length);
  });

  // Keeps the synthetic energy split non-negative and balanced at every sample.
  it("splits consumption into direct solar and grid-supplied power", () => {
    const data = createDemoEnergyData();

    for (let index = 0; index < data.timestamps.length; index += 1) {
      expect(data.production[index]).toBeGreaterThanOrEqual(0);
      expect(data.consumption[index]).toBeGreaterThan(0);
      expect(data.solarDirect[index]).toBeGreaterThanOrEqual(0);
      expect(data.solarDirect[index]).toBeLessThanOrEqual(
        data.production[index],
      );
      expect(data.gridSupplied[index]).toBeGreaterThanOrEqual(0);
      expect(data.solarDirect[index] + data.gridSupplied[index]).toBeCloseTo(
        data.consumption[index],
        3,
      );
    }
  });

  // Provides repeatable daytime production and nighttime grid-only consumption.
  it("produces a repeatable solar profile and night-time grid load", () => {
    const first = createDemoEnergyData();
    const second = createDemoEnergyData();

    expect(first.production).toEqual(second.production);
    expect(first.production[0]).toBe(0);
    expect(first.production[24]).toBeGreaterThan(0);
    expect(first.production[48]).toBe(0);
    expect(first.solarDirect[0]).toBe(0);
    expect(first.gridSupplied[0]).toBeCloseTo(first.consumption[0], 3);
  });
});
