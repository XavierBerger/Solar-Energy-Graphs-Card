import type { EnergyHistoryResponse } from "./home-assistant-energy-history";
import {
  createChart,
  uPlot,
  type UPlotInstance,
  type UPlotOptions,
} from "./uplot-adapter";

const DEFAULT_WIDTH = 600;
const DEFAULT_HEIGHT = 100;
let nextSyncGroupId = 0;

// Pale min-max ranges drawn around the mean of each sensor.
const PRODUCTION_RANGE_FILL = "rgba(204, 157, 0, 0.25)";
const CONSUMPTION_RANGE_FILL = "rgba(59, 130, 246, 0.2)";
const IMPORT_RANGE_FILL = "rgba(239, 68, 68, 0.3)";

const RANGE_BOUND_SERIES = {
  label: "",
  class: "hide-helper-legend",
  stroke: "rgba(0, 0, 0, 0)",
  width: 0,
};

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

export interface TimeRange {
  min: number;
  max: number;
}

/** Computes the new horizontal time range when zooming with the mouse wheel. */
export function computeWheelZoomRange(
  currentRange: TimeRange,
  dayWindow: TimeRange,
  cursorPct: number,
  deltaY: number,
  zoomFactor = 0.8,
): TimeRange | undefined {
  if (deltaY === 0) {
    return undefined;
  }

  const { min: currentMin, max: currentMax } = currentRange;
  const { min: dayStart, max: dayEnd } = dayWindow;
  const dayDuration = dayEnd - dayStart;
  const currentDuration = currentMax - currentMin;

  if (dayDuration <= 0 || currentDuration <= 0) {
    return undefined;
  }

  const clampedPct = Math.max(0, Math.min(1, cursorPct));
  const pivot = currentMin + clampedPct * currentDuration;

  const newDuration = deltaY < 0 ? currentDuration * zoomFactor : currentDuration / zoomFactor;

  if (newDuration >= dayDuration) {
    if (currentMin === dayStart && currentMax === dayEnd) {
      return undefined;
    }
    return { min: dayStart, max: dayEnd };
  }

  let newMin = pivot - clampedPct * newDuration;
  let newMax = newMin + newDuration;

  if (newMin < dayStart) {
    newMin = dayStart;
    newMax = dayStart + newDuration;
  } else if (newMax > dayEnd) {
    newMax = dayEnd;
    newMin = dayEnd - newDuration;
  }

  return { min: newMin, max: newMax };
}

/** Computes the new horizontal time range when dragging to pan. */
export function computeDragPanRange(
  currentRange: TimeRange,
  dayWindow: TimeRange,
  deltaPx: number,
  plotWidthPx: number,
): TimeRange | undefined {
  if (deltaPx === 0 || plotWidthPx <= 0) {
    return undefined;
  }

  const { min: currentMin, max: currentMax } = currentRange;
  const { min: dayStart, max: dayEnd } = dayWindow;
  const currentDuration = currentMax - currentMin;
  const dayDuration = dayEnd - dayStart;

  // Not zoomed in — nothing to pan.
  if (currentDuration >= dayDuration) {
    return undefined;
  }

  // Convert pixel displacement to time units.
  // Dragging right (positive deltaPx) moves the view left (earlier in time).
  const deltaTime = -(deltaPx / plotWidthPx) * currentDuration;

  let newMin = currentMin + deltaTime;
  let newMax = currentMax + deltaTime;

  if (newMin < dayStart) {
    newMin = dayStart;
    newMax = dayStart + currentDuration;
  } else if (newMax > dayEnd) {
    newMax = dayEnd;
    newMin = dayEnd - currentDuration;
  }

  if (newMin === currentMin && newMax === currentMax) {
    return undefined;
  }

  return { min: newMin, max: newMax };
}

