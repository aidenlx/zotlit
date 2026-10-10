import { Data, Effect } from "effect";

import {
  annotationTypeToName,
  parseAnnotationPosition,
  parseIndexedKey,
  resolveIndexedKeyLibraryIn,
} from "@zotlit/db";
import type {
  Annotation,
  AnnotationPosition,
  AnnotationSources,
  Attachment,
  ZoteroDatabaseIdentity,
} from "@zotlit/db";
import { attachmentAbsPath, resolveAnnotCachePath } from "@zotlit/db/path";
import type { AttachmentPathContext } from "@zotlit/db/path";

import { getLogger } from "@/lib/log";
import type {
  AnnotationRecord,
  AnnotationSource,
} from "@/services/annotation-repository/service";
import type {
  ZoteroReadsApi,
  ZoteroReadsService,
} from "@/services/zotero-reads/service";

import type { ExcerptRequest } from "./contract";

const logger = getLogger("excerpt-image");

/** The reads one excerpt request resolves through. */
export type ExcerptRequestReads = Pick<
  ZoteroReadsApi,
  "AttachmentSources" | "DatabaseIdentity"
>;

/**
 * The file inputs one saved Annotation resolves through, or `null` where nothing
 * can: no Annotation Source, another Zotero data directory, or a database that
 * cannot answer.
 *
 * The database verifies the source again, so a record the source does not hold
 * resolves to nothing rather than to another database's pixels.
 */
export async function savedExcerptRequest(options: {
  annotation: AnnotationRecord;
  source: AnnotationSource | null;
  sourceScope: string | null;
  zoteroReads: Pick<ZoteroReadsService, "acquireRead">;
  paths: AttachmentPathContext;
}): Promise<ExcerptRequest | null> {
  const { annotation, source, sourceScope } = options;
  // The paths as they stand now: a request belongs to the data directory its
  // source was read from, whatever the settings become during the read.
  const paths: AttachmentPathContext = {
    dataDir: options.paths.dataDir,
    baseAttachmentPath: options.paths.baseAttachmentPath,
  };
  if (!source || sourceScope !== paths.dataDir) return null;
  try {
    // One Snapshot, so the identity and the attachment come from one database.
    await using lease = await options.zoteroReads.acquireRead();
    const request = await excerptRequest({
      annotation,
      source,
      reads: lease.reads,
      paths,
    });
    return options.paths.dataDir === paths.dataDir ? request : null;
  } catch (error) {
    logger.debug("No excerpt request: the database did not answer", {
      annotationKey: annotation.key,
      error,
    });
    return null;
  }
}

/**
 * Resolves file inputs only when the selected source identifies this database.
 *
 * @throws where the database cannot answer.
 */
export async function excerptRequest(options: {
  annotation: AnnotationRecord;
  source: AnnotationSource;
  reads: ExcerptRequestReads;
  paths: AttachmentPathContext;
}): Promise<ExcerptRequest | null> {
  const { identity, attachment } = await readExcerptInputs(
    options.reads,
    options.annotation.parentKey,
  );
  return excerptRequestFrom({ ...options, identity, attachment });
}

/**
 * The database facts an excerpt request is verified and resolved against: the
 * database's identity, and the parent context of the attachment `parentKey`
 * names, with that attachment, `null` where the database holds none. Pass
 * Snapshot-bound reads, so both facts come from one database.
 */
export async function readExcerptInputs(
  reads: ExcerptRequestReads,
  parentKey: string,
): Promise<{
  identity: ZoteroDatabaseIdentity;
  sources: AnnotationSources;
  attachment: Attachment | null;
}> {
  const [identity, sources] = await Effect.runPromise(
    Effect.all(
      [
        reads.DatabaseIdentity({}),
        reads.AttachmentSources({ attachmentKeys: [parentKey] }),
      ],
      { concurrency: "unbounded" },
    ),
  );
  const attachment =
    sources.attachments.find(({ indexedKey }) => indexedKey === parentKey) ??
    null;
  return { identity, sources, attachment };
}

/**
 * {@link excerptRequest} over database facts already read: the database's
 * identity and the Annotation's parent attachment, `null` where the database
 * holds none.
 */
