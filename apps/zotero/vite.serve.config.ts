import { defineConfig, mergeConfig } from "vite";

import { zoteroDevServerPlugin } from "./scripts/dev-server/index.js";
import { createZoteroViteConfig } from "./vite.config.js";

const packageRoot = import.meta.dirname;

export default defineConfig((configEnv) =>
  mergeConfig(createZoteroViteConfig(configEnv), {
    plugins: [
      zoteroDevServerPlugin({
        root: packageRoot,
        mode: configEnv.mode,
      }),
    ],
  }),
);
