import preact from "@preact/preset-vite";
import { defineConfig } from "vite";

// Tauri expects a fixed dev port and does not want the screen cleared.
export default defineConfig({
  plugins: [preact()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  build: { target: "es2022", outDir: "dist" },
});
