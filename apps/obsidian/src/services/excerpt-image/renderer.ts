import { readFile, stat } from "node:fs/promises";
import { loadPdfJs } from "obsidian";

import type { ExcerptRequest } from "./service";

interface Viewport {
  convertToViewportPoint(x: number, y: number): [number, number];
}
export interface ExcerptRenderTask {
  promise: Promise<void>;
  cancel(): void;
}
interface PdfPage {
  view: number[];
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

/** Deadlines also cover hosts whose cancellation method does not settle. */
export async function abortable<T>(
  promise: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted) {
    // The caller may already have started work: observe its eventual rejection.
    void promise.catch(() => undefined);
    signal.throwIfAborted();
  }
  let abort: (() => void) | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        abort = () => reject(signal.reason);
        signal.addEventListener("abort", abort, { once: true });
        if (signal.aborted) abort();
      }),
    ]);
  } finally {
    if (abort) signal.removeEventListener("abort", abort);
  }
}

/** Detached display rendering uses the host worker, fonts, and decoding assets. */
export async function renderExcerpt(
  request: ExcerptRequest,
  cancellation: AbortSignal,
): Promise<Uint8Array> {
  const position = request.annotation.position;
  if (
    !request.pdfPath ||
    request.annotation.type !== "image" ||
    position.kind !== "pdf-rects"
  )
    throw new Error("Unsupported excerpt");
  const signal = AbortSignal.any([cancellation, AbortSignal.timeout(30_000)]);
  const info = await abortable(stat(request.pdfPath), signal);
  if (info.size > 256 * 1024 * 1024)
    throw new Error("PDF exceeds excerpt byte limit");
  const lib = await abortable(loadPdfJs(), signal);
  const data = new Uint8Array(await readFile(request.pdfPath, { signal }));
  signal.throwIfAborted();
  await using stack = new AsyncDisposableStack();
  const loading = stack.adopt(
    lib.getDocument({
      data,
      cMapUrl: "/lib/pdfjs/cmaps/",
      cMapPacked: true,
      standardFontDataUrl: "/lib/pdfjs/standard_fonts/",
      wasmUrl: "/lib/pdfjs/wasm/",
      iccUrl: "/lib/pdfjs/iccs/",
      isEvalSupported: false,
    }),
    async (task) => {
      await abortable(task.destroy(), AbortSignal.timeout(5_000)).catch(
        () => undefined,
      );
    },
  );
  const cancelLoad = () => {
    void loading.destroy().catch(() => undefined);
  };
  signal.addEventListener("abort", cancelLoad, { once: true });
  stack.defer(() => signal.removeEventListener("abort", cancelLoad));
  const pdf = await abortable(loading.promise, signal);
  const page = await abortable(pdf.getPage(position.pageIndex + 1), signal);
  const rect = position.rects[0];
  if (
    !rect ||
    !rect.every(Number.isFinite) ||
    rect[2] <= rect[0] ||
    rect[3] <= rect[1]
  )
    throw new Error("Invalid excerpt bounds");
  const crop = [
    Math.max(rect[0], page.view[0]!),
    Math.max(rect[1], page.view[1]!),
    Math.min(rect[2], page.view[2]!),
    Math.min(rect[3], page.view[3]!),
  ];
  if (crop[2]! <= crop[0]! || crop[3]! <= crop[1]!)
    throw new Error("Excerpt outside PDF page");
  const bounds = (scale: number) => {
    const viewport = page.getViewport({ scale });
    const a = viewport.convertToViewportPoint(crop[0]!, crop[1]!);
    const b = viewport.convertToViewportPoint(crop[2]!, crop[3]!);
    return [
      Math.min(a[0], b[0]),
      Math.min(a[1], b[1]),
      Math.abs(b[0] - a[0]),
      Math.abs(b[1] - a[1]),
    ];
  };
  let scale = 4;
  let box = bounds(scale);
  scale *= Math.min(
    1,
    Math.sqrt(16_777_216 / (box[2]! * box[3]!)),
    8192 / Math.max(box[2]!, box[3]!),
  );
  box = bounds(scale);
  const canvas = stack.adopt(document.createElement("canvas"), (canvas) => {
    canvas.width = 0;
    canvas.height = 0;
  });
  canvas.width = Math.max(1, Math.floor(box[2]!));
  canvas.height = Math.max(1, Math.floor(box[3]!));
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("Canvas unavailable");
  const viewport = page.getViewport({
    scale,
    offsetX: -box[0]!,
    offsetY: -box[1]!,
  });
  const task = stack.adopt(
    page.render({ canvasContext: context, viewport, intent: "display" }),
    (task) => task.cancel(),
  );
  // Attach a rejection handler before checking the private seam.
  void task.promise.catch(() => undefined);
  usePromiseScheduling(page, task);
  const cancelRender = () => task.cancel();
  signal.addEventListener("abort", cancelRender, { once: true });
  stack.defer(() => signal.removeEventListener("abort", cancelRender));
  await abortable(task.promise, signal);
  const blob = await abortable(
    new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) =>
          blob ? resolve(blob) : reject(new Error("PNG encoding failed")),
        "image/png",
      ),
    ),
    signal,
  );
  return new Uint8Array(await abortable(blob.arrayBuffer(), signal));
}
