// Shared excerpt request identity and cache-key contracts.

import { createHash } from "node:crypto";

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

/**
 * The database one Annotation Source was verified against, in canonical form.
 *
 * A Zotero Server ID names exactly one Zotero database, so a Local API record
 * and a database record that declare the same Server ID describe the same
 * Library universe: they carry one identity and reuse one excerpt image. A
 * source that names no Server ID keeps a local identity instead, which no other
 * source whose database equivalence is unproven can match. A database record
 * without a Server ID falls back to its Local API user identity, and only
 * another snapshot of that same standalone database matches it.
 *
 * @see apps/obsidian/docs/adr/0050-excerpt-cache-identity-is-shared-across-verified-annotation-sources.md
 */
export function excerptSourceIdentity(source: AnnotationSource): unknown[] {
  if (source.kind === "zotero-db")
    return source.database.serverID
      ? ["zotero", source.database.serverID]
      : ["zotero-db", source.database.userID, source.database.localUserKey];
  return source.serverID ? ["zotero", source.serverID] : ["zotero-local-api"];
}

/**
 * Every source identity form one request's durable assets may carry, the
 * current form first.
 *
 * The previous release named a database source after its own fields and a Local
 * API source after its Server ID alone, so an asset or link it wrote for the
 * same logical source hashes differently. A cache lookup needs only the current
 * form, because a stale key recomputes, but an ownership check has to keep
 * recognizing the assets and links an upgraded vault already holds.
 *
 * @see apps/obsidian/docs/adr/0050-excerpt-cache-identity-is-shared-across-verified-annotation-sources.md
 */
export function excerptSourceIdentities(source: AnnotationSource): unknown[][] {
  return [
    excerptSourceIdentity(source),
    source.kind === "zotero-db"
      ? [
          source.kind,
          source.database.userID,
          source.database.localUserKey,
          source.database.serverID,
          source.libraryID,
        ]
      : [source.kind, source.serverID],
  ];
}

/**
 * One verified Annotation's stable identity, which the canonical pixel
 * fingerprint ({@link excerptKey}) deliberately excludes.
 *
 * A display holds the image of an Annotation under it, so a saved edit that
 * replaces the pixels keeps answering the same identity, and the device-local
 * latest image of an Annotation is stored under it, so the image that was last
 * displayed survives a remount and an application restart.
 */
export function excerptAnnotationIdentity(request: ExcerptRequest): unknown[] {
  return [
    request.sourceScope,
    excerptSourceIdentity(request.source),
    request.attachmentKey,
    request.annotation.key,
  ];
}

/**
 * The record one Annotation's latest image lives under, which the store keeps it
 * by and the display tracks the replacement of.
 *
 * One encoding of {@link excerptAnnotationIdentity}, so the store and the
 * surfaces that read or replace its records cannot key one Annotation two ways.
 */
export function excerptAnnotationRecord(request: ExcerptRequest): string {
  return JSON.stringify(excerptAnnotationIdentity(request));
}

/** Excludes source revision and record versions, which cannot change the pixels. */
export function excerptKey(request: ExcerptRequest): string {
  const { annotation: a, source } = request;
  return createHash("sha256")
    .update(
      JSON.stringify([
        EXCERPT_RENDERER_VERSION,
        request.sourceScope,
        excerptSourceIdentity(source),
        request.libraryID,
        request.attachmentKey,
        a.key,
        excerptFingerprint(a),
      ]),
    )
    .digest("hex");
}
