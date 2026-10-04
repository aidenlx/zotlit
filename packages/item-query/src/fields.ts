import { parseItemDate, tagTypeToName } from "@zotlit/db";
import type {
  HydratedCreator,
  HydratedItem,
  HydrateRelation,
  ScanRow,
} from "@zotlit/db/item-query";
import { FIELD_ALIASES, ZOTERO_DATE_FIELDS } from "@zotlit/zotero-types";
import { FIELD_LABELS } from "@zotlit/zotero-types/field-labels";

import { compareStrings } from "./collation";
import { fromAccessDate, fromItemDate, timestamp } from "./filter-dates";
import type { FilterValue, FilterValueType } from "./filter-values";
import type { PathSegment } from "./projection-path";
import type { ProjectionValue } from "./request";

/**
 * One Item while the engine reads it: its scan row and the values hydration
 * loaded for it.
 */
export interface QueryItem {
  readonly scan: ScanRow;
  readonly hydrated: HydratedItem;
  /** The custom fields of the source, for the complete `custom` object. */
  readonly customFieldNames: readonly string[];
}

/**
 * The structure of a value, which decides the Projection Paths below a field.
 * `custom-fields` is an object whose keys are the custom fields of the source.
 */
export type ValueShape =
  | { readonly kind: "scalar" }
  | {
      readonly kind: "object";
      readonly keys: Readonly<Record<string, ValueShape>>;
    }
  | { readonly kind: "list"; readonly element: ValueShape }
  | { readonly kind: "custom-fields" };

/**
 * What hydration loads for a field. `custom: "all"` loads every custom field
 * of the source.
 */
export interface FieldNeeds {
  readonly builtIn?: readonly string[];
  readonly custom?: readonly string[] | "all";
  readonly relations?: readonly HydrateRelation[];
}

/**
 * The value of a Sortable Field for one Item. One field gives one type; `null`
 * is a missing value. Strings compare in the Item Query string order.
 */
export type SortKey = string | number | null;

/**
 * One entry of the field registry. Validation, execution, and the Item Query
 * Schema read the same entries, so a field exists only here.
 */
export interface FieldDefinition {
  readonly shape: ValueShape;
  /** What hydration loads for a path that starts at this field. */
  readonly needs: (rest: readonly PathSegment[]) => FieldNeeds;
  /** Reads the complete value of the field. */
  readonly read: (item: QueryItem) => ProjectionValue;
  /**
   * Present on a Sortable Field: the value that orders the Item. Hydration
   * loads `needs([])` before it runs.
   */
  readonly sortKey?: (item: QueryItem) => SortKey;
  /**
   * Present on a field that a Filter Expression can read. Hydration loads
   * `needs([])` before it runs.
   */
  readonly filter?: FilterValueDefinition;
}

/**
 * The value of a field in a Filter Expression. A relation list is a list of
 * strings here; projection gives the richer structure.
 */
export interface FilterValueDefinition {
  /** The type of the value when the Item has one. */
  readonly type: Exclude<FilterValueType, "null">;
  readonly read: (item: QueryItem) => FilterValue;
}

const SCALAR: ValueShape = { kind: "scalar" };

/** The structured value of a Zotero date field, from the template vocabulary. */
const DATE_SHAPE: ValueShape = {
  kind: "object",
  keys: {
    kind: SCALAR,
    value: SCALAR,
    year: SCALAR,
    month: SCALAR,
    day: SCALAR,
    text: SCALAR,
    raw: SCALAR,
  },
};

const NO_NEEDS = (): FieldNeeds => ({});

function fromScan(
  read: (row: ScanRow) => ProjectionValue,
  sortKey: (row: ScanRow) => SortKey,
  filter?: FilterValueDefinition,
): FieldDefinition {
  return {
    shape: SCALAR,
    needs: NO_NEEDS,
    read: (item) => read(item.scan),
    sortKey: (item) => sortKey(item.scan),
    ...(filter && { filter }),
  };
}

