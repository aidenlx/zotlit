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
import type { DatabaseService } from "@/services/database/service";

import type { ExcerptRequest } from "./contract";

/**
 * The file inputs one saved Annotation resolves through, or `null` where nothing
 * can: no Annotation Source, another Zotero data directory, or a database that
 * is not ready.
 *
 * The database verifies the source again, so a record the source does not hold
 * resolves to nothing rather than to another database's pixels.
 */
export function savedExcerptRequest(options: {
  annotation: AnnotationRecord;
  source: AnnotationSource | null;
  sourceScope: string | null;
  db: Pick<DatabaseService, "state" | "client">;
  paths: AttachmentPathContext;
}): ExcerptRequest | null {
  const { annotation, source, sourceScope, db, paths } = options;
  if (!source || sourceScope !== paths.dataDir || db.state !== "ready")
    return null;
  return excerptRequest({ annotation, source, client: db.client, paths });
}

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
