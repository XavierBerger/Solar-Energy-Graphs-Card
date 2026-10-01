import { expect, it } from "vitest";
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
