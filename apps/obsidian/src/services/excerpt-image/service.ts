import { createHash } from "node:crypto";
import { open, stat } from "node:fs/promises";

import { getLogger } from "@/lib/log";
import type {
  AnnotationRecord,
  AnnotationSource,
} from "@/services/annotation-repository/service";
import { Service } from "@/services/service-base";

import { abortable, renderExcerpt } from "./renderer";
export { excerptRequest } from "./request";

const logger = getLogger("excerpt-image");

/** A complete consumer snapshot; paths and identity belong to the same source. */
export interface ExcerptRequest {
  annotation: AnnotationRecord;
  source: AnnotationSource;
  sourceScope: string;
  attachmentKey: string;
  libraryID?: number;
  pdfPath: string | null;
  zoteroPngPath: string | null;
}

export interface PdfStamp {
  size: number;
  mtimeMs: number;
}
export interface ExcerptEntry {
  bytes: Uint8Array;
  pdf: PdfStamp;
}
export interface ExcerptCache {
  get(key: string): Promise<ExcerptEntry | undefined>;
  put(key: string, entry: ExcerptEntry): Promise<void>;
}
export type ExcerptOutcome =
  | {
      kind: "available";
      bytes: Uint8Array;
      provenance: "rendered" | "cache" | "zotero";
      freshness: "checked" | "unchecked" | "uncertain";
    }
  | { kind: "unavailable" };

export interface ExcerptDeps {
  cache?: ExcerptCache;
  stamp?: (path: string) => Promise<PdfStamp>;
  read?: (path: string, signal: AbortSignal) => Promise<Uint8Array>;
  render?: (
    request: ExcerptRequest,
    signal: AbortSignal,
  ) => Promise<Uint8Array>;
}

export const EXCERPT_RENDERER_VERSION = 2;
export const MAX_FALLBACK_BYTES = 32 * 1024 * 1024;

/** Check the open file before allocating; one extra byte detects later growth. */
async function readFallback(
  path: string,
  signal: AbortSignal,
): Promise<Uint8Array> {
  await using file = await open(path, "r");
  signal.throwIfAborted();
  const { size } = await file.stat();
  if (size > MAX_FALLBACK_BYTES)
    throw new Error("Zotero image exceeds byte limit");
  const bytes = new Uint8Array(size + 1);
  let offset = 0;
  while (offset < bytes.length) {
    signal.throwIfAborted();
    const { bytesRead } = await file.read(
      bytes,
      offset,
      bytes.length - offset,
      offset,
    );
    if (!bytesRead) break;
    offset += bytesRead;
  }
  if (offset > size) throw new Error("Zotero image changed while reading");
  return bytes.subarray(0, offset);
}

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

/** Excludes source revision and record versions, which cannot change the pixels. */
export function excerptKey(request: ExcerptRequest): string {
  const { annotation: a, source } = request;
  return createHash("sha256")
    .update(
      JSON.stringify([
        EXCERPT_RENDERER_VERSION,
        request.sourceScope,
        excerptSourceIdentity(source),
        request.libraryID ??
          (source.kind === "zotero-db" ? source.libraryID : null),
        request.attachmentKey,
        a.key,
        excerptFingerprint(a),
      ]),
    )
    .digest("hex");
}

interface Pending {
  controller: AbortController;
  promise: Promise<ExcerptOutcome>;
  users: number;
}

/** Owns resolution, shared requests, and the bounded rendering queue. */
export class ExcerptImageService extends Service {
  ready: Promise<void>;
  readonly #deps;
  readonly #pending = new Map<string, Pending>();
  readonly #shutdown = new AbortController();
  #tail: Promise<unknown> = Promise.resolve();

  constructor(deps: ExcerptDeps = {}) {
    super();
    this.#deps = deps;
    this.ready = this.#load();
  }

