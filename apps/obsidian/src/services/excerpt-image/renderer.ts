import { open } from "node:fs/promises";
import { loadPdfJs } from "obsidian";

import { getLogger } from "@/lib/log";

import { abortable } from "./abort";
import { excerptSourceIdentity } from "./contract";
import type { ExcerptRequest } from "./contract";
import { encodeExcerptImage } from "./encode";
import type { ExcerptImage } from "./format";
import {
  clipExcerptBounds,
  excerptBounds,
  paintInk,
  viewportBounds,
} from "./geometry";

interface Viewport {
  convertToViewportPoint(x: number, y: number): [number, number];
}
export interface ExcerptRenderTask {
  promise: Promise<void>;
  cancel(): void;
  onContinue?: (continueCallback: () => void) => void;
}
interface PdfPage {
  view: number[];
  cleanup(): boolean;
  getViewport(options: {
    scale: number;
    offsetX?: number;
    offsetY?: number;
  }): Viewport;
  render(options: {
    canvasContext: CanvasRenderingContext2D;
    viewport: Viewport;
    intent: "display";
  }): ExcerptRenderTask;
}
export interface ExcerptPdfJs {
  getDocument(options: Record<string, unknown>): {
    promise: Promise<{ getPage(number: number): Promise<PdfPage> }>;
    destroy(): Promise<void>;
  };
}

/** Only the exact task created by this renderer may change scheduling. */
export function usePromiseScheduling(
  page: unknown,
  task: ExcerptRenderTask,
): void {
  if (
    !page ||
    typeof page !== "object" ||
    !("_intentStates" in page) ||
    !(page._intentStates instanceof Map)
  ) {
    throw new Error("Unsupported PDF.js intent state");
  }
  const matches: { task: unknown; _useRequestAnimationFrame: boolean }[] = [];
  for (const state of page._intentStates.values()) {
    if (!state || !(state.renderTasks instanceof Set)) continue;
    for (const candidate of state.renderTasks) {
      if (
        candidate?.task === task &&
        typeof candidate._useRequestAnimationFrame === "boolean"
      )
        matches.push(candidate);
    }
  }
  if (matches.length !== 1) throw new Error("Unsupported PDF.js render task");
  matches[0]!._useRequestAnimationFrame = false;
}

const MAX_PDF_BYTES = 256 * 1024 * 1024;
type LoadingTask = ReturnType<ExcerptPdfJs["getDocument"]>;

export type ExcerptRendererPhase =
  | "pdf-reading"
  | "document-loading"
  | "page-rendering";

export interface ExcerptRendererDiagnosticSnapshot {
  phase: ExcerptRendererPhase | "idle";
  jobActive: boolean;
  fileOpen: boolean;
  documentOpen: boolean;
  renderTaskActive: boolean;
  canvas: { width: number; height: number } | null;
  lastCanvas: { width: number; height: number } | null;
  worker: "web-worker" | "fake-worker" | "pending" | null;
  workerEvidence: {
    taskKeys: string[];
    workerKeys: string[];
    portType: string | null;
  } | null;
}

interface DiagnosticGate {
  phase: ExcerptRendererPhase;
  release: PromiseWithResolvers<void>;
}

const logger = getLogger(["excerpt-image", "renderer"]);

/** Internal acceptance diagnostics. It does not alter work unless a test installs a gate. */
export class ExcerptRendererDiagnostics {
  #phase: ExcerptRendererPhase | "idle" = "idle";
  #jobActive = false;
  #fileOpen = false;
  #task?: LoadingTask;
  #renderTaskActive = false;
  #canvas?: HTMLCanvasElement;
  #lastCanvas?: { width: number; height: number };
  #gate?: DiagnosticGate;

