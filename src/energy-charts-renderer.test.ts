import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const { createChartMock, syncMock, tzDateMock } = vi.hoisted(() => ({
  createChartMock: vi.fn(),
  syncMock: vi.fn((key: string) => ({ key })),
  tzDateMock: vi.fn((date: Date) => date),
}));

vi.mock("./uplot-adapter", () => ({
  createChart: createChartMock,
  uPlot: { sync: syncMock, tzDate: tzDateMock },
}));

import {
  computeDragPanRange,
  computePinchZoomRange,
  computeTouchDistance,
  computeTouchMidpointX,
  computeWheelZoomRange,
  createTimeAxis,
  createTimeLegend,
  drawZeroLine,
  isHorizontalTouchGesture,
  EnergyChartsRenderer as Renderer,
} from "./energy-charts-renderer";
import type { EnergyHistoryResponse } from "./home-assistant-energy-history";


const TEST_HISTORY_DATA: EnergyHistoryResponse = {
  mainData: [
    Float64Array.from([0, 300]),
    [null, 1800],
    [null, 0],
    [null, 1200],
    [null, 1200],
    [null, 600],
    [null, 1800],
    [null, 1800],
    [null, 400],
    [null, 200],
    [null, 2000],
    [null, 1600],
    [null, 1900],
    [null, 1700],
  ],
  gridData: [
    Float64Array.from([0, 300]),
    [null, 200],
    [null, -400],
    [null, 250],
    [null, 150],
    [null, -300],
    [null, -500],
  ],
  hasProduction: true,
  hasConsumption: true,
  hasGridImport: true,
  hasGridExport: true,
};

class EnergyChartsRenderer extends Renderer {
  constructor(
    containers: readonly [HTMLElement, HTMLElement],
    darkMode = false,
    language: "en" | "fr" = "en",
  ) {
    super(
      containers,
      TEST_HISTORY_DATA,
      "Europe/Paris",
      darkMode,
      language,
    );
  }
}

class MockResizeObserver implements ResizeObserver {
  static instances: MockResizeObserver[] = [];
  readonly observedElements: Element[] = [];
  readonly observe = vi.fn((element: Element) => {
    this.observedElements.push(element);
  });
  readonly unobserve = vi.fn();
  readonly disconnect = vi.fn();

  constructor(private readonly callback: ResizeObserverCallback) {
    MockResizeObserver.instances.push(this);
  }

  trigger(target: Element, width: number, height: number): void {
    const entry = {
      target,
      contentRect: { width, height },
    } as ResizeObserverEntry;
    this.callback([entry], this);
  }
}

