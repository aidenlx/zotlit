// The reads that the Note Feature write and creation groups share: an Item, a note's Profile, a Profile's template.
import { Effect } from "effect";

import type { Item } from "@zotlit/db";

import type { NoteProfile, ResolvedProfile } from "@/services/profile/bindings";
import type { ResolvedLiteratureNoteTemplate } from "@/services/template/service";
import type { ZoteroReadsApi } from "@/services/zotero-reads/service";

import type { NoteFeatureDeps } from "./context";

/** The Profile a note moves from: none for an unresolved Profile stamp. */
function relocationSource(current: NoteProfile): ResolvedProfile | undefined {
  return current.ok ? current.profile : undefined;
}

/** The live Item an Indexed Key names, or `undefined` when none does. */
async function readItem(
  reads: ZoteroReadsApi,
  indexedKey: string,
): Promise<Item | undefined> {
  const items = await Effect.runPromise(
    reads.ItemsByIndexedKeys({ indexedKeys: [indexedKey] }),
  );
  return items.values().next().value;
}

function resolveProfileDocument(
  ctx: NoteFeatureDeps,
  profile: ResolvedProfile,
): ResolvedLiteratureNoteTemplate | undefined | null {
  if (profile.document === undefined) return undefined;
  return ctx.template.getLiteratureNoteTemplate(profile.document) ?? null;
}

export { readItem, relocationSource, resolveProfileDocument };
