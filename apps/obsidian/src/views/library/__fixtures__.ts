import { DateTime } from "effect";
// The view's clock and its ledger's Uses, for tests: the view is plain code,
// so it reads Temporal.

import type { Use } from "@/services/use-ledger/service";
import type { UseKind } from "@/services/use-ledger/service";

export { holdNow } from "./__fixtures__/clock";

/** A `kind` Use at `iso`. */
export function useAt(kind: UseKind, iso: string): Use {
  return { kind, instant: DateTime.makeUnsafe(iso) };
}

// The Library embeds the Welcome banner, so its test host supplies the same sources.
import { Effect, Layer, Stream } from "effect";

import { NoteIndex } from "@/services/note-index/service";
import { makeWelcomeHost } from "@/views/welcome/__fixtures__";
import type { WelcomeHostOptions } from "@/views/welcome/__fixtures__";

export const makeLibraryHost = <R = never>(
  options: WelcomeHostOptions<R> = {},
) =>
  makeWelcomeHost({
    ...options,
    services: Layer.mergeAll(
      Layer.mock(NoteIndex, {
        getIndexedItemKeys: Effect.succeed([]),
        changes: Stream.empty,
        whenIndexed: Effect.void,
      }),
      options.services ?? Layer.empty,
    ),
  });
