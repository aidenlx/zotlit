import {
  collectionItems,
  itemData,
  itemDataValues,
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
  count,
  or,
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
import { annotationTypeIDs, annotationTypeToName } from "@/lib/zt-annot";
import { annotationColorsForName } from "@/lib/zt-color";

import { storedNumberOf, storedIntegerOf } from "./candidate-set";
import type { CandidateLeaf } from "./candidate-set";
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

const universeSlots = idSlots(SCAN_PAGE_SIZE);
const universeRows = defineStatement<
  Record<IdSlot, number | null> & { libraryID: number }
>("annotation-universe-rows")((db, { placeholder }) =>
  selectAnnotations(db)
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
    ...universeSlots.bind(chunk.itemIDs),
  });
}

const slots = idSlots(HYDRATE_CHUNK_SIZE);
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

export type AnnotationCandidateLeaf =
  | { readonly kind: "parent"; readonly leaf: CandidateLeaf }
  | { readonly kind: "type"; readonly value: string }
  | { readonly kind: "color"; readonly value: string }
  | { readonly kind: "tag"; readonly value: string }
  | {
      readonly kind: "selector";
      readonly target: "item" | "attachment";
      readonly keys: readonly string[];
    };

const annotationCount = defineStatement<{ libraryID: number }>(
  "annotation-row-count",
)((db, { placeholder }) =>
  db.select({ rows: count() }).from(
    selectAnnotations(db)
      .where(
        and(eq(items.libraryID, placeholder("libraryID")), ...universe(db)),
      )
      .as("annotationUniverse"),
  ),
);
export const readAnnotationRowCount = (libraryID: number) =>
  Effect.map(annotationCount.all({ libraryID }), (rows) => rows[0]?.rows ?? 0);

interface AnnotationCandidateParams extends Record<string, unknown> {
  libraryID: number;
  limit: number;
  value: string;
  list: string;
  number: number | null;
  integer: bigint | null;
}

const annotationCandidates = (
  kind:
    | "type"
    | "color"
    | "tag"
    | "item"
    | "attachment"
    | "parent-tag"
    | "parent-key"
    | "parent-field"
    | "parent-collection",
) =>
  defineStatement<AnnotationCandidateParams>("annotation-candidate-set")(
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
        type: sql`case ${itemAnnotations.type} ${sql.join(
          annotationTypeIDs().map(
            (type) => sql`when ${type} then ${annotationTypeToName(type)}`,
          ),
          sql` `,
        )} else 'unknown' end = ${p("value")}`,
        color: or(
          eq(itemAnnotations.color, p("value")),
          sql`upper(${itemAnnotations.color}) in (${list})`,
        ),
        tag: tagged(items.itemID),
        item: sql`${parent.key} in (${list})`,
        attachment: sql`${attachment.key} in (${list})`,
        "parent-tag": tagged(parent.itemID),
        "parent-key": eq(parent.key, p("value")),
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
        .from(itemAnnotations)
        .innerJoin(items, eq(items.itemID, itemAnnotations.itemID))
        .innerJoin(
          itemAttachments,
          eq(itemAttachments.itemID, itemAnnotations.parentItemID),
        )
        .innerJoin(attachment, eq(attachment.itemID, itemAttachments.itemID))
        .innerJoin(parent, eq(parent.itemID, itemAttachments.parentItemID))
        .where(and(eq(unindexed(items.libraryID), p("libraryID")), condition))
        .limit(p("limit"));
    },
  );
const annotationCandidateStatements = {
  type: annotationCandidates("type"),
  color: annotationCandidates("color"),
  tag: annotationCandidates("tag"),
  item: annotationCandidates("item"),
  attachment: annotationCandidates("attachment"),
  "parent-tag": annotationCandidates("parent-tag"),
  "parent-key": annotationCandidates("parent-key"),
  "parent-field": annotationCandidates("parent-field"),
  "parent-collection": annotationCandidates("parent-collection"),
};

/** Parent leaves expand to Annotation IDs before the cap is applied. */
export function readAnnotationCandidateSet({
  libraryID,
  leaf,
  limit,
}: {
  libraryID: number;
  leaf: AnnotationCandidateLeaf;
  limit: number;
}) {
  let value = "";
  let list: readonly (number | string)[] = [];
  let kind: keyof typeof annotationCandidateStatements;
  if (leaf.kind === "parent") {
    kind = `parent-${leaf.leaf.kind}`;
    switch (leaf.leaf.kind) {
      case "tag":
        value = leaf.leaf.name;
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
  } else if (leaf.kind === "selector") {
    kind = leaf.target;
    list = leaf.keys;
  } else {
    kind = leaf.kind;
    value = leaf.value;
    if (kind === "color") list = annotationColorsForName(value);
  }
  return Effect.map(
    annotationCandidateStatements[kind].all({
      libraryID,
      limit,
      value,
      list: JSON.stringify(list),
      number: storedNumberOf(value),
      integer: storedIntegerOf(value),
    }),
    (rows) => rows.map((row) => row.itemID),
  );
}
