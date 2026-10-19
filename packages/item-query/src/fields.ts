// The field registry of Item Query: each built-in field with its shape, its
// hydration needs, and its projection, sort, and filter readers.
import {
  creatorFieldModeToName,
  creatorTypePriority,
  parseItemDate,
  tagTypeToName,
} from "@zotlit/db";
import type {
  HydratedCreator,
  HydratedItem,
  HydrateRelation,
  ScanRow,
} from "@zotlit/db/item-query";
import { FIELD_ALIASES, ZOTERO_DATE_FIELDS } from "@zotlit/zotero-types";
import { FIELD_LABELS } from "@zotlit/zotero-types/field-labels";

import type { QueryAnnotation } from "./annotation-fields";
import type { AnnotationNeeds } from "./annotation-hydration";
import type { QueryAttachment } from "./attachment-fields";
import type { AttachmentNeeds } from "./attachment-hydration";
import { compareStrings } from "./collation";
import {
  datePart,
  dayKey,
  fromAccessDate,
  fromItemDate,
  timestamp,
} from "./filter-dates";
import type { FilterRegistry } from "./filter-plan";
import { isQueryRecord } from "./filter-values";
import type { FilterValue, FilterValueType } from "./filter-values";
import { keyField, indexedKeyField } from "./key-fields";
import { libraryField } from "./library-field";
import type { QueryNote } from "./note-fields";
import type { NoteNeeds } from "./note-hydration";
import type { PathSegment } from "./projection-path";
import type { QueryClock } from "./query-clock";
import type { FilterNavigation, RecordVocabulary } from "./record-field";
import { recordField } from "./record-field";
import { definitionFilter } from "./record-field";
import { annotationVocabulary } from "./record-vocabularies";
import { attachmentVocabulary } from "./record-vocabularies";
import { noteVocabulary } from "./record-vocabularies";
import type { ProjectionValue } from "./request";
import type { ProjectionJson } from "./value-text";

/**
 * One Item while the engine reads it: its scan row and the values hydration
 * loaded for it.
 */
export interface QueryItem {
  readonly scan: ScanRow;
  readonly lastUse?: number;
  readonly groupID: number | null;
  readonly hydrated: HydratedItem;
  /** The custom fields of the source, for the complete `custom` object. */
  readonly customFieldNames: readonly string[];
  readonly attachments?: readonly QueryAttachment[];
  readonly annotations?: readonly QueryAnnotation[];
  readonly notes?: readonly QueryNote[];
}

/** The JSON type of a scalar value in a Query Row. */
export type ScalarType = "string" | "number" | "boolean";

/**
 * The structure of a value, which decides the Projection Paths below a field
 * and the JSON types of the Item Query Schema. `custom-fields` is an object
 * whose keys are the custom fields of the source, each one a `value`.
 */
export type ValueShape =
  | {
      readonly kind: "record";
      readonly vocabulary: () => RecordVocabulary<any, any>;
    }
  | { readonly kind: "scalar"; readonly type: ScalarType }
  | { readonly kind: "json" }
  | {
      readonly kind: "object";
      readonly keys: Readonly<Record<string, ValueShape>>;
    }
  | { readonly kind: "list"; readonly element: ValueShape }
  | { readonly kind: "custom-fields"; readonly value: ValueShape };

/**
 * What hydration loads for a field. `custom: "all"` loads every custom field
 * of the source.
 */
export interface FieldNeeds {
  readonly builtIn?: readonly string[];
  readonly custom?: readonly string[] | "all";
  readonly relations?: readonly HydrateRelation[];
  readonly attachments?: readonly AttachmentNeeds[];
  readonly annotations?: readonly AnnotationNeeds[];
  readonly notes?: readonly NoteNeeds[];
}

/**
 * The value of a Sortable Field for one Item. One field gives one type; `null`
 * is a missing value. Strings compare in the Item Query string order.
 */
export type SortKey = string | number | boolean | null;

/**
 * One entry of the field registry. Validation, execution, and the Item Query
 * Schema read the same entries, so a field exists only here.
 */
