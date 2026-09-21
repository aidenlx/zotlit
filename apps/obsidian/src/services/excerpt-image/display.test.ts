// The live display read of one Annotation, as a card demands it and a saved
// edit replaces it.

import { open } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { loadPdfJs } from "obsidian";
import { describe, expect, it, vi } from "vitest";

import type {
  AnnotationRecord,
  AnnotationSource,
} from "@/services/annotation-repository/service";
import { QueryClientService } from "@/services/query-client/service";

import { redPng } from "./__fixtures__/png";
import { sizedWebp } from "./__fixtures__/webp";
import { EXCERPT_DISPLAY, ExcerptDisplayService } from "./display";
import type { ExcerptDisplayDemand, ExcerptImageDisplay } from "./display";
import { PNG_FORMAT, WEBP_FORMAT } from "./format";
import type { ExcerptImage } from "./format";
import type {
  ExcerptPdfJs,
  ExcerptRendererDiagnosticSnapshot,
} from "./renderer";
import { ExcerptImageService } from "./service";
import type { ExcerptEntry, ExcerptRequest } from "./service";

// The one read below that goes through the service's own renderer doubles the
// PDF file and the canvas that renderer needs, and nothing else.
vi.mock("node:fs/promises", async (original) => ({
  ...(await original<typeof import("node:fs/promises")>()),
  open: vi.fn(),
}));
vi.mock("obsidian", async (original) => ({
  ...(await original<typeof import("obsidian")>()),
  loadPdfJs: vi.fn(),
}));

const SOURCE: AnnotationSource = {
  kind: "zotero-db",
  database: { userID: 1, localUserKey: "local", serverID: "server" },
  libraryID: 1,
  libraryRevision: 1,
};

/** One ink Annotation: its colour and its path are the pixels an image paints. */
function annotation(color: string): AnnotationRecord {
  return {
    key: "INK1",
    parentKey: "PDF1",
    type: "ink",
    color,
    comment: null,
    text: null,
    pageLabel: "1",
    tags: [],
    version: 1,
    position: { kind: "pdf-ink", pageIndex: 0, width: 2, paths: [[20, 30]] },
  };
}

/** One request for those pixels; every colour is another canonical cache key. */
function request(color: string): ExcerptRequest {
  return {
    annotation: annotation(color),
    source: SOURCE,
    sourceScope: "/fixture",
    attachmentKey: "PDF1",
    libraryID: 1,
    pdfPath: "/paper.pdf",
    zoteroPngPath: null,
  };
}

/** The image one render answers with; the byte tells the images apart. */
function image(byte: number): ExcerptImage {
  return { bytes: new Uint8Array([byte]), format: PNG_FORMAT };
}

/** One render the test holds open. */
interface Render {
  readonly request: ExcerptRequest;
  readonly signal: AbortSignal;
  readonly answer: PromiseWithResolvers<ExcerptImage>;
  /** Resolves when the render was abandoned, which the caller can await. */
  readonly cancelled: Promise<void>;
  /** Whether the test has answered the render; a signal after that abandons nothing. */
  answered: boolean;
  aborted: boolean;
}

/** What one live display harness hands a test. */
interface Live extends AsyncDisposable {
  readonly queries: QueryClientService;
  readonly service: ExcerptImageService;
  readonly display: ExcerptDisplayService;
  readonly renders: Render[];
  /** One card's demand, released when the harness goes. */
  card(): ExcerptDisplayDemand;
  /** The render at `index`, once it has started. */
  started(index: number): Promise<Render>;
  /** Wait for the render at `index` to be abandoned. */
  cancelled(index: number): Promise<void>;
  /** Answer one render; the caller awaits its commit through a snapshot. */
  finish(index: number, bytes: number): void;
  /** Fail one render, which leaves the resolution to Zotero's own image. */
  fail(index: number): void;
  /** Replace the PDF behind the demanded path: its stamp moves, so its entry is stale. */
  replacePdf(): void;
}

