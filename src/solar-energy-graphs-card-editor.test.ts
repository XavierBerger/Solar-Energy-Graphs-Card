import { afterEach, describe, expect, it } from "vitest";
import { SolarEnergyGraphsCardEditor } from "./solar-energy-graphs-card-editor";
import type { SolarEnergyGraphsCardConfig } from "./solar-energy-graphs-card-config";

type HomeAssistantForm = HTMLElement & {
  data?: Record<string, string | null>;
  hass?: unknown;
  schema?: Array<{
    name: string;
    required: boolean;
    selector: { entity: { domain: string } };
  }>;
};

const CARD_CONFIG: SolarEnergyGraphsCardConfig = {
  type: "custom:solar-energy-graphs-card",
  entities: {
    production: "sensor.pv_power",
    consumption: "sensor.house_power",
    grid_import: "sensor.import_power",
    grid_export: "sensor.export_power",
  },
};

describe("SolarEnergyGraphsCardEditor", () => {
  let editor: SolarEnergyGraphsCardEditor | undefined;

  afterEach(() => {
    editor?.remove();
    editor = undefined;
  });

  // Presents four required Home Assistant selectors for sensor entities.
  it("renders the four fixed sensor roles as required entity selectors", async () => {
    editor = new SolarEnergyGraphsCardEditor();
    editor.setConfig(CARD_CONFIG);
    document.body.append(editor);
    await editor.updateComplete;

    const form = editor.shadowRoot?.querySelector("ha-form") as
      | HomeAssistantForm
      | undefined;
    expect(form?.schema).toEqual([
      {
        name: "production",
        selector: { entity: { domain: "sensor" } },
        required: true,
      },
      {
        name: "consumption",
        selector: { entity: { domain: "sensor" } },
        required: true,
      },
      {
        name: "grid_import",
        selector: { entity: { domain: "sensor" } },
        required: true,
      },
      {
        name: "grid_export",
        selector: { entity: { domain: "sensor" } },
        required: true,
      },
    ]);
    expect(form?.data).toEqual(CARD_CONFIG.entities);
  });

  // Makes the active Home Assistant instance available to its native form.
  it("passes the Home Assistant context to the form", async () => {
    editor = new SolarEnergyGraphsCardEditor();
    const hass = { language: "en" };
    editor.hass = hass;
    editor.setConfig(CARD_CONFIG);
    document.body.append(editor);
    await editor.updateComplete;

    const form = editor.shadowRoot?.querySelector("ha-form") as
      | HomeAssistantForm
      | undefined;
    expect(form?.hass).toBe(hass);
  });

  // Uses the French sensor labels of the active Home Assistant profile.
  it("renders the French editor labels when Home Assistant is in French", () => {
    editor = new SolarEnergyGraphsCardEditor();
    editor.hass = { language: "fr" };

    expect((editor as unknown as { computeLabel: (field: { name: string }) => string }).computeLabel({ name: "grid_import" })).toBe("Import réseau");
  });

  // Emits the nested configuration expected by the existing card YAML schema.
  it("emits changed entities using the existing configuration shape", async () => {
    editor = new SolarEnergyGraphsCardEditor();
    editor.setConfig(CARD_CONFIG);
    document.body.append(editor);
    await editor.updateComplete;
    let changedConfig: SolarEnergyGraphsCardConfig | undefined;
    editor.addEventListener("config-changed", (event) => {
      changedConfig = (
        event as CustomEvent<{ config: SolarEnergyGraphsCardConfig }>
      ).detail.config;
    });

    const form = editor.shadowRoot?.querySelector("ha-form");
    form?.dispatchEvent(
      new CustomEvent("value-changed", {
        detail: { value: { production: "sensor.other_pv" } },
        bubbles: true,
        composed: true,
      }),
    );

    expect(changedConfig).toEqual({
      ...CARD_CONFIG,
      consumers: [],
      entities: { ...CARD_CONFIG.entities, production: "sensor.other_pv" },
    });
  });

  // Represents a cleared selector as null, which the card already accepts.
  it("preserves the nullable entity shape when a selection is cleared", async () => {
    editor = new SolarEnergyGraphsCardEditor();
    editor.setConfig(CARD_CONFIG);
    document.body.append(editor);
    await editor.updateComplete;
    let changedConfig: SolarEnergyGraphsCardConfig | undefined;
    editor.addEventListener("config-changed", (event) => {
      changedConfig = (
        event as CustomEvent<{ config: SolarEnergyGraphsCardConfig }>
      ).detail.config;
    });

    editor.shadowRoot?.querySelector("ha-form")?.dispatchEvent(
      new CustomEvent("value-changed", {
        detail: { value: { production: null } },
        bubbles: true,
        composed: true,
      }),
    );

    expect(changedConfig?.entities).toEqual({
      ...CARD_CONFIG.entities,
      production: null,
    });
  });

  // Leaves entity fields empty rather than guessing sensor IDs for a new card.
  it("starts with empty entity selections when no entities are configured", async () => {
    editor = new SolarEnergyGraphsCardEditor();
    editor.setConfig({
      type: CARD_CONFIG.type,
      entities: {
        production: null,
        consumption: null,
        grid_import: null,
        grid_export: null,
      },
    });
    document.body.append(editor);
    await editor.updateComplete;

    const form = editor.shadowRoot?.querySelector("ha-form") as
      | HomeAssistantForm
      | undefined;
    expect(form?.data).toEqual({
      production: null,
      consumption: null,
      grid_import: null,
      grid_export: null,
    });
  });

  // Adds an empty consumer draft without guessing an entity ID.
  it("adds a consumer using an empty entity and a default color", async () => {
    editor = new SolarEnergyGraphsCardEditor();
    editor.setConfig(CARD_CONFIG);
    document.body.append(editor);
    await editor.updateComplete;
    let changedConfig: SolarEnergyGraphsCardConfig | undefined;
    editor.addEventListener("config-changed", (event) => {
      changedConfig = (
        event as CustomEvent<{ config: SolarEnergyGraphsCardConfig }>
      ).detail.config;
    });

    const addButton = Array.from(
      editor.shadowRoot?.querySelectorAll("button") ?? [],
    ).find((button) => button.textContent?.includes("Add a consumer"));
    addButton?.click();
    await editor.updateComplete;

    expect(changedConfig?.consumers).toEqual([
      { entity: "", color: "#8B5CF6" },
    ]);
    expect(editor.shadowRoot?.querySelectorAll(".consumer-row")).toHaveLength(1);
  });

  // Emits entity, color, reordering, and removal edits in the consumer-list order.
  it("edits consumer entities and colors, reorders them, and removes a row", async () => {
    editor = new SolarEnergyGraphsCardEditor();
    editor.setConfig({
      ...CARD_CONFIG,
      consumers: [
        { entity: "sensor.first", color: "#8B5CF6" },
        { entity: "sensor.second", color: "#F97316" },
      ],
    });
    document.body.append(editor);
    await editor.updateComplete;
    let changedConfig: SolarEnergyGraphsCardConfig | undefined;
    editor.addEventListener("config-changed", (event) => {
      changedConfig = (
        event as CustomEvent<{ config: SolarEnergyGraphsCardConfig }>
      ).detail.config;
    });

    const consumerForms = editor.shadowRoot?.querySelectorAll("ha-form");
    consumerForms?.[1].dispatchEvent(
      new CustomEvent("value-changed", {
        detail: { value: { entity: "sensor.oven" } },
      }),
    );
    const color = editor.shadowRoot?.querySelector<HTMLInputElement>(
      ".consumer-row input[type=color]",
    );
    if (color) {
      color.value = "#abcdef";
      color.dispatchEvent(new Event("input", { bubbles: true }));
    }
    const downButton = editor.shadowRoot?.querySelector<HTMLButtonElement>(
      '.consumer-row button[aria-label="Move consumer down"]',
    );
    downButton?.click();
    await editor.updateComplete;

    expect(changedConfig?.consumers).toEqual([
      { entity: "sensor.second", color: "#F97316" },
      { entity: "sensor.oven", color: "#abcdef" },
    ]);
    const removeButton = editor.shadowRoot?.querySelector<HTMLButtonElement>(
      '.consumer-row button[aria-label="Remove consumer"]',
    );
    removeButton?.click();
    await editor.updateComplete;

    expect(changedConfig?.consumers).toEqual([
      { entity: "sensor.oven", color: "#abcdef" },
    ]);
  });
});
