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
  ],
  gridData: [Float64Array.from([0, 300]), [null, 200], [null, -400]],
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
    axes: Array<{
      grid?: { width?: number };
      ticks?: Record<string, never>;
      border?: Record<string, never>;
    }>;
  }>;

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
        axes: [{ grid: {}, ticks: {}, border: {} }, { grid: {}, ticks: {}, border: {} }],
      },
      {
        setSize: vi.fn(),
        setData: vi.fn(),
        destroy: vi.fn(),
        redraw: vi.fn(),
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
      fill: "#f59e0b",
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
    ]);
    expect(firstOptions.bands).toEqual([
      { series: [3, 2], fill: "#a2d49b" },
      { series: [5, 4], fill: "#e96e7d" },
    ]);
    expect(firstOptions.axes[1].label).toBe("Power (W)");
    expect(firstOptions.scales.y.autoMin).toBe(0);
    expect(firstOptions.legend.mount).toBeTypeOf("function");
    expect(secondOptions.scales.y.autoMin).toBeUndefined();
    expect(secondOptions.legend.mount).toBeTypeOf("function");
    expect(firstData).toHaveLength(10);
    expect(firstData[0]).toHaveLength(2);
    expect(firstData[1]).toEqual([null, 1800]);
    expect(firstData[8]).toEqual([null, 400]);
    expect(firstData[9]).toEqual([null, 200]);
    expect(secondOptions.series[1].label).toBe("Grid export (+W)");
    expect(secondOptions.series[2].label).toBe("Grid import (-W)");
    expect(secondOptions.axes[1].label).toBe("Power (W)");
    expect(secondOptions.bands).toBeUndefined();
    expect(secondOptions.scales.y.autoMin).toBeUndefined();
    expect(secondData).toHaveLength(3);
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
    new EnergyChartsRenderer(containers, legendContainers);
    const secondSyncKey = createChartMock.mock.calls[2][0].cursor.sync.key;

    expect(secondSyncKey).not.toBe(firstSyncKey);
  });

  // Draws the zero reference across the network chart plotting area.
  it("draws a theme-colored zero line when zero is in the y range", () => {
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
      scales: { y: { min: -200, max: 700 } },
      valToPos: vi.fn(() => 10),
      ctx,
      bbox: { left: 5, width: 120 },
    };

    drawZeroLine(chart, "#9e9e9e");

    expect(chart.valToPos).toHaveBeenCalledWith(0, "y", true);
    expect(ctx.strokeStyle).toBe("#9e9e9e");
    expect(ctx.lineWidth).toBe(1.5);
    expect(ctx.moveTo).toHaveBeenCalledWith(5, 10.5);
    expect(ctx.lineTo).toHaveBeenCalledWith(125, 10.5);
    expect(ctx.stroke).toHaveBeenCalledOnce();
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
    const chart = {
      scales: { y: { min: 10, max: 700 } },
      valToPos: vi.fn(() => 10),
      ctx,
      bbox: { left: 5, width: 120 },
    };

    drawZeroLine(chart, "#9e9e9e");

    expect(chart.valToPos).not.toHaveBeenCalled();
    expect(ctx.stroke).not.toHaveBeenCalled();
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
});
