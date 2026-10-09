import {
  annotationColorToName,
  annotationColorsForName,
  annotationHasCacheImage,
  annotationTypeToName,
  formatIndexedKey,
} from "@zotlit/db";
import { linkModeToName } from "@zotlit/db";
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
import type { ProjectionValue } from "./request";

type FieldDefinition = ItemFieldDefinition<QueryAnnotation, AnnotationNeeds>;

export interface QueryAnnotation {
  readonly scan: AnnotationScanRow;
  readonly annotation: HydratedAnnotation;
  readonly parent: QueryItem;
  readonly groupID: number | null;
  readonly file: { readonly path: string | null; readonly exists: boolean };
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

/** What a path below `attachment` loads. */
const ATTACHMENT_NEEDS = new Map<string, AnnotationNeeds>([
  ["indexedKey", {}],
  ["title", { attachmentTitle: true }],
  ["contentType", DETAILS],
  ["linkMode", DETAILS],
  ["path", { file: true }],
  ["exists", { file: true }],
]);
const WHOLE_ATTACHMENT_NEEDS: AnnotationNeeds = {
  details: true,
  attachmentTitle: true,
  file: true,
};

export const ANNOTATION_FIELDS = new Map<string, FieldDefinition>([
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
  [
    "attachment",
    {
      shape: {
        kind: "object",
        keys: {
          indexedKey: string,
          title: string,
          contentType: string,
          linkMode: string,
          path: string,
          exists: boolean,
        },
      },
      needs: ([key]) =>
        (typeof key === "string" && ATTACHMENT_NEEDS.get(key)) ||
        WHOLE_ATTACHMENT_NEEDS,
      read: ({ scan, annotation, groupID, file }) => {
        const attachment = annotation.details?.attachment;
        return {
          indexedKey: formatIndexedKey(scan.attachmentKey, groupID),
          title: annotation.attachmentTitle ?? null,
          contentType: attachment?.contentType ?? null,
          linkMode:
            attachment?.linkMode == null
              ? null
              : linkModeToName(attachment.linkMode),
          ...file,
        };
      },
    },
  ],
]);

export function annotationFieldDefinition(
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
  if (!name.startsWith("item.")) return ANNOTATION_FIELDS.get(name);
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
 * the Attachment's Indexed Key within its Library.
 */
const ANNOTATION_SORTABLE = new Map<
  string,
  SortableField<QueryAnnotation, AnnotationNeeds>
>([
  ...[
    "dateAdded",
    "dateModified",
    "type",
    "color",
    "pageIndex",
    "sortIndex",
    "item.title",
    "item.date",
    "item.dateModified",
  ].map((name) => {
    const definition = annotationFieldDefinition(name)!;
    return [
      name,
      { needs: definition.needs([]), key: definition.sortKey! },
    ] as const;
  }),
  [
    "attachment.indexedKey",
    { needs: {}, key: (item) => item.scan.attachmentKey },
  ],
]);

export const ANNOTATION_SORT_FIELDS: readonly string[] = [
  ...ANNOTATION_SORTABLE.keys(),
];

export function annotationSortableField(
  name: string,
): SortableField<QueryAnnotation, AnnotationNeeds> | undefined {
  return ANNOTATION_SORTABLE.get(name);
}

export const annotationFilterRegistry: FilterRegistry<
  QueryAnnotation,
  AnnotationNeeds
> = {
  prefix: "item",
  equalityField: (name, value) =>
    name === "color" && annotationColorsForName(value).length
      ? "colorName"
      : name,
  field(name) {
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
    const definition = ANNOTATION_FIELDS.get(name);
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
export const planAnnotationFilter = (text: string) =>
  planFilter(text, annotationFilterRegistry);
