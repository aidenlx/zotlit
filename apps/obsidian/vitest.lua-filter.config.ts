// The native Pandoc check of zotlit-cite.lua: `src/**/*.pandoc.test.ts`, which
// needs a `pandoc` binary the workspace does not install, so `pnpm test`
// (vitest.config.ts) leaves it out. Run with
// `pnpm --filter @zotlit/obsidian test:lua-filter`.
//
// It takes vitest.config.ts by plain spread rather than `mergeConfig`, and
// drops its `projects`, whose `include` would otherwise carry over.
import { defineConfig } from "vitest/config";

import base from "./vitest.config.ts";

const { projects: _projects, ...test } = base.test!;

export default defineConfig({
  ...base,
  test: {
    ...test,
    include: ["src/**/*.pandoc.test.ts"],
    // The style validator reads XML through the DOMParser Obsidian's renderer
    // supplies.
    environment: "happy-dom",
    // Every case spawns Pandoc against one shared workspace, in order.
    fileParallelism: false,
  },
});
