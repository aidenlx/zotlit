// View atoms over the Citation Index: the live Cited By of an Item. Read
// through `@/lib/view-atoms`.
import { Effect, Option, Stream } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";

import { held, viewRuntime } from "@/lib/view-atoms";
import { CitationIndex } from "@/services/citation-index/service";
import type { CitedBySnapshot } from "@/services/citation-index/service";
import { activeKeyAtom } from "@/services/note-index/atoms";

import { CitationLookup } from "./lookup-service";

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

/** The lookup publication, including an equal-revision recovery after failure. */
export const citationLookupStateAtom = held(
  Stream.unwrap(Effect.map(CitationLookup, (lookup) => lookup.changes)),
  { status: "pending", revision: null, stopped: false },
);

/** Document and membership changes; readers select only their own path. */
export const documentRevisionsAtom = held(
  Stream.unwrap(
    Effect.map(CitationIndex, (index) =>
      Stream.scan(
        index.events,
        (): Readonly<Record<string, number>> => ({}),
        (revisions, event) => {
          const path =
            event.type === "changed"
              ? event.path
              : event.type === "membership-changed"
                ? "*"
                : null;
          return path === null
            ? revisions
            : { ...revisions, [path]: (revisions[path] ?? 0) + 1 };
        },
      ),
    ),
  ),
  {},
);
