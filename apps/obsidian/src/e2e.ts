import type { buildServices } from "./services/build";

/** Type-only boundary for code evaluated by the End-to-end Run. */
export type E2eServices = Awaited<ReturnType<typeof buildServices>>["services"];
