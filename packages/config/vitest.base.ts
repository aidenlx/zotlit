import { fileURLToPath } from "node:url";

// Each package's worker pool shares CPU with the other Turbo test tasks.
export const testDefaults = {
  maxWorkers: 4,
  // The hosted runner has 4 vCPU, and the release gate runs every package's
  // suite there, so a test that passes locally can run past 5 s (#2020).
  // Locally the Vitest default holds, so a slow test still shows up. The root
  // `test` task passes `GITHUB_ACTIONS` through Turbo's strict env mode.
  testTimeout: process.env.GITHUB_ACTIONS ? 15_000 : 5_000,
  // Vitest's own defaults, plus every `.scratch/` folder: git ignores them,
  // and a test file left in one is not part of any package's suite.
  exclude: ["**/node_modules/**", "**/.git/**", "**/.scratch/**"],
  // A bare `vitest run` passes the Memory Gate. Under root `pnpm test` the
  // whole run passed it once, and the admitted mark makes this skip it.
  globalSetup: [
    fileURLToPath(new URL("./vitest-memory-gate.ts", import.meta.url)),
  ],
};
