import {
  collectionItems,
  itemData,
  itemDataValues,
  deletedItems,
  fieldsCombined,
  itemAttachments,
  items,
  itemTypesCombined,
  itemTags,
  tags,
} from "@drizzle/schema";
import {
  and,
  or,
  count,
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

import type {
  TagCandidateLeaf,
  KeysCandidateLeaf,
  ParentCandidateLeaf,
} from "./candidate-leaf";
import { storedNumberOf, storedIntegerOf } from "./candidate-set";
import type { CandidateLeaf } from "./candidate-set";
import { defineStatement, idSlots, unindexed } from "./database";
import type {
  IdSlot,
  ItemQueryDatabase,
  ItemQueryReaderError,
} from "./database";
import { HYDRATE_CHUNK_SIZE } from "./hydrate-chunk";
import { SCAN_PAGE_SIZE } from "./scan-page";
import type { ScanRow } from "./scan-page";

const parent = alias(items, "attachmentParent");

/** An Attachment identity and the parent values needed for reading order. */
export interface AttachmentScanRow extends ScanRow {
  libraryID: number;
  parent: ScanRow;
}

function selectAttachments(db: NodeDatabaseClient) {
  return db
    .select({
      itemID: items.itemID,
      key: items.key,
      itemType: sql<string>`'attachment'`,
      dateAdded: sql<number | null>`unixepoch(${items.dateAdded}) * 1000`,
      dateModified: sql<number | null>`unixepoch(${items.dateModified}) * 1000`,
      libraryID: items.libraryID,
      parent: {
        itemID: parent.itemID,
        key: parent.key,
        itemType: itemTypesCombined.typeName,
        dateAdded: sql<number | null>`unixepoch(${parent.dateAdded}) * 1000`,
        dateModified: sql<
          number | null
        >`unixepoch(${parent.dateModified}) * 1000`,
      },
    })
    .from(items)
    .innerJoin(itemAttachments, eq(itemAttachments.itemID, items.itemID))
    .innerJoin(parent, eq(parent.itemID, itemAttachments.parentItemID))
    .innerJoin(
      itemTypesCombined,
      eq(itemTypesCombined.itemTypeID, parent.itemTypeID),
    );
}

function universe(db: NodeDatabaseClient) {
  return [
    notInArray(itemTypesCombined.typeName, [...CHILD_ITEM_TYPES]),
    inArray(itemAttachments.linkMode, [0, 1, 2, 3]),
    ...[items, parent].map((table) =>
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
}>("attachment-scan-page")((db, { placeholder }) =>
  selectAttachments(db)
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

export function readAttachmentScanPage(page: {
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

const universeSlots = idSlots(SCAN_PAGE_SIZE);
const universeRows = defineStatement<
  Record<IdSlot, number | null> & { libraryID: number }
>("attachment-universe-rows")((db, { placeholder }) =>
  selectAttachments(db)
    .where(
      and(
        eq(unindexed(items.libraryID), placeholder("libraryID")),
        inArray(
          items.itemID,
          universeSlots.names.map((name) => placeholder(name)),
        ),
        ...universe(db),
      ),
    )
    .orderBy(asc(items.key)),
);

export function readAttachmentUniverseRows(chunk: {
  libraryID: number;
  itemIDs: readonly number[];
}) {
  if (chunk.itemIDs.length > SCAN_PAGE_SIZE)
    return Effect.die(
      new RangeError("An Attachment universe chunk holds at most 500 IDs."),
    );
  if (!chunk.itemIDs.length) return Effect.succeed([] as AttachmentScanRow[]);
  return universeRows.all({
    libraryID: chunk.libraryID,
    ...universeSlots.bind(chunk.itemIDs),
  });
}

const slots = idSlots(HYDRATE_CHUNK_SIZE);
/** The live Attachments of a chunk of parent Items, in Attachment key order. */
const itemAttachmentsStatement = defineStatement<Record<IdSlot, number | null>>(
  "item-attachments",
)((db, { placeholder }) =>
  selectAttachments(db)
    .where(
      and(
        inArray(
          parent.itemID,
          slots.names.map((name) => placeholder(name)),
        ),
        ...universe(db),
      ),
    )
    .orderBy(asc(items.key)),
);

export function readItemAttachments(itemIDs: readonly number[]) {
  if (itemIDs.length > HYDRATE_CHUNK_SIZE)
    return Effect.die(
      new RangeError("A relation chunk holds at most 250 parent IDs."),
    );
  return itemIDs.length
    ? itemAttachmentsStatement.all(slots.bind(itemIDs))
    : Effect.succeed([] as AttachmentScanRow[]);
}

const titleData = alias(itemData, "attachmentTitleData");
const titleValue = alias(itemDataValues, "attachmentTitleValue");
const urlData = alias(itemData, "attachmentUrlData");
const urlValue = alias(itemDataValues, "attachmentUrlValue");
const details = defineStatement<Record<IdSlot, number | null>>(
  "attachment-details",
)((db, { placeholder }) => {
  const fieldID = (name: string) =>
    db
      .select({ fieldID: fieldsCombined.fieldID })
      .from(fieldsCombined)
      .where(
        and(eq(fieldsCombined.fieldName, name), eq(fieldsCombined.custom, 0)),
      );
  return db
    .select({
      itemID: items.itemID,
      key: items.key,
      libraryID: items.libraryID,
      parentItemID: itemAttachments.parentItemID,
      linkMode: itemAttachments.linkMode,
      path: itemAttachments.path,
      contentType: itemAttachments.contentType,
      dateAdded: items.dateAdded,
      dateModified: items.dateModified,
      title: sql<string | number | null>`${titleValue.value}`,
      url: sql<string | number | null>`${urlValue.value}`,
    })
    .from(itemAttachments)
    .innerJoin(items, eq(items.itemID, itemAttachments.itemID))
    .leftJoin(
      titleData,
      and(
        eq(titleData.itemID, items.itemID),
        inArray(titleData.fieldID, fieldID("title")),
      ),
    )
    .leftJoin(titleValue, eq(titleValue.valueID, titleData.valueID))
    .leftJoin(
      urlData,
      and(
        eq(urlData.itemID, items.itemID),
        inArray(urlData.fieldID, fieldID("url")),
      ),
    )
    .leftJoin(urlValue, eq(urlValue.valueID, urlData.valueID))
    .where(
      inArray(
        items.itemID,
        slots.names.map((name) => placeholder(name)),
      ),
    );
});
const attachmentTags = defineStatement<Record<IdSlot, number | null>>(
  "attachment-tags",
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
export type AttachmentDetails = Effect.Success<
  ReturnType<typeof details.all>
>[number] & { readonly parentItemID: number };
export interface HydratedAttachment {
  readonly details?: AttachmentDetails;
  readonly tags?: readonly string[];
}

/** Each requested read is one statement for the chunk. */
export function readAttachmentHydrateChunk(chunk: {
  rows: readonly AttachmentScanRow[];
  details?: boolean;
  tags?: boolean;
}): Effect.Effect<
  ReadonlyMap<number, HydratedAttachment>,
  ItemQueryReaderError,
  ItemQueryDatabase
> {
  if (chunk.rows.length > HYDRATE_CHUNK_SIZE)
    return Effect.die(
      new RangeError("An Attachment hydrate chunk holds at most 250 rows."),
    );
  return Effect.gen(function* () {
    const result = new Map<
      number,
      { details?: AttachmentDetails; tags?: string[] }
    >();
    for (const row of chunk.rows)
      result.set(row.itemID, chunk.tags ? { tags: [] } : {});
    if (!chunk.rows.length) return result;
    const bound = slots.bind(chunk.rows.map((row) => row.itemID));
    if (chunk.details) {
      for (const row of yield* details.all(bound)) {
        if (row.parentItemID !== null)
          result.get(row.itemID)!.details = {
            ...row,
            parentItemID: row.parentItemID,
          };
      }
    }
    if (chunk.tags) {
      for (const row of yield* attachmentTags.all(bound))
        result.get(row.itemID)!.tags!.push(row.name);
    }
    return result;
  });
}
const attachmentCount = defineStatement<{ libraryID: number }>(
  "attachment-row-count",
)((db, { placeholder }) =>
  db.select({ rows: count() }).from(
    selectAttachments(db)
      .where(
        and(eq(items.libraryID, placeholder("libraryID")), ...universe(db)),
      )
      .as("attachmentUniverse"),
  ),
);
export const readAttachmentRowCount = (libraryID: number) =>
  Effect.map(attachmentCount.all({ libraryID }), (rows) => rows[0]?.rows ?? 0);

export type AttachmentCandidateLeaf =
  | KeysCandidateLeaf
  | ParentCandidateLeaf<CandidateLeaf>
  | {
      readonly kind: "key" | "contentType" | "linkMode" | "fileType";
      readonly value: string;
    }
  | TagCandidateLeaf;

interface AttachmentCandidateParams extends Record<string, unknown> {
  libraryID: number;
  afterItemID: number;
  limit: number;
  value: string;
  list: string;
  number: number | null;
  integer: bigint | null;
}

const attachmentCandidates = (
  kind:
    | "key"
    | "keys"
    | "contentType"
    | "fileType"
    | "linkMode"
    | "tag"
    | "parent-tag"
    | "parent-key"
    | "parent-keys"
    | "parent-field"
    | "parent-collection",
) =>
  defineStatement<AttachmentCandidateParams>("attachment-candidate-set")(
    (db, { placeholder: p }) => {
      const list = sql`select value from json_each(${p("list")})`;
      const tagged = (id: typeof items.itemID | typeof parent.itemID) =>
        inArray(
          id,
          db
            .select({ itemID: itemTags.itemID })
            .from(itemTags)
            .innerJoin(tags, eq(tags.tagID, itemTags.tagID))
            .where(eq(tags.name, p("value"))),
        );
      const condition = {
        key: eq(items.key, p("value")),
        keys: sql`${items.key} in (${list})`,
        contentType: eq(itemAttachments.contentType, p("value")),
        fileType: sql`case
          when ${itemAttachments.linkMode} = 3 then 'web'
          when ${itemAttachments.contentType} = 'application/pdf' then 'pdf'
          when ${itemAttachments.contentType} = 'application/epub+zip' then 'epub'
          when ${itemAttachments.contentType} in ('text/html', 'application/xhtml+xml') then 'web'
          else 'other' end = ${p("value")}`,

        linkMode: sql`case ${itemAttachments.linkMode} when 0 then 'imported_file' when 1 then 'imported_url' when 2 then 'linked_file' when 3 then 'linked_url' end = ${p("value")}`,
        tag: tagged(items.itemID),
        "parent-tag": tagged(parent.itemID),
        "parent-key": eq(parent.key, p("value")),
        "parent-keys": sql`${parent.key} in (${list})`,
        "parent-field": inArray(
          parent.itemID,
          db
            .select({ itemID: itemData.itemID })
            .from(itemDataValues)
            .innerJoin(
              itemData,
              eq(itemData.valueID, unindexed(itemDataValues.valueID)),
            )
            .where(
              and(
                or(
                  eq(itemDataValues.value, p("value")),
                  eq(itemDataValues.value, p("number")),
                  eq(itemDataValues.value, p("integer")),
                ),
                sql`${unindexed(itemData.fieldID)} in (${list})`,
              ),
            ),
        ),
        "parent-collection": inArray(
          parent.itemID,
          db
            .select({ itemID: collectionItems.itemID })
            .from(collectionItems)
            .where(sql`${collectionItems.collectionID} in (${list})`),
        ),
      }[kind];
      return db
        .select({ itemID: items.itemID })
        .from(itemAttachments)
        .innerJoin(items, eq(items.itemID, itemAttachments.itemID))
        .innerJoin(parent, eq(parent.itemID, itemAttachments.parentItemID))
        .innerJoin(
          itemTypesCombined,
          eq(itemTypesCombined.itemTypeID, parent.itemTypeID),
        )
        .where(
          and(
            eq(unindexed(items.libraryID), p("libraryID")),
            gt(items.itemID, p("afterItemID")),
            condition,
            ...(kind.startsWith("parent-") ? universe(db) : []),
          ),
        )
        .orderBy(items.itemID)
        .limit(p("limit"));
    },
  );
const attachmentCandidateStatements = {
  key: attachmentCandidates("key"),
  keys: attachmentCandidates("keys"),
  contentType: attachmentCandidates("contentType"),
  fileType: attachmentCandidates("fileType"),
  linkMode: attachmentCandidates("linkMode"),
  tag: attachmentCandidates("tag"),
  "parent-tag": attachmentCandidates("parent-tag"),
  "parent-key": attachmentCandidates("parent-key"),
  "parent-keys": attachmentCandidates("parent-keys"),
  "parent-field": attachmentCandidates("parent-field"),
  "parent-collection": attachmentCandidates("parent-collection"),
};

/** Parent leaves expand to Attachment IDs before the cap is applied. */
export function readAttachmentCandidateSet({
  libraryID,
  leaf,
  limit,
  afterItemID = 0,
}: {
  libraryID: number;
  leaf: AttachmentCandidateLeaf;
  limit: number;
  afterItemID?: number;
}) {
  let value = "";
  let list: readonly (number | string)[] = [];
  let kind: keyof typeof attachmentCandidateStatements;
  if (leaf.kind === "parent") {
    kind = `parent-${leaf.leaf.kind}`;
    switch (leaf.leaf.kind) {
      case "tag":
        value = leaf.leaf.value;
        break;
      case "keys":
        list = leaf.leaf.keys;
        break;
      case "key":
        value = leaf.leaf.key;
        break;
      case "field":
        value = leaf.leaf.value;
        list = leaf.leaf.fieldIDs;
        break;
      case "collection":
        list = leaf.leaf.collectionIDs;
        break;
    }
  } else if (leaf.kind === "keys") {
    kind = "keys";
    list = leaf.keys;
  } else {
    kind = leaf.kind;
    value = leaf.value;
  }
  return Effect.map(
    attachmentCandidateStatements[kind].all({
      libraryID,
      afterItemID,
      limit,
      value,
      list: JSON.stringify(list),
      number: storedNumberOf(value),
      integer: storedIntegerOf(value),
    }),
    (rows) => rows.map((row) => row.itemID),
  );
}
