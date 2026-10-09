import { ANNOTATION_FIELDS } from "./annotation-fields";
import { ANNOTATION_POSITION_SHAPES } from "./annotation-position";
import {
  describeItemQueryVocabulary,
  describeQuery,
  pathsBelow,
  jsonType,
} from "./describe-item-query";
import type { SchemaCapabilities, SchemaField } from "./describe-item-query";
import { ANNOTATIONS } from "./query-annotations";

const filterCapability = (path: string): SchemaCapabilities["filter"] => {
  const plan = ANNOTATIONS.planFilter(path);
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
        sort: false,
      },
      ...pathsBelow(path, definition.shape, filterCapability),
    ],
  );
  fields.push(
    ...item.fields.map((field) => ({
      ...field,
      path: `item.${field.path}`,
      sort: false,
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
  return {
    ...item,
    fields: fields.map((field) => ({
      ...field,
      sort: ANNOTATIONS.sortable(field.path) !== undefined,
    })),
    positionKinds: ANNOTATION_POSITION_SHAPES,
  };
}

export const describeAnnotationQuery = () =>
  describeQuery(ANNOTATIONS, describeAnnotationQueryVocabulary());
