import { Effect } from "effect";

import {
  readItemAttachments,
  readItemAnnotations,
  readAttachmentAnnotations,
  HYDRATE_CHUNK_SIZE,
} from "@zotlit/db/item-query";
import type {
  AttachmentScanRow,
  AnnotationScanRow,
  ItemQueryDatabase,
  ItemQueryReaderError,
  ScanRow,
} from "@zotlit/db/item-query";

import type { Loader } from "./record-loader";
import type { TargetLibrary } from "./request";

/** Raw Relation Lists live only for one root hydrate chunk, including its nested loads. */
export interface RelationChunk {
  readonly values: WeakMap<object, Map<number, readonly unknown[]>>;
  readonly attachments: Map<number, readonly AttachmentScanRow[]>;
  readonly itemAnnotations: Map<number, readonly AnnotationScanRow[]>;
  readonly attachmentAnnotations: Map<number, readonly AnnotationScanRow[]>;
}

export const relationChunk = (): RelationChunk => ({
  values: new WeakMap(),
  attachments: new Map(),
  itemAnnotations: new Map(),
  attachmentAnnotations: new Map(),
});

const readCached = Effect.fnUntraced(function* <Row>(
  cache: Map<number, readonly Row[]>,
  {
    ids,
    read,
    parentID,
  }: {
    readonly ids: readonly number[];
    readonly read: (
      ids: readonly number[],
    ) => Effect.Effect<readonly Row[], ItemQueryReaderError, ItemQueryDatabase>;
    readonly parentID: (row: Row) => number;
  },
) {
  const missing = [...new Set(ids)].filter((id) => !cache.has(id));
  if (missing.length) {
    const rows = yield* read(missing);
    const groups = new Map<number, Row[]>(missing.map((id) => [id, []]));
    for (const row of rows) groups.get(parentID(row))!.push(row);
    for (const [id, list] of groups) cache.set(id, list);
  }
  return ids.flatMap((id) => cache.get(id) ?? []);
});

export const relatedAttachments = (
  chunk: RelationChunk,
  ids: readonly number[],
) =>
  readCached(chunk.attachments, {
    ids,
    read: readItemAttachments,
    parentID: (row) => row.parent.itemID,
  });
export const relatedItemAnnotations = (
  chunk: RelationChunk,
  ids: readonly number[],
) =>
  readCached(chunk.itemAnnotations, {
    ids,
    read: readItemAnnotations,
    parentID: (row) => row.parent.itemID,
  });
export const relatedAttachmentAnnotations = (
  chunk: RelationChunk,
  ids: readonly number[],
) =>
  readCached(chunk.attachmentAnnotations, {
    ids,
    read: readAttachmentAnnotations,
    parentID: (row) => row.attachmentID,
  });

/** Child lists can exceed the parent chunk; hydrate them with the existing bounded readers. */
export const loadRelation = Effect.fnUntraced(function* <
  Row extends ScanRow & { libraryID: number },
  Value,
>(
  loader: Loader<Row, Value>,
  rows: readonly Row[],
  {
    libraries,
    parentID,
    relations,
  }: {
    readonly relations: RelationChunk;
    readonly libraries: readonly TargetLibrary[];
    readonly parentID: (row: Row) => number;
  },
) {
  const byLibrary = new Map(
    libraries.map((library) => [library.libraryID, library]),
  );
  // Each loader has one fixed set of needs, so its values can be reused by
  // parent within this root chunk, even across several child hydrate chunks.
  let cached = relations.values.get(loader) as
    | Map<number, readonly Value[]>
    | undefined;
  if (!cached) {
    cached = new Map();
    relations.values.set(loader, cached);
  }
  const missing = rows.filter((row) => !cached.has(parentID(row)));
  const loaded = new Map<number, Value[]>();
  for (let start = 0; start < missing.length; start += HYDRATE_CHUNK_SIZE) {
    const chunk = missing.slice(start, start + HYDRATE_CHUNK_SIZE);
    const values = yield* loader.load(
      chunk,
      (index) => byLibrary.get(chunk[index]!.libraryID)!,
      relations,
    );
    for (const [index, value] of values.entries()) {
      const id = parentID(chunk[index]!);
      const list = loaded.get(id);
      if (list) list.push(value);
      else loaded.set(id, [value]);
    }
  }
  for (const [id, list] of loaded) cached.set(id, list);
  return new Map(
    [...new Set(rows.map(parentID))].map((id) => [id, cached.get(id)!]),
  );
});