export function excerptRequestFrom(options: {
  annotation: AnnotationRecord;
  source: AnnotationSource;
  identity: ZoteroDatabaseIdentity;
  attachment: Attachment | null;
  paths: AttachmentPathContext;
}): ExcerptRequest | null {
  const { annotation, source, identity, attachment, paths } = options;
  const compatible =
    source.kind === "zotero-local-api"
      ? identity.serverID === source.serverID
      : identity.serverID === source.database.serverID &&
        identity.userID === source.database.userID &&
        identity.localUserKey === source.database.localUserKey;
  if (!compatible) return null;
  const key = parseIndexedKey(annotation.key);
  if (!attachment || !key) return null;
  if (source.kind === "zotero-db" && source.libraryID !== attachment.libraryID)
    return null;
  return {
    annotation,
    source,
    sourceScope: paths.dataDir,
    attachmentKey: annotation.parentKey,
    libraryID: attachment.libraryID,
    pdfPath: attachmentAbsPath(attachment, paths),
    zoteroPngPath: resolveAnnotCachePath(
      { key: key.key, type: annotation.type },
      { dataDir: paths.dataDir, groupID: key.groupID },
    ),
  };
}

/** The reads {@link excerptRequestForKey} resolves one Indexed Key through. */
export type ExcerptKeyReads = Pick<
  ZoteroReadsApi,
  "AnnotationSources" | "DatabaseIdentity" | "Libraries"
>;

/** A read of the database failed; `message` is the reader's own. */
export class ExcerptSourceUnavailable extends Data.TaggedError(
  "ExcerptSourceUnavailable",
)<{ readonly message: string }> {}

/**
 * The excerpt request of the Annotation with Indexed Key `key`, read from the
 * database, or `null` where the source holds no Library of the key, no
 * Annotation has the key, or its Attachment is gone. Any Annotation type
 * yields a request; the caller decides whether it has an Excerpt Image. Pass
 * Snapshot-bound reads, so every fact comes from one database.
 *
 * @throws {ExcerptSourceUnavailable} where a read fails.
 */
export function excerptRequestForKey(options: {
  reads: ExcerptKeyReads;
  key: string;
  paths: AttachmentPathContext;
  signal?: AbortSignal;
}): Promise<ExcerptRequest | null> {
  const { reads, key, paths, signal } = options;
  return Effect.runPromise(
    Effect.gen(function* () {
      const [libraries, identity] = yield* Effect.all(
        [reads.Libraries({}), reads.DatabaseIdentity({})],
        { concurrency: "unbounded" },
      );
      const target = resolveIndexedKeyLibraryIn(libraries, key);
      if (!target) return null;
      const sources = yield* reads.AnnotationSources({
        libraryID: target.libraryID,
        keys: [target.key],
      });
      const annotation = sources.annotations.find(
        (entry) => entry.indexedKey === key,
      );
      if (!annotation) return null;
      const attachment = sources.attachments.find(
        (entry) => entry.itemID === annotation.parentItemID,
      );
      if (!attachment) return null;
      return excerptRequestFrom({
        annotation: annotationRecordOf(annotation, attachment),
        source: {
          kind: "zotero-db",
          database: identity,
          libraryID: target.libraryID,
          libraryRevision:
            libraries.find((entry) => entry.libraryID === target.libraryID)
              ?.clientVersion ?? null,
        },
        identity,
        attachment,
        paths,
      });
    }).pipe(
      Effect.mapError(
        (error) =>
          new ExcerptSourceUnavailable({
            message:
              error instanceof Error && error.message
                ? error.message
                : String(error),
          }),
      ),
    ),
    { signal },
  );
}

/**
 * The Annotation record an excerpt request carries, from the Annotation's row
 * and its parent `attachment`. `position` defaults to the row's position read
 * by the attachment's content type.
 */
export function annotationRecordOf(
  annotation: Annotation,
  attachment: Attachment,
  position: AnnotationPosition = parseAnnotationPosition(
    annotation.position,
    attachment.contentType ?? "",
  ),
): AnnotationRecord {
  return {
    key: annotation.indexedKey,
    parentKey: attachment.indexedKey,
    type: annotationTypeToName(annotation.type),
    text: annotation.text,
    comment: annotation.comment,
    color: annotation.color,
    pageLabel: annotation.pageLabel,
    sortIndex: annotation.sortIndex,
    tags: annotation.tags,
    position,
    version: annotation.version,
    lock: null,
  };
}
