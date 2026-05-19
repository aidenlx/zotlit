import { defineConfig, mergeConfig } from "vite";

import { zoteroDevServerPlugin } from "./scripts/dev-server/index.js";
import { createZoteroViteConfig } from "./vite.config.js";

const here = import.meta.dirname;

export default defineConfig((configEnv) =>
  mergeConfig(createZoteroViteConfig(configEnv), {
    plugins: [
      zoteroDevServerPlugin({
        root: here,
        mode: configEnv.mode,
      }),
    ],
  }),
);