/**
 * A real service on a real query client, with every render gated: the test, and
 * not a clock, decides when one finishes and what it answers.
 */
function harness(): Live {
  const renders: Render[] = [];
  const entries = new Map<string, ExcerptEntry>();
  const demands: ExcerptDisplayDemand[] = [];
  const stack = new AsyncDisposableStack();
  let arrived = Promise.withResolvers<void>();
  /** The PDF stamp every probe reads; a replacement moves its modification time. */
  let mtimeMs = 1;
  const service = stack.use(
    new ExcerptImageService({
      stamp: async () => ({ size: 100, mtimeMs }),
      render: (renderRequest, signal) => {
        const answer = Promise.withResolvers<ExcerptImage>();
        const cancelled = Promise.withResolvers<void>();
        const render: Render = {
          request: renderRequest,
          signal,
          answer,
          cancelled: cancelled.promise,
          answered: false,
          aborted: false,
        };
        renders.push(render);
        arrived.resolve();
        arrived = Promise.withResolvers<void>();
        signal.addEventListener(
          "abort",
          () => {
            // The service aborts the signal of its own finished job too; only a
            // render it abandoned before the answer counts.
            if (render.answered) return;
            render.aborted = true;
            cancelled.resolve();
            answer.reject(signal.reason);
          },
          { once: true },
        );
        return answer.promise;
      },
      read: async () => redPng,
      cache: {
        get: async (key) => entries.get(key),
        put: async (key, entry) => {
          entries.set(key, entry);
        },
      },
    }),
  );
  const queries = stack.use(new QueryClientService());
  const display = stack.use(
    new ExcerptDisplayService({
      queries,
      resolve: (resolveRequest, signal) =>
        service.resolve(resolveRequest, signal),
    }),
  );
  return {
    queries,
    service,
    display,
    renders,
    card() {
      const demand = display.open();
      demands.push(demand);
      return demand;
    },
    async started(index) {
      while (renders.length <= index) await arrived.promise;
      return renders[index]!;
    },
    async cancelled(index) {
      await this.started(index);
      await renders[index]!.cancelled;
    },
    finish(index, bytes) {
      const render = renders[index]!;
      render.answered = true;
      render.answer.resolve(image(bytes));
    },
    fail(index) {
      const render = renders[index]!;
      render.answered = true;
      render.answer.reject(new Error("PDF render failed"));
    },
    replacePdf() {
      mtimeMs++;
    },
    async [Symbol.asyncDispose]() {
      for (const demand of demands) demand.release();
      await stack.disposeAsync();
    },
  };
}

/** The next snapshot that answers `matches`, as one resolution's completion signal. */
function settled(
  demand: ExcerptDisplayDemand,
  matches: (display: ExcerptImageDisplay) => boolean,
): Promise<ExcerptImageDisplay> {
  const next = Promise.withResolvers<ExcerptImageDisplay>();
  const check = () => {
    const snapshot = demand.snapshot();
    if (matches(snapshot)) next.resolve(snapshot);
  };
  const off = demand.subscribe(check);
  check();
  return next.promise.finally(off);
}

/**
 * One read through the service's own renderer, with the PDF file and the canvas
 * that renderer needs doubled and the page render held open: the display read
 * engages the real `ExcerptRenderer`, and the test watches what it holds.
 */
interface Resident extends AsyncDisposable {
  readonly service: ExcerptImageService;
  readonly card: ExcerptDisplayDemand;
  /** What the service's own renderer reports it is holding. */
  diagnostics(): ExcerptRendererDiagnosticSnapshot;
  /** Resolves once the page render has started and is held open. */
  painting(): Promise<void>;
  /** Let the held render task finish, so the read commits. */
  finish(): void;
}

