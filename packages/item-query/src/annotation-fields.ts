import {
  annotationColorToName,
  annotationHasCacheImage,
  annotationTypeToName,
  formatIndexedKey,
} from "@zotlit/db";
import { linkModeToName } from "@zotlit/db";
import type {
  AnnotationScanRow,
  HydratedAnnotation,
} from "@zotlit/db/item-query";

import { annotationPageIndex } from "./annotation-position";
import { compareStrings } from "./collation";
import { fieldDefinition } from "./fields";
import type { FieldDefinition, QueryItem, ValueShape } from "./fields";
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
): FieldDefinition<QueryAnnotation> => ({ shape, needs: () => ({}), read });

export const ANNOTATION_FIELDS = new Map<
  string,
  FieldDefinition<QueryAnnotation>
>([
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
  if (!name.startsWith("item.")) return ANNOTATION_FIELDS.get(name);
  if (name !== "item.title" && name !== "item.citationKey") return undefined;
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
