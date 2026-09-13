// The source-join of a document's Citations: each cited Item read from the Zotero database, in the identities and summary a reference list reports.

import {
  getAttachmentsByParents,
  getItemsByKey,
  getZoteroIdentity,
  isChildItemFields,
  itemToCsl,
  resolveIndexedKeyLibrary,
} from "@zotlit/db";
import type { Attachment, CslItemData, Item } from "@zotlit/db";
import { parseAttachmentPath } from "@zotlit/db/path";

import { itemSummary } from "@/lib/item-summary";
import { getLogger } from "@/lib/log";
import type { DatabaseService } from "@/services/database/service";

import type { Citation } from "./query";

const logger = getLogger(["citation-index", "sources"]);

/** One Attachment the Item offers to open in Zotero's reader. */
export interface OpenableAttachment {
  /** Bare Zotero key of the Attachment itself, for `zotero://open`. */
  key: string;
  /** Group library ID, or `null` for the personal library. */
  groupID: number | null;
  /** Filename, which names the row when an Item carries several. */
  label: string;
}

/** Whether the Zotero database answered the source-join read. */
export type DatabaseReadability = "ready" | "unreadable";

/** The cited Items of one document, with the state that says what an Item the join left out means. */
export interface ReferenceSourceJoin {
  /** The readable sources by Indexed Key. */
  sources: Map<string, ReferenceSource>;
  /**
   * `"unreadable"` leaves `sources` empty or partial, so a caller reports the
   * state itself rather than the Items it never read as missing.
   */
  database: DatabaseReadability;
}

/** One cited Zotero Item, in the identities a reference entry reports and acts on. */
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
  /** The Item's citation key, or `null` when Zotero holds none for it. */
  citekey: string | null;
  /** Linkpath the Citation carries, or `null` when the Item has no Literature Note yet. */
  linkpath: string | null;
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
 * Read the cited Items of one document straight from the database, so a
 * reference list keeps working while Zotero is closed.
 *
 * An Item the library no longer holds is left out, and its Citation stays the
 * caller's to report as an error. A citekey that names no live Zotero Item
 * names nothing to read. Attachments come in one batched read, so a row knows
 * what it can open before the reader clicks; an unreadable attachment table
 * costs the open action alone, where letting it escape would empty the whole
 * answer and show every citation as a missing Item.
 *
 * @param citations the document's Citations, whose linkpath each source carries
 *   through so one call answers the whole identity of a reference entry.
 * @returns the readable sources by Indexed Key, beside the `database` state a
 *   caller reports rather than the Items it names as missing.
 */
export function readReferenceSources(
  db: Pick<DatabaseService, "state" | "client">,
  citations: readonly Citation[],
): ReferenceSourceJoin {
  const sources = new Map<string, ReferenceSource>();
  if (db.state !== "ready") return { sources, database: "unreadable" };
  if (citations.length === 0) return { sources, database: "ready" };

  try {
    const user = getZoteroIdentity(db.client);
    const cited: {
      indexedKey: string;
      linkpath: string | null;
      item: Item;
      summary: string;
      citekey: string | null;
    }[] = [];
    for (const { indexedKey, linkpath } of citations) {
      if (indexedKey === null) continue;
      const selector = resolveIndexedKeyLibrary(db.client, indexedKey);
      if (!selector) continue;
      const item = getItemsByKey(db.client, selector.libraryID, [
        selector.key,
      ])[0];
      if (!item) continue;
      const { fields } = item;
      if (isChildItemFields(fields)) continue;
      cited.push({
        indexedKey,
        linkpath,
        item,
        summary: itemSummary(item, fields).formatted,
        citekey: fields.citationKey ?? null,
      });
    }

    const attachments = new Map<number, OpenableAttachment[]>();
    try {
      const rows = getAttachmentsByParents(
        db.client,
        cited.map(({ item }) => item.itemID),
      );
      for (const [itemID, group] of Map.groupBy(
        rows,
        (row) => row.parentItemID,
      )) {
        attachments.set(itemID, toOpenableAttachments(group));
      }
    } catch (error) {
      logger.warn("Cannot read the attachments of the cited items", { error });
    }

    for (const { indexedKey, linkpath, item, summary, citekey } of cited) {
      sources.set(indexedKey, {
        csl: itemToCsl(item, user),
        summary,
        itemKey: item.key,
        itemID: item.itemID,
        groupID: item.groupID,
        citekey,
        linkpath,
        attachments: attachments.get(item.itemID) ?? [],
      });
    }
  } catch (error) {
    logger.warn("Cannot read the cited items", { error });
    return { sources, database: "unreadable" };
  }
  return { sources, database: "ready" };
}