  async #load(): Promise<void> {
    await using stack = new AsyncDisposableStack();
    stack.defer(async () => {
      this.#shutdown.abort();
      for (const pending of this.#pending.values()) pending.controller.abort();
      await Promise.allSettled(
        [...this.#pending.values()].map((p) => p.promise),
      );
    });
    this.commit(stack.move());
  }

  async resolve(
    request: ExcerptRequest,
    signal?: AbortSignal,
  ): Promise<ExcerptOutcome> {
    // Capture the published input before startup or queued work can yield.
    const snapshot = structuredClone(request);
    await this.ready;
    signal?.throwIfAborted();
    this.#shutdown.signal.throwIfAborted();
    const key = excerptKey(snapshot);
    const pendingKey = JSON.stringify([
      key,
      snapshot.pdfPath,
      snapshot.zoteroPngPath,
    ]);
    let pending = this.#pending.get(pendingKey);
    if (!pending || pending.controller.signal.aborted) {
      if (this.#pending.size >= 128) {
        logger.debug("Excerpt unavailable: queue full", {
          key,
          queued: this.#pending.size,
        });
        return { kind: "unavailable" };
      }
      const controller = new AbortController();
      const promise = this.#tail.then(() => {
        const bounded = AbortSignal.any([
          controller.signal,
          AbortSignal.timeout(35_000),
        ]);
        bounded.throwIfAborted();
        return abortable(this.#resolve(snapshot, key, bounded), bounded);
      });
      pending = { controller, promise, users: 0 };
      this.#pending.set(pendingKey, pending);
      this.#tail = promise.catch(() => undefined);
      const held = pending;
      void promise
        .finally(() => {
          if (this.#pending.get(pendingKey) === held)
            this.#pending.delete(pendingKey);
        })
        .catch(() => undefined);
    }
    pending.users++;
    const held = pending;
    try {
      return await (signal ? abortable(held.promise, signal) : held.promise);
    } finally {
      if (--held.users === 0) held.controller.abort();
    }
  }

  async #resolve(
    request: ExcerptRequest,
    key: string,
    signal: AbortSignal,
  ): Promise<ExcerptOutcome> {
    signal.throwIfAborted();
    const stamp =
      this.#deps.stamp ??
      (async (path: string) => {
        const info = await stat(path);
        return { size: info.size, mtimeMs: info.mtimeMs };
      });
    const pdf = request.pdfPath
      ? await stamp(request.pdfPath).catch((error) => {
          logger.debug("Excerpt PDF freshness unavailable", { key, error });
          return undefined;
        })
      : undefined;
    const cached = await this.#deps.cache?.get(key).catch((error) => {
      logger.debug("Excerpt cache read failed", { key, error });
      return undefined;
    });
    signal.throwIfAborted();
    if (
      cached &&
      (!pdf ||
        (pdf.size === cached.pdf.size && pdf.mtimeMs === cached.pdf.mtimeMs))
    ) {
      logger.debug("Excerpt cache matched", { key, freshnessChecked: !!pdf });
      return {
        kind: "available",
        bytes: cached.bytes,
        provenance: "cache",
        freshness: pdf ? "checked" : "unchecked",
      };
    }
    logger.trace("Excerpt cache missed; rendering", {
      key,
      cached: !!cached,
      freshnessChecked: !!pdf,
    });
    try {
      const bytes = await (this.#deps.render ?? renderExcerpt)(request, signal);
      signal.throwIfAborted();
      if (pdf)
        await this.#deps.cache?.put(key, { bytes, pdf }).catch((error) => {
          logger.debug("Excerpt cache write failed", { key, error });
        });
      logger.debug("Excerpt rendered", {
        key,
        bytes: bytes.length,
        freshnessChecked: !!pdf,
      });
      return {
        kind: "available",
        bytes,
        provenance: "rendered",
        freshness: pdf ? "checked" : "unchecked",
      };
    } catch (error) {
      signal.throwIfAborted();
      logger.debug("Excerpt rendering failed; checking Zotero image", {
        key,
        error,
      });
    }
    try {
      if (request.zoteroPngPath) {
        const bytes = await (this.#deps.read ?? readFallback)(
          request.zoteroPngPath,
          signal,
        );
        signal.throwIfAborted();
        if (bytes.length > MAX_FALLBACK_BYTES)
          throw new Error("Zotero image exceeds byte limit");
        if (
          bytes.length > 8 &&
          [137, 80, 78, 71, 13, 10, 26, 10].every(
            (byte, index) => bytes[index] === byte,
          )
        ) {
          logger.debug("Excerpt uses uncertain Zotero image", {
            key,
            bytes: bytes.length,
          });
          return {
            kind: "available",
            bytes,
            provenance: "zotero",
            freshness: "uncertain",
          };
        }
        logger.debug("Zotero excerpt has invalid PNG signature", { key });
      }
    } catch (error) {
      signal.throwIfAborted();
      logger.debug("Zotero excerpt read failed", { key, error });
    }
    logger.debug("Excerpt unavailable", { key });
    return { kind: "unavailable" };
  }
}
