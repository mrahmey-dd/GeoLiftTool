import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  server: {
    host:  "0.0.0.0",
    port:  5173,
    proxy: {
      // Proxy /v1/* to the Plumber API during development
      "/v1": {
        target:       "http://api:8000",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir:      "dist",
    sourcemap:   true,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor:   ["react", "react-dom"],
          charts:   ["recharts"],
          geo:      ["d3", "topojson-client"],
        },
      },
    },
  },
});
