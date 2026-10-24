// boundary: Promise and AbortSignal facade for callers outside Effect.
import { Cause, Effect, Exit } from "@/lib/effect";
import type { ManagedRuntime } from "@/lib/effect";

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
      const exit = await run(parser.parse(request), { signal });
      if (Exit.isSuccess(exit)) return exit.value;
      if (signal.aborted) throw signal.reason;
      throw Cause.squash(exit.cause);
    },
  };
}
