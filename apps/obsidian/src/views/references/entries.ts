// One document's reference list: cited Items, the engine's bibliography, and document order.

import { type CslItemData } from "@zotlit/db";

import {
  type Citation,
  type CitationOccurrence,
} from "@/services/citation-scan/service";

/** One cited Zotero Item, in the identities the sidebar's entry actions use. */
export interface ReferenceSource {
  /** The item as the engine reads it; its `id` addresses the rendered entry. */
  csl: CslItemData;
  /** `Creators (Year): Title` from the shared item-summary rendering. */
  summary: string;
  /** Bare Zotero item key, for the `zotero://select` action. */
  itemKey: string;
  /** Zotero `itemID`, the parent the attachment read looks under. */
  itemID: number;
  /** Group library ID, or `null` for the personal library. */
  groupID: number | null;
}

interface ReferenceEntryBase {
  /** Indexed Key of the cited Item — the entry's identity across re-renders. */
  indexedKey: string;
  /** Reference Number the scanner assigned by first occurrence. */
  refNumber: number;
  /** Linkpath of the cited Literature Note, for the open-note action. */
  linkpath: string;
  occurrences: readonly CitationOccurrence[];
}

/**
 * One reference as the sidebar shows it. The engine's absence is a normal mode,
 * so a `summary` entry is ordinary content rather than a degraded one; a
 * `missing` entry keeps a citation whose Item vanished visible.
 */
export type ReferenceEntry = ReferenceEntryBase &
  (
    | { kind: "rendered"; source: ReferenceSource; html: string }
    | { kind: "summary"; source: ReferenceSource }
    | { kind: "missing" }
  );

/**
 * Assemble the reference list of one document.
 *
 * The list follows the scanner's document order and keeps its Reference
 * Numbers, so the engine's own bibliography order never reaches the sidebar.
 *
 * @param sources cited Items by Indexed Key; an Item the database no longer
 *   holds is simply absent, and its citation becomes a `missing` entry.
 * @param rendered bibliography entries by CSL `id`; omit it, or leave an id
 *   out, to fall back to the minimal reference list.
 */
export function buildReferenceEntries(
  citations: readonly Citation[],
  sources: ReadonlyMap<string, ReferenceSource>,
  rendered?: ReadonlyMap<string, string>,
): ReferenceEntry[] {
  return citations.map(({ indexedKey, refNumber, linkpath, occurrences }) => {
    const base = { indexedKey, refNumber, linkpath, occurrences };
    const source = sources.get(indexedKey);
    if (!source) return { ...base, kind: "missing" };
    const html = rendered?.get(source.csl.id);
    return html === undefined
      ? { ...base, kind: "summary", source }
      : { ...base, kind: "rendered", source, html };
  });
}
