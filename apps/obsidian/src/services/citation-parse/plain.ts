// boundary: Promise and AbortSignal facade for callers outside Effect.
import { Effect } from "effect";
import type { ManagedRuntime } from "effect";

import { settleAtEdge } from "@/lib/signal-edge";

import type { ParseReply } from "./client";
import { CitationParse } from "./service";

export interface PlainCitationParse {
  parse(
    request: { path: string; generation: number; text: string },
    signal: AbortSignal,
  ): Promise<ParseReply>;
}

export function plainCitationParse(
  runtime: Pick<ManagedRuntime.ManagedRuntime<CitationParse, never>, "runSync">,
): PlainCitationParse {
  const parser = runtime.runSync(CitationParse);
  const run = Effect.runPromiseExitWith(
    runtime.runSync(Effect.context<never>()),
  );
  return {
    async parse(request, signal) {
      return settleAtEdge(await run(parser.parse(request), { signal }), signal);
    },
  };
}
