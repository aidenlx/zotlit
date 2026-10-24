/** Document citation text for the editor and reading surfaces. */
import { Cause, Effect, Exit, Stream } from "@/lib/effect";
import type { ManagedRuntime } from "@/lib/effect";
import { isScopeClosed } from "@/lib/effect-scope";

import { CitationText } from "./service";

export type PlainCitationText = ReturnType<typeof plainCitationText>;

export function plainCitationText(
  runtime: ManagedRuntime.ManagedRuntime<CitationText, never>,
) {
  const service = runtime.runSync(CitationText);
  const run = Effect.runSyncWith(runtime.runSync(Effect.context<never>()));
  const closed = () => isScopeClosed(runtime.scope);
  return {
    get current() {
      return run(service.current);
    },
    changes: service.changes,
    events: service.events,
    changed: service.events.pipe(
      Stream.filter((event) => event.type === "changed"),
      Stream.map((event) => event.path),
    ),
    settled: service.events.pipe(
      Stream.filter((event) => event.type === "settled"),
    ),
    invalidated: service.events.pipe(
      Stream.filter((event) => event.type === "invalidated"),
      Stream.map(() => undefined),
    ),
    peek: (path: string) =>
      closed() ? null : runtime.runSync(service.peek(path)),
    async read(path: string, options?: { signal?: AbortSignal }) {
      if (closed()) return null;
      const exit = await runtime.runPromiseExit(service.read(path, options));
      if (Exit.isSuccess(exit)) return exit.value;
      if (Cause.hasInterruptsOnly(exit.cause)) return null;
      throw Cause.squash(exit.cause);
    },
  };
}
