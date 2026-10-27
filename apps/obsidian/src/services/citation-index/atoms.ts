// View atoms over the Citation Index: the live Cited By of an Item. Read
// through `@/lib/view-atoms`.
import { Effect, Option, Stream } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";

import { viewRuntime } from "@/lib/view-atoms";
import { CitationIndex } from "@/services/citation-index/service";
import type { CitedBySnapshot } from "@/services/citation-index/service";
import { activeKeyAtom } from "@/services/note-index/atoms";

const citedBy = (key: string) =>
  Stream.unwrap(
    Effect.gen(function* () {
      return (yield* CitationIndex).citedBy(key);
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
