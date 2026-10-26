// boundary: Promise and AbortSignal facade for callers outside Effect.
import type { ManagedRuntime } from "effect";

import { AbortError } from "@/lib/abort-error";
import { effectBridge } from "@/lib/effect-bridge";
import { settleAtEdge } from "@/lib/signal-edge";

import type { ParseReply } from "./client";
import { CitationParse } from "./service";

export interface PlainCitationParse {
  parse(
    request: { path: string; generation: number; text: string },
    signal: AbortSignal,
  ): Promise<ParseReply>;
}

/** Unload stops a pending parse, which then rejects with an `AbortError`. */
export function plainCitationParse(
  runtime: Pick<
    ManagedRuntime.ManagedRuntime<CitationParse, never>,
    "runSync" | "runFork" | "scope"
  >,
): PlainCitationParse {
  const parser = runtime.runSync(CitationParse);
  const bridge = effectBridge(runtime);
  return {
    async parse(request, signal) {
      return settleAtEdge(
        await bridge.runPromiseExit(parser.parse(request), { signal }),
        signal,
        () => {
          throw new AbortError("The plugin unloaded during the parse.");
        },
      );
    },
  };
}