  snapshot(): ExcerptRendererDiagnosticSnapshot {
    const worker = (
      this.#task as
        | { _worker?: { _webWorker?: unknown; port?: unknown } }
        | undefined
    )?._worker;
    const portType = worker?.port?.constructor?.name ?? null;
    return {
      phase: this.#phase,
      jobActive: this.#jobActive,
      fileOpen: this.#fileOpen,
      documentOpen: !!this.#task,
      renderTaskActive: this.#renderTaskActive,
      canvas: this.#canvas
        ? { width: this.#canvas.width, height: this.#canvas.height }
        : null,
      lastCanvas: this.#lastCanvas ? { ...this.#lastCanvas } : null,
      worker: !this.#task
        ? null
        : worker?._webWorker || portType === "Worker"
          ? "web-worker"
          : portType === "LoopbackPort"
            ? "fake-worker"
            : "pending",
      workerEvidence: this.#task
        ? {
            taskKeys: Object.keys(this.#task),
            workerKeys: worker ? Object.keys(worker) : [],
            portType,
          }
        : null,
    };
  }

  hold(phase: ExcerptRendererPhase): void {
    if (this.#gate) throw new Error("Excerpt renderer diagnostic gate is busy");
    this.#gate = { phase, release: Promise.withResolvers<void>() };
  }

  release(): void {
    this.#gate?.release.resolve();
    this.#gate = undefined;
  }

  held(phase: ExcerptRendererPhase): boolean {
    return this.#gate?.phase === phase;
  }

  async enter(phase: ExcerptRendererPhase, signal: AbortSignal): Promise<void> {
    this.#phase = phase;
    const gate = this.#gate;
    if (gate?.phase === phase) await abortable(gate.release.promise, signal);
  }

  leave(phase: ExcerptRendererPhase): void {
    if (this.#phase === phase) this.#phase = "idle";
  }

  job(active: boolean): void {
    this.#jobActive = active;
  }

  file(open: boolean): void {
    this.#fileOpen = open;
  }

  document(task?: LoadingTask): void {
    this.#task = task;
  }

  renderTask(active: boolean): void {
    this.#renderTaskActive = active;
  }

  canvas(canvas?: HTMLCanvasElement): void {
    this.#canvas = canvas;
    if (canvas)
      this.#lastCanvas = { width: canvas.width, height: canvas.height };
  }

  canvasReset(): void {
    if (this.#canvas)
      this.#lastCanvas = {
        width: this.#canvas.width,
        height: this.#canvas.height,
      };
    this.#canvas = undefined;
  }

  close(): void {
    this.release();
    this.#phase = "idle";
    this.#jobActive = false;
    this.#fileOpen = false;
    this.#task = undefined;
    this.#renderTaskActive = false;
    this.#canvas = undefined;
  }
}

/** One resident document serves the service's serial queue; render tasks remain local. */
export class ExcerptRenderer implements AsyncDisposable {
  readonly diagnostics = new ExcerptRendererDiagnostics();
  readonly #host;
  #session?: { key: string; task: LoadingTask; close?: Promise<void> };
  #unusable = false;
  readonly #shutdown = new AbortController();
  #active?: Promise<ExcerptImage>;

  constructor(
    host: {
      load?: typeof loadPdfJs;
      canvas?: () => HTMLCanvasElement;
      deadline?: (milliseconds: number) => AbortSignal;
    } = {},
  ) {
    this.#host = host;
  }

  #deadline(milliseconds: number) {
    return this.#host.deadline
      ? this.#host.deadline(milliseconds)
      : AbortSignal.timeout(milliseconds);
  }

  async #teardown(promise: Promise<unknown>) {
    await abortable(promise, this.#deadline(5_000)).catch((error) => {
      // An unconfirmed teardown must not accumulate another resident resource.
      const transitionedToUnusable = !this.#unusable;
      this.#unusable = true;
      logger.debug("Excerpt renderer teardown failed", {
        error,
        state: "unusable",
        transitionedToUnusable,
      });
    });
  }

  async #close() {
    const session = this.#session;
    if (!session) return;
    session.close ??= this.#teardown(
      Promise.resolve().then(() => session.task.destroy()),
    );
    await session.close;
    if (this.#session === session) {
      this.#session = undefined;
      this.diagnostics.document();
    }
  }

  /** Release the resident PDF document while keeping the renderer reusable. */
  async release(): Promise<void> {
    await this.#active?.catch(() => undefined);
    await this.#close();
  }

  async [Symbol.asyncDispose]() {
    this.#unusable = true;
    this.#shutdown.abort();
    await this.release();
    this.diagnostics.close();
  }

  async render(
    request: ExcerptRequest,
    cancellation: AbortSignal,
  ): Promise<ExcerptImage> {
    if (this.#unusable) throw new Error("Excerpt renderer is closed");
    if (this.#active) throw new Error("Excerpt renderer is busy");
    const signal = AbortSignal.any([
      cancellation,
      this.#shutdown.signal,
      this.#deadline(30_000),
    ]);
    const job = this.#render(request, signal).catch(async (error: unknown) => {
      await this.#close();
      throw error;
    });
    this.diagnostics.job(true);
    this.#active = job;
    try {
      return await job;
    } finally {
      this.#active = undefined;
      this.diagnostics.job(false);
    }
  }

  async #document(request: ExcerptRequest, signal: AbortSignal) {
    const opening = open(request.pdfPath!, "r");
    let handle: Awaited<typeof opening>;
    try {
      handle = await abortable(opening, signal);
    } catch (error) {
      // Cancellation can win before open returns. Keep acquisition and its
      // eventual close inside this job's teardown, including the handoff race.
      await this.#teardown(
        opening.then(
          (file) => file.close(),
          () => undefined,
        ),
      );
      throw error;
    }
    await using handles = new AsyncDisposableStack();
    this.diagnostics.file(true);
    const file = handles.adopt(handle, async (file) => {
      await this.#teardown(file.close());
      this.diagnostics.file(false);
    });
    const info = await abortable(file.stat(), signal);
    if (
      !Number.isSafeInteger(info.size) ||
      info.size < 0 ||
      info.size > MAX_PDF_BYTES
    )
      throw new Error("PDF exceeds excerpt byte limit");
    const key = JSON.stringify([
      request.sourceScope,
      excerptSourceIdentity(request.source),
      request.libraryID,
      request.attachmentKey,
      request.pdfPath,
      info.size,
      info.mtimeMs,
    ]);
    if (this.#session?.key !== key) {
      await this.#close();
      signal.throwIfAborted();
      if (this.#unusable) throw new Error("Excerpt renderer is closed");
      // One extra byte detects growth without an unbounded readFile allocation.
      const data = new Uint8Array(info.size + 1);
      let offset = 0;
      while (offset < data.length) {
        signal.throwIfAborted();
        const reading = file.read(data, offset, data.length - offset, offset);
        void reading.catch(() => undefined);
        let bytesRead: number;
        if (offset === 0) {
          try {
            await this.diagnostics.enter("pdf-reading", signal);
            ({ bytesRead } = await abortable(reading, signal));
          } finally {
            this.diagnostics.leave("pdf-reading");
          }
        } else {
          ({ bytesRead } = await abortable(reading, signal));
        }
        if (!bytesRead) break;
        offset += bytesRead;
      }
      const after = await abortable(file.stat(), signal);
      if (
        offset !== info.size ||
        after.size !== info.size ||
        after.mtimeMs !== info.mtimeMs
      )
        throw new Error("PDF changed while reading");
      const lib = await abortable((this.#host.load ?? loadPdfJs)(), signal);
      signal.throwIfAborted();
      this.#session = {
        key,
        task: lib.getDocument({
          data: data.subarray(0, offset),
          cMapUrl: "/lib/pdfjs/cmaps/",
          cMapPacked: true,
          standardFontDataUrl: "/lib/pdfjs/standard_fonts/",
          wasmUrl: "/lib/pdfjs/wasm/",
          iccUrl: "/lib/pdfjs/iccs/",
          isEvalSupported: false,
        }),
      };
      this.diagnostics.document(this.#session.task);
    }
    try {
      await this.diagnostics.enter("document-loading", signal);
      return await abortable(this.#session.task.promise, signal);
    } finally {
      this.diagnostics.leave("document-loading");
    }
  }

  async #render(
    request: ExcerptRequest,
    signal: AbortSignal,
  ): Promise<ExcerptImage> {
    const position = request.annotation.position;
    if (
      !request.pdfPath ||
      !(
        (request.annotation.type === "image" &&
          position.kind === "pdf-rects") ||
        (request.annotation.type === "ink" && position.kind === "pdf-ink")
      )
    )
      throw new Error("Unsupported excerpt");
    signal.throwIfAborted();
    await using stack = new AsyncDisposableStack();
    const pdf = await this.#document(request, signal);
    if (this.#unusable) throw new Error("Excerpt renderer is closed");
    const page = stack.adopt(
      await abortable(pdf.getPage(position.pageIndex + 1), signal),
      (page) => {
        page.cleanup();
      },
    );
    const rect = excerptBounds(request.annotation);
    const crop = clipExcerptBounds(rect, page.view);
    const bounds = (scale: number) => {
      const viewport = page.getViewport({ scale });
      return viewportBounds(crop, viewport);
    };
    let scale = 4;
    let box = bounds(scale);
    if (!box.every(Number.isFinite) || box[2]! <= 0 || box[3]! <= 0)
      throw new Error("Invalid PDF excerpt bounds");
    scale *= Math.min(
      1,
      Math.sqrt(16_777_216 / (box[2]! * box[3]!)),
      8192 / Math.max(box[2]!, box[3]!),
    );
    box = bounds(scale);
    const canvas = stack.adopt(
      (this.#host.canvas ?? (() => document.createElement("canvas")))(),
      (canvas) => {
        canvas.width = 0;
        canvas.height = 0;
        this.diagnostics.canvasReset();
      },
    );
    canvas.width = Math.max(1, Math.floor(box[2]!));
    canvas.height = Math.max(1, Math.floor(box[3]!));
    this.diagnostics.canvas(canvas);
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("Canvas unavailable");
    const viewport = page.getViewport({
      scale,
      offsetX: -box[0]!,
      offsetY: -box[1]!,
    });
    const task = stack.adopt(
      page.render({ canvasContext: context, viewport, intent: "display" }),
      (task) => {
        task.cancel();
        this.diagnostics.renderTask(false);
      },
    );
    this.diagnostics.renderTask(true);
    void task.promise
      .finally(() => this.diagnostics.renderTask(false))
      .catch(() => undefined);
    // Attach a rejection handler before checking the private seam.
    void task.promise.catch(() => undefined);
    usePromiseScheduling(page, task);
    try {
      if (this.diagnostics.held("page-rendering")) {
        task.onContinue = (continueCallback) => {
          void this.diagnostics
            .enter("page-rendering", signal)
            .then(continueCallback, () => task.cancel());
        };
      } else {
        await this.diagnostics.enter("page-rendering", signal);
      }
      await abortable(task.promise, signal);
    } finally {
      this.diagnostics.leave("page-rendering");
    }
    paintInk({ annotation: request.annotation, viewport, context });
    return await encodeExcerptImage(canvas, signal);
  }
}
