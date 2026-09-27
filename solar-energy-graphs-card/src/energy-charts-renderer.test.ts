import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { UPlotInstance } from "./uplot-adapter";

const { createChartMock } = vi.hoisted(() => ({
  createChartMock: vi.fn(),
}));

vi.mock("./uplot-adapter", () => ({
  createChart: createChartMock,
}));

import { EnergyChartsRenderer } from "./energy-charts-renderer";

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
    destroy: ReturnType<typeof vi.fn>;
    redraw: ReturnType<typeof vi.fn>;
    axes: Array<{
      stroke?: string;
      grid?: { stroke?: string };
      ticks?: { stroke?: string };
      border?: { stroke?: string };
    }>;
  }>;

  beforeEach(() => {
    containers = [document.createElement("div"), document.createElement("div")];
    document.body.append(...containers);
    charts = [
      {
        setSize: vi.fn(),
        destroy: vi.fn(),
        redraw: vi.fn(),
        axes: [{ grid: {}, ticks: {}, border: {} }, { grid: {}, ticks: {}, border: {} }],
      },
      {
        setSize: vi.fn(),
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
    vi.stubGlobal("ResizeObserver", MockResizeObserver);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  // Creates exactly two uPlot instances using clearly neutral demonstration series.
  it("creates two charts with temporary neutral demo data", () => {
    new EnergyChartsRenderer(containers);

    expect(createChartMock).toHaveBeenCalledTimes(2);
    const firstOptions = createChartMock.mock.calls[0][0];
    const secondOptions = createChartMock.mock.calls[1][0];
    expect(firstOptions.series[1].label).toBe("Demonstration series A");
    expect(firstOptions.series[2].label).toBe("Demonstration series B");
    expect(secondOptions.series[1].label).toBe("Demonstration series A");
    expect(firstOptions.width).toBe(600);
    expect(firstOptions.height).toBe(100);
  });

  // Applies Home Assistant theme tokens to uPlot axis text, ticks and gridlines.
  it("uses the active Home Assistant theme colors", () => {
    containers[0].style.setProperty("--primary-text-color", "#f4f4f4");
    containers[0].style.setProperty("--divider-color", "#555555");
    containers[1].style.setProperty("--primary-text-color", "#f4f4f4");
    containers[1].style.setProperty("--divider-color", "#555555");

    new EnergyChartsRenderer(containers);

    const axes = createChartMock.mock.calls[0][0].axes;
    expect(axes[0].stroke).toBe("#f4f4f4");
    expect(axes[0].grid.stroke).toBe("#555555");
    expect(axes[0].ticks.stroke).toBe("#f4f4f4");
    expect(axes[1].stroke).toBe("#f4f4f4");
  });

  // Redraws both canvas charts when Home Assistant theme colors change.
  it("refreshes chart colors when the theme changes", () => {
    containers[0].style.setProperty("--primary-text-color", "#f4f4f4");
    containers[0].style.setProperty("--divider-color", "#555555");
    const renderer = new EnergyChartsRenderer(containers);
    containers[0].style.setProperty("--primary-text-color", "#222222");
    containers[0].style.setProperty("--divider-color", "#cccccc");

    renderer.refreshTheme();

    expect(charts[0].axes[0].stroke).toBe("#222222");
    expect(charts[0].axes[0].grid?.stroke).toBe("#cccccc");
    expect(charts[1].axes[1].ticks?.stroke).toBe("#222222");
    expect(charts[0].redraw).toHaveBeenCalledWith(true, true);
    expect(charts[1].redraw).toHaveBeenCalledWith(true, true);
  });

  // Avoids redrawing canvas charts when theme values did not change.
  it("does not redraw when theme colors are unchanged", () => {
    const renderer = new EnergyChartsRenderer(containers);

    renderer.refreshTheme();

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
});
