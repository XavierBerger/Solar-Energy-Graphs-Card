import { expect, it, vi } from "vitest";
import "./index";

// Makes the card discoverable from Home Assistant's visual card picker.
it("registers the card in Home Assistant's visual card picker", () => {
  const customCards = (
    window as Window & {
      customCards?: Array<{ type: string; name: string; description: string }>;
    }
  ).customCards;

  expect(customCards).toContainEqual({
    type: "solar-energy-graphs-card",
    name: "Solar Energy Graphs Card",
    description: "Two synchronized solar energy graphs.",
  });
});

// Avoids adding a second card-picker entry when Home Assistant already has the card.
it("does not duplicate existing visual card picker metadata", async () => {
  const customCardWindow = window as Window & {
    customCards?: Array<{ type: string; name: string; description: string }>;
  };
  const original = customCardWindow.customCards;
  const metadata = {
    type: "solar-energy-graphs-card",
    name: "Solar Energy Graphs Card",
    description: "Two synchronized solar energy graphs.",
  };
  customCardWindow.customCards = [metadata];
  vi.resetModules();

  try {
    await import("./index");
    expect(customCardWindow.customCards).toEqual([metadata]);
  } finally {
    customCardWindow.customCards = original;
  }
});
