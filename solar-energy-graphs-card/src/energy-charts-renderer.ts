import {
  createChart,
  uPlot,
  type UPlotData,
  type UPlotInstance,
  type UPlotOptions,
} from "./uplot-adapter";
import { createDemoEnergyData } from "./demo-energy-data";

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

const DEMO_ENERGY_DATA = createDemoEnergyData();

const DEFAULT_WIDTH = 600;
const DEFAULT_HEIGHT = 100;

const toUtcDate = (timestamp: number): Date =>
  uPlot.tzDate(new Date(timestamp * 1000), "Etc/UTC");

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

    this.charts = containers.map((element, index) => {
      const mainChart = index === 0;
      const chart = createChart(
        this.createOptions(element, mainChart),
        mainChart ? this.createMainChartData() : SAMPLE_DATA,
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

  private createOptions(element: HTMLElement, mainChart: boolean): UPlotOptions {
    const axes: UPlotOptions["axes"] = [
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
        ...(mainChart ? { label: "Watts (W)" } : {}),
      },
    ];

    const series: UPlotOptions["series"] = mainChart
      ? [
          {},
          {
            label: "Production solaire (W)",
            stroke: "rgba(0, 0, 0, 0)",
            width: 0,
            fill: "rgba(245, 158, 11, 0.12)",
          },
          {
            label: "",
            stroke: "rgba(0, 0, 0, 0)",
            width: 0,
          },
          {
            label: "Solaire direct (W)",
            width: 0,
          },
          {
            label: "",
            stroke: "rgba(0, 0, 0, 0)",
            width: 0,
          },
          {
            label: "Consommation couverte par le réseau (W)",
            width: 0,
          },
          {
            label: "",
            stroke: "#d4ac1f",
            width: 1.5,
          },
          {
            label: "Consommation totale (W)",
            stroke: "#3b82f6",
            width: 1.5,
          },
        ]
      : [{}, ...SAMPLE_SERIES];
    const bands: NonNullable<UPlotOptions["bands"]> = [
      { series: [3, 2], fill: "#a2d49b" },
      { series: [5, 4], fill: "#e96e7d" },
    ];

    return {
      width: element.clientWidth || DEFAULT_WIDTH,
      height: element.clientHeight || DEFAULT_HEIGHT,
      ...(mainChart ? { tzDate: toUtcDate } : {}),
      scales: {
        x: { time: true },
        y: { auto: true, ...(mainChart ? { autoMin: 0 } : {}) },
      },
      series,
      axes,
      ...(mainChart ? { bands } : {}),
    };
  }

  private createMainChartData(): UPlotData {
    const zero = new Float32Array(DEMO_ENERGY_DATA.timestamps.length);

    return [
      DEMO_ENERGY_DATA.timestamps,
      DEMO_ENERGY_DATA.production,
      zero,
      DEMO_ENERGY_DATA.solarDirect,
      DEMO_ENERGY_DATA.solarDirect.slice(),
      DEMO_ENERGY_DATA.consumption,
      DEMO_ENERGY_DATA.production.slice(),
      DEMO_ENERGY_DATA.consumption.slice(),
    ];
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
