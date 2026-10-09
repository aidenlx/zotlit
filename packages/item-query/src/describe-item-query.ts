import { Effect } from "effect";

import type {
  ItemQueryDatabase,
  ItemQueryDatabaseError,
  ItemQueryLayoutError,
} from "@zotlit/db/item-query";

import type { QueryDataset } from "./dataset";
import { describeQueryCustomFields } from "./describe-query-custom-fields";
import { BUILT_IN_NAMES, fieldDefinition, filterField } from "./fields";
import type { ValueShape } from "./fields";
import {
  GLOBAL_FUNCTIONS,
  IF_FUNCTION,
  METHOD_ENTRIES,
  PROPERTY_ENTRIES,
  VALUE_TYPES,
} from "./filter-functions";
import type { FunctionDefinition, FunctionParameter } from "./filter-functions";
import { planFilter } from "./filter-plan";
import type { FilterValueType } from "./filter-values";
import { ITEMS } from "./query-items";
import type { SortSpec } from "./request";

/** The JSON type of a value in a Query Row. Every value can also be null. */
export type JsonType =
  | "string"
  | "number"
  | "boolean"
  | "object"
  | "array"
  | "any";

/** A non-null type of the Filter Expression language. */
export type FilterType = Exclude<FilterValueType, "null">;

/** What a caller can do with one name or Projection Path. */
export interface SchemaCapabilities {
  /**
   * The type a Filter Expression reads when it names the path. `any`: a filter
   * reads it and the type depends on the Item. `null`: a filter cannot read it.
   */
  readonly filter: FilterType | "any" | null;
  /** The `fields` argument takes it. */
  readonly projection: boolean;
  /** The `sort` argument takes it. */
  readonly sort: boolean;
}

/** A built-in field or a Projection Path below one. */
export interface SchemaField extends SchemaCapabilities {
  /** The Query Dataset reached by this parent or Relation List. */
  readonly relation?: "items" | "attachments" | "annotations";
  /** The Projection Path; a field is the path without `.` or `[`. */
  readonly path: string;
  readonly type: JsonType;
  /** Text forms; angle brackets name variable parts, not literal values. */
  readonly valueForms?: readonly string[];
}

/** A custom field of the active Zotero source. */
export interface SchemaCustomField extends SchemaField {
  /** The exact source name. */
  readonly name: string;
  /** A Filter Expression can read the field by its name alone. */
  readonly bareName: boolean;
}

export interface SchemaParameter {
  readonly name: string;
  /** One type, or each type the parameter takes. `any` also takes null. */
  readonly type: FunctionParameter["type"];
  /** Present on a typed parameter that also takes null. */
  readonly nullable?: true;
  /** Present on a string parameter that takes only these texts. */
  readonly values?: readonly string[];
}

/** A global function of the Filter Expression language. */
export interface SchemaFunction {
  readonly name: string;
  readonly parameters: readonly SchemaParameter[];
  /** Parameters after the required ones that a call can omit. */
  readonly optional: readonly SchemaParameter[];
  /** The parameter of every further argument; `null` on a fixed count. */
  readonly rest: SchemaParameter | null;
  /** The type of a non-null result; `null` when it varies. */
  readonly returns: FilterType | null;
}

/** A method, called as `value.name(...)` on a value of type `on`. */
export interface SchemaMethod extends SchemaFunction {
  /** `any`: a method of every value, null included. */
  readonly on: FilterValueType | "any";
  /**
   * Present on an element-expression method: the names its first parameter
   * can use. `value` is the element, `index` its position, `acc` the running
   * result of `reduce`.
   */
  readonly scope?: readonly string[];
}

/** A property, read as `value.name` on a value of type `on`. */
export interface SchemaProperty {
  readonly name: string;
  readonly on: FilterValueType;
  readonly returns: FilterType;
}

/** The Item Query Schema: what a request can name on the active source. */
export interface ItemQuerySchema {
  readonly projectionPathGrammar: typeof PROJECTION_PATH_GRAMMAR;
  /** The built-in fields and the Projection Paths below them. */
  readonly fields: readonly SchemaField[];
  readonly customFields: readonly SchemaCustomField[];
  readonly functions: readonly SchemaFunction[];
  readonly methods: readonly SchemaMethod[];
  readonly properties: readonly SchemaProperty[];
  /** The value types of the Filter Expression language. */
  readonly types: readonly FilterValueType[];
  /** What an omitted argument means. `limit: null`: every match. */
  readonly defaults: {
    readonly fields: readonly string[];
    readonly sort: readonly SortSpec[];
    readonly limit: number | null;
  };
}

/**
 * Describe Item Query on the active Zotero source: its fields, Projection
 * Paths, custom fields, functions, and types, read from the registries that
 * execution uses.
 */
export function describeItemQuery(): Effect.Effect<
  ItemQuerySchema,
  ItemQueryLayoutError | ItemQueryDatabaseError,
  ItemQueryDatabase
> {
  return describeQuery(ITEMS, describeItemQueryVocabulary());
}

/**
 * The schema of a Query Dataset on the active Zotero source: its vocabulary,
 * the custom fields of the source, and the defaults of the dataset.
 */
export function describeQuery<Vocabulary extends object>(
  dataset: QueryDataset<any>,
  vocabulary: Vocabulary,
): Effect.Effect<
  Vocabulary & Pick<ItemQuerySchema, "customFields" | "defaults">,
  ItemQueryLayoutError | ItemQueryDatabaseError,
  ItemQueryDatabase
