import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const { createChartMock, syncMock } = vi.hoisted(() => ({
  createChartMock: vi.fn(),
  syncMock: vi.fn((key: string) => ({ key })),
}));

vi.mock("./uplot-adapter", () => ({
  createChart: createChartMock,
  uPlot: { sync: syncMock },
}));

import {
  computeDragPanRange,
  computeWheelZoomRange,
  drawZeroLine,
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
    legendContainers: readonly [HTMLElement, HTMLElement],
    darkMode = false,
  ) {
    super(
      containers,
      legendContainers,
      TEST_HISTORY_DATA,
      "Europe/Paris",
      darkMode,
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
  let legendContainers: [HTMLElement, HTMLElement];
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
    legendContainers = [document.createElement("div"), document.createElement("div")];
    document.body.append(...containers, ...legendContainers);
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
    vi.stubGlobal("ResizeObserver", MockResizeObserver);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  // Hides uPlot point markers, drawn in white on sparse statistics intervals.
  it("disables point markers on every data series", () => {
    new EnergyChartsRenderer(containers, legendContainers);

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

  // Builds both energy charts with the shared time scale and sign convention.
  it("creates the solar and signed grid-exchange charts", () => {
    new EnergyChartsRenderer(containers, legendContainers);

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
    expect(secondOptions.legend.mount).toBeTypeOf("function");
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
    expect(secondOptions.legend.mount).toBeTypeOf("function");
    expect(firstOptions.hooks).toBeUndefined();
    expect(secondOptions.hooks.draw).toHaveLength(1);
    expect(syncMock).toHaveBeenCalledOnce();
    expect(firstOptions.width).toBe(600);
    expect(firstOptions.height).toBe(100);
  });

  // Replaces both plot datasets after Home Assistant history is refreshed.
  it("updates both charts with normalized history data", () => {
    const renderer = new EnergyChartsRenderer(containers, legendContainers);
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
    const renderer = new EnergyChartsRenderer(containers, legendContainers);
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
    const renderer = new EnergyChartsRenderer(containers, legendContainers);

    renderer.updateData(TEST_HISTORY_DATA);

    expect(charts[0].setScale).not.toHaveBeenCalled();
    expect(charts[1].setScale).not.toHaveBeenCalled();
  });

  // Drops the zoom when the new data starts another day.
  it("resets the x zoom when another day is shown", () => {
    const renderer = new EnergyChartsRenderer(containers, legendContainers);
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

  // Mounts both legend tables into their own layout rows outside the plot.
  it("mounts each legend into its dedicated container", () => {
    new EnergyChartsRenderer(containers, legendContainers);
    const firstLegend = document.createElement("table");
    const secondLegend = document.createElement("table");

    createChartMock.mock.calls[0][0].legend.mount({}, firstLegend);
    createChartMock.mock.calls[1][0].legend.mount({}, secondLegend);

    expect(legendContainers[0].firstElementChild).toBe(firstLegend);
    expect(legendContainers[1].firstElementChild).toBe(secondLegend);
    expect(containers[0].contains(firstLegend)).toBe(false);
    expect(containers[1].contains(secondLegend)).toBe(false);
  });

  // Removes externally mounted legends when the graph renderer is destroyed.
  it("clears mounted legends on destroy", () => {
    const renderer = new EnergyChartsRenderer(containers, legendContainers);
    const legends = [document.createElement("table"), document.createElement("table")];
    createChartMock.mock.calls[0][0].legend.mount({}, legends[0]);
    createChartMock.mock.calls[1][0].legend.mount({}, legends[1]);

    renderer.destroy();

    expect(legendContainers[0].childElementCount).toBe(0);
    expect(legendContainers[1].childElementCount).toBe(0);
  });

  // Keeps separately rendered cards from joining the same cursor and zoom group.
  it("creates a distinct uPlot synchronization group per card", () => {
    new EnergyChartsRenderer(containers, legendContainers);
    const firstSyncKey = createChartMock.mock.calls[0][0].cursor.sync.key;

    containers = [document.createElement("div"), document.createElement("div")];
    legendContainers = [
      document.createElement("div"),
      document.createElement("div"),
    ];
    createChartMock.mockImplementation(() => ({ root: createRoot() }));
    new EnergyChartsRenderer(containers, legendContainers);
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

    new EnergyChartsRenderer(containers, legendContainers);

    const axes = createChartMock.mock.calls[0][0].axes;
    expect(axes[0].stroke()).toBe("#f4f4f4");
    expect(axes[0].grid.stroke()).toBe("#555555");
    expect(axes[0].grid.width).toBe(1);
    expect(axes[0].ticks.stroke()).toBe("#f4f4f4");
    expect(axes[1].stroke()).toBe("#f4f4f4");
  });

  // Uses readable text and a thinner gray grid for Home Assistant dark mode.
  it("uses a white axis and a thin gray grid in dark mode", () => {
    const renderer = new EnergyChartsRenderer(containers, legendContainers);
    renderer.refreshTheme(true);
    const axes = createChartMock.mock.calls[0][0].axes;

    expect(axes[0].stroke()).toBe("#ffffff");
    expect(axes[0].ticks.stroke()).toBe("#ffffff");
    expect(axes[0].grid.stroke()).toBe("#9e9e9e");
    expect(charts[0].axes[0].grid?.width).toBe(0.5);
    expect(charts[0].redraw).toHaveBeenCalledWith(true, true);
    expect(charts[1].redraw).toHaveBeenCalledWith(true, true);
  });

  // Keeps color callbacks callable through repeated theme changes and redraws.
  it("retains stable color callbacks across repeated theme changes", () => {
    const renderer = new EnergyChartsRenderer(containers, legendContainers);
    const axes = createChartMock.mock.calls[0][0].axes;
    const stroke = axes[0].stroke;
    const gridStroke = axes[0].grid.stroke;

    renderer.refreshTheme(true);
    expect(axes[0].stroke()).toBe("#ffffff");
    renderer.refreshTheme(false);
    expect(axes[0].stroke()).toBe("#212121");
    expect(axes[0].grid.stroke()).toBe("#bdbdbd");
    renderer.refreshTheme(true);

    expect(axes[0].stroke).toBe(stroke);
    expect(axes[0].grid.stroke).toBe(gridStroke);
    expect(axes[0].stroke()).toBe("#ffffff");
    expect(axes[0].grid.stroke()).toBe("#9e9e9e");
    expect(charts[0].redraw).toHaveBeenCalledTimes(3);
    expect(charts[1].redraw).toHaveBeenCalledTimes(3);
  });

  // Leaves uPlot's own selection color, visible on a light card.
  it("keeps uPlot's zoom selection color in light mode", () => {
    new EnergyChartsRenderer(containers, legendContainers);

    expect(selectionColor(0)).toBe("");
    expect(selectionColor(1)).toBe("");
  });

  // Draws the zoom selection in translucent gray on both charts in dark mode,
  // where uPlot's 7% black is invisible.
  it("shows a gray zoom selection on both charts in dark mode", () => {
    new EnergyChartsRenderer(containers, legendContainers, true);

    expect(selectionColor(0)).toBe("rgba(158, 158, 158, 0.25)");
    expect(selectionColor(1)).toBe("rgba(158, 158, 158, 0.25)");
  });

  // Switches the zoom selection color with the Home Assistant theme.
  it("updates the zoom selection color when the theme changes", () => {
    const renderer = new EnergyChartsRenderer(containers, legendContainers);

    renderer.refreshTheme(true);
    const darkColors = [selectionColor(0), selectionColor(1)];
    renderer.refreshTheme(false);

    expect(darkColors).toEqual(Array(2).fill("rgba(158, 158, 158, 0.25)"));
    expect(selectionColor(0)).toBe("");
    expect(selectionColor(1)).toBe("");
  });

  // Avoids redrawing canvas charts when the selected theme did not change.
  it("does not redraw when the theme is unchanged", () => {
    const renderer = new EnergyChartsRenderer(containers, legendContainers);

    renderer.refreshTheme(false);

    expect(charts[0].redraw).not.toHaveBeenCalled();
    expect(charts[1].redraw).not.toHaveBeenCalled();
  });

  // Watches both graph containers so responsive layout changes reach uPlot.
  it("observes both chart containers", () => {
    new EnergyChartsRenderer(containers, legendContainers);

    expect(MockResizeObserver.instances).toHaveLength(1);
    expect(MockResizeObserver.instances[0].observedElements).toEqual(
      containers,
    );
  });

  // Resizes only the chart whose observed container changed size.
  it("updates the matching chart dimensions after resize", () => {
    new EnergyChartsRenderer(containers, legendContainers);

    MockResizeObserver.instances[0].trigger(containers[1], 420, 160);

    expect(charts[0].setSize).not.toHaveBeenCalled();
    expect(charts[1].setSize).toHaveBeenCalledWith({
      width: 420,
      height: 160,
    });
  });

  // Ignores zero-sized observations to avoid collapsing charts while hidden.
  it("ignores zero-sized containers", () => {
    new EnergyChartsRenderer(containers, legendContainers);

    MockResizeObserver.instances[0].trigger(containers[0], 0, 0);

    expect(charts[0].setSize).not.toHaveBeenCalled();
    expect(charts[1].setSize).not.toHaveBeenCalled();
  });

  // Releases observers and both uPlot instances exactly once.
  it("destroys charts and disconnects its observer idempotently", () => {
    const renderer = new EnergyChartsRenderer(containers, legendContainers);

    renderer.destroy();
    renderer.destroy();

    expect(MockResizeObserver.instances[0].disconnect).toHaveBeenCalledOnce();
    expect(charts[0].destroy).toHaveBeenCalledOnce();
    expect(charts[1].destroy).toHaveBeenCalledOnce();
  });

  // Zooms both charts synchronously and falls back to the center for invalid cursor coordinates.
  it("zooms both charts synchronously when scrolling over the solar chart", () => {
    new EnergyChartsRenderer(containers, legendContainers);
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
  });

  // Zooms both energy charts synchronously when the mouse wheel scrolls on the second chart.
  it("zooms both charts synchronously when scrolling over the grid chart", () => {
    new EnergyChartsRenderer(containers, legendContainers);
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

  // Prevents scrolling and leaves scales unchanged when zooming out while already at full day.
  it("does not update scale when zooming out from the full day bounds", () => {
    new EnergyChartsRenderer(containers, legendContainers);
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
    const renderer = new EnergyChartsRenderer(containers, legendContainers);
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
    new EnergyChartsRenderer(containers, legendContainers);
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
    new EnergyChartsRenderer(containers, legendContainers);
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
    new EnergyChartsRenderer(containers, legendContainers);
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
    new EnergyChartsRenderer(containers, legendContainers);
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
    new EnergyChartsRenderer(containers, legendContainers);
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
    const renderer = new EnergyChartsRenderer(containers, legendContainers);
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
    const renderer = new EnergyChartsRenderer(containers, legendContainers);
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

  // Uses dark mode defaults even if the card has no custom theme values.
  it("falls back to dark-mode defaults when CSS variables are missing", () => {
    new EnergyChartsRenderer(containers, legendContainers, true);

    const axes = createChartMock.mock.calls[0][0].axes;
    expect(axes[0].stroke()).toBe("#ffffff");
    expect(axes[0].grid.stroke()).toBe("#9e9e9e");
    expect(charts[0].root.querySelector(".u-select")!.style.backgroundColor).toBe(
      "rgba(158, 158, 158, 0.25)",
    );
    expect(charts[1].root.querySelector(".u-select")!.style.backgroundColor).toBe(
      "rgba(158, 158, 158, 0.25)",
    );
  });

  // Falls back to Home Assistant defaults when the computed CSS values are blank.
  it("falls back to default light theme colors when CSS values are empty", () => {
    containers[0].style.setProperty("--primary-text-color", "");
    containers[0].style.setProperty("--divider-color", "");

    new EnergyChartsRenderer(containers, legendContainers);

    const axes = createChartMock.mock.calls[0][0].axes;
    expect(axes[0].stroke()).toBe("#212121");
    expect(axes[0].grid.stroke()).toBe("#bdbdbd");
  });

  // Keeps a destroyed renderer from mutating chart state on later updates.
  it("ignores updates after destroy", () => {
    const renderer = new EnergyChartsRenderer(containers, legendContainers);
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
    new EnergyChartsRenderer(containers, legendContainers);
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
    new EnergyChartsRenderer(containers, legendContainers);
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
    new EnergyChartsRenderer(containers, legendContainers);
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
    new EnergyChartsRenderer(containers, legendContainers);
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
    new EnergyChartsRenderer(containers, legendContainers);
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
    new EnergyChartsRenderer(containers, legendContainers);
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
