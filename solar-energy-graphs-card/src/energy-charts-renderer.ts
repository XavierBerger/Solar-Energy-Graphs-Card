import {
  createChart,
  uPlot,
  type UPlotInstance,
  type UPlotOptions,
} from "./uplot-adapter";
import type { EnergyHistoryResponse } from "./home-assistant-energy-history";

const DEFAULT_WIDTH = 600;
const DEFAULT_HEIGHT = 100;
let nextSyncGroupId = 0;

interface ZeroLineChart {
  scales: Record<string, { min?: number; max?: number }>;
  valToPos(value: number, scale: string, canvasPosition?: boolean): number;
  ctx: Pick<
    CanvasRenderingContext2D,
    | "save"
    | "restore"
    | "beginPath"
    | "moveTo"
    | "lineTo"
    | "stroke"
    | "strokeStyle"
    | "lineWidth"
  >;
  bbox: Pick<DOMRect, "left" | "width">;
}

export function drawZeroLine(chart: ZeroLineChart, color: string): void {
  const yScale = chart.scales.y;
  if (
    !yScale ||
    yScale.min === undefined ||
    yScale.max === undefined ||
    yScale.min > 0 ||
    yScale.max < 0
  ) {
    return;
  }

  const y = chart.valToPos(0, "y", true);
  const { ctx, bbox } = chart;
  const alignedY = Math.round(y) + 0.5;

  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(bbox.left, alignedY);
  ctx.lineTo(bbox.left + bbox.width, alignedY);
  ctx.stroke();
  ctx.restore();
}

interface ChartTheme {
  text: string;
  grid: string;
  gridWidth: number;
}

type ChartTarget = {
  element: HTMLElement;
  legendElement: HTMLElement;
  chart: UPlotInstance;
};

export class EnergyChartsRenderer {
  private readonly charts: ChartTarget[];
  private readonly resizeObserver: ResizeObserver;
  private readonly syncGroup: ReturnType<typeof uPlot.sync>;
  private destroyed = false;
  private theme: ChartTheme;

  constructor(
    containers: readonly [HTMLElement, HTMLElement],
    legendContainers: readonly [HTMLElement, HTMLElement],
    data: EnergyHistoryResponse,
    timeZone: string,
    darkMode = false,
  ) {
    this.theme = this.readTheme(containers[0], darkMode);
    this.syncGroup = uPlot.sync(
      `solar-energy-graphs-card-${++nextSyncGroupId}`,
    );
    this.resizeObserver = new ResizeObserver((entries) => {
      this.handleResize(entries);
    });

    this.charts = containers.map((element, index) => {
      const legendElement = legendContainers[index];
      const mainChart = index === 0;
      const chart = createChart(
        this.createOptions(element, legendElement, mainChart, timeZone),
        mainChart ? data.mainData : data.gridData,
        element,
      );
      this.resizeObserver.observe(element);
      return { element, legendElement, chart };
    });
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }

    this.destroyed = true;
    this.resizeObserver.disconnect();
    this.charts.forEach(({ chart, legendElement }) => {
      chart.destroy();
      legendElement.replaceChildren();
    });
  }

  updateData(data: EnergyHistoryResponse): void {
    if (this.destroyed) {
      return;
    }
    this.charts[0].chart.setData(data.mainData);
    this.charts[1].chart.setData(data.gridData);
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

  private createOptions(
    element: HTMLElement,
    legendContainer: HTMLElement,
    mainChart: boolean,
    timeZone: string,
  ): UPlotOptions {
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
        label: "Power (W)",
      },
    ];

    const series: UPlotOptions["series"] = mainChart
      ? [
          {},
          {
            label: "",
            class: "hide-helper-legend",
            stroke: "rgba(0, 0, 0, 0)",
            width: 0,
            fill: "rgba(245, 158, 11, 0.12)",
          },
          {
            label: "",
            class: "hide-helper-legend",
            stroke: "rgba(0, 0, 0, 0)",
            width: 0,
          },
          {
            label: "Self-consumption",
            width: 0,
            fill: "#a2d49b",
          },
          {
            label: "",
            class: "hide-helper-legend",
            stroke: "rgba(0, 0, 0, 0)",
            width: 0,
          },
          {
            label: "",
            class: "hide-helper-legend",
            width: 0,
          },
          {
            label: "Solar production",
            stroke: "#d4ac1f",
            width: 1.5,
          },
          {
            label: "Consumption",
            stroke: "#3b82f6",
            width: 1.5,
          },
        ]
      : [
          {},
          {
            label: "Grid export (+W)",
            stroke: "#f59e0b",
            width: 1.5,
            fill: "rgba(245, 158, 11, 0.35)",
          },
          {
            label: "Grid import (-W)",
            stroke: "#ef4444",
            width: 1.5,
            fill: "rgba(239, 68, 68, 0.35)",
          },
        ];
    const bands: NonNullable<UPlotOptions["bands"]> = [
      { series: [3, 2], fill: "#a2d49b" },
      { series: [5, 4], fill: "#e96e7d" },
    ];

    return {
      width: element.clientWidth || DEFAULT_WIDTH,
      height: element.clientHeight || DEFAULT_HEIGHT,
      tzDate: (timestamp) =>
        uPlot.tzDate(new Date(timestamp * 1000), timeZone),
      cursor: {
        sync: { key: this.syncGroup.key, scales: ["x", null] },
        drag: { x: true, y: false },
      },
      legend: {
        mount: (_chart, legend) => {
          legendContainer.replaceChildren(legend);
        },
      },
      scales: {
        x: { time: true },
        y: { auto: true, ...(mainChart ? { autoMin: 0 } : {}) },
      },
      series,
      axes,
      ...(mainChart
        ? { bands }
        : { hooks: { draw: [(chart) => drawZeroLine(chart, this.theme.grid)] } }),
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
