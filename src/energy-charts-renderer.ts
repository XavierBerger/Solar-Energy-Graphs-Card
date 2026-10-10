import type { EnergyHistoryResponse } from "./home-assistant-energy-history";
import { translations, type CardLanguage } from "./translations";
import {
  createChart,
  uPlot,
  type UPlotInstance,
  type UPlotOptions,
} from "./uplot-adapter";

// Type pour les fonctions de formatage des axes et légendes uPlot
type UPlotTimeFormatter = (self: unknown, value: number) => string;
type UPlotAxisFormatter = (self: unknown, splits: number[]) => string[];

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

// ════════════════════════════════════════
// UTILITAIRES PARTAGÉS (toutes langues)
// ════════════════════════════════════

/** Returns true for timestamp 0 (Unix epoch), null, undefined, NaN, or Infinity. */
function isInvalidTimestamp(value: unknown): boolean {
  if (value === 0 || value == null) return true;
  return typeof value === "number" && !Number.isFinite(value);
}

/**
 * Formats a timestamp with the given locale, or returns "-" for invalid/zero values.
 * uPlot passes 0 when no point is under the cursor, which would display as 1970-01-01.
 */
function formatTimeOrDefault(
  value: unknown,
  timeZone: string,
  locale: string,
  options: Intl.DateTimeFormatOptions,
): string {
  if (isInvalidTimestamp(value)) return "-";
  return new Intl.DateTimeFormat(locale, { ...options, timeZone }).format(
    new Date((value as number) * 1000),
  );
}

// ════════════════════════════════════════
// FONCTIONS GÉNÉRIQUES POUR LES AXES ET LÉGENDES TEMPORELS
// ════════════════════════════════════════

export function createTimeAxis(
  timeZone: string,
  locale: string,
  hourCycle: "h11" | "h12" | "h23" | "h24" = "h23",
): UPlotAxisFormatter {
  const dayFormatter = new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    timeZone,
  });
  const timeFormatter = new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle,
    timeZone,
  });

  return (_self, splits) => {
    let previousDay: string | undefined;
    return splits.map((value) => {
      if (isInvalidTimestamp(value)) return "-";
      const date = new Date((value as number) * 1000);
      const day = dayFormatter.format(date);
      const label = day !== previousDay ? day : timeFormatter.format(date);
      previousDay = day;
      return label;
    });
  };
}

export function createTimeLegend(
  timeZone: string,
  locale: string,
  hourCycle: "h11" | "h12" | "h23" | "h24" = "h23",
): UPlotTimeFormatter {
  return (_self, value) =>
    formatTimeOrDefault(value, timeZone, locale, {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle,
    });
}

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

  // Stryker disable next-line EqualityOperator: deltaY === 0 has already returned.
  const newDuration = deltaY < 0 ? currentDuration * zoomFactor : currentDuration / zoomFactor;

  if (newDuration >= dayDuration) {
    if (currentMin === dayStart && currentMax === dayEnd) {
      return undefined;
    }
    return { min: dayStart, max: dayEnd };
  }

  let newMin = pivot - clampedPct * newDuration;
  let newMax = newMin + newDuration;

  // Stryker disable EqualityOperator: at a day bound, clamping keeps the same range.
  if (newMin < dayStart) {
    newMin = dayStart;
    newMax = dayStart + newDuration;
  } else if (newMax > dayEnd) {
    newMax = dayEnd;
    newMin = dayEnd - newDuration;
  }
  // Stryker restore EqualityOperator

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

  // Stryker disable EqualityOperator: at a day bound, clamping keeps the same range.
  if (newMin < dayStart) {
    newMin = dayStart;
    newMax = dayStart + currentDuration;
  } else if (newMax > dayEnd) {
    newMax = dayEnd;
    newMin = dayEnd - currentDuration;
  }
  // Stryker restore EqualityOperator

  // Stryker disable next-line ConditionalExpression,LogicalOperator: a pan keeps the duration, so both bounds move together.
  if (newMin === currentMin && newMax === currentMax) {
    return undefined;
  }

  return { min: newMin, max: newMax };
}

