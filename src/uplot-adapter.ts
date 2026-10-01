import uPlot from "uplot";
import uPlotStyles from "uplot/dist/uPlot.min.css?inline";

export type UPlotOptions = ConstructorParameters<typeof uPlot>[0];
export type UPlotData = ConstructorParameters<typeof uPlot>[1];
export type UPlotInstance = InstanceType<typeof uPlot>;

export function createChart(
  options: UPlotOptions,
  data: UPlotData,
  target: HTMLElement,
): UPlotInstance {
  return new uPlot(options, data, target);
}

export { uPlot, uPlotStyles };
