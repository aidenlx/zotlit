// The parse service for callers outside Effect.
import type { ManagedRuntime } from "@/lib/effect";

import { ParseFailed } from "./client";
import type { ParseClient } from "./client";
import { CitationParse } from "./service";

export interface PlainCitationParse extends ParseClient {}

export function plainCitationParse(
  runtime: Pick<ManagedRuntime.ManagedRuntime<CitationParse, never>, "runSync">,
): PlainCitationParse {
  // The layer owns this client's lifetime; Promise callers keep its existing boundary.
  const { client } = runtime.runSync(CitationParse);
  return {
    parse: (request, signal) =>
      client.parse(request, signal).catch((error: unknown) => {
        throw error instanceof ParseFailed
          ? error
          : new ParseFailed(String(error));
      }),
  };
}
