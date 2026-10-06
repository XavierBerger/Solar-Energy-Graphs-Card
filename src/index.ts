import "./solar-energy-graphs-card";
import "./solar-energy-graphs-card-editor";
import { cardLanguage, translations } from "./translations";

interface LovelaceCustomCardMetadata {
  type: string;
  name: string;
  description: string;
}

const customCardWindow = window as Window & {
  customCards?: LovelaceCustomCardMetadata[];
};
customCardWindow.customCards ??= [];
if (
  !customCardWindow.customCards.some(
    ({ type }) => type === "solar-energy-graphs-card",
  )
) {
  customCardWindow.customCards.push({
    type: "solar-energy-graphs-card",
    name: "Solar Energy Graphs Card",
    get description() {
      return translations(cardLanguage(document.documentElement.lang))
        .cardPickerDescription;
    },
  });
}

export { createChart, uPlot } from "./uplot-adapter";