describe("EnergyChartsRenderer", () => {
  let containers: [HTMLElement, HTMLElement];
  let charts: Array<{
    setSize: ReturnType<typeof vi.fn>;
    setData: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
    redraw: ReturnType<typeof vi.fn>;
    setScale: ReturnType<typeof vi.fn>;
    data: [Float64Array];
    scales: { x: { min?: number; max?: number } };
    cursor: { drag: { x: boolean; y: boolean } };
    root: HTMLElement;
    axes: Array<{
      grid?: { width?: number };
      ticks?: Record<string, never>;
      border?: Record<string, never>;
    }>;
  }>;

  // uPlot root holding the zoom selection element.
  const createRoot = () => {
    const root = document.createElement("div");
    const select = document.createElement("div");
    select.className = "u-select";
    root.append(select);
    return root;
  };
  const selectionColor = (index: number) =>
    charts[index].root.querySelector<HTMLElement>(".u-select")!.style.backgroundColor;

  beforeEach(() => {
    containers = [document.createElement("div"), document.createElement("div")];
    document.body.append(...containers);
    charts = [
      {
        setSize: vi.fn(),
        setData: vi.fn(),
        destroy: vi.fn(),
        redraw: vi.fn(),
        setScale: vi.fn(),
        data: [Float64Array.from([0, 300])],
        scales: { x: { min: 0, max: 300 } },
        cursor: { drag: { x: true, y: false } },
        root: createRoot(),
        axes: [{ grid: {}, ticks: {}, border: {} }, { grid: {}, ticks: {}, border: {} }],
      },
      {
        setSize: vi.fn(),
        setData: vi.fn(),
        destroy: vi.fn(),
        redraw: vi.fn(),
        setScale: vi.fn(),
        data: [Float64Array.from([0, 300])],
        scales: { x: { min: 0, max: 300 } },
        cursor: { drag: { x: true, y: false } },
        root: createRoot(),
        axes: [{ grid: {}, ticks: {}, border: {} }, { grid: {}, ticks: {}, border: {} }],
      },
    ];
    MockResizeObserver.instances = [];
    createChartMock.mockReset();
    createChartMock.mockImplementation(
      () => charts[createChartMock.mock.calls.length - 1],
    );
    syncMock.mockReset();
    syncMock.mockImplementation((key) => ({ key }));
    tzDateMock.mockReset();
    tzDateMock.mockImplementation((date) => date);
    vi.stubGlobal("ResizeObserver", MockResizeObserver);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  // Hides uPlot point markers, drawn in white on sparse statistics intervals.
  it("disables point markers on every data series", () => {
    new EnergyChartsRenderer(containers);

    const [firstOptions, secondOptions] = createChartMock.mock.calls.map(
      ([options]) => options,
    );
    for (const options of [firstOptions, secondOptions]) {
      expect(
        options.series
          .slice(1)
          .every((series: { points?: { show?: boolean } }) => series.points?.show === false),
      ).toBe(true);
    }
  });

  // Formats French axis ticks and cursor timestamps as local 24-hour values.
  it("uses French chart labels and timezone-aware 24-hour time formatting", () => {
    new EnergyChartsRenderer(containers, false, "fr");

    const [firstOptions, secondOptions] = createChartMock.mock.calls.map(
      ([options]) => options,
    );
    const axisLabels = firstOptions.axes[0].values(
      undefined,
      [
        Date.parse("2026-10-06T21:30:00Z") / 1000,
        Date.parse("2026-10-06T22:00:00Z") / 1000,
        Date.parse("2026-10-06T22:30:00Z") / 1000,
      ],
      0,
      50,
      1800,
    );
    expect(axisLabels).toEqual(["06/10/26", "07/10/26", "00:30"]);
    expect(
      firstOptions.series[0].value(
        undefined,
        Date.parse("2026-10-06T22:30:00Z") / 1000,
        0,
        null,
      ),
    ).toBe("07/10/2026 00:30");
    expect(typeof secondOptions.series[0].value).toBe("function");
    expect(firstOptions.axes[1].label).toBe("Puissance (W)");
    expect(firstOptions.series[3].label).toBe("Autoconsommation");
  });

  // Returns "-" for invalid timestamps (0, null, undefined, NaN, Infinity) in French mode.
  it("returns dash for invalid timestamps in French legend and axis", () => {
    new EnergyChartsRenderer(containers, false, "fr");

    const [firstOptions] = createChartMock.mock.calls.map(
      ([options]) => options,
    );

    // Test axis values formatter with invalid timestamps
    const invalidAxisLabels = firstOptions.axes[0].values(
      undefined,
      [0, null, undefined, Number.NaN, Number.POSITIVE_INFINITY],
      0,
      50,
      1800,
    );
    expect(invalidAxisLabels).toEqual(["-", "-", "-", "-", "-"]);

    // Test legend value formatter with invalid timestamps
    expect(firstOptions.series[0].value(undefined, 0, 0, null)).toBe("-");
    expect(firstOptions.series[0].value(undefined, null, 0, null)).toBe("-");
    expect(firstOptions.series[0].value(undefined, undefined, 0, null)).toBe("-");
    expect(firstOptions.series[0].value(undefined, Number.NaN, 0, null)).toBe("-");
    expect(firstOptions.series[0].value(undefined, Number.POSITIVE_INFINITY, 0, null)).toBe("-");
  });

  // Builds both energy charts with the shared time scale and sign convention.
  it("creates the solar and signed grid-exchange charts", () => {
    new EnergyChartsRenderer(containers);

    expect(createChartMock).toHaveBeenCalledTimes(2);
    const firstOptions = createChartMock.mock.calls[0][0];
    const secondOptions = createChartMock.mock.calls[1][0];
    const firstData = createChartMock.mock.calls[0][1];
    const secondData = createChartMock.mock.calls[1][1];
    expect(firstOptions.series[3].label).toBe("Self-consumption");
    expect(firstOptions.series[6].label).toBe("Solar production");
    expect(firstOptions.series[6].stroke).toBe("#cc9d00");
    expect(firstOptions.series[6].fill).toBeUndefined();
    expect(firstOptions.series[1].fill).toBe("#fbf0a8");
    expect(firstOptions.series[7].label).toBe("Consumption");
    expect(firstOptions.series[8]).toMatchObject({
      label: "Grid import",
      class: "legend-values-only",
      show: false,
      fill: "#e96e7d",
    });
    expect(firstOptions.series[9]).toMatchObject({
      label: "Grid export",
      class: "legend-values-only",
      show: false,
      fill: "#fbf0a8",
    });
    expect(firstOptions.series[0].class).toBeUndefined();
    expect(
      firstOptions.series
        .slice(1)
        .filter((series: { class?: string }) => !series.class)
        .map((series: { label?: string }) => series.label),
    ).toEqual(["Self-consumption", "Solar production", "Consumption"]);
    expect(
      firstOptions.series
        .slice(1)
        .filter((series: { class?: string }) => series.class)
        .map((series: { class?: string }) => series.class),
    ).toEqual([
      ...Array(4).fill("hide-helper-legend"),
      "legend-values-only",
      "legend-values-only",
      ...Array(4).fill("hide-helper-legend"),
    ]);
    expect(
      firstOptions.series
        .slice(10)
        .every((series: { label?: string }) => series.label === ""),
    ).toBe(true);
    expect(
      firstOptions.series
        .slice(10)
        .every(
          (series: { stroke?: string }) =>
            series.stroke === "rgba(0, 0, 0, 0)",
        ),
    ).toBe(true);
    expect(firstOptions.bands).toEqual([
      { series: [3, 2], fill: "#a2d49b" },
      { series: [5, 4], fill: "#e96e7d" },
      { series: [10, 11], fill: "rgba(204, 157, 0, 0.25)" },
      { series: [12, 13], fill: "rgba(59, 130, 246, 0.2)" },
    ]);
    expect(firstOptions.axes[1].label).toBe("Power (W)");
    expect(firstOptions.scales.y.autoMin).toBe(0);
    expect(firstOptions.legend.mount).toBeTypeOf("function");
    expect(secondOptions.scales.y.autoMin).toBeUndefined();
    expect(secondOptions.legend).toEqual({ show: false });
    expect(firstData).toHaveLength(14);
    expect(firstData[0]).toHaveLength(2);
    expect(firstData[1]).toEqual([null, 1800]);
    expect(firstData[8]).toEqual([null, 400]);
    expect(firstData[9]).toEqual([null, 200]);
    expect(secondOptions.series[1].label).toBe("Grid export (+W)");
    expect(secondOptions.series[2].label).toBe("Grid import (-W)");
    expect(secondOptions.axes[1].label).toBe("Power (W)");
    expect(secondOptions.bands).toEqual([
      { series: [3, 4], fill: "rgba(204, 157, 0, 0.25)" },
      { series: [5, 6], fill: "rgba(239, 68, 68, 0.3)" },
    ]);
    expect(
      secondOptions.series
        .slice(3)
        .map((series: { class?: string; width?: number }) => [series.class, series.width]),
    ).toEqual(Array(4).fill(["hide-helper-legend", 0]));
    expect(secondOptions.scales.y.autoMin).toBeUndefined();
    expect(secondData).toHaveLength(7);
    expect(secondData[0]).toHaveLength(2);
    expect(secondData[1]).toEqual([null, 200]);
    expect(secondData[2]).toEqual([null, -400]);
    expect(firstOptions.cursor.sync.key).toBe(secondOptions.cursor.sync.key);
    expect(firstOptions.cursor.sync.scales).toEqual(["x", null]);
    expect(secondOptions.cursor.sync.scales).toEqual(["x", null]);
    expect(firstOptions.cursor.drag).toEqual({ x: true, y: false });
    expect(secondOptions.cursor.drag).toEqual({ x: true, y: false });
    expect(firstOptions.legend.mount).toBeTypeOf("function");
    expect(secondOptions.legend).toEqual({ show: false });
    expect(firstOptions.hooks.setCursor).toHaveLength(1);
    expect(secondOptions.hooks.draw).toHaveLength(1);
    expect(syncMock).toHaveBeenCalledOnce();
    expect(firstOptions.width).toBe(600);
    expect(firstOptions.height).toBe(100);
  });

  // Wires timezone, axis color and zero-line callbacks to their chart options.
  it("provides callable timezone, axis, and zero-line options", () => {
    new EnergyChartsRenderer(containers);
    const firstOptions = createChartMock.mock.calls[0][0];
    const secondOptions = createChartMock.mock.calls[1][0];

    expect(firstOptions.tzDate(300)).toEqual(new Date(300_000));
    expect(tzDateMock).toHaveBeenCalledWith(new Date(300_000), "Europe/Paris");
    for (const options of [firstOptions, secondOptions]) {
      for (const axis of options.axes) {
        expect(axis.stroke()).toBe("#212121");
        expect(axis.grid.stroke()).toBe("#bdbdbd");
        expect(axis.ticks.stroke()).toBe("#212121");
        expect(axis.border.stroke()).toBe("#bdbdbd");
      }
    }

    const context = {
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      strokeStyle: "",
      lineWidth: 0,
    };
    const chart = {
      scales: { y: { min: -10, max: 10 } },
      valToPos: vi.fn(() => 50),
      ctx: context,
      bbox: { left: 10, width: 100 },
    };
    secondOptions.hooks.draw[0](chart);

    expect(context.moveTo).toHaveBeenCalledWith(10, 50.5);
    expect(context.lineTo).toHaveBeenCalledWith(110, 50.5);
    expect(context.stroke).toHaveBeenCalledOnce();
  });

  // Replaces both plot datasets after Home Assistant history is refreshed.
  it("updates both charts with normalized history data", () => {
    const renderer = new EnergyChartsRenderer(containers);
    const updatedData: EnergyHistoryResponse = {
      ...TEST_HISTORY_DATA,
      mainData: [Float64Array.from([0, 600]), [null, 2400]],
      gridData: [Float64Array.from([0, 600]), [null, 300]],
    };

    renderer.updateData(updatedData);

    expect(charts[0].setData).toHaveBeenCalledWith(updatedData.mainData);
    expect(charts[1].setData).toHaveBeenCalledWith(updatedData.gridData);
  });

  // Keeps a horizontal zoom on both charts when data of the same day arrives.
  it("restores the x zoom after a same-day data update", () => {
    const renderer = new EnergyChartsRenderer(containers);
    charts[0].scales.x = { min: 60, max: 300 };

    renderer.updateData(TEST_HISTORY_DATA);

    expect(charts[0].setScale).toHaveBeenCalledWith("x", { min: 60, max: 300 });
    expect(charts[1].setScale).toHaveBeenCalledWith("x", { min: 60, max: 300 });

    charts[0].scales.x = { min: 0, max: 120 };
    renderer.updateData(TEST_HISTORY_DATA);

    expect(charts[0].setScale).toHaveBeenLastCalledWith("x", { min: 0, max: 120 });
    expect(charts[1].setScale).toHaveBeenLastCalledWith("x", { min: 0, max: 120 });
  });

  // Lets setData fit the whole day when the user has not zoomed.
  it("does not set the x scale after an update without zoom", () => {
    const renderer = new EnergyChartsRenderer(containers);

    renderer.updateData(TEST_HISTORY_DATA);

    expect(charts[0].setScale).not.toHaveBeenCalled();
    expect(charts[1].setScale).not.toHaveBeenCalled();

    charts[0].scales.x = { max: 200 };
    charts[1].scales.x = { min: 50 };
    renderer.updateData(TEST_HISTORY_DATA);

    expect(charts[0].setScale).not.toHaveBeenCalled();
    expect(charts[1].setScale).not.toHaveBeenCalled();
  });

  // Drops the zoom when the new data starts another day.
  it("resets the x zoom when another day is shown", () => {
    const renderer = new EnergyChartsRenderer(containers);
    charts[0].scales.x = { min: 60, max: 120 };
    const nextDay: EnergyHistoryResponse = {
      ...TEST_HISTORY_DATA,
      mainData: [Float64Array.from([86400, 86700]), [null, 2400]],
      gridData: [Float64Array.from([86400, 86700]), [null, 300]],
    };

    renderer.updateData(nextDay);

    expect(charts[0].setScale).not.toHaveBeenCalled();
    expect(charts[1].setScale).not.toHaveBeenCalled();
  });

  // Mounts the top legend inside the plot overlay, hidden until the cursor is on it.
  it("mounts the top legend inside the plot overlay, hidden until the cursor is on it", () => {
    new EnergyChartsRenderer(containers);
    const table = document.createElement("table");
    const over = document.createElement("div");

    createChartMock.mock.calls[0][0].legend.mount({ over, cursor: { left: -10 } }, table);

    expect(over.firstElementChild).toBe(table);
    expect(table.style.display).toBe("none");
  });

  // Shows the top legend while its own or the synced cursor is on the plot.
  it("shows the top legend while its own or the synced cursor is on the plot", () => {
    new EnergyChartsRenderer(containers);
    const table = document.createElement("table");
    const over = document.createElement("div");
    const firstOptions = createChartMock.mock.calls[0][0];

    firstOptions.legend.mount({ over, cursor: { left: -10 } }, table);
    expect(table.style.display).toBe("none");

    firstOptions.hooks.setCursor[0]({ cursor: { left: 0 } });
    expect(table.style.display).toBe("");

    firstOptions.hooks.setCursor[0]({ cursor: { left: 120 } });
    expect(table.style.display).toBe("");

    firstOptions.hooks.setCursor[0]({ cursor: { left: -10 } });
    expect(table.style.display).toBe("none");
  });

  // Keeps separately rendered cards from joining the same cursor and zoom group.
  it("creates a distinct uPlot synchronization group per card", () => {
    new EnergyChartsRenderer(containers);
    const firstSyncKey = createChartMock.mock.calls[0][0].cursor.sync.key;

    containers = [document.createElement("div"), document.createElement("div")];
    createChartMock.mockImplementation(() => ({ root: createRoot() }));
    new EnergyChartsRenderer(containers);
    const secondSyncKey = createChartMock.mock.calls[2][0].cursor.sync.key;

    expect(secondSyncKey).not.toBe(firstSyncKey);
  });

  // Draws the zero reference across the network chart plotting area, including exact boundary values.
  it("draws a theme-colored zero line when zero is in the y range", () => {
    const draw = (yRange: { min: number; max: number }) => {
      const ctx = {
        save: vi.fn(),
        restore: vi.fn(),
        beginPath: vi.fn(),
        moveTo: vi.fn(),
        lineTo: vi.fn(),
        stroke: vi.fn(),
        strokeStyle: "",
        lineWidth: 0,
      };
      const chart = {
        scales: { y: yRange },
        valToPos: vi.fn(() => 10),
        ctx,
        bbox: { left: 5, width: 120 },
      };

      drawZeroLine(chart, "#9e9e9e");

      expect(chart.valToPos).toHaveBeenCalledWith(0, "y", true);
      expect(ctx.strokeStyle).toBe("#9e9e9e");
      expect(ctx.lineWidth).toBe(1.5);
      expect(ctx.save).toHaveBeenCalledOnce();
      expect(ctx.beginPath).toHaveBeenCalledOnce();
      expect(ctx.moveTo).toHaveBeenCalledWith(5, 10.5);
      expect(ctx.lineTo).toHaveBeenCalledWith(125, 10.5);
      expect(ctx.stroke).toHaveBeenCalledOnce();
      expect(ctx.restore).toHaveBeenCalledOnce();
    };

    draw({ min: -200, max: 700 });
    draw({ min: 0, max: 700 });
    draw({ min: -200, max: 0 });
  });

  // Skips the reference line when the visible network range excludes zero.
  it("does not draw a zero line outside the y range", () => {
    const ctx = {
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      strokeStyle: "",
      lineWidth: 0,
    };
    const checkSkipped = (
      scales: Record<string, { min?: number; max?: number }>,
    ) => {
      const chart = {
        scales,
        valToPos: vi.fn(() => 10),
        ctx,
        bbox: { left: 5, width: 120 },
      };

      drawZeroLine(chart, "#9e9e9e");

      expect(chart.valToPos).not.toHaveBeenCalled();
      expect(ctx.stroke).not.toHaveBeenCalled();
    };

    checkSkipped({ y: { min: 10, max: 700 } });
    checkSkipped({});
    checkSkipped({ y: { max: 700 } });
    checkSkipped({ y: { min: -700 } });
    checkSkipped({ y: { min: -700, max: -10 } });
  });

  // Preserves the existing light-theme colors and grid width.
  it("keeps the current light theme palette unchanged", () => {
    containers[0].style.setProperty("--primary-text-color", "#f4f4f4");
    containers[0].style.setProperty("--divider-color", "#555555");

    new EnergyChartsRenderer(containers);

    const axes = createChartMock.mock.calls[0][0].axes;
    expect(axes[0].stroke()).toBe("#f4f4f4");
    expect(axes[0].grid.stroke()).toBe("#555555");
    expect(axes[0].grid.width).toBe(1);
    expect(axes[0].ticks.stroke()).toBe("#f4f4f4");
    expect(axes[1].stroke()).toBe("#f4f4f4");
  });

  // Uses readable text and a thinner gray grid for Home Assistant dark mode.
  it("uses a white axis and a thin gray grid in dark mode", () => {
    const renderer = new EnergyChartsRenderer(containers);
    charts[0].axes[0].grid = undefined;
    renderer.refreshTheme(true);
    const axes = createChartMock.mock.calls[0][0].axes;

    expect(axes[0].stroke()).toBe("#ffffff");
    expect(axes[0].ticks.stroke()).toBe("#ffffff");
    expect(axes[0].grid.stroke()).toBe("#9e9e9e");
    expect(charts[0].axes[1].grid?.width).toBe(0.5);
    expect(charts[0].redraw).toHaveBeenCalledWith(true, true);
    expect(charts[1].redraw).toHaveBeenCalledWith(true, true);
  });

  // Keeps color callbacks callable through repeated theme changes and redraws.
  it("retains stable color callbacks across repeated theme changes", () => {
    const renderer = new EnergyChartsRenderer(containers);
    const axes = createChartMock.mock.calls[0][0].axes;
    const stroke = axes[0].stroke;
    const gridStroke = axes[0].grid.stroke;

    containers[0].style.setProperty("--primary-text-color", "#123456");
    renderer.refreshTheme(false);
    expect(axes[0].stroke()).toBe("#123456");
    expect(axes[0].grid.stroke()).toBe("#bdbdbd");

    containers[0].style.setProperty("--divider-color", "#654321");
    renderer.refreshTheme(false);
    expect(axes[0].stroke()).toBe("#123456");
    expect(axes[0].grid.stroke()).toBe("#654321");

    renderer.refreshTheme(true);
    expect(axes[0].stroke()).toBe("#ffffff");
    renderer.refreshTheme(false);
    expect(axes[0].stroke()).toBe("#123456");
    expect(axes[0].grid.stroke()).toBe("#654321");
    renderer.refreshTheme(true);

    expect(axes[0].stroke).toBe(stroke);
    expect(axes[0].grid.stroke).toBe(gridStroke);
    expect(axes[0].stroke()).toBe("#ffffff");
    expect(axes[0].grid.stroke()).toBe("#9e9e9e");
    expect(charts[0].redraw).toHaveBeenCalledTimes(5);
    expect(charts[1].redraw).toHaveBeenCalledTimes(5);
  });

  // Leaves uPlot's own selection color, visible on a light card.
  it("keeps uPlot's zoom selection color in light mode", () => {
    new EnergyChartsRenderer(containers);

    expect(selectionColor(0)).toBe("");
    expect(selectionColor(1)).toBe("");
  });

  // Draws the zoom selection in translucent gray on both charts in dark mode,
  // where uPlot's 7% black is invisible.
  it("shows a gray zoom selection on both charts in dark mode", () => {
    new EnergyChartsRenderer(containers, true);

    expect(selectionColor(0)).toBe("rgba(158, 158, 158, 0.25)");
    expect(selectionColor(1)).toBe("rgba(158, 158, 158, 0.25)");
  });

  // Switches the zoom selection color with the Home Assistant theme.
  it("updates the zoom selection color when the theme changes", () => {
    const renderer = new EnergyChartsRenderer(containers);

    renderer.refreshTheme(true);
    const darkColors = [selectionColor(0), selectionColor(1)];
    containers[0].style.setProperty("--primary-text-color", "#ffffff");
    containers[0].style.setProperty("--divider-color", "#9e9e9e");
    renderer.refreshTheme(false);

    expect(darkColors).toEqual(Array(2).fill("rgba(158, 158, 158, 0.25)"));
    expect(selectionColor(0)).toBe("");
    expect(selectionColor(1)).toBe("");
    expect(charts[0].axes[0].grid?.width).toBe(1);
  });

  // Avoids redrawing canvas charts when the selected theme did not change.
  it("does not redraw when the theme is unchanged", () => {
    const renderer = new EnergyChartsRenderer(containers);

    renderer.refreshTheme(false);

    expect(charts[0].redraw).not.toHaveBeenCalled();
    expect(charts[1].redraw).not.toHaveBeenCalled();
  });

  // Ignores Home Assistant theme updates after chart resources have been released.
  it("does not refresh the theme after destroy", () => {
    const renderer = new EnergyChartsRenderer(containers);
    renderer.destroy();

    renderer.refreshTheme(true);

    expect(charts[0].redraw).not.toHaveBeenCalled();
    expect(charts[1].redraw).not.toHaveBeenCalled();
  });

  // Watches both graph containers so responsive layout changes reach uPlot.
  it("observes both chart containers", () => {
    new EnergyChartsRenderer(containers);

    expect(MockResizeObserver.instances).toHaveLength(1);
    expect(MockResizeObserver.instances[0].observedElements).toEqual(
      containers,
    );
  });

  // Resizes only the chart whose observed container changed size.
  it("updates the matching chart dimensions after resize", () => {
    new EnergyChartsRenderer(containers);

    MockResizeObserver.instances[0].trigger(containers[1], 420, 160);

    expect(charts[0].setSize).not.toHaveBeenCalled();
    expect(charts[1].setSize).toHaveBeenCalledWith({
      width: 420,
      height: 160,
    });
  });

  // Ignores zero-sized observations to avoid collapsing charts while hidden.
  it("ignores zero-sized containers", () => {
    new EnergyChartsRenderer(containers);

    MockResizeObserver.instances[0].trigger(containers[0], 0, 0);
    MockResizeObserver.instances[0].trigger(containers[0], 420, 0);
    MockResizeObserver.instances[0].trigger(containers[0], 0, 160);

    expect(charts[0].setSize).not.toHaveBeenCalled();
    expect(charts[1].setSize).not.toHaveBeenCalled();
  });

  // Releases observers and both uPlot instances exactly once.
  it("destroys charts and disconnects its observer idempotently", () => {
    const renderer = new EnergyChartsRenderer(containers);

    renderer.destroy();
    renderer.destroy();

    expect(MockResizeObserver.instances[0].disconnect).toHaveBeenCalledOnce();
    expect(charts[0].destroy).toHaveBeenCalledOnce();
    expect(charts[1].destroy).toHaveBeenCalledOnce();
  });

  // Zooms both charts synchronously and falls back to the center for invalid cursor coordinates.
  it("zooms both charts synchronously when scrolling over the solar chart", () => {
    new EnergyChartsRenderer(containers);
    containers[0].getBoundingClientRect = () =>
      ({ left: 50, right: 250, width: 200, top: 0, bottom: 100, height: 100 }) as DOMRect;

    const event = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      deltaY: -100,
    });
    Object.defineProperty(event, "clientX", { value: 100 });
    containers[0].dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(charts[0].setScale).toHaveBeenCalledWith("x", { min: 15, max: 255 });
    expect(charts[1].setScale).toHaveBeenCalledWith("x", { min: 15, max: 255 });

    charts[0].setScale.mockClear();
    charts[1].setScale.mockClear();
    const invalidCursorEvent = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      deltaY: -100,
    });
    Object.defineProperty(invalidCursorEvent, "clientX", {
      value: Number.POSITIVE_INFINITY,
    });
    containers[0].dispatchEvent(invalidCursorEvent);

    expect(charts[0].setScale).toHaveBeenCalledWith("x", { min: 30, max: 270 });
    expect(charts[1].setScale).toHaveBeenCalledWith("x", { min: 30, max: 270 });

    charts[0].setScale.mockClear();
    charts[1].setScale.mockClear();
    containers[0].getBoundingClientRect = () =>
      ({ left: 50, right: 50, width: 0, top: 0, bottom: 100, height: 100 }) as DOMRect;
    const zeroWidthEvent = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      deltaY: -100,
    });
    Object.defineProperty(zeroWidthEvent, "clientX", { value: 50 });
    containers[0].dispatchEvent(zeroWidthEvent);

    expect(charts[0].setScale).toHaveBeenCalledWith("x", { min: 30, max: 270 });
    expect(charts[1].setScale).toHaveBeenCalledWith("x", { min: 30, max: 270 });

    charts[0].setScale.mockClear();
    charts[1].setScale.mockClear();
    containers[0].getBoundingClientRect = () =>
      ({ left: 50, right: 250, width: 200, top: 0, bottom: 100, height: 100 }) as DOMRect;
    const notANumberCursorEvent = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      deltaY: -100,
    });
    Object.defineProperty(notANumberCursorEvent, "clientX", {
      value: Number.NaN,
    });
    containers[0].dispatchEvent(notANumberCursorEvent);

    expect(charts[0].setScale).toHaveBeenCalledWith("x", { min: 30, max: 270 });
    expect(charts[1].setScale).toHaveBeenCalledWith("x", { min: 30, max: 270 });
  });

  // Zooms both energy charts synchronously when the mouse wheel scrolls on the second chart.
  it("zooms both charts synchronously when scrolling over the grid chart", () => {
    new EnergyChartsRenderer(containers);
    containers[1].getBoundingClientRect = () =>
      ({ left: 0, right: 200, width: 200, top: 0, bottom: 100, height: 100 }) as DOMRect;

    const event = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      clientX: 100,
      deltaY: -100,
    });
    containers[1].dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(charts[0].setScale).toHaveBeenCalledWith("x", { min: 30, max: 270 });
    expect(charts[1].setScale).toHaveBeenCalledWith("x", { min: 30, max: 270 });
  });

  // Uses full-day bounds and a centered cursor when uPlot has no x-scale limits.
  it("uses day bounds when wheel zoom has no x-scale limits", () => {
    new EnergyChartsRenderer(containers);
    charts[0].scales.x = {};
    charts[1].scales.x = {};
    containers[0].getBoundingClientRect = () =>
      ({ left: 0, right: 0, width: 0, top: 0, bottom: 100, height: 100 }) as DOMRect;

    const event = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      deltaY: -100,
    });
    containers[0].dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(charts[0].setScale).toHaveBeenCalledWith("x", { min: 30, max: 270 });
    expect(charts[1].setScale).toHaveBeenCalledWith("x", { min: 30, max: 270 });
  });

  // Prevents scrolling and leaves scales unchanged when zooming out while already at full day.
  it("does not update scale when zooming out from the full day bounds", () => {
    new EnergyChartsRenderer(containers);
    containers[0].getBoundingClientRect = () =>
      ({ left: 0, right: 200, width: 200, top: 0, bottom: 100, height: 100 }) as DOMRect;

    const event = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      clientX: 100,
      deltaY: 100,
    });
    containers[0].dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(charts[0].setScale).not.toHaveBeenCalled();
    expect(charts[1].setScale).not.toHaveBeenCalled();

    const zeroDeltaEvent = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      clientX: 100,
      deltaY: 0,
    });
    containers[0].dispatchEvent(zeroDeltaEvent);

    expect(zeroDeltaEvent.defaultPrevented).toBe(false);
    expect(charts[0].setScale).not.toHaveBeenCalled();
    expect(charts[1].setScale).not.toHaveBeenCalled();

    charts[0].data = [Float64Array.from([0])];
    const oneSampleEvent = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      clientX: 100,
      deltaY: -100,
    });
    containers[0].dispatchEvent(oneSampleEvent);

    expect(oneSampleEvent.defaultPrevented).toBe(false);
    expect(charts[0].setScale).not.toHaveBeenCalled();
    expect(charts[1].setScale).not.toHaveBeenCalled();
  });

  // Stops responding to wheel events after the renderer is destroyed.
  it("removes wheel event listeners when destroyed", () => {
    const renderer = new EnergyChartsRenderer(containers);
    containers[0].getBoundingClientRect = () =>
      ({ left: 0, right: 200, width: 200, top: 0, bottom: 100, height: 100 }) as DOMRect;

    renderer.destroy();

    const event = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      clientX: 100,
      deltaY: -100,
    });
    containers[0].dispatchEvent(event);

    expect(charts[0].setScale).not.toHaveBeenCalled();
    expect(charts[1].setScale).not.toHaveBeenCalled();
  });

  // Pans both charts when the user press+drags while zoomed in.
  it("pans both charts on mousedown+mousemove when zoomed", () => {
    new EnergyChartsRenderer(containers);
    // Simulate a zoomed-in state on both charts.
    charts[0].scales.x = { min: 50, max: 200 };
    charts[1].scales.x = { min: 50, max: 200 };
    containers[0].getBoundingClientRect = () =>
      ({ left: 0, right: 200, width: 200, top: 0, bottom: 100, height: 100 }) as DOMRect;

    const mousedown = new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
      clientX: 100,
      button: 0,
    });
    containers[0].dispatchEvent(mousedown);

    const mousemove = new MouseEvent("mousemove", {
      bubbles: true,
      cancelable: true,
      clientX: 150,
    });
    document.dispatchEvent(mousemove);

    // deltaPx = 50, plotWidth = 200, range = 150
    // deltaTime = -(50/200) * 150 = -37.5
    // newMin = 50 - 37.5 = 12.5, newMax = 200 - 37.5 = 162.5
    expect(charts[0].setScale).toHaveBeenCalledWith("x", { min: 12.5, max: 162.5 });
    expect(charts[1].setScale).toHaveBeenCalledWith("x", { min: 12.5, max: 162.5 });

    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    charts[0].setScale.mockClear();
    charts[1].setScale.mockClear();
    charts[0].scales.x = { min: 200, max: 250 };
    charts[1].scales.x = { min: 200, max: 250 };

    containers[0].dispatchEvent(new MouseEvent("mousedown", {
      bubbles: true,
      clientX: 100,
      button: 0,
    }));
    document.dispatchEvent(new MouseEvent("mousemove", {
      bubbles: true,
      clientX: 150,
    }));

    expect(charts[0].setScale).toHaveBeenCalledWith("x", { min: 187.5, max: 237.5 });
    expect(charts[1].setScale).toHaveBeenCalledWith("x", { min: 187.5, max: 237.5 });
  });

  // Does not start panning when the view shows the full day (not zoomed).
  it("does not pan on drag when at full day bounds", () => {
    new EnergyChartsRenderer(containers);
    containers[0].getBoundingClientRect = () =>
      ({ left: 0, right: 200, width: 200, top: 0, bottom: 100, height: 100 }) as DOMRect;

    const mousedown = new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
      clientX: 100,
      button: 0,
    });
    containers[0].dispatchEvent(mousedown);

    const mousemove = new MouseEvent("mousemove", {
      bubbles: true,
      cancelable: true,
      clientX: 150,
    });
    document.dispatchEvent(mousemove);

    expect(charts[0].setScale).not.toHaveBeenCalled();
    expect(charts[1].setScale).not.toHaveBeenCalled();
  });

  // Hands press+drag back to uPlot's x selection zoom on both charts when the
  // full day is shown, e.g. after a zoom out.
  it("enables x selection zoom on both charts at full day bounds", () => {
    new EnergyChartsRenderer(containers);
    charts[0].cursor.drag.x = false;
    charts[1].cursor.drag.x = false;
    containers[0].getBoundingClientRect = () =>
      ({ left: 0, right: 200, width: 200, top: 0, bottom: 100, height: 100 }) as DOMRect;

    containers[0].dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, clientX: 100, button: 0 }),
    );

    expect(charts[0].cursor.drag.x).toBe(true);
    expect(charts[1].cursor.drag.x).toBe(true);
  });

  // Disables uPlot's x selection on both charts while zoomed in, so that
  // press+drag on either chart only pans.
  it("disables x selection zoom on both charts when zoomed", () => {
    new EnergyChartsRenderer(containers);
    charts[0].scales.x = { min: 50, max: 200 };
    charts[1].scales.x = { min: 50, max: 200 };
    containers[1].getBoundingClientRect = () =>
      ({ left: 0, right: 200, width: 200, top: 0, bottom: 100, height: 100 }) as DOMRect;

    containers[1].dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, clientX: 100, button: 2 }),
    );

    expect(charts[0].cursor.drag.x).toBe(true);
    expect(charts[1].cursor.drag.x).toBe(true);

    containers[1].dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, clientX: 100, button: 0 }),
    );

    expect(charts[0].cursor.drag.x).toBe(false);
    expect(charts[1].cursor.drag.x).toBe(false);

    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    charts[0].cursor.drag.x = false;
    charts[1].cursor.drag.x = false;
    charts[0].data = [Float64Array.from([0])];
    containers[0].dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, clientX: 100, button: 0 }),
    );

    expect(charts[0].cursor.drag.x).toBe(false);
    expect(charts[1].cursor.drag.x).toBe(false);
  });

  // Stops panning on mouseup and removes document-level move/up listeners.
  it("stops panning on mouseup", () => {
    new EnergyChartsRenderer(containers);
    charts[0].scales.x = { min: 50, max: 200 };
    charts[1].scales.x = { min: 50, max: 200 };
    containers[0].getBoundingClientRect = () =>
      ({ left: 0, right: 200, width: 200, top: 0, bottom: 100, height: 100 }) as DOMRect;

    containers[0].dispatchEvent(new MouseEvent("mousedown", {
      bubbles: true, cancelable: true, clientX: 100, button: 0,
    }));

    document.dispatchEvent(new MouseEvent("mouseup", {
      bubbles: true, cancelable: true, clientX: 120,
    }));

    // After mouseup, further moves should not pan.
    charts[0].setScale.mockClear();
    charts[1].setScale.mockClear();

    document.dispatchEvent(new MouseEvent("mousemove", {
      bubbles: true, cancelable: true, clientX: 200,
    }));

    expect(charts[0].setScale).not.toHaveBeenCalled();
    expect(charts[1].setScale).not.toHaveBeenCalled();
  });

  // Removes mousedown listeners from chart containers when destroyed.
  it("removes mousedown listeners when destroyed", () => {
    const renderer = new EnergyChartsRenderer(containers);
    charts[0].scales.x = { min: 50, max: 200 };
    charts[1].scales.x = { min: 50, max: 200 };
    containers[0].getBoundingClientRect = () =>
      ({ left: 0, right: 200, width: 200, top: 0, bottom: 100, height: 100 }) as DOMRect;

    renderer.destroy();

    containers[0].dispatchEvent(new MouseEvent("mousedown", {
      bubbles: true, cancelable: true, clientX: 100, button: 0,
    }));
    document.dispatchEvent(new MouseEvent("mousemove", {
      bubbles: true, cancelable: true, clientX: 150,
    }));

    expect(charts[0].setScale).not.toHaveBeenCalled();
    expect(charts[1].setScale).not.toHaveBeenCalled();
  });

  // Cleans up document listeners for an active drag when destroyed mid-drag.
  it("cleans up active drag state on destroy", () => {
    const renderer = new EnergyChartsRenderer(containers);
    charts[0].scales.x = { min: 50, max: 200 };
    charts[1].scales.x = { min: 50, max: 200 };
    containers[0].getBoundingClientRect = () =>
      ({ left: 0, right: 200, width: 200, top: 0, bottom: 100, height: 100 }) as DOMRect;

    containers[0].dispatchEvent(new MouseEvent("mousedown", {
      bubbles: true, cancelable: true, clientX: 100, button: 0,
    }));

    renderer.destroy();

    // After destroy, moves should not pan.
    charts[0].setScale.mockClear();
    charts[1].setScale.mockClear();

    document.dispatchEvent(new MouseEvent("mousemove", {
      bubbles: true, cancelable: true, clientX: 200,
    }));

    expect(charts[0].setScale).not.toHaveBeenCalled();
    expect(charts[1].setScale).not.toHaveBeenCalled();
  });

  // Pans both charts synchronously when 1-finger horizontal touch drag occurs while zoomed in.
  it("pans both charts synchronously on 1-finger horizontal touchmove when zoomed", () => {
    new EnergyChartsRenderer(containers);
    charts[0].scales.x = { min: 60, max: 240 };
    containers[0].getBoundingClientRect = () =>
      ({ left: 0, right: 200, width: 200, top: 0, bottom: 100, height: 100 }) as DOMRect;

    const startEvent = new Event("touchstart", { bubbles: true, cancelable: true });
    Object.defineProperty(startEvent, "touches", {
      value: [{ clientX: 100, clientY: 50 }],
    });
    containers[0].dispatchEvent(startEvent);

    const moveEvent = new Event("touchmove", { bubbles: true, cancelable: true });
    Object.defineProperty(moveEvent, "touches", {
      value: [{ clientX: 50, clientY: 50 }],
    });
    containers[0].dispatchEvent(moveEvent);

    expect(moveEvent.defaultPrevented).toBe(true);
    expect(charts[0].setScale).toHaveBeenCalledWith("x", { min: 105, max: 285 });
    expect(charts[1].setScale).toHaveBeenCalledWith("x", { min: 105, max: 285 });
  });

  // Allows default vertical page scrolling when 1-finger touch movement is primarily vertical.
  it("allows native vertical page scrolling during vertical 1-finger touch movement", () => {
    new EnergyChartsRenderer(containers);
    charts[0].scales.x = { min: 60, max: 240 };
    containers[0].getBoundingClientRect = () =>
      ({ left: 0, right: 200, width: 200, top: 0, bottom: 100, height: 100 }) as DOMRect;

    const startEvent = new Event("touchstart", { bubbles: true, cancelable: true });
    Object.defineProperty(startEvent, "touches", {
      value: [{ clientX: 100, clientY: 50 }],
    });
    containers[0].dispatchEvent(startEvent);

    const moveEvent = new Event("touchmove", { bubbles: true, cancelable: true });
    Object.defineProperty(moveEvent, "touches", {
      value: [{ clientX: 100, clientY: 150 }],
    });
    containers[0].dispatchEvent(moveEvent);

    expect(moveEvent.defaultPrevented).toBe(false);
    expect(charts[0].setScale).not.toHaveBeenCalled();
    expect(charts[1].setScale).not.toHaveBeenCalled();
  });

  // Allows native page scrolling when 1-finger dragging while not zoomed in.
  it("allows native page scrolling when 1-finger dragging while not zoomed", () => {
    new EnergyChartsRenderer(containers);
    containers[0].getBoundingClientRect = () =>
      ({ left: 0, right: 200, width: 200, top: 0, bottom: 100, height: 100 }) as DOMRect;

    const startEvent = new Event("touchstart", { bubbles: true, cancelable: true });
    Object.defineProperty(startEvent, "touches", {
      value: [{ clientX: 100, clientY: 50 }],
    });
    containers[0].dispatchEvent(startEvent);

    const moveEvent = new Event("touchmove", { bubbles: true, cancelable: true });
    Object.defineProperty(moveEvent, "touches", {
      value: [{ clientX: 50, clientY: 50 }],
    });
    containers[0].dispatchEvent(moveEvent);

    expect(moveEvent.defaultPrevented).toBe(false);
    expect(charts[0].setScale).not.toHaveBeenCalled();
  });

  // Resets active touch state on touchend or touchcancel.
  it("cleans up active touch state on touchend and touchcancel", () => {
    new EnergyChartsRenderer(containers);
    charts[0].scales.x = { min: 60, max: 240 };
    containers[0].getBoundingClientRect = () =>
      ({ left: 0, right: 200, width: 200, top: 0, bottom: 100, height: 100 }) as DOMRect;

    const startEvent = new Event("touchstart", { bubbles: true, cancelable: true });
    Object.defineProperty(startEvent, "touches", {
      value: [{ clientX: 100, clientY: 50 }],
    });
    containers[0].dispatchEvent(startEvent);

    const endEvent = new Event("touchend", { bubbles: true, cancelable: true });
    Object.defineProperty(endEvent, "touches", { value: [] });
    containers[0].dispatchEvent(endEvent);

    const moveEvent = new Event("touchmove", { bubbles: true, cancelable: true });
    Object.defineProperty(moveEvent, "touches", {
      value: [{ clientX: 50, clientY: 50 }],
    });
    containers[0].dispatchEvent(moveEvent);

    expect(charts[0].setScale).not.toHaveBeenCalled();

    // Test touchcancel as well
    containers[0].dispatchEvent(startEvent);
    const cancelEvent = new Event("touchcancel", { bubbles: true, cancelable: true });
    Object.defineProperty(cancelEvent, "touches", { value: [] });
    containers[0].dispatchEvent(cancelEvent);
    containers[0].dispatchEvent(moveEvent);

    expect(charts[0].setScale).not.toHaveBeenCalled();
  });

  // Removes all touch event listeners when renderer is destroyed.
  it("removes touch event listeners when destroyed", () => {
    const renderer = new EnergyChartsRenderer(containers);
    charts[0].scales.x = { min: 60, max: 240 };
    containers[0].getBoundingClientRect = () =>
      ({ left: 0, right: 200, width: 200, top: 0, bottom: 100, height: 100 }) as DOMRect;

    renderer.destroy();

    const startEvent = new Event("touchstart", { bubbles: true, cancelable: true });
    Object.defineProperty(startEvent, "touches", {
      value: [{ clientX: 100, clientY: 50 }],
    });
    containers[0].dispatchEvent(startEvent);

    const moveEvent = new Event("touchmove", { bubbles: true, cancelable: true });
    Object.defineProperty(moveEvent, "touches", {
      value: [{ clientX: 50, clientY: 50 }],
    });
    containers[0].dispatchEvent(moveEvent);

    expect(charts[0].setScale).not.toHaveBeenCalled();
  });

  // Zooms both charts synchronously when a 2-finger pinch gesture occurs.
  it("zooms both charts synchronously on 2-finger pinch gesture", () => {
    new EnergyChartsRenderer(containers);
    charts[0].scales.x = { min: 20000, max: 60000 };
    containers[0].getBoundingClientRect = () =>
      ({ left: 0, right: 200, width: 200, top: 0, bottom: 100, height: 100 }) as DOMRect;

    const startEvent = new Event("touchstart", { bubbles: true, cancelable: true });
    Object.defineProperty(startEvent, "touches", {
      value: [
        { clientX: 50, clientY: 50 },
        { clientX: 150, clientY: 50 },
      ],
    });
    containers[0].dispatchEvent(startEvent);

    const moveEvent = new Event("touchmove", { bubbles: true, cancelable: true });
    Object.defineProperty(moveEvent, "touches", {
      value: [
        { clientX: 25, clientY: 50 },
        { clientX: 175, clientY: 50 },
      ],
    });
    containers[0].dispatchEvent(moveEvent);

    expect(moveEvent.defaultPrevented).toBe(true);
    // start distance = 100, move distance = 150 -> ratio = 1.5 -> new duration = 40000/1.5 = 26666.66
    expect(charts[0].setScale).toHaveBeenCalledOnce();
    expect(charts[1].setScale).toHaveBeenCalledOnce();
  });

  // Smoothly transitions from a 2-finger pinch to a 1-finger pan without visual jumps.
  it("smoothly transitions from 2-finger pinch to 1-finger drag pan", () => {
    new EnergyChartsRenderer(containers);
    charts[0].scales.x = { min: 60, max: 240 };
    containers[0].getBoundingClientRect = () =>
      ({ left: 0, right: 200, width: 200, top: 0, bottom: 100, height: 100 }) as DOMRect;

    // Start with 2 fingers
    const startEvent = new Event("touchstart", { bubbles: true, cancelable: true });
    Object.defineProperty(startEvent, "touches", {
      value: [
        { clientX: 50, clientY: 50 },
        { clientX: 150, clientY: 50 },
      ],
    });
    containers[0].dispatchEvent(startEvent);

    // Lift one finger -> 1 touch left
    const endEvent = new Event("touchend", { bubbles: true, cancelable: true });
    Object.defineProperty(endEvent, "touches", {
      value: [{ clientX: 50, clientY: 50 }],
    });
    containers[0].dispatchEvent(endEvent);

    charts[0].setScale.mockClear();

    // Now move remaining finger horizontally
    const moveEvent = new Event("touchmove", { bubbles: true, cancelable: true });
    Object.defineProperty(moveEvent, "touches", {
      value: [{ clientX: 10, clientY: 50 }],
    });
    containers[0].dispatchEvent(moveEvent);

    expect(moveEvent.defaultPrevented).toBe(true);
    expect(charts[0].setScale).toHaveBeenCalledOnce();
  });




  // Uses dark mode defaults even if the card has no custom theme values.
  it("falls back to dark-mode defaults when CSS variables are missing", () => {
    new EnergyChartsRenderer(containers, true);

    const axes = createChartMock.mock.calls[0][0].axes;
    expect(axes[0].stroke()).toBe("#ffffff");
    expect(axes[0].grid.stroke()).toBe("#9e9e9e");
    expect(charts[0].root.querySelector<HTMLElement>(".u-select")!.style.backgroundColor).toBe(
      "rgba(158, 158, 158, 0.25)",
    );
    expect(charts[1].root.querySelector<HTMLElement>(".u-select")!.style.backgroundColor).toBe(
      "rgba(158, 158, 158, 0.25)",
    );
  });

  // Falls back to Home Assistant defaults when the computed CSS values are blank.
  it("falls back to default light theme colors when CSS values are empty", () => {
    containers[0].style.setProperty("--primary-text-color", "");
    containers[0].style.setProperty("--divider-color", "");

    new EnergyChartsRenderer(containers);

    const axes = createChartMock.mock.calls[0][0].axes;
    expect(axes[0].stroke()).toBe("#212121");
    expect(axes[0].grid.stroke()).toBe("#bdbdbd");
  });

  // Keeps a destroyed renderer from mutating chart state on later updates.
  it("ignores updates after destroy", () => {
    const renderer = new EnergyChartsRenderer(containers);
    renderer.destroy();

    renderer.updateData({
      ...TEST_HISTORY_DATA,
      mainData: [Float64Array.from([600, 900]), [null, 2400]],
      gridData: [Float64Array.from([600, 900]), [null, 300]],
    });

    expect(charts[0].setData).not.toHaveBeenCalled();
    expect(charts[1].setData).not.toHaveBeenCalled();
  });

  // Ignores wheel zoom requests when the visible chart has only one x sample.
  it("does not zoom with a single-sample x axis", () => {
    new EnergyChartsRenderer(containers);
    charts[0].data = [Float64Array.from([0])];
    charts[1].data = [Float64Array.from([0])];
    containers[0].getBoundingClientRect = () =>
      ({ left: 0, right: 200, width: 200, top: 0, bottom: 100, height: 100 }) as DOMRect;

    const event = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      clientX: 100,
      deltaY: -100,
    });
    containers[0].dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(charts[0].setScale).not.toHaveBeenCalled();
    expect(charts[1].setScale).not.toHaveBeenCalled();
  });

  // Right-click drags should never trigger a pan while the user is zoomed in.
  it("ignores right-button drag starts when zoomed", () => {
    new EnergyChartsRenderer(containers);
    charts[0].scales.x = { min: 50, max: 200 };
    charts[1].scales.x = { min: 50, max: 200 };
    containers[0].getBoundingClientRect = () =>
      ({ left: 0, right: 200, width: 200, top: 0, bottom: 100, height: 100 }) as DOMRect;

    containers[0].dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, clientX: 100, button: 2 }),
    );
    document.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 150 }));

    expect(charts[0].setScale).not.toHaveBeenCalled();
    expect(charts[1].setScale).not.toHaveBeenCalled();
  });

  // A drag already in progress should silently ignore a second mousedown.
  it("ignores a second drag start while panning", () => {
    new EnergyChartsRenderer(containers);
    charts[0].scales.x = { min: 50, max: 200 };
    charts[1].scales.x = { min: 50, max: 200 };
    containers[0].getBoundingClientRect = () =>
      ({ left: 0, right: 200, width: 200, top: 0, bottom: 100, height: 100 }) as DOMRect;

    containers[0].dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, clientX: 100, button: 0 }),
    );
    containers[0].dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, clientX: 110, button: 0 }),
    );
    document.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 150 }));

    expect(charts[0].setScale).toHaveBeenCalledTimes(1);
    expect(charts[1].setScale).toHaveBeenCalledTimes(1);
  });

  // Zero-width plots should not start a drag or recenter the time scale.
  it("ignores drag starts when the plot width is zero", () => {
    new EnergyChartsRenderer(containers);
    charts[0].scales.x = { min: 50, max: 200 };
    charts[1].scales.x = { min: 50, max: 200 };
    containers[0].getBoundingClientRect = () =>
      ({ left: 0, right: 0, width: 0, top: 0, bottom: 100, height: 100 }) as DOMRect;

    containers[0].dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, clientX: 100, button: 0 }),
    );
    document.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 150 }));

    expect(charts[0].setScale).not.toHaveBeenCalled();
    expect(charts[1].setScale).not.toHaveBeenCalled();
  });

  // Resize callbacks should ignore unrelated container changes.
  it("ignores resize notifications for unrelated elements", () => {
    new EnergyChartsRenderer(containers);
    const unrelated = document.createElement("div");
    document.body.append(unrelated);

    MockResizeObserver.instances[0].trigger(unrelated, 420, 180);

    expect(charts[0].setSize).not.toHaveBeenCalled();
    expect(charts[1].setSize).not.toHaveBeenCalled();
  });

  // Clamps wheel cursor fractions so near-edge scrolls stay inside the day bounds.
  it("clamps the cursor fraction before zooming near the day edges", () => {
    expect(computeWheelZoomRange({ min: 0, max: 300 }, { min: 0, max: 300 }, -10, -100, 0.8)).toEqual({
      min: 0,
      max: 240,
    });
    expect(computeWheelZoomRange({ min: 0, max: 300 }, { min: 0, max: 300 }, 10, -100, 0.8)).toEqual({
      min: 60,
      max: 300,
    });
  });

  // A zoomed-in view should not react to drag moves once the last update is no-op.
  it("does not keep panning when the drag is already clamped at the boundary", () => {
    new EnergyChartsRenderer(containers);
    charts[0].scales.x = { min: 0, max: 40000 };
    charts[1].scales.x = { min: 0, max: 40000 };
    containers[0].getBoundingClientRect = () =>
      ({ left: 0, right: 200, width: 200, top: 0, bottom: 100, height: 100 }) as DOMRect;

    containers[0].dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, clientX: 100, button: 0 }),
    );
    document.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 150 }));

    expect(charts[0].setScale).not.toHaveBeenCalled();
    expect(charts[1].setScale).not.toHaveBeenCalled();
  });
});

