import { formatIndexedKey } from "@zotlit/db";

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
import type { QueryItem, FieldNeeds, FieldDefinition } from "./fields";
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

const identity = <
  Row extends { scan: { key: string }; groupID: number | null },
  Needs,
>(): FieldDefinition<Row, Needs> => ({
  shape: { kind: "scalar", type: "string" },
  needs: () => ({}) as Needs,
  read: (row) => formatIndexedKey(row.scan.key, row.groupID),
});

export const itemVocabulary = (): RecordVocabulary<QueryItem, FieldNeeds> => ({
  id: "items",
  summary: ITEM_SUMMARY,
  field: (name) => (name === "indexedKey" ? identity() : fieldDefinition(name)),
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
  field: attachmentFieldDefinition,
  filter: attachmentFilterRegistry,
});
export const annotationVocabulary = (): RecordVocabulary<
  QueryAnnotation,
  AnnotationNeeds
> => ({
  id: "annotations",
  summary: ANNOTATION_SUMMARY,
  field: (name) =>
    name === "indexedKey" ? identity() : annotationFieldDefinition(name),
  filter: annotationFilterRegistry,
});
