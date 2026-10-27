import type { KnipConfig } from "knip";

// The unused-code check: an export or type with no reader in the workspace.
// `pnpm lint:unused` runs it against the baseline in
// packages/scripts/unused-code.json. Entry files are the roots each package is
// built and run from; their own exports count as read.
const config: KnipConfig = {
  include: ["exports", "types", "enumMembers"],
  // A symbol read in its own file has a reader; only its `export` is spare.
  ignoreExportsUsedInFile: true,
  ignoreWorkspaces: ["packages/obsidian-api", "packages/pdfjs-dist", "video"],
  ignore: ["packages/pdf-structure/src/vendor/**"],
  ignoreIssues: {
    // shadcn/ui components: each file ships the component's whole API.
    "apps/docs/src/components/ui/**": ["exports", "types"],
    // Temporary: the docs skeleton dropped the install pages that render
    // <VersionLedger> and <XpiDownload>, the readers of useReleaseSnapshot.
    // The keep-zotero-and-obsidian-in-sync lesson (#1605) renders them again
    // and removes this entry.
    "apps/docs/src/components/release-snapshot.tsx": ["exports"],
  },
  workspaces: {
    ".": {
      entry: [
        "*.{js,ts}",
        "skills/*/evals/*.test.mjs",
        ".agents/skills/**/*.mjs",
        ".claude/skills/**/*.mjs",
      ],
    },
    "apps/obsidian": {
      entry: [
        "src/zt-main.ts",
        // Bundled by the embeddedWorker Vite plugin.
        "src/services/*/worker.ts",
        // The effectEntry Vite plugin resolves `effect`, `effect/Effect` and
        // `@effect/vitest` to these wrappers.
        "src/lib/effect.ts",
        "src/lib/effect-runtime.ts",
        "src/lib/effect-worker.ts",
        "src/lib/effect-worker-runtime.ts",
        "src/lib/effect-vitest.ts",
        "scripts/**/*.ts",
        "vitest.*.ts",
        "vitest.setup.js",
      ],
    },
    "apps/zotero": {
      entry: [
        "src/bootstrap.ts",
        "src/main.ts",
        "scripts/**/*.ts",
        "vite.config.ts",
        "vite.serve.config.ts",
      ],
      // Loading vite.serve.config.ts needs a local apps/zotero/.env.
      vite: false,
    },
    "apps/docs": {
      entry: [
        "src/server.ts",
        "src/router.tsx",
        "src/routes/**/*.{ts,tsx}",
        "scripts/*.ts",
        "*.config.ts",
      ],
      // vite.config.ts imports .tsx modules by their .js name, which the
      // config loader cannot resolve.
      vite: false,
    },
    "packages/db": {
      // The tsdown entries: dist/ holds src/ here, so the exports map does not
      // lead back to these sources.
      entry: [
        "src/index.ts",
        "src/client/*.ts",
        "src/contract/ir.ts",
        "src/item-query/index.ts",
        "src/lib/zt-path.ts",
        "src/test-utils.ts",
        "src/test-scenario/index.ts",
        "scripts/*.ts",
      ],
      // Loading drizzle.config.js needs a local packages/db/.env.
      drizzle: false,
    },
    "packages/scripts": {
      entry: ["scripts/*.ts"],
    },
    "packages/e2e": {
      entry: ["src/*.e2e.ts", "src/query-measure.ts"],
    },
  },
};

export default config;
