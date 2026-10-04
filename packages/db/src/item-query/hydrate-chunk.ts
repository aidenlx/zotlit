import {
  baseFieldMappingsCombined,
  fieldsCombined,
  itemData,
  itemDataValues,
  items,
} from "@drizzle/schema";
import { and, eq, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { Effect } from "effect";

import { buildTable } from "@/queries/_base-fields";
import type { BaseFieldTable } from "@/queries/_base-fields";

import { defineStatement } from "./database";
import type { ItemQueryDatabase, ItemQueryReaderError } from "./database";

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

/** The loaded values of one Item. A field with no value has no entry. */
export interface HydratedItem {
  /** Values by requested built-in name, as strings. */
  readonly fields: ReadonlyMap<string, string>;
  /** Values by custom field name, as strings. */
  readonly custom: ReadonlyMap<string, string>;
}

const fieldsStatement = defineStatement<Record<string, never>>()((db) =>
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

const baseFieldMappingsStatement = defineStatement<Record<string, never>>()(
  (db) =>
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
      const aliasRows = mappings.map((row) => ({
        itemTypeID: row.itemTypeID,
        fieldID: row.fieldID,
        baseField: { fieldName: row.baseFieldName },
      }));
      const tables = new Map<string, BaseFieldTable<string>>();
      return {
        customFieldNames: custom.map((row) => row.fieldName),
        builtInID: new Map(builtIn.map((row) => [row.fieldName, row.fieldID])),
        customID: new Map(custom.map((row) => [row.fieldName, row.fieldID])),
        tableOf: (name: string) => {
          let table = tables.get(name);
          if (!table) {
            table = buildTable(builtIn, aliasRows, [name]);
            tables.set(name, table);
          }
          return table;
        },
      };
    });
  });
}

const ID_SLOTS = Array.from(
  { length: HYDRATE_CHUNK_SIZE },
  (_, i) => `id${i}` as const,
);

const fieldValuesStatement = defineStatement<
  Record<string, number | string | null>
>()((db, { placeholder }) =>
  db
    .select({
      itemID: itemData.itemID,
      itemTypeID: items.itemTypeID,
      fieldID: itemData.fieldID,
      value: itemDataValues.value,
    })
    .from(itemData)
    .innerJoin(items, eq(items.itemID, itemData.itemID))
    .innerJoin(itemDataValues, eq(itemDataValues.valueID, itemData.valueID))
    .where(
      and(
        inArray(
          itemData.itemID,
          ID_SLOTS.map((slot) => placeholder(slot)),
        ),
        sql`${itemData.fieldID} in (select value from json_each(${placeholder("fieldIDs")}))`,
      ),
    ),
);

/**
 * Load the field values of at most {@link HYDRATE_CHUNK_SIZE} Items, restricted
 * to the fields the query needs. Every requested Item has an entry. A value is
 * a string whether SQLite stores it as text or as a number.
 */
export function readHydrateChunk(chunk: {
  vocabulary: FieldVocabulary;
  itemIDs: readonly number[];
  fields: HydrateFields;
}): Effect.Effect<
  ReadonlyMap<number, HydratedItem>,
  ItemQueryReaderError,
  ItemQueryDatabase
> {
  const { vocabulary, itemIDs, fields } = chunk;
  if (itemIDs.length > HYDRATE_CHUNK_SIZE) {
    return Effect.die(
      new RangeError(
        `A hydrate chunk holds at most ${HYDRATE_CHUNK_SIZE} Items, not ${itemIDs.length}.`,
      ),
    );
  }
  return Effect.gen(function* () {
    const result = new Map<
      number,
      { fields: Map<string, string>; custom: Map<string, string> }
    >();
    for (const id of itemIDs) {
      result.set(id, { fields: new Map(), custom: new Map() });
    }

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
    if (itemIDs.length === 0 || fieldIDs.size === 0) return result;

    const params: Record<string, number | string | null> = {
      fieldIDs: JSON.stringify([...fieldIDs]),
    };
    for (const [i, slot] of ID_SLOTS.entries())
      params[slot] = itemIDs[i] ?? null;
    const rows = yield* fieldValuesStatement.all(params);

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
    return result;
  });
}
