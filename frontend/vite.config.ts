import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// GitHub Pages serves the project from /<repo-name>/, set via VITE_BASE_PATH at build time if needed.
export default defineConfig({
  plugins: [react()],
  base: process.env.VITE_BASE_PATH ?? "/",
  build: {
    outDir: "dist",
    sourcemap: true,
  },
  test: {
    environment: "jsdom",
  },
});
