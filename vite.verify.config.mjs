import { reactRouter } from "@react-router/dev/vite";

export default {
  plugins: [reactRouter()],
  build: { assetsInlineLimit: 0 },
  optimizeDeps: { include: ["@shopify/app-bridge-react"] },
};
