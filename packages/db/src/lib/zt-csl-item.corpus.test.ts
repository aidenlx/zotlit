// Differential coverage: Zotero's own corpus through storage, hydration, CSL.
import { relations } from "@drizzle/relations";
import {
  creators,
  creatorTypes,
  fieldsCombined,
  itemCreators,
  itemData,
  itemDataValues,
  items,
  itemTypeCreatorTypes,
  itemTypes,
  libraries,
} from "@drizzle/schema";
import { drizzle } from "drizzle-orm/node-sqlite";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

import { Temporal } from "@zotlit/shared/temporal";
import { FIELD_ALIASES, ZOTERO_DATE_FIELDS } from "@zotlit/zotero-types";
import fixture from "@zotlit/zotero-types/fixtures/item-to-csl.json" with { type: "json" };
import zoteroSchema from "@zotlit/zotero-types/schema.json" with { type: "json" };

import type { NodeDatabaseClient } from "@/client/node";
import { USER_LIBRARY_ID } from "@/lib/constants";
import { CHILD_ITEM_TYPES } from "@/lib/item-types";
import type { CreatorFieldMode } from "@/lib/zt-creator";
import { getItemsByLibrary } from "@/queries/items";
import type { Item } from "@/queries/items";
import { createFixtureSchema } from "@/test-utils";

import { itemToCsl } from "./zt-csl-item";

interface NativeCreator {
  creatorType: string;
  firstName?: string;
  lastName?: string;
  fieldMode?: number;
}

interface NativeItem {
  itemType: string;
  creators?: readonly NativeCreator[];
  [field: string]: unknown;
}

interface ItemToCslFixture {
  zoteroVersion: string;
  schemaVersion: number;
  cases: Readonly<
    Record<string, { item: NativeItem; csl: Readonly<Record<string, unknown>> }>
  >;
}

interface SchemaItemType {
  itemType: string;
  fields: readonly { field: string; baseField?: string }[];
  creatorTypes: readonly { creatorType: string; primary?: boolean }[];
}

const corpus: ItemToCslFixture = fixture;
const schemaItemTypes: readonly SchemaItemType[] = zoteroSchema.itemTypes;

/** A synced personal account; the comparison drops the `id` it names. */
const USER = {
  userID: 475425,
  localUserKey: "v3aG8nQf",
  username: "aidenlx",
};

/** Zotero writes `dateAdded`/`dateModified` on every row; the mapper ignores both. */
const SEED_TIMESTAMP = Temporal.Instant.from("2024-01-15T10:00:00Z");

describe(`itemToCsl: Zotero ${corpus.zoteroVersion} corpus`, () => {
  it("pins the fixture to the Zotero schema the mapper generates from", () => {
    expect(corpus.schemaVersion).toBe(zoteroSchema.version);
  });

  it("covers every regular item type of the pinned schema", () => {
    const regular = schemaItemTypes
      .map(({ itemType }) => itemType)
      .filter((itemType) => !isChildItemType(itemType));

    expect(Object.keys(corpus.cases).toSorted()).toEqual(regular.toSorted());
  });

  it("matches Zotero's CSL-JSON for every regular item type", () => {
    using sqlite = new DatabaseSync(":memory:");
    createFixtureSchema(sqlite);
    const db = drizzle({ client: sqlite, relations });
    seedCorpus(db);

    const hydrated = new Map<string, Item>(
      getItemsByLibrary(db, USER_LIBRARY_ID).map((item) => [
        item.fields.itemType,
        item,
      ]),
    );
    expect(hydrated.size).toBe(Object.keys(corpus.cases).length);

    for (const [itemType, { csl }] of Object.entries(corpus.cases)) {
      const item = hydrated.get(itemType);
      // Soft, so one absent row still leaves the other item types compared.
      expect.soft(item, itemType).toBeDefined();
      if (!item) continue;
      expect
        .soft(comparable(itemToCsl(item, USER)), itemType)
        .toEqual(coerceDateParts(comparable(csl)));
    }
  });
});

