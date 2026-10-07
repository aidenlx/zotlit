import {
  baseFieldMappingsCombined,
  collectionItems,
  creators,
  creatorTypes,
  deletedItems,
  fieldsCombined,
  itemAttachments,
  itemCreators,
  itemData,
  itemDataValues,
  items,
  itemTags,
  tags,
} from "@drizzle/schema";
import { and, asc, eq, inArray, notExists, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { Effect } from "effect";

import type { CreatorFieldMode } from "@/lib/zt-creator";
import type { TagType } from "@/lib/zt-tag";
import { buildTable } from "@/queries/_base-fields";
import type { BaseFieldTable } from "@/queries/_base-fields";

import type { CollectionPaths } from "./collection-paths";
import { defineStatement, idSlots } from "./database";
import type {
  IdSlot,
  ItemQueryDatabase,
  ItemQueryReaderError,
} from "./database";

/** The Items one hydrate statement reads at most. */
export const HYDRATE_CHUNK_SIZE = 250;

/**
 * The fields of the source: built-in fields, custom fields, and Zotero's
 * base-field mapping. Read it once for each query with
 * {@link readFieldVocabulary}.
 */
export interface FieldVocabulary {
  /** Exact source names of the custom fields (`fieldsCombined.custom = 1`). */
  readonly customFieldNames: readonly string[];
  /**
   * Every field ID that stores a value of one built-in field: the field itself
   * and each type-specific field that aliases it. Empty for an unknown name.
   */
  readonly fieldIDsOf: (name: string) => readonly number[];
  /** @internal The base-field table of one built-in field name. */
  readonly tableOf: (name: string) => BaseFieldTable<string>;
  /** @internal */
  readonly builtInID: ReadonlyMap<string, number>;
  /** @internal */
  readonly customID: ReadonlyMap<string, number>;
}

/** The field values a query needs, by name. */
export interface HydrateFields {
  /**
   * Built-in field names. A base field resolves through the type-specific field
   * of each Item's type (`publicationTitle` reads `bookTitle` of a book section);
   * when an Item stores both, the type-specific field wins.
   */
  readonly builtIn: readonly string[];
  /** Exact source names of custom fields. */
  readonly custom: readonly string[];
}

/** A relation of an Item that the hydrate reader can load. */
export type HydrateRelation =
  | "creators"
  | "tags"
  | "collections"
  | "attachments";

/** One `itemCreators` row of an Item, with its creator and creator type. */
export interface HydratedCreator {
  /** Empty for a one-field (institutional) name. */
  readonly firstName: string;
  /** The complete name of a one-field creator. */
  readonly lastName: string;
  /** Raw `creators.fieldMode`; resolve it with `creatorFieldModeToName`. */
  readonly fieldMode: CreatorFieldMode;
  /** Zotero creator type: `"author"`, `"editor"`, … */
  readonly creatorType: string;
}

/** One `itemTags` row of an Item. */
export interface HydratedTag {
  readonly name: string;
  /** Raw `itemTags.type`; resolve it with `tagTypeToName`. */
  readonly type: TagType;
}

/**
 * The loaded values of one Item. A field with no value has no entry. A
 * relation is present when the request named it.
 */
export interface HydratedItem {
  /** Values by requested built-in name, as strings. */
  readonly fields: ReadonlyMap<string, string>;
  /** Values by custom field name, as strings. */
  readonly custom: ReadonlyMap<string, string>;
  /** One element for each `itemCreators` row, in Zotero's creator order. */
  readonly creators?: readonly HydratedCreator[];
  /** One element for each `itemTags` row, in no defined order. */
  readonly tags?: readonly HydratedTag[];
  /**
   * The root-first name path of each live Collection the Item is filed in
   * directly, in no defined order. See {@link readCollectionPaths}.
   */
  readonly collections?: readonly (readonly string[])[];
  /** The Item has at least one non-trashed child Attachment. */
  readonly hasAttachments?: boolean;
}

const fieldsStatement = defineStatement<Record<string, never>>(
  "field-vocabulary",
)((db) =>
  db
    .select({
      fieldID: fieldsCombined.fieldID,
      fieldName: fieldsCombined.fieldName,
      custom: fieldsCombined.custom,
    })
    .from(fieldsCombined)
    .orderBy(fieldsCombined.fieldID),
);

const baseField = alias(fieldsCombined, "baseField");

const baseFieldMappingsStatement = defineStatement<Record<string, never>>(
  "field-vocabulary",
)((db) =>
  db
    .select({
      itemTypeID: baseFieldMappingsCombined.itemTypeID,
      fieldID: baseFieldMappingsCombined.fieldID,
      baseFieldName: baseField.fieldName,
    })
    .from(baseFieldMappingsCombined)
    .innerJoin(
      baseField,
      eq(baseField.fieldID, baseFieldMappingsCombined.baseFieldID),
    ),
);

/**
 * Read the field vocabulary of the source: its custom fields and the base-field
 * mapping that resolves built-in field names for each item type.
 */
export function readFieldVocabulary(): Effect.Effect<
  FieldVocabulary,
  ItemQueryReaderError,
  ItemQueryDatabase
> {
  return Effect.gen(function* () {
    const fields = yield* fieldsStatement.all({});
    const mappings = yield* baseFieldMappingsStatement.all({});
    return yield* Effect.sync(() => {
      const builtIn = fields.filter((row) => row.custom === 0);
      const custom = fields.filter((row) => row.custom !== 0);
      const tables = new Map<string, BaseFieldTable<string>>();
      /**
       * The table of one built-in field, from the mapping rows of that field
       * alone: its field IDs are the field and the fields that alias it.
       */
      const tableOf = (name: string) => {
        let table = tables.get(name);
        if (!table) {
          table = buildTable(
            builtIn,
            mappings
              .filter((row) => row.baseFieldName === name)
              .map((row) => ({
                itemTypeID: row.itemTypeID,
                fieldID: row.fieldID,
                baseField: { fieldName: name },
              })),
            [name],
          );
          tables.set(name, table);
        }
        return table;
      };
      return {
        customFieldNames: custom.map((row) => row.fieldName),
        fieldIDsOf: (name: string) => tableOf(name).fieldIDs,
        builtInID: new Map(builtIn.map((row) => [row.fieldName, row.fieldID])),
        customID: new Map(custom.map((row) => [row.fieldName, row.fieldID])),
        tableOf,
      };
    });
  });
}

const ID_SLOTS = idSlots(HYDRATE_CHUNK_SIZE);

/** The values of one Item while the reader loads them. */
interface LoadingItem {
  fields: Map<string, string>;
  custom: Map<string, string>;
  creators?: HydratedCreator[];
  tags?: HydratedTag[];
  collections?: (readonly string[])[];
  hasAttachments?: boolean;
}

const fieldValuesStatement = defineStatement<
  Record<string, number | string | null>
>("hydrate-chunk")((db, { placeholder }) =>
  db
    .select({
      itemID: itemData.itemID,
      itemTypeID: items.itemTypeID,
      fieldID: itemData.fieldID,
      // SQLite INTEGER has 64 bits; node:sqlite otherwise converts it to a
      // Number before hydration can preserve it as text. REAL keeps the
      // existing JavaScript string form (for example, 1.0 becomes "1").
      value: sql<
        string | number | null
      >`case typeof(${itemDataValues.value}) when 'integer' then cast(${itemDataValues.value} as text) else ${itemDataValues.value} end`,
    })
    .from(itemData)
    .innerJoin(items, eq(items.itemID, itemData.itemID))
    .innerJoin(itemDataValues, eq(itemDataValues.valueID, itemData.valueID))
    .where(
      and(
        inArray(
          itemData.itemID,
          ID_SLOTS.names.map((slot) => placeholder(slot)),
        ),
        sql`${itemData.fieldID} in (select value from json_each(${placeholder("fieldIDs")}))`,
      ),
    ),
);

const creatorsStatement = defineStatement<Record<IdSlot, number | null>>(
  "hydrate-chunk",
)((db, { placeholder }) =>
  db
    .select({
      itemID: itemCreators.itemID,
      firstName: creators.firstName,
      lastName: creators.lastName,
      fieldMode: creators.fieldMode,
      creatorType: creatorTypes.creatorType,
    })
    .from(itemCreators)
    .innerJoin(creators, eq(creators.creatorID, itemCreators.creatorID))
    .innerJoin(
      creatorTypes,
      eq(creatorTypes.creatorTypeID, itemCreators.creatorTypeID),
    )
    .where(
      inArray(
        itemCreators.itemID,
        ID_SLOTS.names.map((slot) => placeholder(slot)),
      ),
    )
    .orderBy(asc(itemCreators.itemID), asc(itemCreators.orderIndex)),
);

const tagsStatement = defineStatement<Record<IdSlot, number | null>>(
  "hydrate-chunk",
)((db, { placeholder }) =>
  db
    .select({ itemID: itemTags.itemID, name: tags.name, type: itemTags.type })
    .from(itemTags)
    .innerJoin(tags, eq(tags.tagID, itemTags.tagID))
    .where(
      inArray(
        itemTags.itemID,
        ID_SLOTS.names.map((slot) => placeholder(slot)),
      ),
    ),
);

const membershipsStatement = defineStatement<Record<IdSlot, number | null>>(
  "hydrate-chunk",
)((db, { placeholder }) =>
  db
    .select({
      itemID: collectionItems.itemID,
      collectionID: collectionItems.collectionID,
    })
    .from(collectionItems)
    .where(
      inArray(
        collectionItems.itemID,
        ID_SLOTS.names.map((slot) => placeholder(slot)),
      ),
    ),
);

const attachmentParentsStatement = defineStatement<
  Record<IdSlot, number | null>
>("hydrate-chunk")((db, { placeholder }) =>
  db
    .selectDistinct({ itemID: itemAttachments.parentItemID })
    .from(itemAttachments)
    .where(
      and(
        inArray(
          itemAttachments.parentItemID,
          ID_SLOTS.names.map((slot) => placeholder(slot)),
        ),
        notExists(
          db
            .select({ itemID: deletedItems.itemID })
            .from(deletedItems)
            .where(eq(deletedItems.itemID, itemAttachments.itemID)),
        ),
      ),
    ),
);

/**
 * Load the field values and relations of at most {@link HYDRATE_CHUNK_SIZE}
 * Items, restricted to the fields and relations the query needs. Every
 * requested Item has an entry. A value is a string whether SQLite stores it as
 * text or as a number. A requested relation that an Item lacks is an empty
 * list, or `false` for Attachment presence.
 */
export function readHydrateChunk(chunk: {
  vocabulary: FieldVocabulary;
  itemIDs: readonly number[];
  fields: HydrateFields;
  /** The relations to load. Each one runs one statement for the chunk. */
  relations?: readonly HydrateRelation[];
  /**
   * The Collection paths of the Library, from {@link readCollectionPaths}.
   * Required when `relations` names `"collections"`.
   */
  collectionPaths?: CollectionPaths;
}): Effect.Effect<
  ReadonlyMap<number, HydratedItem>,
  ItemQueryReaderError,
  ItemQueryDatabase
> {
  const { vocabulary, itemIDs, fields, relations = [] } = chunk;
  if (itemIDs.length > HYDRATE_CHUNK_SIZE) {
    return Effect.die(
      new RangeError(
        `A hydrate chunk holds at most ${HYDRATE_CHUNK_SIZE} Items, not ${itemIDs.length}.`,
      ),
    );
  }
  return Effect.gen(function* () {
    const result = new Map<number, LoadingItem>();
    for (const id of itemIDs) {
      const item: LoadingItem = { fields: new Map(), custom: new Map() };
      if (relations.includes("creators")) item.creators = [];
      if (relations.includes("tags")) item.tags = [];
      if (relations.includes("collections")) item.collections = [];
      if (relations.includes("attachments")) item.hasAttachments = false;
      result.set(id, item);
    }
    if (itemIDs.length === 0) return result;
    const slots = ID_SLOTS.bind(itemIDs);

    const tables = fields.builtIn.map(
      (name) => [name, vocabulary.tableOf(name)] as const,
    );
    const customByID = new Map<number, string>();
    for (const name of fields.custom) {
      const id = vocabulary.customID.get(name);
      if (id !== undefined) customByID.set(id, name);
    }
    const fieldIDs = new Set<number>(customByID.keys());
    for (const [, table] of tables) {
      for (const id of table.fieldIDs) fieldIDs.add(id);
    }
    if (fieldIDs.size > 0) {
      const rows = yield* fieldValuesStatement.all({
        ...slots,
        fieldIDs: JSON.stringify([...fieldIDs]),
      });
      yield* Effect.sync(() => {
        for (const row of rows) {
          const item = result.get(row.itemID!);
          if (!item || row.fieldID === null || row.value == null) continue;
          const value = String(row.value as unknown);
          const custom = customByID.get(row.fieldID);
          if (custom !== undefined) item.custom.set(custom, value);
          for (const [name, table] of tables) {
            if (table.resolve(row.itemTypeID, row.fieldID) !== name) continue;
            // The type-specific field of the item type wins over a stored value
            // of the base field itself.
            const isOwnField = vocabulary.builtInID.get(name) === row.fieldID;
            if (isOwnField && item.fields.has(name)) continue;
            item.fields.set(name, value);
          }
        }
      });
    }

    if (relations.includes("creators")) {
      const rows = yield* creatorsStatement.all(slots);
      yield* Effect.sync(() => {
        for (const { itemID, ...creator } of rows) {
          result.get(itemID)?.creators?.push({
            firstName: creator.firstName ?? "",
            lastName: creator.lastName ?? "",
            fieldMode: creator.fieldMode ?? 0,
            creatorType: creator.creatorType ?? "",
          });
        }
      });
    }

    if (relations.includes("tags")) {
      const rows = yield* tagsStatement.all(slots);
      yield* Effect.sync(() => {
        for (const { itemID, name, type } of rows) {
          result.get(itemID)?.tags?.push({ name, type });
        }
      });
    }

    if (relations.includes("collections")) {
      const paths = chunk.collectionPaths;
      if (!paths) {
        return yield* Effect.die(
          new TypeError("Loading collections needs the Collection paths."),
        );
      }
      const rows = yield* membershipsStatement.all(slots);
      yield* Effect.sync(() => {
        for (const { itemID, collectionID } of rows) {
          const path = paths.get(collectionID);
          if (path) result.get(itemID)?.collections?.push(path);
        }
      });
    }

    if (relations.includes("attachments")) {
      const rows = yield* attachmentParentsStatement.all(slots);
      yield* Effect.sync(() => {
        for (const { itemID } of rows) {
          const item = itemID === null ? undefined : result.get(itemID);
          if (item) item.hasAttachments = true;
        }
      });
    }
    return result;
  });
}
