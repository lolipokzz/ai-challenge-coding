import { defineConfig } from "vite";
export default defineConfig({
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
        configure(proxy) {
          proxy.on("proxyReq", (proxyReq, req) => {
            if (
              ["http://127.0.0.1:5173", "http://localhost:5173"].includes(
                req.headers.origin,
              )
            ) {
              proxyReq.setHeader("Origin", "http://127.0.0.1:8000");
            }
          });
        },
      },
    },
  },
  build: { outDir: "dist" },
});
