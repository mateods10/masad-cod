import { reactRouter } from "@react-router/dev/vite";
import { build } from "vite";

await build({
  configFile: false,
  plugins: [
    {
      name: "programmatic-config-marker",
      enforce: "pre",
      configResolved(config) {
        config.configFile = "vite.verify.config.mjs";
      },
    },
    reactRouter(),
  ],
  build: { assetsInlineLimit: 0 },
  optimizeDeps: { include: ["@shopify/app-bridge-react"] },
});
