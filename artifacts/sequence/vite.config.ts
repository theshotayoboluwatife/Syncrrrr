import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

const rootDir = path.resolve(import.meta.dirname, "..", "..");

export default defineConfig(async ({ command, mode }) => {
  const env = { ...loadEnv(mode, rootDir, ""), ...process.env };
  const rawPort = env.PORT;
  const isServing = command === "serve";

  if (isServing && !rawPort) {
    throw new Error(
      "PORT environment variable is required but was not provided.",
    );
  }

  const port = Number(rawPort ?? 5173);

  if (isServing && (Number.isNaN(port) || port <= 0)) {
    throw new Error(`Invalid PORT value: "${rawPort}"`);
  }

  const basePath = env.BASE_PATH;

  if (!basePath) {
    throw new Error(
      "BASE_PATH environment variable is required but was not provided.",
    );
  }

  const apiProxyTarget = env.API_PROXY_TARGET;

  return {
    base: basePath,
    envDir: rootDir,
    plugins: [
      react(),
      tailwindcss(),
    ],
    resolve: {
      alias: {
        "@": path.resolve(import.meta.dirname, "src"),
        "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
      },
      dedupe: ["react", "react-dom"],
    },
    root: path.resolve(import.meta.dirname),
    build: {
      outDir: path.resolve(import.meta.dirname, "dist/public"),
      emptyOutDir: true,
    },
    server: {
      port,
      host: "0.0.0.0",
      allowedHosts: true,
      ...(apiProxyTarget && {
        proxy: {
          "/api": {
            target: apiProxyTarget,
            changeOrigin: true,
          },
        },
      }),
      fs: {
        strict: true,
        deny: ["**/.*"],
      },
    },
    preview: {
      port,
      host: "0.0.0.0",
      allowedHosts: true,
    },
  };
});
