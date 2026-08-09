// One document's reference list: cited Items, the engine's bibliography, and the order the list reads in.

import type { Attachment, CslItemData } from "@zotlit/db";
import { parseAttachmentPath } from "@zotlit/db/path";

import type {
  Citation,
  CitationOccurrence,
  DocumentCitationError,
} from "@/services/citation-index/service";

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

/**
 * One bibliography entry as the engine formatted it — the shape the engine's
 * own entry contract carries, without the CSL id that addresses it.
 */
export interface RenderedReference {
  /** The style's Entry Marker, or `undefined` when the style renders none. */
  marker: string | undefined;
  /** The entry text as one inline flow, so the occurrence counter sits after it. */
  content: DocumentFragment;
}

export interface ReferenceBibliography {
  /** Entries already formatted, in the style's bibliography order. */
  entries: ReadonlyMap<string, RenderedReference>;
  /** Whether these entries are the completed answer for the current sources. */
  complete: boolean;
}

interface ReferenceEntryBase {
  /**
   * The entry's identity across re-renders: the Indexed Key of the cited Item,
   * or the raw citekey when no Literature Note carries it.
   */
  id: string;
  occurrences: readonly CitationOccurrence[];
}

interface NumberedReferenceEntryBase extends ReferenceEntryBase {
  /** Reference Number the index assigned by first occurrence. */
  refNumber: number;
}

/**
 * One reference as the sidebar shows it. The engine's absence is a normal mode,
 * so a `summary` entry is ordinary content rather than a degraded one; a
 * `missing` entry keeps a citation whose Item vanished visible, and an
 * `unresolved` entry does the same for a citekey that names no live Zotero
 * Item — Pandoc warns on an undefined citation rather than dropping it. An
 * `unrendered` entry keeps an Item a completed bibliography omitted as an
 * actionable Reference Error. A `rendered`, `summary`, or `unrendered` entry's
 * `linkpath` is `null` when its Item has no Literature Note yet, so the open
 * action creates one; a `missing` entry carries the same type, but `null` there
 * means the database could not read the Item at all, and the open action stays
 * disabled.
 */
type CitationReferenceEntry = NumberedReferenceEntryBase &
  (
    | ({
        kind: "rendered";
        source: ReferenceSource;
        linkpath: string | null;
      } & RenderedReference)
    | { kind: "summary"; source: ReferenceSource; linkpath: string | null }
    | { kind: "unrendered"; source: ReferenceSource; linkpath: string | null }
    | { kind: "missing"; linkpath: string | null }
    | { kind: "unresolved"; citekey: string }
  );

type MalformedReferenceEntry = ReferenceEntryBase & { kind: "malformed" };

export type ReferenceEntry = CitationReferenceEntry | MalformedReferenceEntry;

export interface ReferenceBuildOptions {
  bibliography?: ReferenceBibliography;
  /** Citation source errors that stay outside the CSL bibliography. */
  errors?: readonly DocumentCitationError[];
}

/**
 * Assemble the reference list of one document.
 *
 * A rendered entry takes its place from the bibliography, so the list reads in
 * the order the style itself sorts by. A reference the bibliography holds no
 * place for — an Item the database no longer holds, an id the engine did not
 * render — follows the ordered entries in first-occurrence order as a Reference
 * Error. That is also the order the whole list keeps when no bibliography is
 * passed at all, where source-backed entries are ordinary summaries.
 *
 * A citekey naming no live Zotero Item keeps its raw text and trails the
 * ordered entries with the rest, since the bibliography holds no place for a
 * work the library does not know.
 *
 * @param sources cited Items by Indexed Key; an Item the database no longer
 *   holds is simply absent, and its citation becomes a `missing` entry.
 * @param options rendered bibliography data and citation source errors. Omit
 *   the bibliography for the minimal reference list. A source-backed id becomes
 *   `unrendered` only when a completed bibliography leaves it out.
 */
export function buildReferenceEntries(
  citations: readonly Citation[],
  sources: ReadonlyMap<string, ReferenceSource>,
  options: ReferenceBuildOptions = {},
): ReferenceEntry[] {
  const { bibliography, errors = [] } = options;
  const placed = new Map<string, ReferenceEntry>();
  const trailing: ReferenceEntry[] = [];
  for (const { indexedKey, refNumber, linkpath, occurrences } of citations) {
    if (indexedKey === null) {
      // Every Citation carries an occurrence, and an unresolved one is written
      // as a citekey, so its raw text is what the row shows. The identity keeps
      // the `@` it is written with, which an Indexed Key never starts with.
      const citekey = occurrences[0]!.raw;
      trailing.push({
        id: `@${citekey}`,
        refNumber,
        occurrences,
        kind: "unresolved",
        citekey,
      });
      continue;
    }
    const base = { id: indexedKey, refNumber, linkpath, occurrences };
    const source = sources.get(indexedKey);
    if (!source) {
      trailing.push({ ...base, kind: "missing" });
      continue;
    }
    const entry = bibliography?.entries.get(source.csl.id);
    if (!entry) {
      trailing.push({
        ...base,
        kind: bibliography?.complete ? "unrendered" : "summary",
        source,
      });
      continue;
    }
    placed.set(source.csl.id, { ...base, kind: "rendered", source, ...entry });
  }

  for (const { occurrence } of errors) {
    trailing.push({
      id: `malformed:${occurrence.position.start.offset}`,
      occurrences: [occurrence],
      kind: "malformed",
    });
  }
  trailing.sort(
    (left, right) =>
      left.occurrences[0]!.position.start.offset -
      right.occurrences[0]!.position.start.offset,
  );

  const ordered: ReferenceEntry[] = [];
  for (const id of bibliography?.entries.keys() ?? []) {
    const entry = placed.get(id);
    if (entry) ordered.push(entry);
  }
  return [...ordered, ...trailing];
}
