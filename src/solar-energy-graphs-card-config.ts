export type SolarEnergyEntityRole =
  | "production"
  | "consumption"
  | "grid_import"
  | "grid_export";

export interface ConsumerConfig {
  entity: string;
  color?: string;
  name?: string;
}

export interface SolarEnergyGraphsCardConfig {
  type: string;
  entities: Record<SolarEnergyEntityRole, string | null>;
  consumers?: ConsumerConfig[];
}

export const CONSUMER_DEFAULT_COLORS = [
  "#8B5CF6",
  "#F97316",
  "#10B981",
  "#EC4899",
  "#06B6D4",
  "#EF4444",
  "#84CC16",
  "#6366F1",
  "#F59E0B",
  "#14B8A6",
  "#D946EF",
  "#3B82F6",
] as const;
