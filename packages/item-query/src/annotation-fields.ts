import {
  annotationColorToName,
  annotationColorsForName,
  annotationHasCacheImage,
  annotationTypeToName,
} from "@zotlit/db";
import type {
  AnnotationScanRow,
  HydratedAnnotation,
} from "@zotlit/db/item-query";

import type { AnnotationNeeds } from "./annotation-hydration";
import {
  annotationPageIndex,
  ANNOTATION_POSITION_SHAPE,
  readAnnotationPosition,
} from "./annotation-position";
import type { QueryAttachment } from "./attachment-fields";
import type { AttachmentNeeds } from "./attachment-hydration";
import { compareStrings } from "./collation";
import type { SortableField } from "./dataset";
import { BUILT_IN_NAMES } from "./fields";
import type {
  FieldDefinition as ItemFieldDefinition,
  QueryItem,
  FieldNeeds,
  ValueShape,
} from "./fields";
import { timestamp } from "./filter-dates";
import type { FilterRegistry } from "./filter-plan";
import type { FilterValue } from "./filter-values";
import { keyField, indexedKeyField } from "./key-fields";
import { libraryField } from "./library-field";
import { liftParentRecord, parentSortFields } from "./parent-records";
import { definitionFilter } from "./record-field";
import { attachmentVocabulary } from "./record-vocabularies";
import { itemVocabulary } from "./record-vocabularies";
import type { ProjectionValue } from "./request";

type FieldDefinition = ItemFieldDefinition<QueryAnnotation, AnnotationNeeds>;

export interface QueryAnnotation {
  readonly scan: AnnotationScanRow;
  readonly annotation: HydratedAnnotation;
  readonly parent: QueryItem;
  readonly groupID: number | null;
  readonly attachmentRecord?: QueryAttachment;
}

export const DEFAULT_ANNOTATION_FIELDS = [
  "type",
  "text",
  "comment",
  "color",
  "colorName",
  "pageLabel",
  "pageIndex",
  "tags",
  "dateAdded",
  "dateModified",
  "hasExcerptImage",
  "attachment",
  "item.title",
  "item.citationKey",
] as const;
const string: ValueShape = { kind: "scalar", type: "string" };
const number: ValueShape = { kind: "scalar", type: "number" };
const boolean: ValueShape = { kind: "scalar", type: "boolean" };
const DETAILS: AnnotationNeeds = { details: true };
const field = (
  shape: ValueShape,
  needs: AnnotationNeeds,
  read: (item: QueryAnnotation) => ProjectionValue,
): FieldDefinition => ({
  shape,
  needs: () => needs,
  read,
  ...(shape.kind === "scalar" || shape.kind === "list"
    ? {
        filter: {
          type: shape.kind === "list" ? ("list" as const) : shape.type,
          read: (item: QueryAnnotation) => read(item) as FilterValue,
        },
      }
    : {}),
});

export const ANNOTATION_FIELDS = new Map<string, FieldDefinition>([
  ["library", libraryField],
  ["indexedKey", indexedKeyField],
  ["key", keyField],
  [
    "position",
    field(ANNOTATION_POSITION_SHAPE, DETAILS, ({ annotation: { details } }) =>
      details ? (readAnnotationPosition(details) as ProjectionValue) : null,
    ),
  ],
  [
    "type",
    field(string, DETAILS, ({ annotation: { details } }) =>
      details ? annotationTypeToName(details.type) : null,
    ),
  ],
  ...(["text", "comment", "color", "pageLabel", "authorName"] as const).map(
    (name) =>
      [
        name,
        field(
          string,
          DETAILS,
          (item) => item.annotation.details?.[name] ?? null,
        ),
      ] as const,
  ),
  [
    "colorName",
    field(string, DETAILS, ({ annotation: { details } }) =>
      details ? annotationColorToName(details.color) : null,
    ),
  ],
  [
    "pageIndex",
    field(number, DETAILS, ({ annotation: { details } }) =>
      details ? annotationPageIndex(details) : null,
    ),
  ],
  [
    "tags",
    field({ kind: "list", element: string }, { tags: true }, (item) =>
      (item.annotation.tags ?? []).toSorted(compareStrings),
    ),
  ],
  ["sortIndex", field(string, {}, (item) => item.scan.sortIndex)],
  [
    "dateAdded",
    field(string, {}, (item) =>
      item.scan.dateAdded === null
        ? null
        : Temporal.Instant.fromEpochMilliseconds(item.scan.dateAdded),
    ),
  ],
  [
    "dateModified",
    field(string, {}, (item) =>
      item.scan.dateModified === null
        ? null
        : Temporal.Instant.fromEpochMilliseconds(item.scan.dateModified),
    ),
  ],
  [
    "hasExcerptImage",
    field(boolean, DETAILS, ({ annotation: { details } }) =>
      details ? annotationHasCacheImage(details.type) : null,
    ),
  ],
]);