/** A built-in Zotero field; a base field resolves through its aliases. */
function zoteroField(name: string): FieldDefinition {
  const builtIn = [name];
  const read = (item: QueryItem) => item.hydrated.fields.get(name) ?? null;
  if (!isDateField(name)) {
    return {
      shape: SCALAR,
      needs: () => ({ builtIn }),
      read,
      sortKey: read,
      filter:
        name === "accessDate"
          ? { type: "date", read: (item) => fromAccessDate(read(item)) }
          : { type: "string", read },
    };
  }
  return {
    shape: DATE_SHAPE,
    needs: () => ({ builtIn }),
    read: (item) => dateValue(read(item)),
    sortKey: (item) => firstDay(read(item)),
    // A calendar date at the precision the Item gives.
    filter: {
      type: "date",
      read: (item) => fromItemDate(parseItemDate(read(item))),
    },
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
 * The first day a Zotero date can mean, as the number `yyyymmdd`: a year sorts
 * as its 1 January. `null` for a text date and for no date.
 */
function firstDay(raw: string | null): SortKey {
  const date = parseItemDate(raw);
  if (!date || date.year === null) return null;
  return date.year * 10000 + (date.month ?? 1) * 100 + (date.day ?? 1);
}

const customField: FieldDefinition = {
  shape: { kind: "custom-fields" },
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
    family: SCALAR,
    given: SCALAR,
    literal: SCALAR,
    role: SCALAR,
    fullName: SCALAR,
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

/** The display name of a Creator: the one-field name, or given then family. */
function fullName(creator: HydratedCreator): string {
  return creator.fieldMode === 1
    ? creator.lastName
    : `${creator.firstName} ${creator.lastName}`.trim();
}

/**
 * A Creator as the template vocabulary gives it: a one-field name is
 * `literal`, a two-field name is `given` and `family`.
 */
function templateCreator(creator: HydratedCreator): ProjectionValue {
  if (creator.fieldMode === 1) {
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

/** One Tag in the template vocabulary. */
const TAG_SHAPE: ValueShape = {
  kind: "object",
  keys: { name: SCALAR, type: SCALAR },
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
  shape: { kind: "list", element: SCALAR },
  needs: () => ({ relations: ["collections"] }),
  read: collectionPaths,
  filter: { type: "list", read: collectionPaths },
};

/** Attachment presence: the Item has at least one non-trashed Attachment. */
const attachmentsField: FieldDefinition = {
  shape: SCALAR,
  needs: () => ({ relations: ["attachments"] }),
  read: (item) => item.hydrated.hasAttachments ?? false,
  filter: {
    type: "boolean",
    read: (item) => item.hydrated.hasAttachments ?? false,
  },
};

const FIELDS: ReadonlyMap<string, FieldDefinition> = new Map([
  // Every built-in Zotero field of the bundled schema, with its aliases.
  ...Object.keys(FIELD_LABELS["en-US"]).map(
    (name) => [name, zoteroField(name)] as const,
  ),
  [
    "itemType",
    fromScan(
      (row) => row.itemType,
      (row) => row.itemType,
      { type: "string", read: (item) => item.scan.itemType },
    ),
  ],
  [
    "dateAdded",
    fromScan(
      (row) => row.dateAdded,
      (row) => row.dateAdded.epochMilliseconds,
      { type: "date", read: (item) => timestamp(item.scan.dateAdded) },
    ),
  ],
  [
    "dateModified",
    fromScan(
      (row) => row.dateModified,
      (row) => row.dateModified.epochMilliseconds,
      { type: "date", read: (item) => timestamp(item.scan.dateModified) },
    ),
  ],
  ["custom", customField],
  ["creators", creatorsField],
  ["tags", tagsField],
  ["collections", collectionsField],
  ["attachments", attachmentsField],
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

/**
 * The names a Filter Expression reads that are outside the projection
 * vocabulary. `key` is the Zotero Key of the Item inside the Target Library.
 */
const FILTER_ONLY_FIELDS: ReadonlyMap<string, FilterValueDefinition> = new Map([
  ["key", { type: "string", read: (item: QueryItem) => item.scan.key }],
]);

/** A built-in name as a Filter Expression reads it. */
export type FilterField =
  | {
      readonly filterable: true;
      readonly value: FilterValueDefinition;
      readonly needs: FieldNeeds;
    }
  | { readonly filterable: false };

/**
 * The built-in meaning of a bare name in a Filter Expression: a field with a
 * filter value, or a field that a filter cannot read. `undefined` for a name
 * that is not built in.
 */
export function filterField(name: string): FilterField | undefined {
  const filterOnly = FILTER_ONLY_FIELDS.get(name);
  if (filterOnly) return { filterable: true, value: filterOnly, needs: {} };
  const definition = FIELDS.get(name);
  if (!definition) return undefined;
  return definition.filter
    ? {
        filterable: true,
        value: definition.filter,
        needs: definition.needs([]),
      }
    : { filterable: false };
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

/** Every built-in field name, with the names only a filter reads. */
export const BUILT_IN_NAMES: readonly string[] = [
  ...FIELDS.keys(),
  ...FILTER_ONLY_FIELDS.keys(),
];

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
