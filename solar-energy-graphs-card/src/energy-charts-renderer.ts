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
const DEFAULT_HEIGHT = 100;

interface ChartTheme {
  text: string;
  grid: string;
  gridWidth: number;
}

type ChartTarget = {
  element: HTMLElement;
  chart: UPlotInstance;
};

export class EnergyChartsRenderer {
  private readonly charts: ChartTarget[];
  private readonly resizeObserver: ResizeObserver;
  private destroyed = false;
  private theme: ChartTheme;

  constructor(
    containers: readonly [HTMLElement, HTMLElement],
    darkMode = false,
  ) {
    this.theme = this.readTheme(containers[0], darkMode);
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

  refreshTheme(darkMode: boolean): void {
    if (this.destroyed) {
      return;
    }

    const theme = this.readTheme(this.charts[0].element, darkMode);
    if (
      theme.text === this.theme.text &&
      theme.grid === this.theme.grid &&
      theme.gridWidth === this.theme.gridWidth
    ) {
      return;
    }

    this.theme = theme;
    this.charts.forEach(({ chart }) => {
      chart.axes.forEach((axis) => {
        if (axis.grid) {
          axis.grid.width = theme.gridWidth;
        }
      });
      chart.redraw(true, true);
    });
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
      axes: [
        {
          stroke: () => this.theme.text,
          grid: { stroke: () => this.theme.grid, width: this.theme.gridWidth },
          ticks: { stroke: () => this.theme.text, width: 1 },
          border: { stroke: () => this.theme.grid, width: 1 },
        },
        {
          stroke: () => this.theme.text,
          grid: { stroke: () => this.theme.grid, width: this.theme.gridWidth },
          ticks: { stroke: () => this.theme.text, width: 1 },
          border: { stroke: () => this.theme.grid, width: 1 },
        },
      ],
    };
  }

  private readTheme(element: HTMLElement, darkMode: boolean): ChartTheme {
    if (darkMode) {
      return {
        text: "#ffffff",
        grid: "#9e9e9e",
        gridWidth: 0.5,
      };
    }

    const styles = getComputedStyle(element);
    return {
      text:
        styles.getPropertyValue("--primary-text-color").trim() || "#212121",
      grid: styles.getPropertyValue("--divider-color").trim() || "#bdbdbd",
      gridWidth: 1,
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
