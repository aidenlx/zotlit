// View atoms over ZoteroReads. Read through `@/lib/view-atoms`.
import { Effect, Stream } from "effect";
import type * as Atom from "effect/reactivity/Atom";

import { held } from "@/lib/view-atoms";

import { changed } from "./events";
import { ZoteroReads } from "./service";

/**
 * How many times the Zotero database changed this session. A view atom that
 * reads Zotero data reads this too, so a change reads its data again.
 */
export const zoteroRevisionAtom: Atom.Atom<number> = held(
  Stream.unwrap(
    Effect.gen(function* () {
      return Stream.scan(
        changed(yield* ZoteroReads),
        () => 0,
        (revision) => revision + 1,
      );
    }),
  ),
  0,
);

/** Whether the current database can answer a read. */
export const zoteroReadyAtom = held(
  Stream.unwrap(
    Effect.map(ZoteroReads, (reads) =>
      Stream.map(reads.changes, (state) => state.state === "ready"),
    ),
  ),
  false,
);