/** One renderer hold: a PDF file it reads, and a page render the test ends. */
function resident(): Resident {
  const painting = Promise.withResolvers<void>();
  const painted = Promise.withResolvers<void>();
  const bytes = new Uint8Array([1, 2, 3, 4]);
  vi.mocked(open).mockImplementation(
    async () =>
      ({
        stat: async () => ({ size: bytes.length, mtimeMs: 1 }),
        read: async (
          ...[target, offset, length, position]: [
            Uint8Array,
            number,
            number,
            number,
          ]
        ) => {
          const part = bytes.subarray(position, position + length);
          target.set(part, offset);
          return { bytesRead: part.length, buffer: target };
        },
        close: async () => {},
      }) as unknown as FileHandle,
  );
  const task = { promise: painted.promise, cancel: () => {} };
  const page = {
    view: [0, 0, 100, 50],
    cleanup: () => true,
    getViewport: ({
      scale,
      offsetX = 0,
      offsetY = 0,
    }: {
      scale: number;
      offsetX?: number;
      offsetY?: number;
    }) => ({
      convertToViewportPoint: (x: number, y: number): [number, number] => [
        x * scale + offsetX,
        y * scale + offsetY,
      ],
    }),
    // The one intent state PDF.js would carry for this page, holding the render
    // task about to run, which is how the renderer keeps the frame loop off.
    _intentStates: new Map([
      [
        1,
        { renderTasks: new Set([{ task, _useRequestAnimationFrame: true }]) },
      ],
    ]),
    render: () => {
      painting.resolve();
      return task;
    },
  };
  const pdf: ExcerptPdfJs = {
    getDocument: () => ({
      promise: Promise.resolve({ getPage: async () => page }),
      destroy: async () => {},
    }),
  };
  vi.mocked(loadPdfJs).mockImplementation(async () => pdf);
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ({
      beginPath: () => {},
      moveTo: () => {},
      lineTo: () => {},
      stroke: () => {},
      arc: () => {},
      fill: () => {},
    }),
    toBlob: (callback: (blob: Blob) => void) =>
      callback(
        new Blob([
          sizedWebp(canvas.width, canvas.height) as unknown as BlobPart,
        ]),
      ),
  };
  vi.stubGlobal("document", {
    createElement: () => canvas as unknown as HTMLCanvasElement,
  });

  const stack = new AsyncDisposableStack();
  stack.defer(() => {
    vi.unstubAllGlobals();
  });
  const service = stack.use(
    new ExcerptImageService({
      stamp: async () => ({ size: bytes.length, mtimeMs: 1 }),
    }),
  );
  const queries = stack.use(new QueryClientService());
  const display = stack.use(
    new ExcerptDisplayService({
      queries,
      resolve: (request, signal) => service.resolve(request, signal),
    }),
  );
  const card = display.open();
  stack.defer(() => {
    card.release();
  });
  return {
    service,
    card,
    diagnostics: () => {
      const diagnostics = service.rendererDiagnostics;
      if (!diagnostics) throw new Error("Excerpt renderer unavailable");
      return diagnostics.snapshot();
    },
    painting: () => painting.promise,
    finish: () => painted.resolve(),
    [Symbol.asyncDispose]: () => stack.disposeAsync(),
  };
}

/** Whether the snapshot holds an image for the demanded pixels. */
const painted = (display: ExcerptImageDisplay): boolean =>
  display.status === "settled" && display.current && display.image !== null;

