import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  worker: { format: "es" },
  // MapLibre 6 loads its own ES-module worker relative to its files, which pre-bundling breaks.
  // The import worker's dependencies are listed so Vite doesn't discover them late and reload mid-import.
  optimizeDeps: { exclude: ["maplibre-gl"], include: ["fflate", "fit-file-parser"] },
});
