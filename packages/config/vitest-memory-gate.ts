// Vitest global setup: a bare `vitest run` passes the Memory Gate itself. At
// the Admission Deadline it exits 75: Vitest would turn a throw into exit 1.

import { Effect } from "effect";

import {
  MEMORY_GATE_ADMITTED_ENV,
  passMemoryGateOrExit,
} from "./memory-gate.ts";

export default async function setup(): Promise<void> {
  // Each project of a multi-project config runs this again; the mark skips it.
  if (await Effect.runPromise(passMemoryGateOrExit()))
    process.env[MEMORY_GATE_ADMITTED_ENV] = "1";
}
