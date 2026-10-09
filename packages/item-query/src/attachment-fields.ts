import { formatIndexedKey, linkModeToName } from "@zotlit/db";
import type {
  AttachmentScanRow,
  HydratedAttachment,
} from "@zotlit/db/item-query";

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
import { planFilter } from "./filter-plan";
import type { FilterRegistry } from "./filter-plan";
import type { FilterValue } from "./filter-values";
import { libraryField } from "./library-field";
import type { ProjectionValue } from "./request";

type FieldDefinition = ItemFieldDefinition<QueryAttachment, AttachmentNeeds>;

export interface QueryAttachment {
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
  ["library", libraryField],
  [
    "indexedKey",
    field(string, {}, (item) => formatIndexedKey(item.scan.key, item.groupID)),
  ],
  ["key", field(string, {}, (item) => item.scan.key)],
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
  if (name === "item.indexedKey")
    return field(string, {}, (item) =>
      formatIndexedKey(item.scan.parent.key, item.groupID),
    );
  if (name === "item")
    return {
      shape: {
        kind: "object",
        keys: { indexedKey: string, title: string, citationKey: string },
      },
      needs: () => ({ item: { builtIn: ["title", "citationKey"] } }),
      read: (item) => ({
        indexedKey: formatIndexedKey(item.scan.parent.key, item.groupID),
        title: fieldDefinition("title")!.read(item.parent),
        citationKey: fieldDefinition("citationKey")!.read(item.parent),
      }),
    };
  if (!name.startsWith("item.")) return ATTACHMENT_FIELDS.get(name);
  const parent = fieldDefinition(name.slice(5));
  return parent
    ? {
        ...parent,
        needs: (rest) => ({ item: parent.needs(rest) }),
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
for (const name of ["title", "contentType", "linkMode"]) {
  const definition = ATTACHMENT_FIELDS.get(name)!;
  ATTACHMENT_FIELDS.set(name, {
    ...definition,
    sortKey: (item) => definition.read(item) as string | number | null,
  });
}

/**
 * The Sortable Fields of Attachment Query, including its parent scalar paths.
 */
const ATTACHMENT_SORTABLE = new Map<
  string,
  SortableField<QueryAttachment, AttachmentNeeds>
>(
  [
    "dateAdded",
    "dateModified",
    "title",
    "contentType",
    "linkMode",
    "item.title",
    "item.date",
    "item.dateModified",
  ].map((name) => {
    const definition = attachmentFieldDefinition(name)!;
    return [
      name,
      { needs: definition.needs([]), key: definition.sortKey! },
    ] as const;
  }),
);

export const ATTACHMENT_SORT_FIELDS: readonly string[] = [
  ...ATTACHMENT_SORTABLE.keys(),
];

export function attachmentSortableField(
  name: string,
): SortableField<QueryAttachment, AttachmentNeeds> | undefined {
  return ATTACHMENT_SORTABLE.get(name);
}

export const attachmentFilterRegistry: FilterRegistry<
  QueryAttachment,
  AttachmentNeeds
> = {
  prefix: "item",
  field(name) {
    if (name === "item.indexedKey") {
      const definition = attachmentFieldDefinition(name)!;
      return { filterable: true, value: definition.filter!, needs: {} };
    }
    if (name.startsWith("item.")) {
      const parent = filterField(name.slice(5));
      return parent?.filterable
        ? {
            ...parent,
            needs: { item: parent.needs },
            value: {
              ...parent.value,
              read: (item) => parent.value.read(item.parent),
            },
          }
        : parent;
    }
    const definition = ATTACHMENT_FIELDS.get(name);
    return definition?.filter
      ? {
          filterable: true,
          value: definition.filter,
          needs: definition.needs([]),
        }
      : definition
        ? { filterable: false }
        : undefined;
  },
  custom(name) {
    const parent = customFilterValue(name);
    return {
      ...parent,
      needs: { item: parent.needs },
      value: {
        ...parent.value,
        read: (item) => parent.value.read(item.parent),
      },
    };
  },
};
export const planAttachmentFilter = (text: string) =>
  planFilter(text, attachmentFilterRegistry);