function isChildItemType(itemType: string): boolean {
  return CHILD_ITEM_TYPES.some((childType) => childType === itemType);
}

/**
 * Zotero's expected CSL-JSON and ZotLit's own differ in two agreed places:
 *
 * - `id`, because Zotero's corpus keys items by database item id and ZotLit
 *   keys them by Zotero Item URI.
 * - `accessed`, because ZotLit reads the stored UTC timestamp as the local
 *   calendar day, so the value depends on the test machine's time zone.
 *   {@link file://./zt-csl-item.test.ts} is the authority for that conversion.
 */
function comparable(
  csl: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const { id: _id, accessed: _accessed, ...rest } = csl;
  return rest;
}

/**
 * CSL 1.0.2 permits a date part as a string or a number, and Zotero's corpus
 * holds string years. ZotLit's date contract is numbers throughout, so the
 * expected side converts before the comparison.
 */
function coerceDateParts(
  csl: Record<string, unknown>,
): Record<string, unknown> {
  for (const [variable, value] of Object.entries(csl)) {
    if (typeof value !== "object" || value === null) continue;
    const parts = (value as { "date-parts"?: unknown })["date-parts"];
    if (!Array.isArray(parts)) continue;
    csl[variable] = {
      ...value,
      "date-parts": parts.map((part: unknown[]) => part.map(Number)),
    };
  }
  return csl;
}

// -- Storage adapter ---------------------------------------------------------
// Native Zotero JSON -> the rows Zotero's database holds. It implements only
// the conversions this corpus needs, not Zotero's whole `fromJSON()`.

/**
 * Assigns each distinct name a row id, the way Zotero's lookup tables
 * (`fieldsCombined`, `creatorTypes`, `itemDataValues`) do.
 */
class LookupTable {
  readonly #ids = new Map<string, number>();

  id(name: string): number {
    const existing = this.#ids.get(name);
    if (existing !== undefined) return existing;
    const id = this.#ids.size + 1;
    this.#ids.set(name, id);
    return id;
  }