const itemParent = liftParentRecord({
  name: "item",
  vocabulary: () => itemVocabulary(),
  read: (row: QueryAnnotation) => row.parent,
  identity: (row: QueryAnnotation) => ({
    scan: row.scan.parent,
    groupID: row.groupID,
  }),
  needs: (item: readonly FieldNeeds[]): AnnotationNeeds => ({ item }),
  candidates: "all",
  sortable: ["indexedKey", "key", "title", "date", "dateModified"],
  listed: () => BUILT_IN_NAMES,
  syntax: "fields",
});
const attachmentParent = liftParentRecord({
  name: "attachment",
  vocabulary: () => attachmentVocabulary(),
  read: (row: QueryAnnotation) => row.attachmentRecord,
  identity: (row: QueryAnnotation) => ({
    scan: { key: row.scan.attachmentKey },
    groupID: row.groupID,
  }),
  needs: (attachment: readonly AttachmentNeeds[]): AnnotationNeeds => ({
    attachment,
  }),
  candidates: ["indexedKey", "key"],
  sortable: ["indexedKey", "key"],
  listed: [
    "indexedKey",
    "title",
    "contentType",
    "linkMode",
    "path",
    "exists",
    "key",
    "fileType",
  ],
  syntax: "record",
});
export const ANNOTATION_PARENTS = [attachmentParent, itemParent];

export function annotationFieldDefinition(
  name: string,
): FieldDefinition | undefined {
  return (
    ANNOTATION_FIELDS.get(name) ??
    ANNOTATION_PARENTS.map((parent) => parent.definition(name)).find(
      (field) => field !== undefined,
    )
  );
}

for (const name of ["dateAdded", "dateModified"] as const) {
  const definition = ANNOTATION_FIELDS.get(name)!;
  ANNOTATION_FIELDS.set(name, {
    ...definition,
    filter: {
      type: "date",
      read: (item) =>
        item.scan[name] === null
          ? null
          : timestamp(Temporal.Instant.fromEpochMilliseconds(item.scan[name])),
    },
    sortKey: (item) => item.scan[name],
  });
}
for (const name of ["type", "color", "pageIndex", "sortIndex"]) {
  const definition = ANNOTATION_FIELDS.get(name)!;
  ANNOTATION_FIELDS.set(name, {
    ...definition,
    sortKey: (item) => definition.read(item) as string | number | null,
  });
}

/**
 * The Sortable Fields of Annotation Query. `attachment.indexedKey` orders by
 * the Attachment's Indexed Key across the Target Libraries.
 */
export const ANNOTATION_SORT_FIELDS = parentSortFields(
  [
    "indexedKey",
    "key",
    "dateAdded",
    "dateModified",
    "type",
    "color",
    "pageIndex",
    "sortIndex",
  ],
  ANNOTATION_PARENTS,
);

export function annotationSortableField(
  name: string,
): SortableField<QueryAnnotation, AnnotationNeeds> | undefined {
  const parent = ANNOTATION_PARENTS.map((parent) => parent.sortable(name)).find(
    (field) => field !== undefined,
  );
  if (parent) return parent;
  const definition = ANNOTATION_FIELDS.get(name);
  return definition?.sortKey
    ? { needs: definition.needs([]), key: definition.sortKey }
    : undefined;
}

export const annotationFilterRegistry: FilterRegistry<
  QueryAnnotation,
  AnnotationNeeds
> = {
  prefix: itemParent.name,
  equalityField: (name, value) =>
    name === "color" && annotationColorsForName(value).length
      ? "colorName"
      : name,
  field(name) {
    return (
      definitionFilter(ANNOTATION_FIELDS.get(name)) ??
      ANNOTATION_PARENTS.map((parent) => parent.filter(name)).find(
        (field) => field !== undefined,
      )
    );
  },
  custom: itemParent.custom,
};
