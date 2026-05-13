import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Proxy API + MCP + SSE through to the Bun/Hono server.
      "/sessions": "http://localhost:4111",
      "/health": "http://localhost:4111",
      "/mcp": "http://localhost:4111",
      "/personas": "http://localhost:4111",
      "/templates": "http://localhost:4111",
    },
  },
});
