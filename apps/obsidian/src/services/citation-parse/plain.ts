// The parse service for callers outside Effect.
import { Effect } from "@/lib/effect";
import type { ManagedRuntime } from "@/lib/effect";

import type { ParseClient } from "./client";
import { CitationParse } from "./service";

export interface PlainCitationParse extends ParseClient {}

export function plainCitationParse(
  runtime: ManagedRuntime.ManagedRuntime<CitationParse, never>,
): PlainCitationParse {
  const parser = runtime.runSync(CitationParse.use(Effect.succeed));
  return {
    parse: (request, signal) =>
      runtime.runPromise(parser.parse(request), { signal }),
  };
}