describe("Excerpt Image live display", () => {
  it("paints the image one resolution commits for the demanded pixels", async () => {
    await using live = harness();
    const card = live.card();

    card.demand(request("#ff0000"));
    await live.started(0);
    expect(live.renders).toHaveLength(1);
    expect(card.snapshot()).toEqual({
      image: null,
      current: false,
      status: "reading",
    });

    live.finish(0, 7);
    const display = await settled(card, painted);
    expect(display.image?.bytes).toEqual(new Uint8Array([7]));
    expect(display.current).toBe(true);
  });

  it("keeps painting the previous image while a saved edit replaces it", async () => {
    await using live = harness();
    const card = live.card();
    card.demand(request("#ff0000"));
    await live.started(0);
    live.finish(0, 1);
    const first = await settled(card, painted);

    const saved = request("#00ff00");
    live.display.revalidate(saved);
    card.demand(saved);
    await live.started(1);
    expect(live.renders).toHaveLength(2);
    expect(card.snapshot()).toEqual({
      image: first.image,
      current: false,
      status: "reading",
    });

    live.finish(1, 2);
    const replaced = await settled(card, (display) => painted(display));
    expect(replaced.image?.bytes).toEqual(new Uint8Array([2]));
    expect(replaced.current).toBe(true);
  });

  it("publishes the latest saved request through an A→B→A race", async () => {
    await using live = harness();
    const card = live.card();
    const pixels = request("#ff0000");
    card.demand(pixels);
    await live.started(0);
    live.finish(0, 1);
    await settled(card, painted);

    const other = request("#00ff00");
    live.display.revalidate(other);
    card.demand(other);
    await live.started(1);
    live.display.revalidate(pixels);
    card.demand(pixels);
    // The superseded resolution was cancelled, and the image already held for
    // the pixels that are saved again answers without another render.
    await live.cancelled(1);
    expect(live.renders).toHaveLength(2);
    expect(live.renders[1]!.aborted).toBe(true);

    live.finish(1, 2);
    const display = await settled(card, painted);
    expect(display.image?.bytes).toEqual(new Uint8Array([1]));
  });

  it("answers every demand for the same saved pixels with one resolution", async () => {
    await using live = harness();
    const one = live.card();
    const two = live.card();
    const pixels = request("#ff0000");

    one.demand(pixels);
    two.demand(pixels);
    await live.started(0);
    live.display.revalidate(pixels);
    expect(live.renders).toHaveLength(1);

    live.finish(0, 1);
    const [first, second] = await Promise.all([
      settled(one, painted),
      settled(two, painted),
    ]);
    expect(first.image?.bytes).toEqual(new Uint8Array([1]));
    expect(second.image?.bytes).toEqual(new Uint8Array([1]));
    expect(live.renders).toHaveLength(1);
  });

  it("keeps the previous image after a failed replacement and reads again on the next saved edit", async () => {
    await using live = harness();
    const card = live.card();
    card.demand(request("#ff0000"));
    await live.started(0);
    live.finish(0, 1);
    const first = await settled(card, painted);

    const saved = request("#00ff00");
    live.display.revalidate(saved);
    card.demand(saved);
    await live.started(1);
    live.fail(1);
    const failed = await settled(
      card,
      (display) => display.status === "failed",
    );
    expect(failed.image?.bytes).toEqual(first.image?.bytes);
    expect(failed.current).toBe(false);

    const next = request("#0000ff");
    live.display.revalidate(next);
    card.demand(next);
    await live.started(2);
    expect(live.renders).toHaveLength(3);
    live.finish(2, 3);
    const replaced = await settled(card, painted);
    expect(replaced.image?.bytes).toEqual(new Uint8Array([3]));
  });

  it("re-resolves the same pixels for the Refresh gesture", async () => {
    await using live = harness();
    const card = live.card();
    const saved = request("#ff0000");
    card.demand(saved);
    await live.started(0);
    live.finish(0, 1);
    expect((await settled(card, painted)).image?.bytes).toEqual(
      new Uint8Array([1]),
    );

    // The same path now holds another PDF, and the stamp this fixture reports
    // says so: the display must read the pixels again rather than join the read
    // that already stands for them.
    live.replacePdf();
    live.display.refresh();
    const again = await live.started(1);
    expect(again.request).toEqual(saved);

    live.finish(1, 2);
    const replaced = await settled(
      card,
      (display) => painted(display) && display.image?.bytes[0] === 2,
    );
    expect(replaced.image?.bytes).toEqual(new Uint8Array([2]));
    expect(replaced.current).toBe(true);
  });

  it("ends a failed read's cooldown when Refresh is asked", async () => {
    await using live = harness();
    const card = live.card();
    card.demand(request("#ff0000"));
    await live.started(0);
    live.fail(0);
    await settled(card, (display) => display.status === "failed");

    // A key whose last read failed is served from what it holds until the
    // client's cooldown passes, so the refresh drops that answer before it
    // reads: the gesture resolves the pixels again instead of waiting it out.
    live.display.refresh();
    await live.started(1);
    live.finish(1, 2);
    const recovered = await settled(card, painted);
    expect(recovered.image?.bytes).toEqual(new Uint8Array([2]));
    expect(recovered.current).toBe(true);
  });

  it("releases one demand alone, and the read with the last demand", async () => {
    await using live = harness();
    const one = live.card();
    const two = live.card();
    one.demand(request("#ff0000"));
    two.demand(request("#ff0000"));
    await live.started(0);
    expect(live.renders).toHaveLength(1);

    one.release();
    expect(live.renders[0]!.aborted).toBe(false);
    live.finish(0, 1);
    const display = await settled(two, painted);
    expect(display.image?.bytes).toEqual(new Uint8Array([1]));

    two.demand(request("#00ff00"));
    await live.started(1);
    expect(live.renders).toHaveLength(2);
    two.release();
    await live.cancelled(1);
    expect(live.renders[1]!.aborted).toBe(true);
    expect(live.queries.keysUnder([EXCERPT_DISPLAY])).toEqual([]);
  });

  it("resolves a captured note request from its own pixels, never from the display", async () => {
    await using live = harness();
    const card = live.card();
    const pixels = request("#ff0000");
    card.demand(pixels);

    // The note captures the pixels the display is resolving: one job answers
    // both, and the display moving on releases its own demand alone.
    const note = live.service.resolve(request("#ff0000"));
    await live.started(0);
    expect(live.renders).toHaveLength(1);
    card.demand(request("#00ff00"));

    // The display's own demand is gone, but the job the note shares runs on.
    live.finish(0, 1);
    await expect(note).resolves.toMatchObject({
      kind: "available",
      provenance: "rendered",
      bytes: new Uint8Array([1]),
    });
    expect(live.renders[0]!.aborted).toBe(false);

    await live.started(1);
    live.finish(1, 2);
    const display = await settled(card, painted);
    expect(display.image?.bytes).toEqual(new Uint8Array([2]));

    // A note asking for pixels the display never held renders its own image.
    const later = live.service.resolve(request("#0000ff"));
    await live.started(2);
    expect(live.renders).toHaveLength(3);
    live.finish(2, 9);
    await expect(later).resolves.toMatchObject({
      kind: "available",
      bytes: new Uint8Array([9]),
    });
    expect(card.snapshot().image?.bytes).toEqual(new Uint8Array([2]));
  });

  it("holds the renderer for the live read alone, and releases it when the read settles", async () => {
    await using live = resident();
    // The marker this fixture has to lack first: no file, no document, and no
    // render task is open, so every one of them below is the read's own. A
    // demand the renderer never engages — no PDF path, say — can only report
    // this same idle state, which is what makes the assertions mean something.
    expect(live.diagnostics()).toMatchObject({
      jobActive: false,
      fileOpen: false,
      documentOpen: false,
      renderTaskActive: false,
    });

    live.card.demand(request("#ff0000"));
    await live.painting();
    // The read is live: the renderer holds the PDF document and the page it is
    // painting, and the card has no image yet.
    expect(live.diagnostics()).toMatchObject({
      jobActive: true,
      documentOpen: true,
      renderTaskActive: true,
    });
    expect(live.diagnostics().canvas).not.toBeNull();

    live.finish();
    const shown = await settled(live.card, painted);
    expect(shown.image?.format).toBe(WEBP_FORMAT);
    // The read is over while the card still demands it: what it held goes.
    expect(live.diagnostics()).toMatchObject({
      phase: "idle",
      jobActive: false,
      fileOpen: false,
      documentOpen: false,
      renderTaskActive: false,
      canvas: null,
    });
  });
});
