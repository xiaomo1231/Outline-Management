/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import pkg from "./package.json";

// Tauri 开发时固定端口；浏览器里也能直接打开调试（数据存在浏览器里）
export default defineConfig({
  plugins: [react()],
  // 版本号只在 package.json 里写一处，桌面版（tauri.conf.json 指向它）和界面都从这里取
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  build: { target: "es2021", chunkSizeWarningLimit: 2000 },
  test: { environment: "node" },
});
