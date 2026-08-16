// The blocks one hovered citation shows: its works' bibliography entries, in the order the citation names them.

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

export type CitationPopoverBlock = CitationEntryBlock | UnresolvedCitationBlock;

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
 */
export function citationPopoverBlocks(
  works: readonly HoveredWork[],
  entries: readonly ReferenceEntry[],
  { serials }: { serials: boolean },
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
      // reads as the same broken citation an unresolved citekey is.
      default:
        return { kind: "unresolved", citekey };
    }
  });
}