export interface FieldDefinition<Item = QueryItem, Needs = FieldNeeds> {
  readonly description?: string;
  readonly relation?: () => RecordVocabulary<any, any>;
  readonly project?: (
    item: Item,
    rest: readonly PathSegment[],
  ) => ProjectionValue;
  readonly filterNeeds?: Needs;
  readonly navigation?: FilterNavigation<Needs>;
  readonly shape: ValueShape;
  /** Documented forms of a text value, with placeholders for variable parts. */
  readonly valueForms?: readonly string[];
  /** What hydration loads for a path that starts at this field. */
  readonly needs: (rest: readonly PathSegment[]) => Needs;
  /** Reads the complete value of the field. */
  readonly read: (item: Item) => ProjectionValue;
  /**
   * Present on a Sortable Field: the value that orders the Item. Hydration
   * loads `needs([])` before it runs. The Query Clock places a calendar-day
   * `accessDate` at its start in the query time zone.
   */
  readonly sortKey?: (item: Item, clock: QueryClock) => SortKey;
  /**
   * Present on a Sortable Field whose sort key is another value than the one
   * it projects: the key, from the projected value. {@link sortKey} reads
   * the key through it, so the two cannot differ.
   */
  readonly valueSortKey?: (value: ProjectionJson) => SortKey;
  /**
   * Present on a field that a Filter Expression can read. Hydration loads
   * `needs([])` before it runs.
   */
  readonly filter?: FilterValueDefinition<Item>;
}

/**
 * The value of a field in a Filter Expression. Creator, Tag, and Collection
 * lists hold text; cross-dataset Relation Lists hold records.
 */
export interface FilterValueDefinition<Item = QueryItem> {
  /** The type of the value when the Item has one. */
  readonly type: Exclude<FilterValueType, "null">;
  readonly read: (item: Item) => FilterValue;
}

const STRING: ValueShape = { kind: "scalar", type: "string" };
const NUMBER: ValueShape = { kind: "scalar", type: "number" };

/** The structured value of a Zotero date field, from the template vocabulary. */
const DATE_SHAPE: ValueShape = {
  kind: "object",
  keys: {
    kind: STRING,
    // The ISO date or year-month; null for a year-only or text date.
    value: STRING,
    year: NUMBER,
    month: NUMBER,
    day: NUMBER,
    text: STRING,
    raw: STRING,
  },
};

const NO_NEEDS = (): FieldNeeds => ({});

/** A field that the scan row holds: hydration loads nothing for it. */
function fromScan(readers: {
  read: (row: ScanRow) => ProjectionValue;
  sortKey: (row: ScanRow) => SortKey;
  filter: FilterValueDefinition;
}): FieldDefinition {
  const { read, sortKey, filter } = readers;
  return {
    // The item type name, or a timestamp as an ISO string on the wire.
    shape: STRING,
    needs: NO_NEEDS,
    read: (item) => read(item.scan),
    sortKey: (item) => sortKey(item.scan),
    filter,
  };
}

/**
 * A timestamp of the scan row. A stored value that SQLite cannot parse is
 * null in projection, filter, and sort.
 */
function scanTimestamp(column: "dateAdded" | "dateModified"): FieldDefinition {
  const instant = (row: ScanRow) => {
    const milliseconds = row[column];
    return milliseconds === null
      ? null
      : Temporal.Instant.fromEpochMilliseconds(milliseconds);
  };
  return fromScan({
    read: instant,
    sortKey: (row) => row[column],
    filter: {
      type: "date",
      read: (item) => {
        const value = instant(item.scan);
        return value && timestamp(value);
      },
    },
  });
}

/** A built-in Zotero field; a base field resolves through its aliases. */
function zoteroField(name: string): FieldDefinition {
  const builtIn = [name];
  const read = (item: QueryItem) => item.hydrated.fields.get(name) ?? null;
  if (name === "accessDate") return accessDateField(builtIn, read);
  if (!isDateField(name)) {
    return {
      shape: STRING,
      needs: () => ({ builtIn }),
      read,
      sortKey: read,
      filter: { type: "string", read },
    };
  }
  return {
    shape: DATE_SHAPE,
    needs: () => ({ builtIn }),
    read: (item) => dateValue(read(item)),
    sortKey: (item) => firstDay(dateValue(read(item)) as ProjectionJson),
    valueSortKey: firstDay,
    // A calendar date at the precision the Item gives.
    filter: {
      type: "date",
      read: (item) => fromItemDate(parseItemDate(read(item))),
    },
  };
}

/**
 * Zotero's `accessDate`: one date in projection, sort, and filter, a timestamp
 * or a calendar day. A calendar day sorts from its start in the query time
 * zone. A stored value that does not parse is null in all three.
 */
function accessDateField(
  builtIn: readonly string[],
  read: (item: QueryItem) => string | null,
): FieldDefinition {
  const value = (item: QueryItem) => fromAccessDate(read(item));
  return {
    shape: STRING,
    needs: () => ({ builtIn }),
    read: (item) => {
      const date = value(item);
      if (!date) return null;
      return date.precision === "instant" ? date.instant : date.first;
    },
    sortKey: (item, clock) => {
      const date = value(item);
      return date && datePart(date, "timestamp", clock);
    },
    filter: { type: "date", read: value },
  };
}

