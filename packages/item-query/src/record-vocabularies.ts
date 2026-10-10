import {
  annotationFieldDefinition,
  annotationFilterRegistry,
} from "./annotation-fields";
import type { QueryAnnotation } from "./annotation-fields";
import type { AnnotationNeeds } from "./annotation-hydration";
import {
  attachmentFieldDefinition,
  attachmentFilterRegistry,
} from "./attachment-fields";
import type { QueryAttachment } from "./attachment-fields";
import type { AttachmentNeeds } from "./attachment-hydration";
import { fieldDefinition, itemFilterRegistry } from "./fields";
import type { QueryItem, FieldNeeds } from "./fields";
import type { RecordVocabulary } from "./record-field";

export const ITEM_SUMMARY = ["indexedKey", "title", "citationKey"] as const;
export const ATTACHMENT_SUMMARY = [
  "indexedKey",
  "title",
  "contentType",
  "linkMode",
  "path",
  "exists",
] as const;
export const ANNOTATION_SUMMARY = [
  "indexedKey",
  "type",
  "text",
  "comment",
  "pageLabel",
  "pageIndex",
] as const;

export const itemVocabulary = (): RecordVocabulary<QueryItem, FieldNeeds> => ({
  id: "items",
  summary: ITEM_SUMMARY,
  projectionFields: [...ITEM_SUMMARY, "key"],
  field: fieldDefinition,
  filter: {
    ...itemFilterRegistry,
    field: (name) => {
      if (name === "custom")
        return {
          filterable: true,
          needs: {},
          value: {
            type: "record",
            read: (row) => ({
              type: "record",
              identity: row.hydrated.custom,
              read: (key) => row.hydrated.custom.get(key) ?? null,
            }),
          },
          navigation: {
            member: (key) => ({
              filterable: true,
              customField: key,
              needs: { custom: [key] },
              value: {
                type: "string",
                read: (value) =>
                  value &&
                  typeof value === "object" &&
                  "type" in value &&
                  value.type === "record"
                    ? value.read(key)
                    : null,
              },
            }),
          },
        };
      return itemFilterRegistry.field(name);
    },
  },
});
export const attachmentVocabulary = (): RecordVocabulary<
  QueryAttachment,
  AttachmentNeeds
> => ({
  id: "attachments",
  summary: ATTACHMENT_SUMMARY,
  projectionFields: [...ATTACHMENT_SUMMARY, "key", "fileType"],
  field: attachmentFieldDefinition,
  filter: attachmentFilterRegistry,
});
export const annotationVocabulary = (): RecordVocabulary<
  QueryAnnotation,
  AnnotationNeeds
> => ({
  id: "annotations",
  summary: ANNOTATION_SUMMARY,
  projectionFields: [...ANNOTATION_SUMMARY, "key"],
  field: annotationFieldDefinition,
  filter: annotationFilterRegistry,
});
