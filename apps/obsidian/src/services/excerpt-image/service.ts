import { open, stat } from "node:fs/promises";

import { getLogger } from "@/lib/log";
import { Service } from "@/services/service-base";

import { excerptKey } from "./contract";
import type { ExcerptRequest } from "./contract";
import { usableExcerptPng } from "./png";
import { abortable, ExcerptRenderer } from "./renderer";
import type { ExcerptRendererDiagnostics } from "./renderer";
import type { ExcerptStore } from "./store";
export {
  EXCERPT_RENDERER_VERSION,
  excerptFingerprint,
  excerptKey,
  excerptSourceIdentity,
} from "./contract";
export type { ExcerptRequest } from "./contract";
export { excerptRequest } from "./request";

const logger = getLogger("excerpt-image");

/** Size/mtime validation intentionally cannot detect a replacement with identical metadata. */
export interface PdfStamp {
  size: number;
  mtimeMs: number;
}
export interface ExcerptEntry {
  bytes: Uint8Array;
  pdf: PdfStamp;
}
export interface ExcerptCache {
  get(key: string, pdf?: PdfStamp): Promise<ExcerptEntry | undefined>;
  put(key: string, entry: ExcerptEntry): Promise<void>;
  clear?(): Promise<void>;
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
  openStore?: () => Promise<ExcerptStore>;
  stamp?: (path: string) => Promise<PdfStamp>;
  read?: (path: string, signal: AbortSignal) => Promise<Uint8Array>;
  render?: (
    request: ExcerptRequest,
    signal: AbortSignal,
  ) => Promise<Uint8Array>;
}

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

interface Pending {
  controller: AbortController;
  promise: Promise<ExcerptOutcome>;
  users: number;
}

/** Owns resolution, shared requests, and the bounded rendering queue. */
export class ExcerptImageService extends Service<ExcerptCache | undefined> {
  ready: Promise<ExcerptCache | undefined>;
  readonly #deps;
  readonly #pending = new Map<string, Pending>();
  readonly #shutdown = new AbortController();
  #tail: Promise<unknown> = Promise.resolve();
  #generation = 0;
  #clearing: Promise<void> = Promise.resolve();
  #renderer?: ExcerptRenderer;
  #stalled = false;
  #jobs = 0;

  /** Internal lifecycle diagnostics used by the real-app acceptance suite. */
  get rendererDiagnostics(): ExcerptRendererDiagnostics | undefined {
    return this.#renderer?.diagnostics;
  }

  constructor(deps: ExcerptDeps = {}) {
    super();
    this.#deps = deps;
    this.ready = this.#load();
  }

  async #load(): Promise<ExcerptCache | undefined> {
    await using stack = new AsyncDisposableStack();
    if (!this.#deps.render) this.#renderer = stack.use(new ExcerptRenderer());
    let cache = this.#deps.cache;
    if (this.#deps.openStore) {
      try {
        cache = stack.use(await this.#deps.openStore());
      } catch (error) {
        logger.debug("Excerpt cache open failed", { error });
      }
    }
    stack.defer(async () => {
      this.#shutdown.abort();
      for (const pending of this.#pending.values()) pending.controller.abort();
      await Promise.allSettled(
        [...this.#pending.values()].map((p) => p.promise),
      );
      await this.#tail;
    });
    this.commit(stack.move());
    return cache;
  }

  /** Clear only derived entries; old requests can finish but cannot refill them. */
  clear(): Promise<void> {
    this.#generation++;
    const operation = this.#clearing.then(async () => {
      const cache = await this.ready;
      this.#shutdown.signal.throwIfAborted();
      if (this.#deps.openStore && !cache)
        throw new Error("Excerpt cache could not be opened");
      await cache?.clear?.();
    });
    this.#clearing = operation.catch(() => undefined);
    return operation;
  }

  async resolve(
    request: ExcerptRequest,
    signal?: AbortSignal,
  ): Promise<ExcerptOutcome> {
    // Capture the published input before startup or queued work can yield.
    const snapshot = structuredClone(request);
    const generation = this.#generation;
    const cache = await this.ready;
    await this.#clearing;
    signal?.throwIfAborted();
    this.#shutdown.signal.throwIfAborted();
    const key = excerptKey(snapshot);
    const pendingKey = JSON.stringify([
      generation,
      key,
      snapshot.pdfPath,
      snapshot.zoteroPngPath,
    ]);
    let pending = this.#pending.get(pendingKey);
    if (!pending || pending.controller.signal.aborted) {
      if (this.#jobs >= 128) {
        logger.debug("Excerpt unavailable: queue full", {
          key,
          queued: this.#jobs,
        });
        return { kind: "unavailable" };
      }
      const controller = new AbortController();
      this.#jobs++;
      const promise = this.#tail.then(async () => {
        if (this.#stalled) return { kind: "unavailable" } as const;
        const bounded = AbortSignal.any([
          controller.signal,
          this.#shutdown.signal,
          AbortSignal.timeout(35_000),
        ]);
        bounded.throwIfAborted();
        const job = this.#resolve(
          snapshot,
          { key, cache, generation },
          bounded,
        );
        try {
          return await abortable(job, bounded);
        } finally {
          // Caller cancellation is immediate; the queue still owns teardown.
          // A host that cannot settle must not accumulate more active jobs.
          await abortable(
            job.then(
              () => undefined,
              () => undefined,
            ),
            AbortSignal.timeout(5_000),
          ).catch(() => {
            this.#stalled = true;
            logger.debug("Excerpt queue stopped after unsettled teardown");
          });
        }
      });
      pending = { controller, promise, users: 0 };
      this.#pending.set(pendingKey, pending);
      this.#tail = promise.catch(() => undefined);
      const held = pending;
      void promise
        .finally(() => {
          this.#jobs--;
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
    context: {
      key: string;
      cache: ExcerptCache | undefined;
      generation: number;
    },
    signal: AbortSignal,
  ): Promise<ExcerptOutcome> {
    const { key, cache, generation } = context;
    const persistent = request.sourceScope ? cache : undefined;
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
    const cached = await persistent?.get(key, pdf).catch((error) => {
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
      const bytes = await (this.#deps.render
        ? this.#deps.render(request, signal)
        : this.#renderer!.render(request, signal));
      signal.throwIfAborted();
      if (pdf && generation === this.#generation)
        await persistent?.put(key, { bytes, pdf }).catch((error) => {
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
          usableExcerptPng(
            Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength),
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
        logger.debug("Zotero excerpt has unusable PNG data", { key });
      }
    } catch (error) {
      signal.throwIfAborted();
      logger.debug("Zotero excerpt read failed", { key, error });
    }
    logger.debug("Excerpt unavailable", { key });
    return { kind: "unavailable" };
  }
}