function isDateField(name: string): boolean {
  const dateFields: readonly string[] = ZOTERO_DATE_FIELDS;
  return (
    dateFields.includes(name) || dateFields.includes(FIELD_ALIASES[name] ?? "")
  );
}

/** A Zotero multipart date as a structured value; `null` without a date. */
function dateValue(raw: string | null): ProjectionValue {
  const date = parseItemDate(raw);
  if (!date) return null;
  return {
    kind: date.kind,
    value: date.value,
    year: date.year,
    month: date.month,
    day: date.day,
    text: date.kind === "text" ? date.text : null,
    raw: date.raw,
  };
}

/**
 * The first day a Zotero date, as {@link dateValue} gives it, can mean, as
 * the number `yyyymmdd`: a year sorts as its 1 January. `null` for a date
 * without a year and for no date.
 */
function firstDay(date: ProjectionJson): SortKey {
  if (!isJsonRecord(date) || typeof date.year !== "number") return null;
  return dayKey({
    year: date.year,
    month: typeof date.month === "number" ? date.month : 1,
    day: typeof date.day === "number" ? date.day : 1,
  });
}

function isJsonRecord(
  value: ProjectionJson,
): value is { readonly [key: string]: ProjectionJson } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The key the engine sorts the Sortable Field `name` by, from the value it
 * projects for a record: two records tie on the field where their keys are
 * equal, though their values may show differently, as the dates `2024` and
 * `2024-01-01` do. A key the Query Clock places, as a calendar-day
 * `accessDate`'s, is the projected value itself.
 */
export function projectedSortKey(name: string, value: ProjectionJson): SortKey {
  const definition = FIELDS.get(name);
  if (definition?.valueSortKey) return definition.valueSortKey(value);
  if (value === null || typeof value !== "object") return value;
  return JSON.stringify(value);
}

/** The shape of the value of one custom field. */
export const CUSTOM_FIELD_VALUE_SHAPE: ValueShape = STRING;

const customField: FieldDefinition = {
  shape: { kind: "custom-fields", value: CUSTOM_FIELD_VALUE_SHAPE },
  needs: (rest) =>
    typeof rest[0] === "string" ? { custom: [rest[0]] } : { custom: "all" },
  read: (item) =>
    Object.fromEntries(
      item.customFieldNames.map((name) => [
        name,
        item.hydrated.custom.get(name) ?? null,
      ]),
    ),
};

/** One Creator in the template vocabulary. */
const CREATOR_SHAPE: ValueShape = {
  kind: "object",
  keys: {
    family: STRING,
    given: STRING,
    literal: STRING,
    role: STRING,
    fullName: STRING,
  },
};

const creatorsField: FieldDefinition = {
  shape: { kind: "list", element: CREATOR_SHAPE },
  needs: () => ({ relations: ["creators"] }),
  read: (item) => (item.hydrated.creators ?? []).map(templateCreator),
  filter: {
    type: "list",
    read: (item) => (item.hydrated.creators ?? []).map(fullName),
  },
};

/** The Creator has a one-field (institutional) name, held in `lastName`. */
function isOneFieldName(creator: HydratedCreator): boolean {
  return creatorFieldModeToName(creator.fieldMode) === "nameOnly";
}

/** The display name of a Creator: the one-field name, or given then family. */
function fullName(creator: HydratedCreator): string {
  return isOneFieldName(creator)
    ? creator.lastName
    : `${creator.firstName} ${creator.lastName}`.trim();
}

/**
 * A Creator as the template vocabulary gives it: a one-field name is
 * `literal`, a two-field name is `given` and `family`.
 */
function templateCreator(creator: HydratedCreator): ProjectionValue {
  if (isOneFieldName(creator)) {
    return {
      family: "",
      given: "",
      literal: creator.lastName,
      role: creator.creatorType,
      fullName: fullName(creator),
    };
  }
  return {
    family: creator.lastName,
    given: creator.firstName,
    literal: null,
    role: creator.creatorType,
    fullName: fullName(creator),
  };
}

/**
 * The first author of an Item: the first of its Primary Creators, the creators
 * of the first role in the priority chain that the Item has. The chain starts
 * at the primary creator type of the item type, then `editor`, `director`, and
 * `contributor`, as the template `authors` (ADR 0074).
 */