export interface TouchPoint {
  clientX: number;
  clientY: number;
}

/** Computes the distance between two touch points in pixels. */
export function computeTouchDistance(t1: TouchPoint, t2: TouchPoint): number {
  const dx = t2.clientX - t1.clientX;
  const dy = t2.clientY - t1.clientY;
  return Math.hypot(dx, dy);
}

/** Computes the horizontal midpoint position in pixels for two touch points. */
export function computeTouchMidpointX(t1: TouchPoint, t2: TouchPoint): number {
  return (t1.clientX + t2.clientX) / 2;
}

/** Returns true if a touch displacement vector is primarily horizontal. */
export function isHorizontalTouchGesture(deltaX: number, deltaY: number): boolean {
  return Math.abs(deltaX) > Math.abs(deltaY);
}

/** Computes the new horizontal time range when zooming with a two-finger pinch gesture. */
export function computePinchZoomRange(
  currentRange: TimeRange,
  dayWindow: TimeRange,
  cursorPct: number,
  distanceRatio: number,
): TimeRange | undefined {
  if (distanceRatio <= 0 || distanceRatio === 1) {
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

  const newDuration = currentDuration / distanceRatio;

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


interface ChartTheme {
  text: string;
  grid: string;
  gridWidth: number;
  // Zoom selection background; empty keeps uPlot's `.u-select` CSS.
  selection: string;
}

type ChartTarget = {
  element: HTMLElement;
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
  private readonly touchListeners: Array<{
    element: HTMLElement;
    onTouchStart: (event: TouchEvent) => void;
    onTouchMove: (event: TouchEvent) => void;
    onTouchEnd: (event: TouchEvent) => void;
    onTouchCancel: (event: TouchEvent) => void;
  }> = [];
  private dragState?: {
    startX: number;
    rangeAtStart: TimeRange;
    dayWindow: TimeRange;
    plotWidth: number;
    onMove: (event: MouseEvent) => void;
    onUp: (event: MouseEvent) => void;
  };
  private touchState?: {
    targetIndex: number;
    startX: number;
    startY: number;
    isPan: boolean;
    isPinch: boolean;
    rangeAtStart: TimeRange;
    dayWindow: TimeRange;
    plotWidth: number;
    plotLeft: number;
    startDistance?: number;
    startRange?: TimeRange;
  };
  private destroyed = false;
  private theme: ChartTheme;
  private readonly language: CardLanguage;

  constructor(
    containers: readonly [HTMLElement, HTMLElement],
    data: EnergyHistoryResponse,
    timeZone: string,
    darkMode = false,
    language: CardLanguage = "en",
  ) {
    this.language = language;
    this.theme = this.readTheme(containers[0], darkMode);
    this.syncGroup = uPlot.sync(
      // Stryker disable next-line UpdateOperator: only the uniqueness of the key matters.
      `solar-energy-graphs-card-${++nextSyncGroupId}`,
    );
    this.resizeObserver = new ResizeObserver((entries) => {
      this.handleResize(entries);
    });

    this.charts = containers.map((element, index) => {
      const mainChart = index === 0;
      const chart = createChart(
        this.createOptions(element, mainChart, timeZone),
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

      const onTouchStart = (event: TouchEvent) => {
        this.handleTouchStart(event, index);
      };
      const onTouchMove = (event: TouchEvent) => {
        this.handleTouchMove(event, index);
      };
      const onTouchEnd = (event: TouchEvent) => {
        this.handleTouchEnd(event, index);
      };
      const onTouchCancel = (event: TouchEvent) => {
        this.handleTouchEnd(event, index);
      };

      element.addEventListener("touchstart", onTouchStart, { passive: false });
      element.addEventListener("touchmove", onTouchMove, { passive: false });
      element.addEventListener("touchend", onTouchEnd);
      element.addEventListener("touchcancel", onTouchCancel);
      this.touchListeners.push({
        element,
        onTouchStart,
        onTouchMove,
        onTouchEnd,
        onTouchCancel,
      });

      return { element, chart };
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
    this.touchListeners.forEach(
      ({ element, onTouchStart, onTouchMove, onTouchEnd, onTouchCancel }) => {
        element.removeEventListener("touchstart", onTouchStart);
        element.removeEventListener("touchmove", onTouchMove);
        element.removeEventListener("touchend", onTouchEnd);
        element.removeEventListener("touchcancel", onTouchCancel);
      },
    );
    this.touchListeners.length = 0;
    this.touchState = undefined;
    if (this.dragState) {
      document.removeEventListener("mousemove", this.dragState.onMove);
      document.removeEventListener("mouseup", this.dragState.onUp);
      this.dragState = undefined;
    }
    this.charts.forEach(({ chart }) => {
      chart.destroy();
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
    if (min === undefined || max === undefined) {
      return undefined;
    }
    // An empty axis fails both comparisons.
    return min > x[0] || max < x[x.length - 1]
      ? { min, max, dayStart: x[0] }
      : undefined;
  }

  private handleWheel(event: WheelEvent, targetIndex: number): void {
    if (this.destroyed || event.deltaY === 0) {
      return;
    }

    const target = this.charts[targetIndex];
    const { data, scales } = target.chart;
    const xData = data[0];
    if (!xData || xData.length < 2) {
      return;
    }

    const dayStart = xData[0];
    const dayEnd = xData[xData.length - 1];
    const currentMin = scales.x.min ?? dayStart;
    const currentMax = scales.x.max ?? dayEnd;

    const overlay = target.chart.over ?? target.element;
    const rect = overlay.getBoundingClientRect();
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
    const { data, scales } = target.chart;
    const xData = data[0];
    if (!xData || xData.length < 2) {
      return;
    }

    const dayStart = xData[0];
    const dayEnd = xData[xData.length - 1];
    const currentMin = scales.x.min ?? dayStart;
    const currentMax = scales.x.max ?? dayEnd;
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
    const rect = overlay.getBoundingClientRect();
    if (!(rect.width > 0)) {
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
    // Stryker disable next-line ConditionalExpression,BlockStatement: the document listeners only exist during a drag.
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
    // Stryker disable next-line ConditionalExpression,BlockStatement: the document listeners only exist during a drag.
    if (!this.dragState) {
      return;
    }

    document.removeEventListener("mousemove", this.dragState.onMove);
    document.removeEventListener("mouseup", this.dragState.onUp);
    this.dragState = undefined;
  }

  private handleTouchStart(event: TouchEvent, targetIndex: number): void {
    if (this.destroyed || event.touches.length === 0) {
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
    if (!rect.width || rect.width <= 0) {
      return;
    }

    if (event.touches.length === 1) {
      const touch = event.touches[0];
      this.touchState = {
        targetIndex,
        startX: touch.clientX,
        startY: touch.clientY,
        isPan: false,
        isPinch: false,
        rangeAtStart: { min: currentMin, max: currentMax },
        dayWindow: { min: dayStart, max: dayEnd },
        plotWidth: rect.width,
        plotLeft: rect.left ?? 0,
      };
    } else if (event.touches.length === 2) {
      const t1 = event.touches[0];
      const t2 = event.touches[1];
      const startDistance = computeTouchDistance(t1, t2);

      this.touchState = {
        targetIndex,
        startX: t1.clientX,
        startY: t1.clientY,
        isPan: false,
        isPinch: true,
        rangeAtStart: { min: currentMin, max: currentMax },
        dayWindow: { min: dayStart, max: dayEnd },
        plotWidth: rect.width,
        plotLeft: rect.left ?? 0,
        startDistance,
        startRange: { min: currentMin, max: currentMax },
      };
    }
  }

  private handleTouchMove(event: TouchEvent, targetIndex: number): void {
    if (
      this.destroyed ||
      !this.touchState ||
      this.touchState.targetIndex !== targetIndex
    ) {
      return;
    }

    if (event.touches.length === 2) {
      const t1 = event.touches[0];
      const t2 = event.touches[1];
      const currentDistance = computeTouchDistance(t1, t2);

      if (
        !this.touchState.isPinch ||
        !this.touchState.startDistance ||
        !this.touchState.startRange
      ) {
        const { scales } = this.charts[targetIndex].chart;
        const currentMin = scales.x?.min ?? this.touchState.dayWindow.min;
        const currentMax = scales.x?.max ?? this.touchState.dayWindow.max;
        this.touchState.isPinch = true;
        this.touchState.isPan = false;
        this.touchState.startDistance = currentDistance;
        this.touchState.startRange = { min: currentMin, max: currentMax };
        return;
      }

      if (this.touchState.startDistance <= 0 || currentDistance <= 0) {
        return;
      }

      event.preventDefault();
      const distanceRatio = currentDistance / this.touchState.startDistance;
      const midpointX = computeTouchMidpointX(t1, t2);
      const cursorPct =
        this.touchState.plotWidth > 0
          ? (midpointX - this.touchState.plotLeft) / this.touchState.plotWidth
          : 0.5;

      const newRange = computePinchZoomRange(
        this.touchState.startRange,
        this.touchState.dayWindow,
        cursorPct,
        distanceRatio,
      );

      if (newRange) {
        this.charts.forEach(({ chart }) => {
          chart.setScale("x", newRange);
        });
      }
    } else if (event.touches.length === 1) {
      if (this.touchState.isPinch) {
        const touch = event.touches[0];
        const { scales } = this.charts[targetIndex].chart;
        const currentMin = scales.x?.min ?? this.touchState.dayWindow.min;
        const currentMax = scales.x?.max ?? this.touchState.dayWindow.max;
        this.touchState.isPinch = false;
        this.touchState.isPan = false;
        this.touchState.startX = touch.clientX;
        this.touchState.startY = touch.clientY;
        this.touchState.rangeAtStart = { min: currentMin, max: currentMax };
        return;
      }

      const touch = event.touches[0];
      const deltaX = touch.clientX - this.touchState.startX;
      const deltaY = touch.clientY - this.touchState.startY;

      const currentDuration =
        this.touchState.rangeAtStart.max - this.touchState.rangeAtStart.min;
      const dayDuration =
        this.touchState.dayWindow.max - this.touchState.dayWindow.min;
      const zoomed = currentDuration < dayDuration;

      if (
        !this.touchState.isPan &&
        zoomed &&
        isHorizontalTouchGesture(deltaX, deltaY)
      ) {
        this.touchState.isPan = true;
      }

      if (this.touchState.isPan) {
        event.preventDefault();
        const newRange = computeDragPanRange(
          this.touchState.rangeAtStart,
          this.touchState.dayWindow,
          deltaX,
          this.touchState.plotWidth,
        );

        if (newRange) {
          this.charts.forEach(({ chart }) => {
            chart.setScale("x", newRange);
          });
        }
      }
    }
  }

  private handleTouchEnd(event: TouchEvent, targetIndex: number): void {
    if (this.touchState && this.touchState.targetIndex === targetIndex) {
      if (event.touches.length === 0) {
        this.touchState = undefined;
      } else if (event.touches.length === 1 && this.touchState.isPinch) {
        const touch = event.touches[0];
        const { scales } = this.charts[targetIndex].chart;
        const currentMin = scales.x?.min ?? this.touchState.dayWindow.min;
        const currentMax = scales.x?.max ?? this.touchState.dayWindow.max;
        this.touchState.isPinch = false;
        this.touchState.isPan = false;
        this.touchState.startX = touch.clientX;
        this.touchState.startY = touch.clientY;
        this.touchState.rangeAtStart = { min: currentMin, max: currentMax };
      }
    }
  }

  refreshTheme(darkMode: boolean): void {
    if (this.destroyed) {
      return;
    }

    const theme = this.readTheme(this.charts[0].element, darkMode);
    if (
      theme.text === this.theme.text &&
      theme.grid === this.theme.grid &&
      // Stryker disable next-line ConditionalExpression: gridWidth and selection both follow darkMode, so either one detects its change.
      theme.gridWidth === this.theme.gridWidth &&
      // Stryker disable next-line ConditionalExpression: see gridWidth.
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

  private getTimeFormatters(timeZone: string) {
    const t = translations(this.language);
    return {
      axis: createTimeAxis(timeZone, t.dateLocale, t.hourCycle),
      legend: createTimeLegend(timeZone, t.dateLocale, t.hourCycle),
    };
  }

  private createOptions(
    element: HTMLElement,
    mainChart: boolean,
    timeZone: string,
  ): UPlotOptions {
    const t = translations(this.language);
    const { axis, legend } = this.getTimeFormatters(timeZone);
    const axes = [
      {
        stroke: () => this.theme.text,
        grid: { stroke: () => this.theme.grid, width: this.theme.gridWidth },
        ticks: { stroke: () => this.theme.text, width: 1 },
        border: { stroke: () => this.theme.grid, width: 1 },
        values: axis,
      },
      {
        stroke: () => this.theme.text,
        grid: { stroke: () => this.theme.grid, width: this.theme.gridWidth },
        ticks: { stroke: () => this.theme.text, width: 1 },
        border: { stroke: () => this.theme.grid, width: 1 },
        label: t.chart.power,
      },
    ] as UPlotOptions["axes"];

    const series = mainChart
      ? [
        {
          label: t.chart.time,
          value: legend,
        },
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
          label: t.chart.selfConsumption,
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
          label: t.chart.solarProduction,
          stroke: "#cc9d00",
          width: 1.25,
        },
        {
          label: t.chart.consumption,
          stroke: "#3b82f6",
          width: 1.25,
        },
        {
          label: t.chart.gridImport,
          class: "legend-values-only",
          show: false,
          fill: "#e96e7d",
        },
        {
          label: t.chart.gridExport,
          class: "legend-values-only",
          show: false,
          fill: "#fbf0a8",
        },
        { ...RANGE_BOUND_SERIES },
        { ...RANGE_BOUND_SERIES },
        { ...RANGE_BOUND_SERIES },
        { ...RANGE_BOUND_SERIES },
      ] as UPlotOptions["series"]
      : [
        {
          label: t.chart.time,
          value: legend,
        },
        {
          label: t.chart.gridExportPositive,
          stroke: "#cc9d00",
          width: 1.25,
          fill: "#fbf0a8",
        },
        {
          label: t.chart.gridImportNegative,
          stroke: "#ef4444",
          width: 1.25,
          fill: "#e96e7d",
        },
        { ...RANGE_BOUND_SERIES },
        { ...RANGE_BOUND_SERIES },
        { ...RANGE_BOUND_SERIES },
        { ...RANGE_BOUND_SERIES },
      ] as UPlotOptions["series"];
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

    let legendTable!: HTMLElement;
    // Displays the legend when the cursor is over either graph.
    const showLegendWithCursor = (chart: UPlotInstance) => {
      legendTable.style.display = chart.cursor.left! >= 0 ? "" : "none";
    };

    return {
      width: element.clientWidth || DEFAULT_WIDTH,
      height: element.clientHeight || DEFAULT_HEIGHT,
      tzDate: (timestamp) =>
        uPlot.tzDate(new Date(timestamp * 1000), timeZone),
      cursor: {
        sync: { key: this.syncGroup.key, scales: ["x", null] },
        drag: { x: true, y: false },
      },
      legend: mainChart
        ? {
          mount: (chart, table) => {
            legendTable = table;
            chart.over.append(table);
            showLegendWithCursor(chart);
          },
        }
        : { show: false },
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
        ? { hooks: { setCursor: [showLegendWithCursor] } }
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
      const target = this.charts.find(({ element }) => element === entry.target);
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
