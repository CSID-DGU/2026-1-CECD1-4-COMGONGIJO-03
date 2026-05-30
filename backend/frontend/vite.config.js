import fs from "node:fs";
import path from "node:path";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

function readBackendEnv() {
  const backendEnvPath = path.resolve(process.cwd(), "..", ".env");
  if (!fs.existsSync(backendEnvPath)) return {};

  return fs
    .readFileSync(backendEnvPath, "utf-8")
    .split(/\r?\n/)
    .reduce((env, line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return env;
      const separatorIndex = trimmed.indexOf("=");
      if (separatorIndex === -1) return env;
      const key = trimmed.slice(0, separatorIndex).trim();
      const value = trimmed.slice(separatorIndex + 1).trim();
      env[key] = value;
      return env;
    }, {});
}

export default defineConfig(({ mode }) => {
  const frontendEnv = loadEnv(mode, process.cwd(), "");
  const backendEnv = readBackendEnv();
  const apiBaseUrl = frontendEnv.VITE_API_BASE_URL || "/api";
  const backendPort = backendEnv.PORT || "3000";
  const proxyTarget = apiBaseUrl.startsWith("http")
    ? apiBaseUrl.replace(/\/api\/?$/, "")
    : `http://localhost:${backendPort}`;

  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        "/api": {
          target: proxyTarget,
          changeOrigin: true
        }
      }
    }
  };
});
