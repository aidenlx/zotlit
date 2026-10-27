import type { createPluginRuntime } from "./services/plugin-runtime";

/** Type-only boundary for code evaluated by the End-to-end Run. */
export type E2eServices = Awaited<ReturnType<typeof createPluginRuntime>>;
