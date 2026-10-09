import { ATTACHMENT_FIELDS } from "./attachment-fields";
import {
  describeItemQueryVocabulary,
  describeQuery,
  pathsBelow,
  jsonType,
} from "./describe-item-query";
import type { SchemaCapabilities, SchemaField } from "./describe-item-query";
import { ATTACHMENTS } from "./query-attachments";

const filterCapability = (path: string): SchemaCapabilities["filter"] => {
  const plan = ATTACHMENTS.planFilter(path);
  if ("kind" in plan) return null;
  const type = plan.root.valueType;
  return type === "unknown" ? "any" : type === "null" ? null : type;
};

/** Source-independent Attachment vocabulary; generated only at build time. */
export function describeAttachmentQueryVocabulary() {
  const item = describeItemQueryVocabulary();
  const fields: SchemaField[] = [...ATTACHMENT_FIELDS].flatMap(
    ([path, definition]) => [
      {
        path,
        type: jsonType(definition.shape),
        projection: true,
        filter: filterCapability(path),
        sort: false,
        ...(definition.valueForms && { valueForms: definition.valueForms }),
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
      filter: "string",
      sort: false,
    },
    {
      path: "item",
      relation: "items",
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
      sort: ATTACHMENTS.sortable(field.path) !== undefined,
    })),
    defaults: {
      fields: [...ATTACHMENTS.defaultFields],
      sort: [...ATTACHMENTS.defaultSort],
      limit: null,
    },
  };
}

export const describeAttachmentQuery = () =>
  describeQuery(ATTACHMENTS, describeAttachmentQueryVocabulary());
