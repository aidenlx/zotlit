import { linkModeToName } from "@zotlit/db";
import type {
  AttachmentScanRow,
  HydratedAttachment,
} from "@zotlit/db/item-query";

import type { QueryAnnotation } from "./annotation-fields";
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
import { definitionFilter, recordField } from "./record-field";
import { annotationVocabulary } from "./record-vocabularies";
import { itemVocabulary } from "./record-vocabularies";
import type { ProjectionValue } from "./request";

type FieldDefinition = ItemFieldDefinition<QueryAttachment, AttachmentNeeds>;

export interface QueryAttachment {
  readonly annotations?: readonly QueryAnnotation[];
  readonly scan: AttachmentScanRow;
  readonly attachment: HydratedAttachment;
  readonly parent: QueryItem;
  readonly groupID: number | null;
  readonly file: { readonly path: string | null; readonly exists: boolean };
}

export const DEFAULT_ATTACHMENT_FIELDS = [
  "title",
  "contentType",
  "linkMode",
  "path",
  "exists",
  "item.title",
  "item.citationKey",
] as const;
const string: ValueShape = { kind: "scalar", type: "string" };
const boolean: ValueShape = { kind: "scalar", type: "boolean" };
const DETAILS: AttachmentNeeds = { details: true };
const field = (
  shape: ValueShape,
  needs: AttachmentNeeds,
  read: (item: QueryAttachment) => ProjectionValue,
): FieldDefinition => ({
  shape,
  needs: () => needs,
  read,
  ...(shape.kind === "scalar" || shape.kind === "list"
    ? {
        filter: {
          type: shape.kind === "list" ? ("list" as const) : shape.type,
          read: (item: QueryAttachment) => read(item) as FilterValue,
        },
      }
    : {}),
});

export const ATTACHMENT_FIELDS = new Map<string, FieldDefinition>([
  [
    "annotations",
    recordField({
      vocabulary: () => annotationVocabulary(),
      list: true,
      rows: (item) => item.annotations ?? [],
      needs: (annotations) => ({ annotations }),
    }),
  ],
  ["library", libraryField],
  ["indexedKey", indexedKeyField],
  ["key", keyField],
  [
    "title",
    field(string, DETAILS, (item) =>
      item.attachment.details?.title == null
        ? null
        : String(item.attachment.details.title),
    ),
  ],
  [
    "contentType",
    field(
      string,
      DETAILS,
      (item) => item.attachment.details?.contentType ?? null,
    ),
  ],
  [
    "fileType",
    {
      ...field(string, DETAILS, (item) => {
        const details = item.attachment.details;
        if (details?.linkMode === 3) return "web";
        switch (details?.contentType) {
          case "application/pdf":
            return "pdf";
          case "application/epub+zip":
            return "epub";
          case "text/html":
          case "application/xhtml+xml":
            return "web";
          default:
            return "other";
        }
      }),
      valueForms: ["pdf", "epub", "web", "other"],
    },
  ],
  [
    "linkMode",
    {
      ...field(string, DETAILS, (item) =>
        item.attachment.details?.linkMode == null
          ? null
          : linkModeToName(item.attachment.details.linkMode),
      ),
      valueForms: [
        "imported_file",
        "imported_url",
        "linked_file",
        "linked_url",
      ],
    },
  ],
  ["path", field(string, { file: true }, (item) => item.file.path)],
  ["exists", field(boolean, { file: true }, (item) => item.file.exists)],
  [
    "url",
    field(string, DETAILS, (item) => {
      const details = item.attachment.details;
      return details &&
        (details.linkMode === 1 || details.linkMode === 3) &&
        details.url !== null
        ? String(details.url)
        : null;
    }),
  ],
  [
    "tags",
    field({ kind: "list", element: string }, { tags: true }, (item) =>
      (item.attachment.tags ?? []).toSorted(compareStrings),
    ),
  ],
  ...(["dateAdded", "dateModified"] as const).map(
    (name) =>
      [
        name,
        field(string, {}, (item) =>
          item.scan[name] === null
            ? null
            : Temporal.Instant.fromEpochMilliseconds(item.scan[name]),
        ),
      ] as const,
  ),
]);

const itemParent = liftParentRecord({
  name: "item",
  vocabulary: () => itemVocabulary(),
  read: (row: QueryAttachment) => row.parent,
  identity: (row: QueryAttachment) => ({
    scan: row.scan.parent,
    groupID: row.groupID,
  }),
  needs: (item: readonly FieldNeeds[]): AttachmentNeeds => ({ item }),
  candidates: "all",
  sortable: ["indexedKey", "key", "title", "date", "dateModified"],
  listed: () => BUILT_IN_NAMES,
  syntax: "fields",
});
export const ATTACHMENT_PARENTS = [itemParent];

export function attachmentFieldDefinition(
  name: string,
): FieldDefinition | undefined {
  return (
    ATTACHMENT_FIELDS.get(name) ??
    ATTACHMENT_PARENTS.map((parent) => parent.definition(name)).find(
      (field) => field !== undefined,
    )
  );
}

for (const name of ["dateAdded", "dateModified"] as const) {
  const definition = ATTACHMENT_FIELDS.get(name)!;
  ATTACHMENT_FIELDS.set(name, {
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
for (const name of ["title", "contentType", "fileType", "linkMode"]) {
  const definition = ATTACHMENT_FIELDS.get(name)!;
  ATTACHMENT_FIELDS.set(name, {
    ...definition,
    sortKey: (item) => definition.read(item) as string | number | null,
  });
}

/**
 * The Sortable Fields of Attachment Query, including its parent scalar paths.
 */
export const ATTACHMENT_SORT_FIELDS = parentSortFields(
  [
    "indexedKey",
    "key",
    "dateAdded",
    "dateModified",
    "title",
    "contentType",
    "fileType",
    "linkMode",
  ],
  ATTACHMENT_PARENTS,
);

export function attachmentSortableField(
  name: string,
): SortableField<QueryAttachment, AttachmentNeeds> | undefined {
  const parent = ATTACHMENT_PARENTS.map((parent) => parent.sortable(name)).find(
    (field) => field !== undefined,
  );
  if (parent) return parent;
  const definition = ATTACHMENT_FIELDS.get(name);
  return definition?.sortKey
    ? { needs: definition.needs([]), key: definition.sortKey }
    : undefined;
}

export const attachmentFilterRegistry: FilterRegistry<
  QueryAttachment,
  AttachmentNeeds
> = {
  prefix: itemParent.name,
  field(name) {
    return (
      definitionFilter(ATTACHMENT_FIELDS.get(name)) ??
      ATTACHMENT_PARENTS.map((parent) => parent.filter(name)).find(
        (field) => field !== undefined,
      )
    );
  },
  custom: itemParent.custom,
};
