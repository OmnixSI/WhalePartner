import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 默认只监听本机；手机浏览器联调时用 WP_LAN=1 开放局域网。
const host = process.env.TAURI_DEV_HOST || (process.env.WP_LAN ? "0.0.0.0" : "127.0.0.1");

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    host,
    port: 1420,
    strictPort: true,
    proxy: { "/api": "http://127.0.0.1:8787" },
  },
  build: { target: "es2022", chunkSizeWarningLimit: 900 },
});
