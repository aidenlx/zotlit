import { Effect } from "effect";

import {
  ANNOTATION_FIELDS,
  ANNOTATION_SORT_FIELDS,
  DEFAULT_ANNOTATION_FIELDS,
  planAnnotationFilter,
} from "./annotation-fields";
import { ANNOTATION_POSITION_SHAPES } from "./annotation-position";
import {
  describeItemQueryVocabulary,
  pathsBelow,
  jsonType,
} from "./describe-item-query";
import type { SchemaCapabilities, SchemaField } from "./describe-item-query";
import { describeAnnotationQueryCustomFields } from "./describe-item-query-custom-fields";
import { DEFAULT_ANNOTATION_SORT } from "./query-annotations";

const filterCapability = (path: string): SchemaCapabilities["filter"] => {
  const plan = planAnnotationFilter(path);
  if ("kind" in plan) return null;
  const type = plan.root.valueType;
  return type === "unknown" ? "any" : type === "null" ? null : type;
};

/** Source-independent Annotation vocabulary; generated only at build time. */
export function describeAnnotationQueryVocabulary() {
  const item = describeItemQueryVocabulary();
  const fields: SchemaField[] = [...ANNOTATION_FIELDS].flatMap(
    ([path, definition]) => [
      {
        path,
        type: jsonType(definition.shape),
        projection: true,
        filter: filterCapability(path),
        sort: ANNOTATION_SORT_FIELDS.has(path),
      },
      ...pathsBelow(path, definition.shape, filterCapability),
    ],
  );
  fields.push(
    ...item.fields.map((field) => ({
      ...field,
      path: `item.${field.path}`,
      sort: ANNOTATION_SORT_FIELDS.has(`item.${field.path}`),
    })),
  );
  fields.push(
    {
      path: "item.indexedKey",
      type: "string",
      projection: true,
      filter: null,
      sort: false,
    },
    {
      path: "item",
      type: "object",
      projection: true,
      filter: null,
      sort: false,
    },
  );
  return { ...item, fields, positionKinds: ANNOTATION_POSITION_SHAPES };
}

export const describeAnnotationQuery = () =>
  Effect.map(describeAnnotationQueryCustomFields(), (customFields) => ({
    ...describeAnnotationQueryVocabulary(),
    customFields,
    defaults: {
      fields: DEFAULT_ANNOTATION_FIELDS,
      sort: DEFAULT_ANNOTATION_SORT,
      limit: null,
    },
  }));