describe("computeWheelZoomRange", () => {
  const dayWindow = { min: 0, max: 86400 };

  // Reduces the visible time span centered around the cursor position on zoom in.
  it("zooms in centered at the cursor fraction", () => {
    const current = { min: 0, max: 86400 };
    const zoomed = computeWheelZoomRange(current, dayWindow, 0.5, -100, 0.8);

    expect(zoomed).toEqual({ min: 8640, max: 77760 });
  });

  // Keeps zooming in without any artificial minimum duration limit.
  it("allows unlimited zoom in down to arbitrarily small intervals", () => {
    const current = { min: 1000, max: 1000.01 };
    const zoomed = computeWheelZoomRange(current, dayWindow, 0.5, -100, 0.8);

    expect(zoomed).toBeDefined();
    expect(zoomed!.max - zoomed!.min).toBeCloseTo(0.008, 6);
  });

  // Expands the visible time span when zooming out while staying within the day.
  it("clamps zoom out to stay within the day boundaries", () => {
    const current = { min: 10000, max: 30000 };
    const zoomed = computeWheelZoomRange(current, dayWindow, 0.5, 100, 0.8);

    expect(zoomed).toEqual({ min: 7500, max: 32500 });
  });

  // Restores exact day window bounds when zoom out duration exceeds the full day.
  it("clamps zoom out exceeding full day duration to exact day bounds", () => {
    const current = { min: 5000, max: 80000 };
    const zoomed = computeWheelZoomRange(current, dayWindow, 0.5, 100, 0.8);

    expect(zoomed).toEqual({ min: 0, max: 86400 });
    expect(
      computeWheelZoomRange({ min: 0, max: 70000 }, dayWindow, 0.5, 100, 0.8),
    ).toEqual(dayWindow);
    expect(
      computeWheelZoomRange(
        { min: 16400, max: 86400 },
        dayWindow,
        0.5,
        100,
        0.8,
      ),
    ).toEqual(dayWindow);
  });

  // Avoids unnecessary scale updates when zooming out while already showing the full day.
  it("returns undefined when zooming out while already at full day bounds", () => {
    const current = { min: 0, max: 86400 };
    const zoomed = computeWheelZoomRange(current, dayWindow, 0.5, 100, 0.8);

    expect(zoomed).toBeUndefined();
  });

  // Leaves the time range unchanged when the wheel event has zero deltaY.
  it("returns undefined when deltaY is zero", () => {
    const current = { min: 10000, max: 30000 };
    const zoomed = computeWheelZoomRange(current, dayWindow, 0.5, 0, 0.8);

    expect(zoomed).toBeUndefined();
  });

  // Shifts the zoom window to avoid falling before the start of the day.
  it("shifts the zoomed range when the cursor is near the day start", () => {
    const current = { min: 0, max: 50000 };
    const zoomed = computeWheelZoomRange(current, dayWindow, 0, -100, 0.8);
    const zoomedOut = computeWheelZoomRange(current, dayWindow, 1, 100, 0.8);

    expect(zoomed).toEqual({ min: 0, max: 40000 });
    expect(zoomedOut).toEqual({ min: 0, max: 62500 });
  });

  // Shifts the zoom window to avoid extending beyond the end of the day.
  it("shifts the zoomed range when the cursor is near the day end", () => {
    const current = { min: 36400, max: 86400 };
    const zoomed = computeWheelZoomRange(current, dayWindow, 1, -100, 0.8);
    const zoomedOut = computeWheelZoomRange(current, dayWindow, 0, 100, 0.8);

    expect(zoomed).toEqual({ min: 46400, max: 86400 });
    expect(zoomedOut).toEqual({ min: 23900, max: 86400 });
  });

  // Rejects invalid non-positive day or range durations safely.
  it("returns undefined for non-positive range or day window durations", () => {
    expect(computeWheelZoomRange({ min: 10, max: 10 }, dayWindow, 0.5, -100)).toBeUndefined();
    expect(computeWheelZoomRange({ min: 0, max: 100 }, { min: 50, max: 50 }, 0.5, -100)).toBeUndefined();
  });
});

