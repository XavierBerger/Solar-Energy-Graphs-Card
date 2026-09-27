import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { SolarEnergyGraphsCard } from "./solar-energy-graphs-card";

const { rendererInstances } = vi.hoisted(() => ({
  rendererInstances: [] as Array<{
    containers: HTMLElement[];
    destroy: ReturnType<typeof vi.fn>;
  }>,
}));

vi.mock("./energy-charts-renderer", () => ({
  EnergyChartsRenderer: class {
    readonly containers: HTMLElement[];
    readonly destroy = vi.fn();

    constructor(containers: HTMLElement[]) {
      this.containers = containers;
      rendererInstances.push(this);
    }
  },
}));

describe("SolarEnergyGraphsCard", () => {
  let card: SolarEnergyGraphsCard;

  beforeEach(() => {
    rendererInstances.length = 0;
  });

  afterEach(() => {
    card?.remove();
    document.body.replaceChildren();
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

  // Keeps Home Assistant's layout estimate aligned with the two chart areas.
  it("reports a card size of nine rows", () => {
    card = new SolarEnergyGraphsCard();

    expect(card.getCardSize()).toBe(9);
  });

  // Ensures both titled chart containers identify their data as temporary demonstrations.
  it("renders two titled chart areas with a mock-data notice", async () => {
    card = new SolarEnergyGraphsCard();
    document.body.append(card);
    await card.updateComplete;

    expect(card.shadowRoot?.querySelectorAll(".chart")).toHaveLength(2);
    expect(card.shadowRoot?.textContent).toContain(
      "Graphique de démonstration 1",
    );
    expect(card.shadowRoot?.textContent).toContain(
      "Graphique de démonstration 2",
    );
    expect(card.shadowRoot?.querySelectorAll(".graph-note")).toHaveLength(2);
    expect(card.shadowRoot?.textContent).toContain(
      "Données artificielles de démonstration",
    );
  });

  // Provides both rendered elements to the uPlot renderer after the card updates.
  it("creates a renderer for both chart containers", async () => {
    card = new SolarEnergyGraphsCard();
    document.body.append(card);
    await card.updateComplete;

    expect(rendererInstances).toHaveLength(1);
    expect(rendererInstances[0].containers).toHaveLength(2);
    expect(rendererInstances[0].containers).toEqual([
      card.shadowRoot?.querySelector('[data-chart="one"]'),
      card.shadowRoot?.querySelector('[data-chart="two"]'),
    ]);
  });

  // Releases chart resources when Home Assistant removes the card.
  it("destroys the renderer when disconnected", async () => {
    card = new SolarEnergyGraphsCard();
    document.body.append(card);
    await card.updateComplete;

    card.remove();

    expect(rendererInstances[0].destroy).toHaveBeenCalledOnce();
  });

  // Recreates chart resources if Home Assistant reconnects the same card element.
  it("recreates the renderer when reconnected", async () => {
    card = new SolarEnergyGraphsCard();
    document.body.append(card);
    await card.updateComplete;

    card.remove();
    document.body.append(card);
    await card.updateComplete;

    expect(rendererInstances).toHaveLength(2);
  });

  // Keeps each card instance responsible for its own pair of chart containers.
  it("creates independent renderers for multiple card instances", async () => {
    const firstCard = new SolarEnergyGraphsCard();
    const secondCard = new SolarEnergyGraphsCard();
    document.body.append(firstCard, secondCard);
    await Promise.all([firstCard.updateComplete, secondCard.updateComplete]);
    card = firstCard;

    expect(rendererInstances).toHaveLength(2);
    expect(rendererInstances[0].containers[0]).not.toBe(
      rendererInstances[1].containers[0],
    );
    secondCard.remove();
  });
});
