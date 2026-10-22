import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const root = resolve(__dirname);

// Three entry points: two extension pages and the MV3 service worker.
// The service worker is emitted at a fixed path so manifest.json can reference it.
export default defineConfig({
  plugins: [react()],
  base: "./",
  publicDir: "public",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "chrome116",
    // The module-preload polyfill touches `document`, which does not exist in the service worker.
    modulePreload: false,
    sourcemap: false,
    rollupOptions: {
      input: {
        popup: resolve(root, "popup.html"),
        dashboard: resolve(root, "dashboard.html"),
        background: resolve(root, "src/background/serviceWorker.ts"),
      },
      output: {
        entryFileNames: (chunk) => (chunk.name === "background" ? "background.js" : "assets/[name]-[hash].js"),
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
        manualChunks: (id) => {
          if (id.includes("node_modules/react") || id.includes("node_modules/scheduler")) return "react";
          if (id.includes("node_modules/zod")) return "zod";
          if (id.includes("/src/shared/")) return "shared";
          if (id.includes("/src/ui/")) return "ui";
          return undefined;
        },
      },
    },
  },
});
