import {
  deletedItems,
  itemAnnotations,
  itemAttachments,
  items,
  itemTypesCombined,
  itemTags,
  tags,
} from "@drizzle/schema";
import {
  and,
  asc,
  eq,
  gt,
  inArray,
  notExists,
  notInArray,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { Effect } from "effect";

import type { NodeDatabaseClient } from "@/client/node";
import { CHILD_ITEM_TYPES } from "@/lib/item-types";

import { defineStatement, idSlots, unindexed } from "./database";
import type { IdSlot } from "./database";
import { HYDRATE_CHUNK_SIZE, readHydrateChunk } from "./hydrate-chunk";
import { SCAN_PAGE_SIZE } from "./scan-page";
import type { ScanRow } from "./scan-page";

const attachment = alias(items, "annotationAttachment");
const parent = alias(items, "annotationParent");

/** An Annotation identity and the parent values needed for reading order. */
export interface AnnotationScanRow extends ScanRow {
  attachmentID: number;
  attachmentKey: string;
  parent: ScanRow;
  sortIndex: string;
}

function selectAnnotations(db: NodeDatabaseClient) {
  return db
    .select({
      itemID: items.itemID,
      key: items.key,
      itemType: sql<string>`'annotation'`,
      dateAdded: sql<number | null>`unixepoch(${items.dateAdded}) * 1000`,
      dateModified: sql<number | null>`unixepoch(${items.dateModified}) * 1000`,
      attachmentID: attachment.itemID,
      attachmentKey: attachment.key,
      parent: {
        itemID: parent.itemID,
        key: parent.key,
        itemType: itemTypesCombined.typeName,
        dateAdded: sql<number | null>`unixepoch(${parent.dateAdded}) * 1000`,
        dateModified: sql<
          number | null
        >`unixepoch(${parent.dateModified}) * 1000`,
      },
      sortIndex: itemAnnotations.sortIndex,
    })
    .from(items)
    .innerJoin(itemAnnotations, eq(itemAnnotations.itemID, items.itemID))
    .innerJoin(
      itemAttachments,
      eq(itemAttachments.itemID, itemAnnotations.parentItemID),
    )
    .innerJoin(attachment, eq(attachment.itemID, itemAttachments.itemID))
    .innerJoin(parent, eq(parent.itemID, itemAttachments.parentItemID))
    .innerJoin(
      itemTypesCombined,
      eq(itemTypesCombined.itemTypeID, parent.itemTypeID),
    );
}

function universe(db: NodeDatabaseClient) {
  return [
    notInArray(itemTypesCombined.typeName, [...CHILD_ITEM_TYPES]),
    ...[items, attachment, parent].map((table) =>
      notExists(
        db
          .select({ itemID: deletedItems.itemID })
          .from(deletedItems)
          .where(eq(deletedItems.itemID, table.itemID)),
      ),
    ),
  ];
}

const scan = defineStatement<{
  libraryID: number;
  afterKey: string;
  limit: number;
}>("annotation-scan-page")((db, { placeholder }) =>
  selectAnnotations(db)
    .where(
      and(
        eq(items.libraryID, placeholder("libraryID")),
        gt(items.key, placeholder("afterKey")),
        ...universe(db),
      ),
    )
    .orderBy(asc(items.key))
    .limit(placeholder("limit")),
);

export function readAnnotationScanPage(page: {
  libraryID: number;
  afterKey: string | null;
  size?: number;
}) {
  return scan.all({
    libraryID: page.libraryID,
    afterKey: page.afterKey ?? "",
    limit: Math.min(page.size ?? SCAN_PAGE_SIZE, SCAN_PAGE_SIZE),
  });
}

const slots = idSlots(HYDRATE_CHUNK_SIZE);
const universeRows = defineStatement<
  Record<IdSlot, number | null> & { libraryID: number }
>("annotation-universe-rows")((db, { placeholder }) =>
  selectAnnotations(db)
    .where(
      and(
        eq(unindexed(items.libraryID), placeholder("libraryID")),
        inArray(
          items.itemID,
          slots.names.map((name) => placeholder(name)),
        ),
        ...universe(db),
      ),
    )
    .orderBy(asc(items.key)),
);

export function readAnnotationUniverseRows(chunk: {
  libraryID: number;
  itemIDs: readonly number[];
}) {
  if (chunk.itemIDs.length > SCAN_PAGE_SIZE)
    return Effect.die(
      new RangeError("An Annotation universe chunk holds at most 500 IDs."),
    );
  if (!chunk.itemIDs.length) return Effect.succeed([] as AnnotationScanRow[]);
  return universeRows.all({
    libraryID: chunk.libraryID,
    ...slots.bind(chunk.itemIDs),
  });
}

const details = defineStatement<Record<IdSlot, number | null>>(
  "annotation-hydrate-chunk",
)((db, { placeholder }) =>
  db
    .select({
      itemID: itemAnnotations.itemID,
      type: itemAnnotations.type,
      text: itemAnnotations.text,
      comment: itemAnnotations.comment,
      color: itemAnnotations.color,
      pageLabel: itemAnnotations.pageLabel,
      authorName: itemAnnotations.authorName,
      // Read as text: a corrupt position must not make the whole query fail.
      position: sql<string>`${itemAnnotations.position}`,
      attachment: {
        itemID: attachment.itemID,
        key: attachment.key,
        libraryID: attachment.libraryID,
        parentItemID: itemAttachments.parentItemID,
        linkMode: itemAttachments.linkMode,
        path: itemAttachments.path,
        contentType: itemAttachments.contentType,
        dateAdded: attachment.dateAdded,
        dateModified: attachment.dateModified,
      },
    })
    .from(itemAnnotations)
    .innerJoin(
      itemAttachments,
      eq(itemAttachments.itemID, itemAnnotations.parentItemID),
    )
    .innerJoin(attachment, eq(attachment.itemID, itemAttachments.itemID))
    .where(
      inArray(
        itemAnnotations.itemID,
        slots.names.map((name) => placeholder(name)),
      ),
    ),
);
const annotationTags = defineStatement<Record<IdSlot, number | null>>(
  "annotation-hydrate-chunk",
)((db, { placeholder }) =>
  db
    .select({ itemID: itemTags.itemID, name: tags.name })
    .from(itemTags)
    .innerJoin(tags, eq(tags.tagID, itemTags.tagID))
    .where(
      inArray(
        itemTags.itemID,
        slots.names.map((name) => placeholder(name)),
      ),
    ),
);

/** Load annotation text and Tags, Attachment metadata, and requested parent fields. */
export const readAnnotationHydrateChunk = Effect.fnUntraced(function* (
  chunk: Omit<Parameters<typeof readHydrateChunk>[0], "itemIDs"> & {
    rows: readonly AnnotationScanRow[];
  },
) {
  if (chunk.rows.length > HYDRATE_CHUNK_SIZE)
    return yield* Effect.die(
      new RangeError("An Annotation hydrate chunk holds at most 500 rows."),
    );
  const bound = slots.bind(chunk.rows.map((row) => row.itemID));
  const rows = chunk.rows.length ? yield* details.all(bound) : [];
  const tagRows = chunk.rows.length ? yield* annotationTags.all(bound) : [];
  const parents = yield* readHydrateChunk({
    ...chunk,
    itemIDs: [...new Set(chunk.rows.map((row) => row.parent.itemID))],
  });
  const attachments = yield* readHydrateChunk({
    vocabulary: chunk.vocabulary,
    fields: { builtIn: ["title"], custom: [] },
    itemIDs: [...new Set(chunk.rows.map((row) => row.attachmentID))],
  });
  const byID = new Map(chunk.rows.map((row) => [row.itemID, row]));
  const tagsByID = new Map<number, string[]>();
  for (const row of tagRows) {
    const names = tagsByID.get(row.itemID) ?? [];
    names.push(row.name);
    tagsByID.set(row.itemID, names);
  }
  return new Map(
    rows.map((row) => [
      row.itemID,
      {
        ...row,
        tags: tagsByID.get(row.itemID) ?? [],
        attachment: {
          ...row.attachment,
          parentItemID: byID.get(row.itemID)!.parent.itemID,
          title:
            attachments.get(row.attachment.itemID)?.fields.get("title") ?? null,
        },
        parent: parents.get(byID.get(row.itemID)!.parent.itemID)!,
      },
    ]),
  );
});

export type HydratedAnnotation =
  Effect.Success<
    ReturnType<typeof readAnnotationHydrateChunk>
  > extends ReadonlyMap<number, infer A>
    ? A
    : never;
