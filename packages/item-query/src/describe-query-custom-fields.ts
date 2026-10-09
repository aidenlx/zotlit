import { Effect } from "effect";

import { readFieldVocabulary } from "@zotlit/db/item-query";
import type {
  ItemQueryDatabase,
  ItemQueryDatabaseError,
  ItemQueryLayoutError,
} from "@zotlit/db/item-query";

import type { QueryDataset } from "./dataset";
import type { SchemaCustomField } from "./describe-item-query";
import {
  CUSTOM_FIELD_VALUE_SHAPE,
  customFilterValue,
  fieldDefinition,
} from "./fields";
import type { ValueShape } from "./fields";
import { hasBareForm } from "./filter-plan";

/**
 * The custom fields supplied by the active Zotero source, at the paths the
 * Query Dataset reads them.
 */
export function describeQueryCustomFields(
  dataset: QueryDataset<any>,
): Effect.Effect<
  readonly SchemaCustomField[],
  ItemQueryLayoutError | ItemQueryDatabaseError,
  ItemQueryDatabase
> {
  return Effect.map(readFieldVocabulary(), ({ customFieldNames }) =>
    customFieldNames.map((name) => {
      const field = customSchemaField(name);
      return { ...field, path: dataset.customPrefix + field.path };
    }),
  );
}

function customSchemaField(name: string): SchemaCustomField {
  const custom = fieldDefinition("custom")!;
  const { value } = customFilterValue(name);
  return {
    name,
    path: `custom[${JSON.stringify(name)}]`,
    bareName: hasBareForm(name),
    type: jsonType(CUSTOM_FIELD_VALUE_SHAPE),
    filter: value.type,
    projection: true,
    sort: custom.sortKey !== undefined,
  };
}

function jsonType(shape: ValueShape): SchemaCustomField["type"] {
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
