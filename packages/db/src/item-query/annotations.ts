import {
  collectionItems,
  itemData,
  itemDataValues,
  deletedItems,
  fieldsCombined,
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

const attachment = alias(items, "annotationAttachment");
const parent = alias(items, "annotationParent");

/** An Annotation identity and the parent values needed for reading order. */
export interface AnnotationScanRow extends ScanRow {
  libraryID: number;
  attachmentID: number;
  attachmentKey: string;
  attachmentDateAdded: number | null;
  attachmentDateModified: number | null;
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
      libraryID: items.libraryID,
      attachmentID: attachment.itemID,
      attachmentKey: attachment.key,
      attachmentDateAdded: sql<
        number | null
      >`unixepoch(${attachment.dateAdded}) * 1000`,
      attachmentDateModified: sql<
        number | null
      >`unixepoch(${attachment.dateModified}) * 1000`,
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
/** A Relation List uses the same universe as Annotation Query. */
const relationStatement = (level: "item" | "attachment") =>
  defineStatement<Record<IdSlot, number | null>>(
    level === "item" ? "item-annotations" : "attachment-annotations",
  )((db, { placeholder }) =>
    selectAnnotations(db)
      .where(
        and(
          inArray(
            level === "item" ? parent.itemID : attachment.itemID,
            slots.names.map((name) => placeholder(name)),
          ),
          ...universe(db),
        ),
      )
      .orderBy(
        asc(attachment.key),
        asc(itemAnnotations.sortIndex),
        asc(items.key),
      ),
  );
const itemAnnotationsStatement = relationStatement("item");
const attachmentAnnotationsStatement = relationStatement("attachment");

export function readItemAnnotations(itemIDs: readonly number[]) {
  if (itemIDs.length > HYDRATE_CHUNK_SIZE)
    return Effect.die(
      new RangeError("A relation chunk holds at most 250 parent IDs."),
    );
  return itemIDs.length
    ? itemAnnotationsStatement.all(slots.bind(itemIDs))
    : Effect.succeed([] as AnnotationScanRow[]);
}

export function readAttachmentAnnotations(itemIDs: readonly number[]) {
  if (itemIDs.length > HYDRATE_CHUNK_SIZE)
    return Effect.die(
      new RangeError("A relation chunk holds at most 250 parent IDs."),
    );
  return itemIDs.length
    ? attachmentAnnotationsStatement.all(slots.bind(itemIDs))
    : Effect.succeed([] as AnnotationScanRow[]);
}

const details = defineStatement<Record<IdSlot, number | null>>(
  "annotation-details",
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
  "annotation-tags",
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
const attachmentTitles = defineStatement<Record<IdSlot, number | null>>(
  "annotation-attachment-titles",
)((db, { placeholder }) =>
  db
    .select({
      itemID: itemData.itemID,
      title: sql<string | number | null>`${itemDataValues.value}`,
    })
    .from(itemData)
    .innerJoin(itemDataValues, eq(itemDataValues.valueID, itemData.valueID))
    .innerJoin(fieldsCombined, eq(fieldsCombined.fieldID, itemData.fieldID))
    .where(
      and(
        inArray(
          itemData.itemID,
          slots.names.map((name) => placeholder(name)),
        ),
        eq(fieldsCombined.fieldName, "title"),
        eq(fieldsCombined.custom, 0),
      ),
    ),
);

/** The values of one Annotation row and its Attachment. */
export type AnnotationDetails = Effect.Success<
  ReturnType<typeof details.all>
>[number] & {
  readonly attachment: { readonly parentItemID: number };
};

/**
 * The loaded values of one Annotation. A load is present when the request
 * named it.
 */
export interface HydratedAnnotation {
  readonly details?: AnnotationDetails;
  /** The Tag names of the Annotation, in no defined order. */
  readonly tags?: readonly string[];
  /** The title of the Annotation's Attachment. */
  readonly attachmentTitle?: string | null;
}

/**
 * Load the values of at most {@link HYDRATE_CHUNK_SIZE} Annotation rows that
 * the query needs. Every row has an entry. Each named load runs one statement
 * for the chunk; the parent Item loads through the Item hydrate reader.
 */
export function readAnnotationHydrateChunk(chunk: {
  rows: readonly AnnotationScanRow[];
  /** The Annotation values and the Attachment metadata. */
  details?: boolean;
  /** The Tag names of each Annotation. */
  tags?: boolean;
  /** The title of each Annotation's Attachment. */
  attachmentTitle?: boolean;
}): Effect.Effect<
  ReadonlyMap<number, HydratedAnnotation>,
  ItemQueryReaderError,
  ItemQueryDatabase
> {
  const { rows } = chunk;
  if (rows.length > HYDRATE_CHUNK_SIZE)
    return Effect.die(
      new RangeError(
        `An Annotation hydrate chunk holds at most ${HYDRATE_CHUNK_SIZE} rows.`,
      ),
    );
  return Effect.gen(function* () {
    const result = new Map<
      number,
      {
        details?: AnnotationDetails;
        tags?: string[];
        attachmentTitle?: string | null;
      }
    >();
    for (const row of rows) {
      result.set(row.itemID, {
        ...(chunk.tags ? { tags: [] } : {}),
        ...(chunk.attachmentTitle ? { attachmentTitle: null } : {}),
      });
    }
    if (!rows.length) return result;
    const bound = slots.bind(rows.map((row) => row.itemID));
    if (chunk.details) {
      const found = yield* details.all(bound);
      const parentOf = new Map(rows.map((row) => [row.itemID, row.parent]));
      for (const row of found) {
        result.get(row.itemID)!.details = {
          ...row,
          attachment: {
            ...row.attachment,
            parentItemID: parentOf.get(row.itemID)!.itemID,
          },
        };
      }
    }
    if (chunk.tags) {
      for (const row of yield* annotationTags.all(bound)) {
        result.get(row.itemID)!.tags!.push(row.name);
      }
    }
    if (chunk.attachmentTitle) {
      const titles = new Map(
        (yield* attachmentTitles.all(
          slots.bind([...new Set(rows.map((row) => row.attachmentID))]),
        )).map((row) => [
          row.itemID,
          row.title === null ? null : String(row.title),
        ]),
      );
      for (const row of rows) {
        result.get(row.itemID)!.attachmentTitle =
          titles.get(row.attachmentID) ?? null;
      }
    }
    return result;
  });
}

export type AnnotationCandidateLeaf =
  | ParentCandidateLeaf<CandidateLeaf>
  | { readonly kind: "type"; readonly value: string }
  | { readonly kind: "color"; readonly value: string }
  | TagCandidateLeaf
  | (KeysCandidateLeaf & { readonly target: "self" | "item" | "attachment" });

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
  afterItemID: number;
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
    | "self"
    | "item"
    | "attachment"
    | "parent-tag"
    | "parent-key"
    | "parent-keys"
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
        self: sql`${items.key} in (${list})`,
        item: sql`${parent.key} in (${list})`,
        attachment: sql`${attachment.key} in (${list})`,
        "parent-tag": tagged(parent.itemID),
        "parent-keys": sql`${parent.key} in (${list})`,
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
        .where(
          and(
            eq(unindexed(items.libraryID), p("libraryID")),
            gt(items.itemID, p("afterItemID")),
            condition,
          ),
        )
        .orderBy(items.itemID)
        .limit(p("limit"));
    },
  );
const annotationCandidateStatements = {
  type: annotationCandidates("type"),
  color: annotationCandidates("color"),
  tag: annotationCandidates("tag"),
  self: annotationCandidates("self"),
  item: annotationCandidates("item"),
  attachment: annotationCandidates("attachment"),
  "parent-tag": annotationCandidates("parent-tag"),
  "parent-keys": annotationCandidates("parent-keys"),
  "parent-key": annotationCandidates("parent-key"),
  "parent-field": annotationCandidates("parent-field"),
  "parent-collection": annotationCandidates("parent-collection"),
};

/** Parent leaves expand to Annotation IDs before the cap is applied. */
export function readAnnotationCandidateSet({
  libraryID,
  leaf,
  limit,
  afterItemID = 0,
}: {
  libraryID: number;
  leaf: AnnotationCandidateLeaf;
  limit: number;
  afterItemID?: number;
}) {
  let value = "";
  let list: readonly (number | string)[] = [];
  let kind: keyof typeof annotationCandidateStatements;
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