describe("computeDragPanRange", () => {
  const dayWindow = { min: 0, max: 86400 };

  // Shifts the visible window left (earlier in time) when dragging right.
  it("pans left when dragging right", () => {
    const current = { min: 20000, max: 60000 };
    const result = computeDragPanRange(current, dayWindow, 50, 200);

    // deltaPx=50, plotWidth=200 → fraction=0.25, duration=40000
    // deltaTime = -(50/200)*40000 = -10000
    // newMin = 20000 - 10000 = 10000, newMax = 60000 - 10000 = 50000
    expect(result).toEqual({ min: 10000, max: 50000 });
  });

  // Shifts the visible window right (later in time) when dragging left.
  it("pans right when dragging left", () => {
    const current = { min: 20000, max: 60000 };
    const result = computeDragPanRange(current, dayWindow, -50, 200);

    // deltaTime = -(-50/200)*40000 = 10000
    // newMin = 30000, newMax = 70000
    expect(result).toEqual({ min: 30000, max: 70000 });
  });

  // Clamps the panned range so it does not go before the start of the day.
  it("clamps at the day start boundary", () => {
    const current = { min: 5000, max: 45000 };
    const result = computeDragPanRange(current, dayWindow, 100, 200);

    // deltaTime = -(100/200)*40000 = -20000
    // newMin = 5000 - 20000 = -15000 → clamped to 0
    expect(result).toEqual({ min: 0, max: 40000 });
  });

  // Clamps the panned range so it does not go past the end of the day.
  it("clamps at the day end boundary", () => {
    const current = { min: 41400, max: 81400 };
    const result = computeDragPanRange(current, dayWindow, -100, 200);

    // deltaTime = -(-100/200)*40000 = 20000
    // newMax = 81400 + 20000 = 101400 → clamped to 86400
    expect(result).toEqual({ min: 46400, max: 86400 });
  });

  // Returns undefined when not zoomed in (no panning at full day).
  it("returns undefined when not zoomed in", () => {
    const current = { min: 0, max: 86400 };
    const result = computeDragPanRange(current, dayWindow, 50, 200);

    expect(result).toBeUndefined();
    expect(
      computeDragPanRange({ min: -100, max: 86500 }, dayWindow, 50, 200),
    ).toBeUndefined();
    expect(
      computeDragPanRange(
        { min: 100000, max: 186400 },
        { min: 100000, max: 186400 },
        50,
        200,
      ),
    ).toBeUndefined();
  });

  // Returns undefined when pixel displacement is zero.
  it("returns undefined when deltaPx is zero", () => {
    const current = { min: 20000, max: 60000 };
    const result = computeDragPanRange(current, dayWindow, 0, 200);

    expect(result).toBeUndefined();
  });

  // Returns undefined when plot width is zero or negative.
  it("returns undefined for zero or negative plot width", () => {
    const current = { min: 20000, max: 60000 };

    expect(computeDragPanRange(current, dayWindow, 50, 0)).toBeUndefined();
    expect(computeDragPanRange(current, dayWindow, 50, -10)).toBeUndefined();
  });

  // Returns undefined when already clamped at the boundary in the drag direction.
  it("returns undefined when already at the boundary", () => {
    const atStart = { min: 0, max: 40000 };
    // Dragging right should go earlier, but already at day start.
    expect(computeDragPanRange(atStart, dayWindow, 50, 200)).toBeUndefined();

    const atEnd = { min: 46400, max: 86400 };
    // Dragging left should go later, but already at day end.
    expect(computeDragPanRange(atEnd, dayWindow, -50, 200)).toBeUndefined();
  });
});

