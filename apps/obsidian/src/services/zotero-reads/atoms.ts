// View atoms over ZoteroReads. Read through `@/lib/view-atoms`.
import { Effect, Stream } from "effect";
import * as Atom from "effect/reactivity/Atom";

import { held } from "@/lib/view-atoms";

import { changed } from "./events";
import type { ZoteroReadsState } from "./service";
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

/** The current database condition, including a missing file found during startup. */
export const zoteroStateAtom: Atom.Atom<ZoteroReadsState> =
  held<ZoteroReadsState>(
    Stream.unwrap(Effect.map(ZoteroReads, (reads) => reads.changes)),
    {
      state: "loading",
      error: null,
      moved: false,
      dbFileMissing: false,
      activeReadMode: null,
    },
  );

/** Whether the database is unavailable to a view, including a failed move. */
export const zoteroUnavailableAtom = Atom.map(
  zoteroStateAtom,
  (state) =>
    state.state === "degraded" || (state.error !== null && state.moved),
);

/** Changes that require a tree to discard its database data. */
export const zoteroTreeUnavailableAtom = Atom.map(
  zoteroStateAtom,
  (state) => state.state === "degraded" || state.dbFileMissing,
);

/** A source became unreadable, so an open query must show its diagnostic. */
export const zoteroQueryUnavailableRevisionAtom = held(
  Stream.unwrap(
    Effect.map(ZoteroReads, (reads) =>
      reads.events.pipe(
        Stream.filter(
          (event) =>
            event._tag === "degraded" || event._tag === "db-file-missing",
        ),
        Stream.scan(
          () => 0,
          (revision) => revision + 1,
        ),
      ),
    ),
  ),
  0,
);
