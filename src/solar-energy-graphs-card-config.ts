export type SolarEnergyEntityRole =
  | "production"
  | "consumption"
  | "grid_import"
  | "grid_export";

export interface SolarEnergyGraphsCardConfig {
  type: string;
  entities: Record<SolarEnergyEntityRole, string | null>;
}
