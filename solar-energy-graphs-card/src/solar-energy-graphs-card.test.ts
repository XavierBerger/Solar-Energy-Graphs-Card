import { afterEach, describe, expect, it } from "vitest";
import { SolarEnergyGraphsCard } from "./solar-energy-graphs-card";

describe("SolarEnergyGraphsCard", () => {
  let card: SolarEnergyGraphsCard;

  afterEach(() => {
    card?.remove();
  });

  // Confirms that Lovelace's expected custom card type is accepted.
  it("accepts its configured Lovelace type", () => {
    card = new SolarEnergyGraphsCard();

    expect(() =>
      card.setConfig({ type: "custom:solar-energy-graphs-card" }),
    ).not.toThrow();
  });

  // Prevents unrelated Lovelace card configurations from being accepted.
  it("rejects a different Lovelace card type", () => {
    card = new SolarEnergyGraphsCard();

    expect(() => card.setConfig({ type: "custom:another-card" })).toThrow(
      'Expected card type "custom:solar-energy-graphs-card".',
    );
  });

  // Keeps Home Assistant's layout estimate aligned with the minimal card.
  it("reports a card size of two rows", () => {
    card = new SolarEnergyGraphsCard();

    expect(card.getCardSize()).toBe(2);
  });

  // Verifies the initial placeholder renders inside the Home Assistant card shell.
  it("renders the prototype label inside ha-card", async () => {
    card = new SolarEnergyGraphsCard();
    document.body.append(card);
    await card.updateComplete;

    expect(card.shadowRoot?.querySelector("ha-card")).not.toBeNull();
    expect(card.shadowRoot?.textContent).toContain("Solar Energy Graphs Card");
  });
});