interface ChartTheme {
  text: string;
  grid: string;
  gridWidth: number;
  // Zoom selection background; empty keeps uPlot's `.u-select` CSS.
  selection: string;
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
  private readonly wheelListeners: Array<{
    element: HTMLElement;
    listener: (event: WheelEvent) => void;
  }> = [];
  private readonly dragListeners: Array<{
    element: HTMLElement;
    listener: (event: MouseEvent) => void;
  }> = [];
  private dragState?: {
    startX: number;
    rangeAtStart: TimeRange;
    dayWindow: TimeRange;
    plotWidth: number;
    onMove: (event: MouseEvent) => void;
    onUp: (event: MouseEvent) => void;
  };
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
      this.applySelectionColor(chart);
      this.resizeObserver.observe(element);
      const onWheel = (event: WheelEvent) => {
        this.handleWheel(event, index);
      };
      element.addEventListener("wheel", onWheel, { passive: false });
      this.wheelListeners.push({ element, listener: onWheel });
      const onMouseDown = (event: MouseEvent) => {
        this.handleDragStart(event, index);
      };
      element.addEventListener("mousedown", onMouseDown);
      this.dragListeners.push({ element, listener: onMouseDown });
      return { element, legendElement, chart };
    });
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }

    this.destroyed = true;
    this.resizeObserver.disconnect();
    this.wheelListeners.forEach(({ element, listener }) => {
      element.removeEventListener("wheel", listener);
    });
    this.wheelListeners.length = 0;
    this.dragListeners.forEach(({ element, listener }) => {
      element.removeEventListener("mousedown", listener);
    });
    this.dragListeners.length = 0;
    if (this.dragState) {
      document.removeEventListener("mousemove", this.dragState.onMove);
      document.removeEventListener("mouseup", this.dragState.onUp);
      this.dragState = undefined;
    }
    this.charts.forEach(({ chart, legendElement }) => {
      chart.destroy();
      legendElement.replaceChildren();
    });
  }

  updateData(data: EnergyHistoryResponse): void {
    if (this.destroyed) {
      return;
    }
    const zoom = this.currentZoom();
    this.charts[0].chart.setData(data.mainData);
    this.charts[1].chart.setData(data.gridData);
    // Both x axes start at the day window start: another start means another day.
    if (zoom && data.mainData[0][0] === zoom.dayStart) {
      this.charts.forEach(({ chart }) => {
        chart.setScale("x", { min: zoom.min, max: zoom.max });
      });
    }
  }

  /** Returns the x range when it is narrower than the displayed day. */
  private currentZoom():
    | { min: number; max: number; dayStart: number }
    | undefined {
    const { data, scales } = this.charts[0].chart;
    const x = data[0];
    const { min, max } = scales.x ?? {};
    if (x.length === 0 || min === undefined || max === undefined) {
      return undefined;
    }
    return min > x[0] || max < x[x.length - 1]
      ? { min, max, dayStart: x[0] }
      : undefined;
  }

  private handleWheel(event: WheelEvent, targetIndex: number): void {
    if (this.destroyed || event.deltaY === 0) {
      return;
    }

    const target = this.charts[targetIndex];
    if (!target) {
      return;
    }

    const { data, scales } = target.chart;
    const xData = data[0];
    if (!xData || xData.length < 2) {
      return;
    }

    const dayStart = xData[0];
    const dayEnd = xData[xData.length - 1];
    const currentMin = scales.x?.min ?? dayStart;
    const currentMax = scales.x?.max ?? dayEnd;

    const overlay = target.chart.over ?? target.element;
    const rect = overlay.getBoundingClientRect?.() ?? { left: 0, width: 0 };
    const clientX =
      Number.isFinite(event.clientX)
        ? event.clientX
        : (rect.left ?? 0) + (rect.width ?? 0) / 2;
    const cursorPct =
      rect.width > 0
        ? (clientX - (rect.left ?? 0)) / rect.width
        : 0.5;

    const newRange = computeWheelZoomRange(
      { min: currentMin, max: currentMax },
      { min: dayStart, max: dayEnd },
      cursorPct,
      event.deltaY,
    );

    event.preventDefault();
    if (newRange) {
      this.charts.forEach(({ chart }) => {
        chart.setScale("x", newRange);
      });
    }
  }

  private handleDragStart(event: MouseEvent, targetIndex: number): void {
    if (this.destroyed || event.button !== 0 || this.dragState) {
      return;
    }

    const target = this.charts[targetIndex];
    if (!target) {
      return;
    }

    const { data, scales } = target.chart;
    const xData = data[0];
    if (!xData || xData.length < 2) {
      return;
    }

    const dayStart = xData[0];
    const dayEnd = xData[xData.length - 1];
    const currentMin = scales.x?.min ?? dayStart;
    const currentMax = scales.x?.max ?? dayEnd;
    const currentDuration = currentMax - currentMin;
    const dayDuration = dayEnd - dayStart;

    const zoomed = currentDuration < dayDuration;
    // uPlot reads drag.x on each mousemove: select-to-zoom on the full day,
    // pan once zoomed in.
    this.charts.forEach(({ chart }) => {
      chart.cursor.drag!.x = !zoomed;
    });
    if (!zoomed) {
      return;
    }

    const overlay = target.chart.over ?? target.element;
    const rect = overlay.getBoundingClientRect?.() ?? { width: 0 };
    if (!rect.width || rect.width <= 0) {
      return;
    }

    const onMove = (e: MouseEvent) => {
      this.handleDragMove(e);
    };
    const onUp = (e: MouseEvent) => {
      this.handleDragEnd(e);
    };

    this.dragState = {
      startX: event.clientX,
      rangeAtStart: { min: currentMin, max: currentMax },
      dayWindow: { min: dayStart, max: dayEnd },
      plotWidth: rect.width,
      onMove,
      onUp,
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  private handleDragMove(event: MouseEvent): void {
    if (!this.dragState) {
      return;
    }

    const deltaPx = event.clientX - this.dragState.startX;
    const newRange = computeDragPanRange(
      this.dragState.rangeAtStart,
      this.dragState.dayWindow,
      deltaPx,
      this.dragState.plotWidth,
    );

    if (newRange) {
      this.charts.forEach(({ chart }) => {
        chart.setScale("x", newRange);
      });
    }
  }

  private handleDragEnd(_event: MouseEvent): void {
    if (!this.dragState) {
      return;
    }

    document.removeEventListener("mousemove", this.dragState.onMove);
    document.removeEventListener("mouseup", this.dragState.onUp);
    this.dragState = undefined;
  }

  refreshTheme(darkMode: boolean): void {
    if (this.destroyed) {
      return;
    }

    const theme = this.readTheme(this.charts[0].element, darkMode);
    if (
      theme.text === this.theme.text &&
      theme.grid === this.theme.grid &&
      theme.gridWidth === this.theme.gridWidth &&
      theme.selection === this.theme.selection
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
      this.applySelectionColor(chart);
      chart.redraw(true, true);
    });
  }

  private applySelectionColor(chart: UPlotInstance): void {
    chart.root.querySelector<HTMLElement>(".u-select")!.style.backgroundColor =
      this.theme.selection;
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
          fill: "#fbf0a8",
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
          stroke: "#cc9d00",
          width: 1.25,
        },
        {
          label: "Consumption",
          stroke: "#3b82f6",
          width: 1.25,
        },
        {
          label: "Grid import",
          class: "legend-values-only",
          show: false,
          fill: "#e96e7d",
        },
        {
          label: "Grid export",
          class: "legend-values-only",
          show: false,
          fill: "#fbf0a8",
        },
        { ...RANGE_BOUND_SERIES },
        { ...RANGE_BOUND_SERIES },
        { ...RANGE_BOUND_SERIES },
        { ...RANGE_BOUND_SERIES },
      ]
      : [
        {},
        {
          label: "Grid export (+W)",
          stroke: "#cc9d00",
          width: 1.25,
          fill: "#fbf0a8",
        },
        {
          label: "Grid import (-W)",
          stroke: "#ef4444",
          width: 1.25,
          fill: "#e96e7d",
        },
        { ...RANGE_BOUND_SERIES },
        { ...RANGE_BOUND_SERIES },
        { ...RANGE_BOUND_SERIES },
        { ...RANGE_BOUND_SERIES },
      ];
    const bands: NonNullable<UPlotOptions["bands"]> = mainChart
      ? [
        { series: [3, 2], fill: "#a2d49b" },
        { series: [5, 4], fill: "#e96e7d" },
        { series: [10, 11], fill: PRODUCTION_RANGE_FILL },
        { series: [12, 13], fill: CONSUMPTION_RANGE_FILL },
      ]
      : [
        { series: [3, 4], fill: PRODUCTION_RANGE_FILL },
        { series: [5, 6], fill: IMPORT_RANGE_FILL },
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
      // uPlot draws white point markers once samples are sparse enough, as
      // with statistics intervals; the charts only show lines and areas.
      series: series.map((options, index) =>
        index === 0 ? options : { ...options, points: { show: false } },
      ),
      axes,
      bands,
      ...(mainChart
        ? {}
        : { hooks: { draw: [(chart) => drawZeroLine(chart, this.theme.grid)] } }),
    };
  }

  private readTheme(element: HTMLElement, darkMode: boolean): ChartTheme {
    if (darkMode) {
      return {
        text: "#ffffff",
        grid: "#9e9e9e",
        gridWidth: 0.5,
        // uPlot's 7% black selection is invisible on a dark card.
        selection: "rgba(158, 158, 158, 0.25)",
      };
    }

    const styles = getComputedStyle(element);
    return {
      text:
        styles.getPropertyValue("--primary-text-color").trim() || "#212121",
      grid: styles.getPropertyValue("--divider-color").trim() || "#bdbdbd",
      gridWidth: 1,
      selection: "",
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