describe("Touch gesture calculation helpers", () => {
  const dayWindow = { min: 0, max: 86400 };

  // Calculates Euclidean distance between two touch points.
  it("calculates Euclidean distance between two touch points", () => {
    const p1 = { clientX: 10, clientY: 20 };
    const p2 = { clientX: 40, clientY: 60 };
    expect(computeTouchDistance(p1, p2)).toBe(50);
  });

  // Calculates the horizontal midpoint between two touch points.
  it("calculates horizontal midpoint between two touch points", () => {
    const p1 = { clientX: 100, clientY: 50 };
    const p2 = { clientX: 300, clientY: 150 };
    expect(computeTouchMidpointX(p1, p2)).toBe(200);
  });

  // Identifies primarily horizontal touch displacements over vertical ones.
  it("determines whether touch movement is primarily horizontal", () => {
    expect(isHorizontalTouchGesture(10, 5)).toBe(true);
    expect(isHorizontalTouchGesture(-10, 5)).toBe(true);
    expect(isHorizontalTouchGesture(5, 10)).toBe(false);
    expect(isHorizontalTouchGesture(5, -10)).toBe(false);
    expect(isHorizontalTouchGesture(5, 5)).toBe(false);
  });

  // Returns undefined for invalid or identity touch distance ratios.
  it("returns undefined for non-positive or neutral touch distance ratios", () => {
    const range = { min: 10000, max: 50000 };
    expect(computePinchZoomRange(range, dayWindow, 0.5, 0)).toBeUndefined();
    expect(computePinchZoomRange(range, dayWindow, 0.5, -1)).toBeUndefined();
    expect(computePinchZoomRange(range, dayWindow, 0.5, 1)).toBeUndefined();
  });

  // Returns undefined when day window or current duration is invalid.
  it("returns undefined for invalid day or current durations", () => {
    const zeroRange = { min: 100, max: 100 };
    const zeroDay = { min: 100, max: 100 };
    expect(computePinchZoomRange(zeroRange, dayWindow, 0.5, 1.5)).toBeUndefined();
    expect(computePinchZoomRange({ min: 0, max: 100 }, zeroDay, 0.5, 1.5)).toBeUndefined();
  });

  // Zooms in when touch points move further apart (ratio > 1).
  it("zooms in around cursor pivot when fingers spread apart", () => {
    const current = { min: 20000, max: 60000 }; // duration 40000
    // ratio 2 -> new duration 20000 around 50% pivot (40000)
    const result = computePinchZoomRange(current, dayWindow, 0.5, 2);
    expect(result).toEqual({ min: 30000, max: 50000 });
  });

  // Zooms out when touch points move closer together (ratio < 1).
  it("zooms out around cursor pivot when fingers pinch together", () => {
    const current = { min: 30000, max: 50000 }; // duration 20000
    // ratio 0.5 -> new duration 40000 around 50% pivot (40000)
    const result = computePinchZoomRange(current, dayWindow, 0.5, 0.5);
    expect(result).toEqual({ min: 20000, max: 60000 });
  });

  // Clamps range to day window when zooming out exceeds day duration.
  it("clamps zoom out to full day window when exceeding day bounds", () => {
    const current = { min: 20000, max: 60000 };
    const result = computePinchZoomRange(current, dayWindow, 0.5, 0.1);
    expect(result).toEqual(dayWindow);
  });

  // Returns undefined when zooming out while already showing full day.
  it("returns undefined when zooming out while already showing full day", () => {
    expect(computePinchZoomRange(dayWindow, dayWindow, 0.5, 0.5)).toBeUndefined();
  });

  // Clamps range to start of day when pivot is near the left edge.
  it("clamps zoomed range to start of day window", () => {
    const current = { min: 1000, max: 21000 }; // duration 20000
    // ratio 0.5 -> new duration 40000, pivot = 3000 -> raw min = -1000 -> clamped to 0..40000
    const result = computePinchZoomRange(current, dayWindow, 0.1, 0.5);
    expect(result).toEqual({ min: 0, max: 40000 });
  });

  // Clamps zoomed range to end of day window when pivot is near right edge.
  it("clamps zoomed range to end of day window", () => {
    const current = { min: 65000, max: 85000 }; // duration 20000
    // ratio 0.5 -> new duration 40000 -> clamped to 46400..86400
    const result = computePinchZoomRange(current, dayWindow, 0.9, 0.5);
    expect(result).toEqual({ min: 46400, max: 86400 });
  });
});