function firstAuthor(item: QueryItem): HydratedCreator | undefined {
  const creators = item.hydrated.creators ?? [];
  const primaryType =
    creators.find((creator) => creator.primary)?.creatorType ?? null;
  for (const role of creatorTypePriority(primaryType)) {
    const creator = creators.find((creator) => creator.creatorType === role);
    if (creator) return creator;
  }
  return undefined;
}

/**
 * A Creator, as {@link templateCreator} gives it, as it sorts: the family
 * name then the given name; a one-field name sorts as a family.
 */
function creatorSortKey(creator: ProjectionJson): SortKey {
  if (!isJsonRecord(creator)) return null;
  const { family, given, literal } = creator;
  if (typeof literal === "string") return literal;
  if (typeof family !== "string") return null;
  return typeof given === "string" && given !== ""
    ? `${family}, ${given}`
    : family;
}

const CREATOR_NEEDS = (): FieldNeeds => ({ relations: ["creators"] });

const firstAuthorField: FieldDefinition = {
  shape: CREATOR_SHAPE,
  needs: CREATOR_NEEDS,
  read: (item) => {
    const creator = firstAuthor(item);
    return creator ? templateCreator(creator) : null;
  },
  sortKey: (item) => {
    const creator = firstAuthor(item);
    return creator
      ? creatorSortKey(templateCreator(creator) as ProjectionJson)
      : null;
  },
  valueSortKey: creatorSortKey,
  filter: {
    type: "record",
    read: (item) => {
      const creator = firstAuthor(item);
      if (!creator) return null;
      const value = templateCreator(creator) as Record<string, string | null>;
      return {
        type: "record",
        identity: creator,
        read: (name) => value[name] ?? null,
      };
    },
  },
  navigation: {
    member: (name) =>
      name in (CREATOR_SHAPE as { keys: object }).keys
        ? {
            filterable: true,
            needs: CREATOR_NEEDS(),
            value: {
              type: "string",
              read: (value) => (isQueryRecord(value) ? value.read(name) : null),
            },
          }
        : undefined,
  },
};

/** One Tag in the template vocabulary. */
const TAG_SHAPE: ValueShape = {
  kind: "object",
  keys: { name: STRING, type: STRING },
};

const tagsField: FieldDefinition = {
  shape: { kind: "list", element: TAG_SHAPE },
  needs: () => ({ relations: ["tags"] }),
  read: (item) =>
    (item.hydrated.tags ?? [])
      .toSorted((a, b) => compareStrings(a.name, b.name))
      .map((tag) => ({ name: tag.name, type: tagTypeToName(tag.type) })),
  filter: {
    type: "list",
    read: (item) =>
      (item.hydrated.tags ?? [])
        .map((tag) => tag.name)
        .toSorted(compareStrings),
  },
};

/**
 * Each live Collection an Item is filed in directly, as its root-first path:
 * the names from the top-level Collection down, joined by `/` without escaping
 * (ADR 0040).
 */
const collectionPaths = (item: QueryItem): string[] =>
  (item.hydrated.collections ?? [])
    .map((path) => path.join("/"))
    .toSorted(compareStrings);

const collectionsField: FieldDefinition = {
  shape: { kind: "list", element: STRING },
  needs: () => ({ relations: ["collections"] }),
  read: collectionPaths,
  filter: { type: "list", read: collectionPaths },
};

const attachmentsField: FieldDefinition = recordField({
  vocabulary: () => attachmentVocabulary(),
  list: true,
  rows: (item) => item.attachments ?? [],
  needs: (attachments) => ({ attachments }),
});

/** The newest read of a live child Attachment, in milliseconds. */
function lastRead(item: QueryItem): number | null {
  let latest: number | null = null;
  for (const attachment of item.attachments ?? []) {
    const value = attachment.scan.lastRead;
    if (value !== null && (latest === null || value > latest)) latest = value;
  }
  return latest;
}

const lastReadField: FieldDefinition = {
  shape: STRING,
  needs: () => ({ attachments: [{}] }),
  read: (item) => {
    const value = lastRead(item);
    return value === null
      ? null
      : Temporal.Instant.fromEpochMilliseconds(value);
  },
  sortKey: lastRead,
  filter: {
    type: "date",
    read: (item) => {
      const value = lastRead(item);
      return value === null
        ? null
        : timestamp(Temporal.Instant.fromEpochMilliseconds(value));
    },
  },
};

/** The newest work on the paper, across Zotero and this request's Uses. */
function lastActivity(item: QueryItem): number | null {
  const values = [item.scan.dateAdded, lastRead(item), item.lastUse ?? null];
  for (const note of item.notes ?? []) values.push(note.scan.dateModified);
  for (const annotation of item.annotations ?? [])
    values.push(annotation.scan.dateModified);
  let latest: number | null = null;
  for (const value of values)
    if (value !== null && (latest === null || value > latest)) latest = value;
  return latest;
}

