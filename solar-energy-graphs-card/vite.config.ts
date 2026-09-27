import { defineConfig } from "vitest/config";

export default defineConfig({
  build: {
    lib: {
      entry: "src/index.ts",
      formats: ["es"],
      fileName: () => "solar-energy-graphs-card.js",
    },
    target: "es2022",
  },
  test: {
    environment: "happy-dom",
    include: ["src/**/*.test.ts"],
    clearMocks: true,
  },
});
