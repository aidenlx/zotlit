// View atoms over the Citation Index: the live Cited By of an Item. Read
// through `@/lib/view-atoms`.
import { Effect, Option, Queue, Stream } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";

import { viewRuntime } from "@/lib/view-atoms";
import { CitationIndex } from "@/services/citation-index/service";
import type { CitedBySnapshot } from "@/services/citation-index/service";
import { activeKeyAtom } from "@/services/note-index/atoms";

/** The Cited By of the Item `key`, live; interrupting it stops the observer. */
export const citedBy = (
  key: string,
): Stream.Stream<CitedBySnapshot, never, CitationIndex> =>
  Stream.callback<CitedBySnapshot>((queue) =>
    Effect.gen(function* () {
      const index = yield* CitationIndex;
      const stop = yield* index.observeCitedBy(key, (snapshot) => {
        Queue.offerUnsafe(queue, snapshot);
      });
      yield* Effect.addFinalizer(() => Effect.sync(stop));
    }),
  );

/**
 * The Cited By of one key; `null` until the first snapshot. An equal key
 * gives the same atom, so every leaf that reads a key shares one observer.
 */
export const citedByAtom = Atom.family(
  (key: string): Atom.Atom<CitedBySnapshot | null> =>
    Atom.map(viewRuntime.atom(citedBy(key)), (result) =>
      Option.getOrNull(AsyncResult.value(result)),
    ),
);

/**
 * The active note's Cited By, through the family; `null` with no key or no
 * snapshot yet. On a key change the old key's observer loses this reader and
 * stops once no other reader holds it.
 */
export const activeCitedByAtom: Atom.Atom<CitedBySnapshot | null> = Atom.make(
  (get) => {
    const key = get(activeKeyAtom);
    return key ? get(citedByAtom(key)) : null;
  },
);