const lastActivityField: FieldDefinition = {
  description:
    "Newest addition, Attachment read, child note or Annotation edit, or Use. Includes this device's Uses when the plugin supplies them.",
  shape: STRING,
  needs: () => ({ attachments: [{}], notes: [{}], annotations: [{}] }),
  read: (item) => {
    const value = lastActivity(item);
    return value === null
      ? null
      : Temporal.Instant.fromEpochMilliseconds(value);
  },
  sortKey: lastActivity,
  filter: {
    type: "date",
    read: (item) => {
      const value = lastActivity(item);
      return value === null
        ? null
        : timestamp(Temporal.Instant.fromEpochMilliseconds(value));
    },
  },
};

const FIELDS: ReadonlyMap<string, FieldDefinition> = new Map<
  string,
  FieldDefinition
>([
  // Every built-in Zotero field of the bundled schema, with its aliases.
  ...Object.keys(FIELD_LABELS["en-US"]).map(
    (name) => [name, zoteroField(name)] as const,
  ),
  [
    "itemType",
    fromScan({
      read: (row) => row.itemType,
      sortKey: (row) => row.itemType,
      filter: { type: "string", read: (item) => item.scan.itemType },
    }),
  ],
  ["dateAdded", scanTimestamp("dateAdded")],
  ["dateModified", scanTimestamp("dateModified")],
  ["lastRead", lastReadField],
  ["lastActivity", lastActivityField],
  ["library", libraryField],
  ["key", keyField],
  ["indexedKey", indexedKeyField],
  ["custom", customField],
  ["creators", creatorsField],
  ["firstAuthor", firstAuthorField],
  ["tags", tagsField],
  ["collections", collectionsField],
  ["attachments", attachmentsField],
  [
    "annotations",
    recordField({
      vocabulary: () => annotationVocabulary(),
      list: true,
      rows: (item) => item.annotations ?? [],
      needs: (annotations) => ({ annotations }),
    }),
  ],
  [
    "notes",
    recordField({
      vocabulary: () => noteVocabulary(),
      list: true,
      rows: (item) => item.notes ?? [],
      needs: (notes) => ({ notes }),
    }),
  ],
]);

/** The projection of a request that names no fields. */
export const DEFAULT_FIELDS: readonly string[] = [
  "itemType",
  "title",
  "creators",
  "date",
  "dateModified",
];

export function fieldDefinition(name: string): FieldDefinition | undefined {
  return FIELDS.get(name);
}

/** A built-in name as a Filter Expression reads it. */
export type FilterField<Item = QueryItem, Needs = FieldNeeds> =
  | {
      readonly filterable: true;
      readonly value: FilterValueDefinition<Item>;
      readonly needs: Needs;
      readonly customField?: string;
      readonly navigation?: FilterNavigation<Needs>;
    }
  | { readonly filterable: false };

/**
 * The built-in meaning of a bare name in a Filter Expression: a field with a
 * filter value, or a field that a filter cannot read. `undefined` for a name
 * that is not built in.
 */
export function filterField(name: string): FilterField | undefined {
  const definition = FIELDS.get(name);
  if (!definition) return undefined;
  return definitionFilter(definition);
}

/** The value of one custom field in a Filter Expression, by exact source name. */
export function customFilterValue(name: string): {
  value: FilterValueDefinition;
  needs: FieldNeeds;
} {
  return {
    value: {
      type: "string",
      read: (item) => item.hydrated.custom.get(name) ?? null,
    },
    needs: { custom: [name] },
  };
}

export const itemFilterRegistry: FilterRegistry<QueryItem, FieldNeeds> = {
  field: filterField,
  custom: customFilterValue,
};

/** Every built-in field name. */
export const BUILT_IN_NAMES: readonly string[] = [...FIELDS.keys()];

/**
 * The bare name reads the stored value of one built-in Zotero field as a
 * string, resolved through the field's aliases: its filter value is a string
 * and hydration loads that one field. The field-value candidate leaf reads
 * these fields.
 */
export function isStoredStringField(name: string): boolean {
  const definition = FIELDS.get(name);
  if (definition?.filter?.type !== "string") return false;
  const needs = definition.needs([]);
  return (
    needs.builtIn?.length === 1 &&
    needs.builtIn[0] === name &&
    !needs.custom &&
    !needs.relations
  );
}
