import {
  getAttachmentByKey,
  getZoteroDatabaseIdentity,
  parseIndexedKey,
  resolveIndexedKeyLibrary,
} from "@zotlit/db";
import type { NodeDatabaseClient } from "@zotlit/db/client/node";
import { attachmentAbsPath, resolveAnnotCachePath } from "@zotlit/db/path";
import type { AttachmentPathContext } from "@zotlit/db/path";

import type {
  AnnotationRecord,
  AnnotationSource,
} from "@/services/annotation-repository/service";

import type { ExcerptRequest } from "./contract";

/** Resolves file inputs only when the selected source identifies this database. */
export function excerptRequest(options: {
  annotation: AnnotationRecord;
  source: AnnotationSource;
  client: NodeDatabaseClient;
  paths: AttachmentPathContext;
}): ExcerptRequest | null {
  const { annotation, source, client, paths } = options;
  const identity = getZoteroDatabaseIdentity(client);
  const compatible =
    source.kind === "zotero-local-api"
      ? identity.serverID === source.serverID
      : identity.serverID === source.database.serverID &&
        identity.userID === source.database.userID &&
        identity.localUserKey === source.database.localUserKey;
  if (!compatible) return null;
  const library = resolveIndexedKeyLibrary(client, annotation.parentKey);
  const key = parseIndexedKey(annotation.key);
  if (!library || !key) return null;
  if (source.kind === "zotero-db" && source.libraryID !== library.libraryID)
    return null;
  const attachment = getAttachmentByKey(client, library.key, library.libraryID);
  if (!attachment) return null;
  return {
    annotation,
    source,
    sourceScope: paths.dataDir,
    attachmentKey: annotation.parentKey,
    libraryID: library.libraryID,
    pdfPath: attachmentAbsPath(attachment, paths),
    zoteroPngPath: resolveAnnotCachePath(
      { key: key.key, type: annotation.type },
      { dataDir: paths.dataDir, groupID: key.groupID },
    ),
  };
}
