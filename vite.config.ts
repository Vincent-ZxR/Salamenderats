import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  worker: { format: "es" },
  // MapLibre 6 loads its own ES-module worker relative to its files, which pre-bundling breaks.
  optimizeDeps: { exclude: ["maplibre-gl"] },
});
