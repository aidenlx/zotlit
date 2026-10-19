import {
  ANNOTATION_PARENTS,
  annotationFieldDefinition,
  annotationFilterRegistry,
} from "./annotation-fields";
import type { QueryAnnotation } from "./annotation-fields";
import type { AnnotationNeeds } from "./annotation-hydration";
import {
  ATTACHMENT_PARENTS,
  attachmentFieldDefinition,
  attachmentFilterRegistry,
} from "./attachment-fields";
import type { QueryAttachment } from "./attachment-fields";
import type { AttachmentNeeds } from "./attachment-hydration";
import { ACTIVITY_FIELDS, fieldDefinition, itemFilterRegistry } from "./fields";
import type { QueryItem, FieldNeeds } from "./fields";
import {
  NOTE_PARENTS,
  noteFieldDefinition,
  noteFilterRegistry,
} from "./note-fields";
import type { QueryNote } from "./note-fields";
import type { NoteNeeds } from "./note-hydration";
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
export const NOTE_SUMMARY = ["indexedKey", "title"] as const;

export const itemVocabulary = (): RecordVocabulary<QueryItem, FieldNeeds> => ({
  id: "items",
  summary: ITEM_SUMMARY,
  projectionFields: [...ITEM_SUMMARY, "key"],
  field: (name) =>
    ACTIVITY_FIELDS.has(name) ? undefined : fieldDefinition(name),
  filter: {
    ...itemFilterRegistry,
    field: (name) => {
      if (ACTIVITY_FIELDS.has(name)) return undefined;
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
  parents: ATTACHMENT_PARENTS,
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
  parents: ANNOTATION_PARENTS,
  summary: ANNOTATION_SUMMARY,
  projectionFields: [...ANNOTATION_SUMMARY, "key"],
  field: annotationFieldDefinition,
  filter: annotationFilterRegistry,
});

export const noteVocabulary = (): RecordVocabulary<QueryNote, NoteNeeds> => ({
  id: "notes",
  parents: NOTE_PARENTS,
  summary: NOTE_SUMMARY,
  projectionFields: [...NOTE_SUMMARY, "key", "dateAdded", "dateModified"],
  field: noteFieldDefinition,
  filter: noteFilterRegistry,
});

export const RECORD_VOCABULARIES = {
  items: itemVocabulary,
  attachments: attachmentVocabulary,
  annotations: annotationVocabulary,
  notes: noteVocabulary,
};
