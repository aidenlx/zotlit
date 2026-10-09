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

import {
  annotationPageIndex,
  ANNOTATION_POSITION_SHAPE,
  readAnnotationPosition,
} from "./annotation-position";
import { compareStrings } from "./collation";
import type { SortableField } from "./dataset";
import { fieldDefinition, filterField, customFilterValue } from "./fields";
import type { FieldDefinition, QueryItem, ValueShape } from "./fields";
import { timestamp } from "./filter-dates";
import { planFilter } from "./filter-plan";
import type { FilterRegistry } from "./filter-plan";
import type { FilterValue } from "./filter-values";
import type { ProjectionValue } from "./request";

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
const field = (
  shape: ValueShape,
  read: (item: QueryAnnotation) => ProjectionValue,
): FieldDefinition<QueryAnnotation> => ({
  shape,
  needs: () => ({}),
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

export const ANNOTATION_FIELDS = new Map<
  string,
  FieldDefinition<QueryAnnotation>
>([
  [
    "position",
    field(
      ANNOTATION_POSITION_SHAPE,
      (item) => readAnnotationPosition(item.annotation) as ProjectionValue,
    ),
  ],
  ["type", field(string, (item) => annotationTypeToName(item.annotation.type))],
  ...(["text", "comment", "color", "pageLabel", "authorName"] as const).map(
    (name) => [name, field(string, (item) => item.annotation[name])] as const,
  ),
  [
    "colorName",
    field(string, (item) => annotationColorToName(item.annotation.color)),
  ],
  ["pageIndex", field(number, (item) => annotationPageIndex(item.annotation))],
  [
    "tags",
    field({ kind: "list", element: string }, (item) =>
      item.annotation.tags.toSorted(compareStrings),
    ),
  ],
  ["sortIndex", field(string, (item) => item.scan.sortIndex)],
  [
    "dateAdded",
    field(string, (item) =>
      item.scan.dateAdded === null
        ? null
        : Temporal.Instant.fromEpochMilliseconds(item.scan.dateAdded),
    ),
  ],
  [
    "dateModified",
    field(string, (item) =>
      item.scan.dateModified === null
        ? null
        : Temporal.Instant.fromEpochMilliseconds(item.scan.dateModified),
    ),
  ],
  [
    "hasExcerptImage",
    field(boolean, (item) => annotationHasCacheImage(item.annotation.type)),
  ],
  [
    "attachment",
    field(
      {
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
      (item) => ({
        indexedKey: formatIndexedKey(item.scan.attachmentKey, item.groupID),
        title: item.annotation.attachment.title,
        contentType: item.annotation.attachment.contentType,
        linkMode:
          item.annotation.attachment.linkMode === null
            ? null
            : linkModeToName(item.annotation.attachment.linkMode),
        ...item.file,
      }),
    ),
  ],
]);

export function annotationFieldDefinition(
  name: string,
): FieldDefinition<QueryAnnotation> | undefined {
  if (name === "item.indexedKey")
    return field(string, (item) =>
      formatIndexedKey(item.scan.parent.key, item.groupID),
    );
  if (name === "item")
    return {
      shape: {
        kind: "object",
        keys: { indexedKey: string, title: string, citationKey: string },
      },
      needs: () => ({ builtIn: ["title", "citationKey"] }),
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
const ANNOTATION_SORTABLE = new Map<string, SortableField<QueryAnnotation>>([
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
): SortableField<QueryAnnotation> | undefined {
  return ANNOTATION_SORTABLE.get(name);
}

export const annotationFilterRegistry: FilterRegistry<QueryAnnotation> = {
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
      value: {
        ...parent.value,
        read: (item) => parent.value.read(item.parent),
      },
    };
  },
};
export const planAnnotationFilter = (text: string) =>
  planFilter(text, annotationFilterRegistry);
