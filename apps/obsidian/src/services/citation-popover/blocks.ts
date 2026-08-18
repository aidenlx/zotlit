// The blocks one hovered citation shows: its works' bibliography entries, in the order the citation names them.

import type { AmbiguousCandidate } from "@/services/citation-index/ambiguity";
import type { OpenableAttachment } from "@/services/citation-index/service";
import type { HoveredWork } from "@/services/citekey-navigation";
import type { Inlines } from "@/services/pandoc/ast";
import type { ReferenceEntry } from "@/views/references/entries";

/** One cited work as the Citation Popover shows it, with what its actions need. */
export interface CitationEntryBlock {
  kind: "entry";
  /** The citekey the hovered citation writes this work as, which the open action names. */
  citekey: string;
  /** The style's Entry Marker, or `undefined` where the style writes none. */
  marker: Inlines | undefined;
  /** Entry Serial standing in for the marker, where the document's citations show serials. */
  serial: number | undefined;
  /** The formatted entry, or `null` where no bibliography formatted this work. */
  content: Inlines | null;
  /** `Creators (Year): Title`, which stands where no formatted entry does. */
  summary: string;
  /** Bare Zotero item key, for the `zotero://select` action. */
  itemKey: string;
  /** Group library ID, or `null` for the personal library. */
  groupID: number | null;
  /** Openable Attachments in library order; empty hides the action. */
  attachments: readonly OpenableAttachment[];
}

/** A citekey reaching no Zotero Item, which the popover explains and offers nothing on. */
export interface UnresolvedCitationBlock {
  kind: "unresolved";
  citekey: string;
}

/**
 * A citekey naming several Zotero Items, which the popover explains by the
 * candidates it names — the Ambiguous Citation Key state, told apart from a
 * key that reaches nothing at all.
 */
export interface AmbiguousCitationBlock {
  kind: "ambiguous";
  citekey: string;
  /** The Items the key names, in the order the resolution snapshot reports them. */
  candidates: readonly AmbiguousCandidate[];
}

export type CitationPopoverBlock =
  | CitationEntryBlock
  | UnresolvedCitationBlock
  | AmbiguousCitationBlock;

/**
 * The candidates one citekey names, or `null` for a key naming zero or one
 * Item — the read that tells an Ambiguous Citation Key from a missing one.
 */
export type AmbiguousCandidatesOf = (
  citekey: string,
) => readonly AmbiguousCandidate[] | null;

/**
 * The blocks one hovered citation stacks, in citation order.
 *
 * Each work reaches its entry by the Item it names — the identity the entry
 * list is built under, never the citekey spelling a document writes that Item
 * with. A work naming no Item names no entry either, which is the unresolved
 * block.
 *
 * @param works the works the hovered citation names, in the order it names
 *   them; each gets one block, so a citation none of whose works reaches an
 *   Item still stacks a block apiece.
 * @param entries the reference entries of the document the citation is written
 *   in, as the References Sidebar builds them.
 * @param serials whether that document's citations show Entry Serials, which is
 *   what puts a serial in the gutter of an entry the style wrote no marker for.
 * @param ambiguous the candidates a citekey naming several Items reaches, which
 *   is what an ambiguous block states in place of an entry.
 */
export function citationPopoverBlocks(
  works: readonly HoveredWork[],
  entries: readonly ReferenceEntry[],
  {
    serials,
    ambiguous,
  }: { serials: boolean; ambiguous: AmbiguousCandidatesOf },
): CitationPopoverBlock[] {
  const byItem = new Map(entries.map((entry) => [entry.id, entry]));
  return works.map(({ citekey, indexedKey }) => {
    const entry = indexedKey === undefined ? undefined : byItem.get(indexedKey);
    switch (entry?.kind) {
      case "rendered":
        return {
          kind: "entry",
          citekey,
          marker: entry.marker,
          serial: serials ? entry.serial : undefined,
          content: entry.content,
          summary: entry.source.summary,
          itemKey: entry.source.itemKey,
          groupID: entry.source.groupID,
          attachments: entry.source.attachments,
        };
      // The engine is absent, or it left this work out of a bibliography it
      // completed. The Item is still readable, so the actions all stand.
      case "summary":
      case "unrendered":
        return {
          kind: "entry",
          citekey,
          marker: undefined,
          serial: undefined,
          content: null,
          summary: entry.source.summary,
          itemKey: entry.source.itemKey,
          groupID: entry.source.groupID,
          attachments: entry.source.attachments,
        };
      // An Item the database no longer holds reaches no action either, so it
      // reads as the same broken citation an unresolved citekey is — unless
      // the key names several Items, which the candidates say for themselves.
      default: {
        const candidates = ambiguous(citekey);
        return candidates === null
          ? { kind: "unresolved", citekey }
          : { kind: "ambiguous", citekey, candidates };
      }
    }
  });
}
