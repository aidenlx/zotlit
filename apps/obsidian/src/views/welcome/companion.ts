// Whether Zotero lists ZotLit Companion as installed, re-read when the researcher may have installed it.
import { Effect, Stream } from "effect";

import { held } from "@/lib/view-atoms";
import { ZoteroPref } from "@/services/zotero-pref/service";
import { ZoteroReads } from "@/services/zotero-reads/service";

/** Zotero may write its add-on list after Obsidian starts: retry briefly. */
const RETRY_SECONDS = [0, 1, 2, 4, 8];

/**
 * Each trigger reads the add-on list, then retries until it lists the
 * Companion; a later trigger replaces an earlier retry. The triggers are the
 * reader returning to Obsidian from Zotero and a change of the Zotero
 * profile or of its database.
 */
export const companionInstalledAtom = held(
  Stream.unwrap(
    Effect.gen(function* () {
      const pref = yield* ZoteroPref;
      const reads = yield* ZoteroReads;
      const triggers = Stream.mergeAll(
        [
          Stream.make(undefined),
          Stream.drop(pref.changes, 1),
          Stream.filter(reads.events, (event) => event._tag === "changed"),
          Stream.fromEventListener(window, "focus"),
        ],
        { concurrency: "unbounded" },
      );
      return Stream.switchMap(triggers, () =>
        Stream.fromIterable(RETRY_SECONDS).pipe(
          Stream.mapEffect((seconds) =>
            Effect.andThen(
              Effect.sleep(`${seconds} seconds`),
              pref.companionInstalled,
            ),
          ),
          Stream.takeUntil((installed) => installed),
        ),
      );
    }),
  ),
  false,
);
