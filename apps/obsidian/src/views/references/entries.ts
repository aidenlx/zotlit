// One document's reference list: cited Items, the engine's bibliography, and document order.

import { type Attachment, type CslItemData } from "@zotlit/db";
import { parseAttachmentPath } from "@zotlit/db/path";

import {
  type Citation,
  type CitationOccurrence,
} from "@/services/citation-scan/service";

/** One Attachment the entry offers to open in Zotero's reader. */
export interface OpenableAttachment {
  /** Bare Zotero key of the Attachment itself, for `zotero://open`. */
  key: string;
  /** Group library ID, or `null` for the personal library. */
  groupID: number | null;
  /** Filename, which names the row when an Item carries several. */
  label: string;
}

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
  /** Openable Attachments of the Item, in library order; empty hides the action. */
  attachments: readonly OpenableAttachment[];
}

/**
 * Narrow an Item's Attachments to the ones Zotero's reader can be sent to, and
 * name each by its filename.
 *
 * An Attachment qualifies when its path names a file: the stored modes and both
 * linked-file forms. A bare web link carries no file, and a row whose path does
 * not parse names none either, so neither is offered.
 */
export function toOpenableAttachments(
  attachments: readonly Attachment[],
): OpenableAttachment[] {
  const openable: OpenableAttachment[] = [];
  for (const { key, groupID, path, linkMode } of attachments) {
    const parsed = parseAttachmentPath(path, linkMode, key);
    switch (parsed.kind) {
      case "storage":
        openable.push({ key, groupID, label: parsed.filename });
        break;
      case "linked-absolute":
        openable.push({ key, groupID, label: filename(parsed.path) });
        break;
      case "linked-base":
        openable.push({ key, groupID, label: filename(parsed.relative) });
        break;
      case "linked-url":
      case "unknown":
        break;
    }
  }
  return openable;
}

/**
 * Last segment of a linked-file path, cut at either separator. A path a group
 * library synced from another platform carries that platform's flavor, so the
 * host's own separator alone would leave the whole path as the label.
 */
function filename(path: string): string {
  return path.split(/[/\\]/).pop() ?? path;
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
    | { kind: "rendered"; source: ReferenceSource; content: DocumentFragment }
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
  rendered?: ReadonlyMap<string, DocumentFragment>,
): ReferenceEntry[] {
  return citations.map(({ indexedKey, refNumber, linkpath, occurrences }) => {
    const base = { indexedKey, refNumber, linkpath, occurrences };
    const source = sources.get(indexedKey);
    if (!source) return { ...base, kind: "missing" };
    const content = rendered?.get(source.csl.id);
    return content === undefined
      ? { ...base, kind: "summary", source }
      : { ...base, kind: "rendered", source, content };
  });
}
