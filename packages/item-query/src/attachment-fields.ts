import { linkModeToName } from "@zotlit/db";
import type {
  AttachmentScanRow,
  HydratedAttachment,
} from "@zotlit/db/item-query";

import type { QueryAnnotation } from "./annotation-fields";
import type { AttachmentNeeds } from "./attachment-hydration";
import { compareStrings } from "./collation";
import type { SortableField } from "./dataset";
import { fieldDefinition, filterField, customFilterValue } from "./fields";
import type {
  FieldDefinition as ItemFieldDefinition,
  QueryItem,
  ValueShape,
} from "./fields";
import { timestamp } from "./filter-dates";
import type { FilterRegistry } from "./filter-plan";
import type { FilterValue } from "./filter-values";
import { keyField, indexedKeyField } from "./key-fields";
import { libraryField } from "./library-field";
import { definitionFilter, mapNavigation, recordField } from "./record-field";
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

export function attachmentFieldDefinition(
  name: string,
): FieldDefinition | undefined {
  if (name === "item")
    return recordField({
      vocabulary: () => itemVocabulary(),
      list: false,
      rows: (item) => [item.parent],
      needs: (items) => ({ item: items }),
    });
  if (!name.startsWith("item.")) return ATTACHMENT_FIELDS.get(name);
  const parent = fieldDefinition(name.slice(5));
  return parent
    ? {
        ...parent,
        needs: (rest) => ({ item: [parent.needs(rest)] }),
        filterNeeds: { item: [parent.filterNeeds ?? parent.needs([])] },
        navigation: mapNavigation(parent.navigation, (needs) => ({
          item: [needs],
        })),
        project: parent.project
          ? (item, rest) => parent.project!(item.parent, rest)
          : undefined,
        read: (item) => parent.read(item.parent),
        sortKey: parent.sortKey
          ? (item, clock) => parent.sortKey!(item.parent, clock)
          : undefined,
        filter: parent.filter
          ? {
              ...parent.filter,
              read: (item) => parent.filter!.read(item.parent),
            }
          : undefined,
      }
    : undefined;
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
export const ATTACHMENT_SORT_FIELDS: readonly string[] = [
  "indexedKey",
  "key",
  "item.indexedKey",
  "item.key",
  "dateAdded",
  "dateModified",
  "title",
  "contentType",
  "fileType",
  "linkMode",
  "item.title",
  "item.date",
  "item.dateModified",
];

export function attachmentSortableField(
  name: string,
): SortableField<QueryAttachment, AttachmentNeeds> | undefined {
  if (!ATTACHMENT_SORT_FIELDS.includes(name)) return undefined;
  const definition = attachmentFieldDefinition(name)!;
  return { needs: definition.needs([]), key: definition.sortKey! };
}

export const attachmentFilterRegistry: FilterRegistry<
  QueryAttachment,
  AttachmentNeeds
> = {
  prefix: "item",
  field(name) {
    if (name === "item")
      return definitionFilter(attachmentFieldDefinition(name));
    if (name === "item.indexedKey") {
      const definition = attachmentFieldDefinition(name)!;
      return { filterable: true, value: definition.filter!, needs: {} };
    }
    if (name.startsWith("item.")) {
      const parent = filterField(name.slice(5));
      return parent?.filterable
        ? {
            ...parent,
            needs: { item: [parent.needs] },
            navigation: mapNavigation(parent.navigation, (needs) => ({
              item: [needs],
            })),
            value: {
              ...parent.value,
              read: (item) => parent.value.read(item.parent),
            },
          }
        : parent;
    }
    return definitionFilter(ATTACHMENT_FIELDS.get(name));
  },
  custom(name) {
    const parent = customFilterValue(name);
    return {
      ...parent,
      needs: { item: [parent.needs] },
      value: {
        ...parent.value,
        read: (item) => parent.value.read(item.parent),
      },
    };
  },
};
