// PandocEngine for consumers outside Effect.
import type { ManagedRuntime } from "@/lib/effect";
import { plainManagedBinary } from "@/services/managed-binary/plain";
import type { PlainManagedBinary } from "@/services/managed-binary/plain";

import type { CitationEngine } from "./engine";
import { PandocEngine } from "./service";

export type PlainPandocEngine = PlainManagedBinary<CitationEngine>;

export function plainPandocEngine(
  runtime: ManagedRuntime.ManagedRuntime<PandocEngine, never>,
): PlainPandocEngine {
  return plainManagedBinary(runtime, runtime.runSync(PandocEngine));
}
