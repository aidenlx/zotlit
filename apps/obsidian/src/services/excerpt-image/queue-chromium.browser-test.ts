// Runs the production PDF queue in a disposable Electron renderer, so the crop
// work it schedules is real Chromium canvas encoding and the one window it runs
// in is hidden — the background-throttled state a minimized Obsidian is in.
// Nothing here parses a PDF: the renderer's own document load and rasterizer
// live in Obsidian (see docs/excerpt-image-queue-measurements.md).
import { check } from "./__fixtures__/check";
import { encodeExcerptImage } from "./encode";
import { EXCERPT_JOB_LIMIT, ExcerptPdfQueue } from "./pdf-queue";

export interface ChromiumQueueReport {
  passed: string[];
  userAgent: string;
  /** `hidden` for the fixture's `show: false` window. */
  visibility: string;
  /** 130 producers over 5 PDFs, each encoding a real Chromium canvas crop. */
  cold: {
    excerpts: number;
    renders: number;
    bytes: number;
    peakRenders: number;
    peakAdmitted: number;
    awaitingAtBurst: number;
    totalMs: number;
  };
  /** A cache hit answers on the preflight queue while a render holds the slot. */
  cacheHitWhileBlocked: { hitMs: number; answeredWhileBlocked: boolean };
  /** `idle` resolves only after an admitted job's teardown ran. */
  teardown: { order: string[] };
  /** How a 200 ms timer and a 200 ms `AbortSignal.timeout` actually fired here. */
  throttledTimers: { timerMs: number; deadlineMs: number };
}

/** The crop every job encodes: the full-width page crop an excerpt shows. */
const CROP_WIDTH = 600;
const CROP_HEIGHT = 200;

/** One deterministic crop, drawn and encoded in this renderer. */
async function crop(seed: number, signal: AbortSignal): Promise<Uint8Array> {
  const canvas = document.createElement("canvas");
  canvas.width = CROP_WIDTH;
  canvas.height = CROP_HEIGHT;
  const paint = canvas.getContext("2d", { alpha: false });
  if (!paint) throw new Error("Canvas context unavailable");
  paint.fillStyle = "#ffffff";
  paint.fillRect(0, 0, CROP_WIDTH, CROP_HEIGHT);
  paint.fillStyle = "#20242a";
  for (let row = 0; row < 14; row++)
    paint.fillRect(8, 8 + row * 10, CROP_WIDTH - 16 - ((row * seed) % 40), 4);
  paint.strokeStyle = "#b03030";
  paint.lineWidth = 2;
  paint.beginPath();
  paint.moveTo(6, CROP_HEIGHT - 8);
  paint.lineTo(CROP_WIDTH - 6, 12);
  paint.stroke();
  const image = await encodeExcerptImage(canvas, signal);
  return image.bytes;
}

/** A cold batch: no reader, no vault, no warm state — every excerpt draws and
 * encodes its crop from scratch while the bound is under pressure, so the
 * second producer past the bound has to wait for a slot rather than be refused.
 * Returns the first crop alongside the counts, as the bytes a later request
 * would find in the cache. */
async function cold(queue: ExcerptPdfQueue): Promise<{
  counts: ChromiumQueueReport["cold"];
  stored: Uint8Array;
}> {
  const excerpts = EXCERPT_JOB_LIMIT + 2;
  const controller = new AbortController();
  let renders = 0;
  let bytes = 0;
  let active = 0;
  let peakRenders = 0;
  let peakAdmitted = 0;
  let stored: Uint8Array | undefined;
  const started = performance.now();
  const producers = Array.from({ length: excerpts }, async (_, index) => {
    const admission = await queue.reserve(controller.signal);
    peakAdmitted = Math.max(peakAdmitted, queue.diagnostics.admitted);
    try {
      const image = await admission.render(
        async () => {
          active += 1;
          peakRenders = Math.max(peakRenders, active);
          try {
            return await crop(index + 1, controller.signal);
          } finally {
            active -= 1;
          }
        },
        {
          pdf: `PDF ${index % 5}`,
          sequence: queue.nextSequence(),
          signal: controller.signal,
        },
      );
      stored ??= image;
      bytes += image.byteLength;
      renders += 1;
    } finally {
      admission.release();
    }
  });
  // Every producer reserves in this one synchronous burst, so the counts read
  // here are the bound's own decision before any crop has finished.
  const awaitingAtBurst = queue.diagnostics.awaiting;
  await Promise.all(producers);
  return {
    counts: {
      excerpts,
      renders,
      bytes,
      peakRenders,
      peakAdmitted,
      awaitingAtBurst,
      totalMs: performance.now() - started,
    },
    stored: stored!,
  };
}

