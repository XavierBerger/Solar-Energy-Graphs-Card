import { realpathSync } from "node:fs";
import { defineConfig } from "vitest/config";

export default defineConfig({
  server: {
    fs: {
      // Stryker sandboxes symlink node_modules outside their root; allow its
      // real path so `?inline` CSS imports are not denied during mutation runs.
      allow: [".", realpathSync("node_modules")],
    },
  },
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
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/vite-env.d.ts"],
      reporter: ["text", "html"],
      reportsDirectory: "coverage",
    },
  },
});