// ════════════════════════════════════════
// TESTS DES FORMATTEURS DE TEMPS GÉNÉRIQUES
// ════════════════════════════════════════

describe("Time formatters", () => {
  const timeZone = "Europe/Paris";

  describe("createTimeAxis", () => {
    it("returns dash for timestamp 0 (epoch) with 24h format", () => {
      const axis = createTimeAxis(timeZone, "fr-FR", "h23");
      const labels = axis(undefined, [0]);
      expect(labels).toEqual(["-"]);
    });

    it("returns dash for NaN and Infinity with 24h format", () => {
      const axis = createTimeAxis(timeZone, "fr-FR", "h23");
      const labels = axis(undefined, [Number.NaN, Number.POSITIVE_INFINITY]);
      expect(labels).toEqual(["-", "-"]);
    });

    it("formats valid timestamps in 24h format for French locale", () => {
      const axis = createTimeAxis(timeZone, "fr-FR", "h23");
      // 2026-10-06T22:30:00Z = 00:30 le 07/10/26 à Paris (UTC+2 en été)
      const timestamp = Date.parse("2026-10-06T22:30:00Z") / 1000;
      const labels = axis(undefined, [timestamp]);
      expect(labels[0]).toBe("07/10/26");
    });

    it("returns dash for timestamp 0 (epoch) with 12h format", () => {
      const axis = createTimeAxis(timeZone, "en-US", "h12");
      const labels = axis(undefined, [0]);
      expect(labels).toEqual(["-"]);
    });

    it("formats valid timestamps in 12h format for English locale", () => {
      // Use UTC timezone to avoid DST offsets
      const axis = createTimeAxis("UTC", "en-US", "h12");
      const timestamp = Date.parse("2026-10-06T10:30:00Z") / 1000;
      const labels = axis(undefined, [timestamp]);
      expect(labels[0]).toBe("10/06/26");
    });
  });

  describe("createTimeLegend", () => {
    it("returns dash for timestamp 0 (epoch) with 24h format", () => {
      const legend = createTimeLegend(timeZone, "fr-FR", "h23");
      expect(legend(undefined, 0)).toBe("-");
    });

    it("returns dash for NaN and Infinity with 24h format", () => {
      const legend = createTimeLegend(timeZone, "fr-FR", "h23");
      expect(legend(undefined, Number.NaN)).toBe("-");
      expect(legend(undefined, Number.POSITIVE_INFINITY)).toBe("-");
    });

    it("formats valid timestamps in 24h format for French locale", () => {
      const legend = createTimeLegend(timeZone, "fr-FR", "h23");
      const timestamp = Date.parse("2026-10-06T22:30:00Z") / 1000;
      expect(legend(undefined, timestamp)).toBe("07/10/2026 00:30");
    });

    it("returns dash for timestamp 0 (epoch) with 12h format", () => {
      const legend = createTimeLegend(timeZone, "en-US", "h12");
      expect(legend(undefined, 0)).toBe("-");
    });

    it("formats valid timestamps in 12h format for English locale", () => {
      // Use UTC timezone to avoid DST offsets
      const legend = createTimeLegend("UTC", "en-US", "h12");
      const timestamp = Date.parse("2026-10-06T22:30:00Z") / 1000;
      // 22:30 UTC = 10:30 PM in 12-hour format (year is numeric, not 2-digit)
      expect(legend(undefined, timestamp)).toBe("10/06/2026, 10:30 PM");
    });
  });
});
