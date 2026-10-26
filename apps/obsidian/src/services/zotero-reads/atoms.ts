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

export const zoteroStateAtom = held(
  Stream.unwrap(
    Effect.map(ZoteroReads, (service) =>
      Stream.map(service.changes, (state) => state.state),
    ),
  ),
  "loading" as "loading" | "ready" | "degraded",
);