> {
  return Effect.map(describeQueryCustomFields(dataset), (customFields) => ({
    ...vocabulary,
    customFields,
    defaults: {
      fields: [...dataset.defaultFields],
      sort: dataset.defaultSort.map(({ field, direction }) => ({
        field,
        direction,
      })),
      limit: null,
    },
  }));
}

/** The source-independent Item Query vocabulary, generated into the package asset. */
export function describeItemQueryVocabulary(): Omit<
  ItemQuerySchema,
  "customFields" | "defaults"
> {
  return {
    projectionPathGrammar: PROJECTION_PATH_GRAMMAR,
    fields: BUILT_IN_FIELDS,
    functions: FUNCTIONS,
    methods: METHODS,
    properties: PROPERTIES,
    types: VALUE_TYPES,
  };
}

const PROJECTION_PATH_GRAMMAR = {
  member: { syntax: ".name", description: "Read an object member." },
  index: {
    syntax: "[0]",
    description: "Read one list element by its zero-based index.",
  },
  key: {
    syntax: '["exact key"]',
    description: "Read an object member with a JSON-quoted key.",
  },
  each: {
    syntax: "[]",
    description:
      "Map the remaining path over each list element, preserving order and null positions. Repeat [] for nested lists.",
  },
} as const;

const BUILT_IN_FIELDS: readonly SchemaField[] = BUILT_IN_NAMES.flatMap(
  (name) => {
    const definition = fieldDefinition(name);
    const filter = filterField(name);
    const filterType = filter?.filterable ? filter.value.type : null;
    if (!definition) {
      // A name only a filter reads.
      return [
        {
          path: name,
          type: jsonTypeOf(filterType!),
          filter: filterType,
          projection: false,
          sort: false,
        },
      ];
    }
    const root: SchemaField = {
      path: name,
      type: jsonType(definition.shape),
      filter: filterType,
      projection: true,
      sort: ITEMS.sortable(name) !== undefined,
      ...(definition.relation && { relation: definition.relation().id }),
      ...(definition.valueForms && { valueForms: definition.valueForms }),
    };
    return [root, ...pathsBelow(name, definition.shape)];
  },
);

/**
 * What a Filter Expression reads when its text is the path: the answer of the
 * validation that every filter passes through.
 */
function filterCapability(path: string): SchemaCapabilities["filter"] {
  const plan = planFilter(path);
  if (!("root" in plan)) return null;
  const type = plan.root.valueType;
  return type === "unknown" ? "any" : type === "null" ? null : type;
}

/**
 * The Projection Paths below a value. Index 0 represents numeric access;
 * [] projects the remaining path over every element of a list.
 */
export function pathsBelow(
  path: string,
  shape: ValueShape,
  capability = filterCapability,
): SchemaField[] {
  const below = (child: string, childShape: ValueShape): SchemaField[] => [
    {
      path: child,
      ...(childShape.kind === "record" && {
        relation: childShape.vocabulary().id,
      }),
      type: jsonType(childShape),
      filter: capability(child),
      projection: true,
      sort: false,
    },
    ...pathsBelow(child, childShape, capability),
  ];
  switch (shape.kind) {
    case "scalar":
    case "json":
    case "custom-fields":
      // The custom fields are listed with the source in `customFields`.
      return [];
    case "record": {
      const vocabulary = shape.vocabulary();
      return vocabulary.summary.flatMap((name) =>
        below(`${path}.${name}`, vocabulary.field(name)!.shape),
      );
    }
    case "object":
      return Object.entries(shape.keys).flatMap(([key, child]) =>
        below(`${path}.${key}`, child),
      );
    case "list":
      return [
        ...below(`${path}.length`, { kind: "scalar", type: "number" }),
        ...below(`${path}[0]`, shape.element),
        ...below(`${path}[]`, shape.element).map((field) => ({
          ...field,
          type: "array" as const,
        })),
      ];
  }
}

export function jsonType(shape: ValueShape): JsonType {
  switch (shape.kind) {
    case "scalar":
      return shape.type;
    case "json":
      return "any";
    case "object":
    case "record":
    case "custom-fields":
      return "object";
    case "list":
      return "array";
  }
}

/** The JSON type of a filter value: dates and durations are ISO strings. */
function jsonTypeOf(type: FilterType): JsonType {
  return type === "list"
    ? "array"
    : type === "number" || type === "boolean"
      ? type
      : "string";
}

const parameter = ({
  name,
  type,
  nullable,
  values,
}: FunctionParameter): SchemaParameter => ({
  name,
  type,
  ...(nullable && { nullable }),
  ...(values && { values }),
});

function signature(
  definition: Pick<
    FunctionDefinition,
    "parameters" | "optional" | "rest" | "returns"
  >,
): Omit<SchemaFunction, "name"> {
  return {
    parameters: definition.parameters.map(parameter),
    optional: (definition.optional ?? []).map(parameter),
    rest: definition.rest ? parameter(definition.rest) : null,
    returns: definition.returns,
  };
}

const FUNCTIONS: readonly SchemaFunction[] = [
  // `if` evaluates only the branch that its condition selects.
  { name: "if", ...signature({ ...IF_FUNCTION, returns: null }) },
  ...[...GLOBAL_FUNCTIONS].map(([name, definition]) => ({
    name,
    ...signature(definition),
  })),
];

const METHODS: readonly SchemaMethod[] = METHOD_ENTRIES.map(
  ([on, name, definition]) => ({
    name,
    on,
    ...signature(definition),
    ...(definition.scope && { scope: definition.scope }),
  }),
);

const PROPERTIES: readonly SchemaProperty[] = PROPERTY_ENTRIES.map(
  ([on, name, property]) => ({ name, on, returns: property.returns }),
);
