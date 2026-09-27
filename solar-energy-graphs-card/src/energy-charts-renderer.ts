import {
  createChart,
  type UPlotData,
  type UPlotInstance,
  type UPlotOptions,
} from "./uplot-adapter";

const SAMPLE_TIMESTAMPS = [0, 1, 2, 3, 4, 5, 6].map(
  (hour) => Date.UTC(2025, 0, 1, hour) / 1000,
);

const SAMPLE_SERIES = [
  {
    label: "Demonstration series A",
    stroke: "#3b82f6",
    width: 2,
  },
  {
    label: "Demonstration series B",
    stroke: "#8b5cf6",
    width: 2,
  },
];

const SAMPLE_DATA: UPlotData = [
  SAMPLE_TIMESTAMPS,
  [12, 20, 16, 28, 24, 35, 30],
  [30, 24, 34, 22, 38, 29, 42],
];

const DEFAULT_WIDTH = 600;
const DEFAULT_HEIGHT = 180;

type ChartTarget = {
  element: HTMLElement;
  chart: UPlotInstance;
};

export class EnergyChartsRenderer {
  private readonly charts: ChartTarget[];
  private readonly resizeObserver: ResizeObserver;
  private destroyed = false;

  constructor(containers: readonly [HTMLElement, HTMLElement]) {
    this.resizeObserver = new ResizeObserver((entries) => {
      this.handleResize(entries);
    });

    this.charts = containers.map((element) => {
      const chart = createChart(
        this.createOptions(element),
        SAMPLE_DATA,
        element,
      );
      this.resizeObserver.observe(element);
      return { element, chart };
    });
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }

    this.destroyed = true;
    this.resizeObserver.disconnect();
    this.charts.forEach(({ chart }) => chart.destroy());
  }

  private createOptions(element: HTMLElement): UPlotOptions {
    return {
      width: element.clientWidth || DEFAULT_WIDTH,
      height: element.clientHeight || DEFAULT_HEIGHT,
      scales: {
        x: { time: true },
        y: { auto: true },
      },
      series: [{}, ...SAMPLE_SERIES],
      axes: [{}, {}],
    };
  }

  private handleResize(entries: ResizeObserverEntry[]): void {
    entries.forEach((entry) => {
      const target = this.charts?.find(({ element }) => element === entry.target);
      if (
        target &&
        entry.contentRect.width > 0 &&
        entry.contentRect.height > 0
      ) {
        target.chart.setSize({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      }
    });
  }
}