/** The stored crop's bytes answer a request while a render holds the slot. */
async function cacheHitWhileBlocked(
  queue: ExcerptPdfQueue,
  stored: Uint8Array,
): Promise<ChromiumQueueReport["cacheHitWhileBlocked"]> {
  const controller = new AbortController();
  const release = Promise.withResolvers<void>();
  const started = Promise.withResolvers<void>();
  let finished = false;
  const admission = await queue.reserve(controller.signal);
  const rendering = admission.render(
    async () => {
      started.resolve();
      try {
        await release.promise;
      } finally {
        finished = true;
      }
    },
    {
      pdf: "PDF",
      sequence: queue.nextSequence(),
      signal: controller.signal,
    },
  );
  await started.promise;
  const hit = performance.now();
  const answered = await queue.preflight(async () => stored, controller.signal);
  const hitMs = performance.now() - hit;
  const answeredWhileBlocked = answered.byteLength > 0 && !finished;
  release.resolve();
  await rendering;
  admission.release();
  return { hitMs, answeredWhileBlocked };
}

/** Teardown owns the slot: `idle` may not resolve before it ran. */
async function teardown(
  queue: ExcerptPdfQueue,
): Promise<ChromiumQueueReport["teardown"]> {
  const controller = new AbortController();
  const order: string[] = [];
  const release = Promise.withResolvers<void>();
  const admission = await queue.reserve(controller.signal);
  const rendering = admission.render(
    async () => {
      try {
        await release.promise;
      } finally {
        order.push("teardown");
      }
    },
    {
      pdf: "PDF",
      sequence: queue.nextSequence(),
      signal: controller.signal,
    },
  );
  const idle = queue.idle().then(() => {
    order.push("idle");
  });
  admission.release();
  release.resolve();
  await idle;
  await rendering;
  return { order };
}

/** What a scheduled 200 ms really costs in this window. */
async function throttledTimers(): Promise<
  ChromiumQueueReport["throttledTimers"]
> {
  const timerStart = performance.now();
  const timer = new Promise<number>((resolve) => {
    setTimeout(() => resolve(performance.now() - timerStart), 200);
  });
  const deadlineStart = performance.now();
  const signal = AbortSignal.timeout(200);
  const deadline = new Promise<number>((resolve) => {
    signal.addEventListener(
      "abort",
      () => resolve(performance.now() - deadlineStart),
      { once: true },
    );
  });
  const [timerMs, deadlineMs] = await Promise.all([timer, deadline]);
  return { timerMs, deadlineMs };
}

export async function run(): Promise<ChromiumQueueReport> {
  const passed: string[] = [];
  const queue = new ExcerptPdfQueue();
  const coldBatch = await cold(queue);
  const counts = coldBatch.counts;
  check(counts.renders === counts.excerpts, "a crop settled per excerpt");
  // One PDF crop at a time, in a hidden window, with real encoding behind it.
  check(counts.peakRenders === 1, "never two crop renders at once");
  // The bound decides for in-app work: it is reached, and the overflow waits.
  check(
    counts.peakAdmitted === EXCERPT_JOB_LIMIT,
    `the bound of ${EXCERPT_JOB_LIMIT} was reached, not crossed`,
  );
  check(
    counts.awaitingAtBurst === 2,
    "the producers past the bound waited for a slot",
  );
  check(counts.bytes > 0, "the crops encoded to bytes");
  check(
    coldBatch.stored.byteLength > 0,
    "the first crop carried payload bytes",
  );
  check(!queue.busy, "the batch left nothing in flight");
  passed.push("cold batch of canvas crops");

  const cacheHit = await cacheHitWhileBlocked(queue, coldBatch.stored);
  check(
    cacheHit.answeredWhileBlocked,
    "the cache hit answered while the render was still blocked",
  );
  passed.push("cache hit while a render is blocked");

  const idleOrder = await teardown(queue);
  check(
    idleOrder.order.join(" ") === "teardown idle",
    `idle followed teardown: ${idleOrder.order.join(" ")}`,
  );
  passed.push("teardown before idle");

  const throttled = await throttledTimers();
  check(
    Number.isFinite(throttled.timerMs) && throttled.timerMs < 10_000,
    "a scheduled timer still fires while the window is hidden",
  );
  check(
    Number.isFinite(throttled.deadlineMs) && throttled.deadlineMs < 10_000,
    "AbortSignal.timeout still fires while the window is hidden",
  );
  passed.push("timers under background throttling");

  return {
    passed,
    userAgent: navigator.userAgent,
    visibility: document.visibilityState,
    cold: counts,
    cacheHitWhileBlocked: cacheHit,
    teardown: idleOrder,
    throttledTimers: throttled,
  };
}
