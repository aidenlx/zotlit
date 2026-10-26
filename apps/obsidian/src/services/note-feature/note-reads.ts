// The reads that the Note Feature write and creation groups share: an Item, a note's Profile, a Profile's template.
import { Effect } from "effect";

import type { Item } from "@zotlit/db";

import type { NoteProfile, ResolvedProfile } from "@/services/profile/bindings";
import { Template } from "@/services/template/service";
import type { ZoteroReadsApi } from "@/services/zotero-reads/service";

/** The Profile a note moves from: none for an unresolved Profile stamp. */
function relocationSource(current: NoteProfile): ResolvedProfile | undefined {
  return current.ok ? current.profile : undefined;
}

/** The live Item an Indexed Key names, or `undefined` when none does. */
function readItem(reads: ZoteroReadsApi, indexedKey: string) {
  return reads
    .ItemsByIndexedKeys({ indexedKeys: [indexedKey] })
    .pipe(Effect.map((items): Item | undefined => items.get(indexedKey)));
}

/**
 * The Profile's document: `undefined` for one that names none, `null` for
 * one whose document Template is missing.
 */
const resolveProfileDocument = Effect.fnUntraced(function* (
  profile: ResolvedProfile,
) {
  if (profile.document === undefined) return undefined;
  const template = yield* Template;
  return (yield* template.getLiteratureNoteTemplate(profile.document)) ?? null;
});

export { readItem, relocationSource, resolveProfileDocument };
