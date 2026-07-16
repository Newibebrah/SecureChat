import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const host = process.env.TAURI_DEV_HOST;
const isWeb = process.env.VERCEL || process.env.WEB_BUILD;

export default defineConfig(async () => ({
  plugins: [react()],
  clearScreen: false,
  resolve: isWeb
    ? {
        alias: {
          "@tauri-apps/api/core": path.resolve(
            __dirname,
            "src/lib/tauri-core.ts",
          ),
          "@tauri-apps/api/event": path.resolve(
            __dirname,
            "src/lib/tauri-event.ts",
          ),
        },
      }
    : undefined,
  build: {
    target: "es2021",
    minify: "esbuild",
    cssMinify: true,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ["react", "react-dom"],
          qr: ["qrcode.react", "html5-qrcode"],
          state: ["zustand"],
        },
      },
    },
    chunkSizeWarningLimit: 300,
    sourcemap: false,
  },
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
    },
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
}));
