import { Effect } from "effect";

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
import { openQuerySources } from "./query-sources";

/**
 * The custom fields supplied by the active Zotero source, at the paths the
 * Query Dataset reads them.
 */
export const describeQueryCustomFields = Effect.fnUntraced(function* (
  dataset: QueryDataset<any>,
): Effect.fn.Return<
  readonly SchemaCustomField[],
  ItemQueryLayoutError | ItemQueryDatabaseError,
  ItemQueryDatabase
> {
  const sources = yield* openQuerySources;
  const { customFieldNames } = yield* sources.vocabulary();
  return customFieldNames.map((name) => {
    const field = customSchemaField(name);
    return { ...field, path: dataset.customPrefix + field.path };
  });
});

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
    group: true,
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
