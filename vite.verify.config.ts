import { reactRouter } from "@react-router/dev/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [reactRouter()],
  build: { assetsInlineLimit: 0 },
  optimizeDeps: { include: ["@shopify/app-bridge-react"] },
});
