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
  const runReleased = Effect.runPromiseWith(
    runtime.runSync(Effect.context<never>()),
  );
  return {
    parse: (request, signal) =>
      runtime.scope.state._tag === "Closed"
        ? runReleased(parser.parse(request), { signal })
        : runtime.runPromise(parser.parse(request), { signal }),
  };
}