  rows<T>(build: (name: string, id: number) => T): T[] {
    return [...this.#ids].map(([name, id]) => build(name, id));
  }
}

function seedCorpus(db: NodeDatabaseClient): void {
  const fieldNames = new LookupTable();
  const values = new LookupTable();
  const creatorTypeNames = new LookupTable();
  const itemTypeRows: { itemTypeID: number; typeName: string }[] = [];
  const itemRows: (typeof items.$inferInsert)[] = [];
  const itemTypeCreatorTypeRows: (typeof itemTypeCreatorTypes.$inferInsert)[] =
    [];
  const creatorRows: (typeof creators.$inferInsert)[] = [];
  const itemCreatorRows: (typeof itemCreators.$inferInsert)[] = [];
  const itemDataRows: (typeof itemData.$inferInsert)[] = [];

  for (const [index, [itemType, { item }]] of Object.entries(
    corpus.cases,
  ).entries()) {
    // One row id per case keeps `itemID` and `itemTypeID` readable in failures.
    const id = index + 1;
    itemTypeRows.push({ itemTypeID: id, typeName: itemType });
    itemRows.push({
      itemID: id,
      itemTypeID: id,
      libraryID: USER_LIBRARY_ID,
      key: `FIXT${String(id).padStart(4, "0")}`,
      dateAdded: SEED_TIMESTAMP,
      dateModified: SEED_TIMESTAMP,
      clientDateModified: SEED_TIMESTAMP,
    });

    for (const { creatorType, primary } of itemTypeSchema(itemType)
      .creatorTypes) {
      itemTypeCreatorTypeRows.push({
        itemTypeID: id,
        creatorTypeID: creatorTypeNames.id(creatorType),
        primaryField: primary === true ? 1 : 0,
      });
    }

    for (const [nativeField, value] of Object.entries(item)) {
      if (nativeField === "itemType" || nativeField === "creators") continue;
      const field = storedField(itemType, nativeField);
      itemDataRows.push({
        itemID: id,
        fieldID: fieldNames.id(field),
        valueID: values.id(storedValue(field, value)),
      });
    }

    item.creators?.forEach((creator, orderIndex) => {
      const creatorID = creatorRows.length + 1;
      creatorRows.push({
        creatorID,
        firstName: creator.firstName ?? null,
        lastName: creator.lastName ?? null,
        fieldMode: (creator.fieldMode ?? 0) as CreatorFieldMode,
      });
      itemCreatorRows.push({
        itemID: id,
        creatorID,
        creatorTypeID: creatorTypeNames.id(creator.creatorType),
        orderIndex,
      });
    });
  }

  db.transaction((tx) => {
    tx.insert(libraries)
      .values({
        libraryID: USER_LIBRARY_ID,
        type: "user",
        editable: 1,
        filesEditable: 1,
      })
      .run();
    tx.insert(itemTypes).values(itemTypeRows).run();
    tx.insert(items).values(itemRows).run();
    tx.insert(creatorTypes)
      .values(
        creatorTypeNames.rows((creatorType, id) => ({
          creatorTypeID: id,
          creatorType,
        })),
      )
      .run();
    tx.insert(itemTypeCreatorTypes).values(itemTypeCreatorTypeRows).run();
    tx.insert(creators).values(creatorRows).run();
    tx.insert(itemCreators).values(itemCreatorRows).run();
    tx.insert(fieldsCombined)
      .values(
        fieldNames.rows((fieldName, id) => ({
          fieldID: id,
          fieldName,
          custom: 0,
        })),
      )
      .run();
    tx.insert(itemDataValues)
      .values(values.rows((value, id) => ({ valueID: id, value })))
      .run();
    tx.insert(itemData).values(itemDataRows).run();
  });
}

const itemTypeSchemas = new Map(
  schemaItemTypes.map((itemType) => [itemType.itemType, itemType]),
);

function itemTypeSchema(itemType: string): SchemaItemType {
  const schema = itemTypeSchemas.get(itemType);
  if (!schema) {
    throw new Error(
      `Schema ${zoteroSchema.version} has no item type "${itemType}"`,
    );
  }
  return schema;
}

/**
 * The field Zotero stores the value under. Native JSON names a base field
 * (`medium`) where the database holds the type-specific one (`artworkMedium`).
 */
function storedField(itemType: string, nativeField: string): string {
  const { fields } = itemTypeSchema(itemType);
  if (fields.some(({ field }) => field === nativeField)) return nativeField;
  const specific = fields.find(({ baseField }) => baseField === nativeField);
  if (specific) return specific.field;
  throw new Error(
    `Schema ${zoteroSchema.version} has no field "${nativeField}" on item type "${itemType}"`,
  );
}

/** `itemDataValues.value` is text; native JSON holds numbers for e.g. `volume`. */
function storedValue(field: string, value: unknown): string {
  const text = String(value);
  if (field === "accessDate") return sqlTimestamp(text);
  const baseField = FIELD_ALIASES[field] ?? field;
  return ZOTERO_DATE_FIELDS.some((dateField) => dateField === baseField)
    ? multipartDate(text)
    : text;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Zotero stores a date field as `YYYY-MM-DD <user text>`. Every date in this
 * corpus is a complete ISO calendar day, so the SQL part repeats the text.
 */
function multipartDate(value: string): string {
  if (!ISO_DATE_RE.test(value)) {
    throw new Error(
      `The corpus adapter converts ISO calendar days only; got "${value}"`,
    );
  }
  return `${value} ${value}`;
}

/** Zotero stores `accessDate` as a UTC SQL timestamp, `YYYY-MM-DD HH:MM:SS`. */
function sqlTimestamp(value: string): string {
  return Temporal.Instant.from(value)
    .toString({ smallestUnit: "second" })
    .slice(0, -1)
    .replace("T", " ");
}
