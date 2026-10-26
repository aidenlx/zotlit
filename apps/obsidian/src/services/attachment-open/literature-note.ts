// Resolves a Literature Note's Indexed Key to its Item's PDF Attachments, over the Zotero database.
import { Effect } from "effect";

import { recover } from "@/lib/effect-cause";
import { withLogCategory } from "@/lib/effect-log";
import { ObsidianEnv } from "@/lib/obsidian-env";
import { ZoteroPref } from "@/services/zotero-pref/service";
import { ZoteroReads } from "@/services/zotero-reads/service";

import { toObsidianOpenable } from "./openable";
import type { ObsidianOpenableAttachment } from "./resolve";

/** The services {@link literatureNoteAttachments} reads. */
export type LiteratureNoteServices = ZoteroReads | ZoteroPref | ObsidianEnv;

/**
 * Resolve a Literature Note's Indexed Key to its Item's Obsidian-Openable PDF
 * Attachments — shared by the `open-pdf` command, the file menu, the Quick
 * Switcher's PDF chords, and the Library View's PDF open, so a key→itemID
 * lookup is written once.
 *
 * Both reads share one Snapshot, so a database swap between them cannot pair
 * an itemID with another database's Attachments.
 *
 * @returns no Attachments while the database cannot be read.
 */
export function literatureNoteAttachments(
  indexedKey: string,
): Effect.Effect<ObsidianOpenableAttachment[], never, LiteratureNoteServices> {
  return Effect.gen(function* () {
    const reads = yield* (yield* ZoteroReads).snapshot;
    const items = yield* reads.ItemsByIndexedKeys({
      indexedKeys: [indexedKey],
    });
    const itemID = items.get(indexedKey)?.itemID;
    if (itemID === undefined) return [];
    const attachments = yield* reads.AttachmentsOf({ itemIDs: [itemID] });
    return toObsidianOpenable(attachments, {
      vaultBasePath: (yield* ObsidianEnv).basePath,
      zoteroPref: yield* (yield* ZoteroPref).current,
    });
  }).pipe(
    Effect.scoped,
    recover(
      (cause) =>
        Effect.logWarning(
          "Literature Note Attachments unavailable",
          cause,
        ).pipe(Effect.annotateLogs({ indexedKey })),
      Effect.succeed([]),
    ),
    withLogCategory("attachment-open"),
  );
}
