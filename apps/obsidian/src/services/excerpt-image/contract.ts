// Shared excerpt request identity and cache-key contracts.

import { createHash } from "node:crypto";

import type { ZoteroDatabaseIdentity } from "@zotlit/db";

import type {
  AnnotationRecord,
  AnnotationSource,
} from "@/services/annotation-repository/service";

/** A complete consumer snapshot; paths and identity belong to the same source. */
export interface ExcerptRequest {
  annotation: AnnotationRecord;
  source: AnnotationSource;
  sourceScope: string;
  attachmentKey: string;
  libraryID: number;
  pdfPath: string | null;
  zoteroPngPath: string | null;
  /** Set only after the selected source has been checked against this database. */
  verifiedDatabaseIdentity?: ZoteroDatabaseIdentity;
}

export const EXCERPT_RENDERER_VERSION = 2;

/** Canonical pixel inputs exclude revision, text, labels, comments, and tags. */
export function excerptFingerprint(annotation: AnnotationRecord): string {
  const p = annotation.position;
  if (annotation.type === "ink" && p.kind === "pdf-ink")
    return JSON.stringify([
      "ink",
      p.pageIndex,
      p.width,
      p.paths,
      annotation.color?.toLowerCase() ?? null,
    ]);
  if (annotation.type === "image" && p.kind === "pdf-rects")
    return JSON.stringify(["image", p.pageIndex, p.rects[0]]);
  return JSON.stringify([annotation.type, p.kind]);
}

export function excerptSourceIdentity(source: AnnotationSource): unknown[] {
  return source.kind === "zotero-db"
    ? [
        source.kind,
        source.database.userID,
        source.database.localUserKey,
        source.database.serverID,
        source.libraryID,
      ]
    : [source.kind, source.serverID];
}

function databaseIdentity(identity: ZoteroDatabaseIdentity): unknown[] {
  return [
    "zotero-database",
    identity.userID,
    identity.localUserKey,
    identity.serverID,
  ];
}

/**
 * Canonical cache identity for requests whose source equivalence is proven.
 * An API source carries only a server id until `excerptRequest` checks it
 * against the open database, so an unverified API request remains isolated.
 */
export function excerptCacheSourceIdentity(
  request: Pick<ExcerptRequest, "source" | "verifiedDatabaseIdentity">,
): unknown[] {
  const verified = request.verifiedDatabaseIdentity;
  if (verified) {
    if (
      request.source.kind === "zotero-local-api" &&
      request.source.serverID === verified.serverID
    )
      return databaseIdentity(verified);
  }
  if (request.source.kind === "zotero-db")
    return databaseIdentity(request.source.database);
  return excerptSourceIdentity(request.source);
}

/** Excludes source revision and record versions, which cannot change the pixels. */
export function excerptKey(request: ExcerptRequest): string {
  const { annotation: a } = request;
  return createHash("sha256")
    .update(
      JSON.stringify([
        EXCERPT_RENDERER_VERSION,
        request.sourceScope,
        excerptCacheSourceIdentity(request),
        request.libraryID,
        request.attachmentKey,
        a.key,
        excerptFingerprint(a),
      ]),
    )
    .digest("hex");
}
