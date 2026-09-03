// Node-only export of redacted, renderable Item Snapshots from Zotero data.

import { createHash } from "node:crypto";

import {
  buildFilenameContext,
  CollectionCache,
  CONTRACT_VERSION,
  fetchAnnotationsTemplateData,
  fetchNoteContext,
  getAnnotationsByKey,
  getLibraryByGroupID,
  getItemsByKey,
  getZoteroIdentity,
  resolveItemTags,
  USER_LIBRARY_ID,
  withAnnotationCitation,
} from "@zotlit/db";
import type { NodeDatabaseClient } from "@zotlit/db/client/node";

import { serializeTemplateData } from "@/explorer/index";

import { collectRootDescriptors } from "./descriptors";
import {
  authorsShort,
  normalizeTargets,
  snapshotResolvers,
  validateProvenance,
} from "./resolvers";
import type {
  ExportItemSnapshotOptions,
  ItemSnapshot,
  SnapshotLibrarySelector,
  SnapshotSelection,
} from "./types";
import { SnapshotSelectionError } from "./types";
import { collectUnavailable } from "./unavailable";

export type * from "./descriptors";
export type * from "./types";
export { SnapshotSelectionError } from "./types";

/**
 * @throws SnapshotSelectionError when the selected Library or Item is absent,
 * or when provenance or a vault target contains a disallowed path.
 */
export function exportItemSnapshot(
  client: NodeDatabaseClient,
  selection: SnapshotSelection,
  options: ExportItemSnapshotOptions,
): ItemSnapshot {
  const libraryID = resolveLibraryID(client, selection.library);
  const provenance = validateProvenance(options.provenance);
  const item = getItemsByKey(client, libraryID, [selection.key])[0];
  if (!item) {
    throw new SnapshotSelectionError(
      `Item '${selection.key}' is not in the selected Library.`,
    );
  }

  const targets = normalizeTargets(options.vaultTargets);
  const resolvers = snapshotResolvers(targets);
  const collectionCache = new CollectionCache();
  const note = fetchNoteContext(client, item, {
    resolvers,
    collectionCache,
    username: getZoteroIdentity(client).username,
  });
  const filename = buildFilenameContext({
    item,
    tags: resolveItemTags(client, item.itemID, new Map()),
    collections:
      collectionCache
        .byItemIDs(client, item.libraryID, [item.itemID])
        .get(item.itemID) ?? [],
    authorsShort,
  });
  const rawAnnotations = getAnnotationsByKey(
    client,
    note.annotations.map(({ key }) => key),
    item.libraryID,
  );
  const annotations = [
    ...fetchAnnotationsTemplateData(client, rawAnnotations, {
      resolvers: resolvers.annotation,
    }).values(),
  ].map((annotation) => withAnnotationCitation(annotation, () => null));

  const roots = {
    note: asRecord(serializeTemplateData(note, "note")),
    filename: asRecord(serializeTemplateData(filename, "filename")),
    annotations: annotations.map((annotation) =>
      asRecord(serializeTemplateData(annotation, "annotation")),
    ),
  };
  const body = {
    contractVersion: CONTRACT_VERSION,
    item: {
      key: item.key,
      indexedKey: item.indexedKey,
      itemType: item.fields.itemType,
      title: typeof note.title === "string" ? note.title : null,
      library: selection.library,
    },
    provenance,
    roots,
    descriptors: {
      note: collectRootDescriptors(note),
      filename: collectRootDescriptors(filename),
      annotations: annotations.map(collectRootDescriptors),
    },
    unavailable: collectUnavailable(roots.note),
  };

  return {
    ...body,
    revision: createHash("sha256").update(JSON.stringify(body)).digest("hex"),
  };
}

function resolveLibraryID(
  client: NodeDatabaseClient,
  selector: SnapshotLibrarySelector,
): number {
  if (selector.type === "personal") return USER_LIBRARY_ID;
  const library = getLibraryByGroupID(client, selector.groupID);
  if (!library) {
    throw new SnapshotSelectionError(
      `Group Library '${selector.groupID}' is not available.`,
    );
  }
  return library.libraryID;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value as Record<string, unknown>;
}
