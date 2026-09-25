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

import { settledDisplay } from "./__fixtures__/display-state";
import { redPng } from "./__fixtures__/png";
import { renderGate } from "./__fixtures__/render-gate";
import type { GatedRender } from "./__fixtures__/render-gate";
import { sizedWebp } from "./__fixtures__/webp";
import { EXCERPT_DISPLAY, ExcerptDisplayService } from "./display";
import type { ExcerptDisplayDemand, ExcerptImageDisplay } from "./display";
import { PNG_FORMAT, WEBP_FORMAT } from "./format";
import type { ExcerptImage } from "./format";
import type {
  ExcerptPdfJs,
  ExcerptRendererDiagnosticSnapshot,
} from "./renderer";
import {
  ExcerptImageService,
  excerptAnnotationRecord,
  excerptFingerprint,
  excerptKey,
} from "./service";
import type { ExcerptEntry, ExcerptIdentity, ExcerptRequest } from "./service";

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
function annotation(color: string, key = "INK1"): AnnotationRecord {
  return {
    key,
    parentKey: "PDF1",
    type: "ink",
    color,
    comment: null,
    text: null,
    pageLabel: "1",
    sortIndex: "00000|000000|00000",
    tags: [],
    version: 1,
    position: { kind: "pdf-ink", pageIndex: 0, width: 2, paths: [[20, 30]] },
  };
}

/** One request for those pixels; every colour is another canonical cache key. */
function request(color: string, key = "INK1"): ExcerptRequest {
  return {
    annotation: annotation(color, key),
    source: SOURCE,
    sourceScope: "/fixture",
    attachmentKey: "PDF1",
    libraryID: 1,
    pdfPath: "/paper.pdf",
    zoteroPngPath: null,
  };
}

/** The store record one Annotation's latest image lives under. */
function stored(identity: ExcerptRequest): string {
  return excerptAnnotationRecord(identity);
}

/** The image one render answers with; the byte tells the images apart. */
function image(byte: number): ExcerptImage {
  return { bytes: new Uint8Array([byte]), format: PNG_FORMAT };
}

/** What one live display harness hands a test. */
interface Live extends AsyncDisposable {
  readonly queries: QueryClientService;
  readonly service: ExcerptImageService;
  readonly display: ExcerptDisplayService;
  readonly renders: GatedRender[];
  /** The store's own view of the devices images: what is cached, and its references. */
  readonly entries: Map<string, ExcerptEntry>;
  readonly references: Map<string, ExcerptIdentity>;
  /** One card's demand, released when the harness goes. */
  card(): ExcerptDisplayDemand;
  /** The render at `index`, once it has started. */
  started(index: number): Promise<GatedRender>;
  /** The display's `index`-th read of a device-local image, once it settled. */
  storedRead(index: number): Promise<void>;
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
  const gate = renderGate();
  const entries = new Map<string, ExcerptEntry>();
  const references = new Map<string, ExcerptIdentity>();
  const demands: ExcerptDisplayDemand[] = [];
  const stack = new AsyncDisposableStack();
  /** The PDF stamp every probe reads; a replacement moves its modification time. */
  let mtimeMs = 1;
  const service = stack.use(
    new ExcerptImageService({
      stamp: async () => ({ size: 100, mtimeMs }),
      render: gate.render,
      read: async () => redPng,
      cache: {
        get: async (key) => entries.get(key),
        put: async (key, entry) => {
          entries.set(key, entry);
        },
        latest: async (identity) => references.get(identity),
        putLatest: async (identity, reference) => {
          references.set(identity, reference);
        },
      },
    }),
  );
  const queries = stack.use(new QueryClientService());
  const storedReads: Promise<void>[] = [];
  const display = stack.use(
    new ExcerptDisplayService({
      queries,
      resolve: (resolveRequest, signal) =>
        service.resolve(resolveRequest, signal),
      stored: (storedRequest) => {
        const read = service.stored(storedRequest);
        storedReads.push(
          read.then(
            () => undefined,
            () => undefined,
          ),
        );
        return read;
      },
    }),
  );
  return {
    queries,
    service,
    display,
    renders: gate.renders,
    entries,
    references,
    card() {
      const demand = display.open();
      demands.push(demand);
      return demand;
    },
    started: gate.started,
    async storedRead(index) {
      await storedReads[index];
    },
    async cancelled(index) {
      const render = await gate.started(index);
      await render.cancelled;
    },
    finish(index, bytes) {
      const render = gate.renders[index]!;
      render.answered = true;
      render.answer.resolve(image(bytes));
    },
    fail(index) {
      const render = gate.renders[index]!;
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
      stored: (storedRequest) => service.stored(storedRequest),
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
    const display = await settledDisplay(card, painted);
    expect(display.image?.bytes).toEqual(new Uint8Array([7]));
    expect(display.current).toBe(true);
  });

  it("keeps painting the previous image while a saved edit replaces it", async () => {
    await using live = harness();
    const card = live.card();
    card.demand(request("#ff0000"));
    await live.started(0);
    live.finish(0, 1);
    const first = await settledDisplay(card, painted);

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
    const replaced = await settledDisplay(card, (display) => painted(display));
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
    await settledDisplay(card, painted);

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
    const display = await settledDisplay(card, painted);
    expect(display.image?.bytes).toEqual(new Uint8Array([1]));
  });

  it("keeps the newer saved demand when an older snapshot arrives late", async () => {
    await using live = harness();
    const newer = live.card();
    const delayed = live.card();
    const saved: ExcerptRequest = {
      ...request("#ff0000"),
      annotation: { ...request("#ff0000").annotation, version: 2 },
    };
    const stale: ExcerptRequest = {
      ...request("#00ff00"),
      annotation: { ...request("#00ff00").annotation, version: 1 },
    };

    newer.demand(saved);
    await live.started(0);
    live.finish(0, 1);
    const first = await settledDisplay(newer, painted);
    expect(first.image?.bytes).toEqual(new Uint8Array([1]));

    // The delayed card states the record as it was before the newer save. What
    // the slot answers is still the newer saved pixels, so neither card moves
    // back, and no read starts for the superseded snapshot.
    delayed.demand(stale);
    expect(live.renders).toHaveLength(1);
    expect(delayed.snapshot()).toEqual({
      image: first.image,
      current: false,
      status: "settled",
    });
    expect(newer.snapshot()).toEqual({
      image: first.image,
      current: true,
      status: "settled",
    });

    // A newer saved version still proceeds: the slot reads the pixels it asks.
    const newest: ExcerptRequest = {
      ...request("#0000ff"),
      annotation: { ...request("#0000ff").annotation, version: 3 },
    };
    delayed.demand(newest);
    await live.started(1);
    expect(live.renders).toHaveLength(2);
    live.finish(1, 3);
    const replaced = await settledDisplay(delayed, painted);
    expect(replaced.image?.bytes).toEqual(new Uint8Array([3]));
    expect(replaced.current).toBe(true);
  });

  it("keeps the newer saved pixels when a revalidation carries an older record", async () => {
    await using live = harness();
    const card = live.card();
    const saved: ExcerptRequest = {
      ...request("#ff0000"),
      annotation: { ...request("#ff0000").annotation, version: 2 },
    };
    card.demand(saved);
    await live.started(0);
    live.finish(0, 1);
    const first = await settledDisplay(card, painted);

    // A revalidation of an older record — a list read that started before the
    // newer save — cannot move the display back: the demand it answers is still
    // the newer saved pixels, so no read starts for the superseded ones.
    const stale: ExcerptRequest = {
      ...request("#00ff00"),
      annotation: { ...request("#00ff00").annotation, version: 1 },
    };
    live.display.revalidate(stale);
    expect(live.renders).toHaveLength(1);
    expect(card.snapshot()).toEqual({
      image: first.image,
      current: true,
      status: "settled",
    });
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
      settledDisplay(one, painted),
      settledDisplay(two, painted),
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
    const first = await settledDisplay(card, painted);

    const saved = request("#00ff00");
    live.display.revalidate(saved);
    card.demand(saved);
    await live.started(1);
    live.fail(1);
    const failed = await settledDisplay(
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
    const replaced = await settledDisplay(card, painted);
    expect(replaced.image?.bytes).toEqual(new Uint8Array([3]));
  });

  it("re-resolves the same pixels for the Refresh gesture", async () => {
    await using live = harness();
    const card = live.card();
    const saved = request("#ff0000");
    card.demand(saved);
    await live.started(0);
    live.finish(0, 1);
    expect((await settledDisplay(card, painted)).image?.bytes).toEqual(
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
    const replaced = await settledDisplay(
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
    await settledDisplay(card, (display) => display.status === "failed");

    // A key whose last read failed is served from what it holds until the
    // client's cooldown passes, so the refresh drops that answer before it
    // reads: the gesture resolves the pixels again instead of waiting it out.
    live.display.refresh();
    await live.started(1);
    live.finish(1, 2);
    const recovered = await settledDisplay(card, painted);
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
    const display = await settledDisplay(two, painted);
    expect(display.image?.bytes).toEqual(new Uint8Array([1]));

    two.demand(request("#00ff00"));
    await live.started(1);
    expect(live.renders).toHaveLength(2);
    two.release();
    await live.cancelled(1);
    expect(live.renders[1]!.aborted).toBe(true);
    expect(live.queries.keysUnder([EXCERPT_DISPLAY])).toEqual([]);
  });

  it("stops painting the cleared image on the cards mounted at clear time", async () => {
    await using live = harness();
    const one = live.card();
    const two = live.card();
    const pixels = request("#ff0000");
    one.demand(pixels);
    two.demand(pixels);
    await live.started(0);
    live.finish(0, 1);
    const [first, second] = await Promise.all([
      settledDisplay(one, painted),
      settledDisplay(two, painted),
    ]);
    expect(first.image?.bytes).toEqual(new Uint8Array([1]));
    expect(second.image?.bytes).toEqual(new Uint8Array([1]));
    // Both cards read a painted snapshot now, which is the state the clear has
    // to move: a card that kept it would go on painting the cleared image.
    expect(one.snapshot().image?.bytes).toEqual(new Uint8Array([1]));
    expect(two.snapshot().image?.bytes).toEqual(new Uint8Array([1]));

    // The clear takes the Held Read and the image it held: the cards mounted on
    // it release the image they were painted from rather than going on painting
    // a display the clear released.
    live.display.clear();
    expect(live.queries.keysUnder([EXCERPT_DISPLAY])).toEqual([]);
    expect(one.snapshot()).toEqual({
      image: null,
      current: false,
      status: "cleared",
    });
    expect(two.snapshot()).toEqual({
      image: null,
      current: false,
      status: "cleared",
    });

    // The demand those cards stated still stands: stating it again reads the
    // pixels again, which is what a card that repaints after the clear does.
    one.demand(request("#00ff00"));
    await live.started(1);
    live.finish(1, 2);
    const repainted = await settledDisplay(one, painted);
    expect(repainted.image?.bytes).toEqual(new Uint8Array([2]));
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
    const display = await settledDisplay(card, painted);
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

  it("paints the image this device stored while the saved pixels resolve", async () => {
    await using live = harness();
    const shown = live.card();
    const pixels = request("#ff0000");
    shown.demand(pixels);
    await live.started(0);
    live.finish(0, 1);
    await settledDisplay(shown, painted);
    expect(live.references.get(stored(pixels))?.fingerprint).toBe(
      excerptFingerprint(pixels.annotation),
    );

    // The card goes and the display forgets the Held Read it held: what the
    // next card paints first is the device-local image, not the query cache.
    shown.release();
    expect(live.queries.keysUnder([EXCERPT_DISPLAY])).toEqual([]);

    const returned = live.card();
    const saved = request("#00ff00");
    returned.demand(saved);
    await live.started(1);
    const seeded = await settledDisplay(
      returned,
      (display) => display.image !== null,
    );
    expect(seeded.image?.bytes).toEqual(new Uint8Array([1]));
    expect(seeded.current).toBe(false);
    expect(seeded.status).toBe("reading");

    live.finish(1, 2);
    const replaced = await settledDisplay(returned, painted);
    expect(replaced.image?.bytes).toEqual(new Uint8Array([2]));
    expect(replaced.current).toBe(true);
  });

  it("leaves the stored fallback unread when the Held Read holds an image", async () => {
    await using service = new ExcerptImageService({ read: async () => redPng });
    await using queries = new QueryClientService();
    const stored = vi.fn(async () => null);
    await using display = new ExcerptDisplayService({
      queries,
      resolve: (resolveRequest, signal) =>
        service.resolve(resolveRequest, signal),
      stored,
    });
    const card = display.open();
    const pixels = {
      ...request("#ff0000"),
      pdfPath: null,
      zoteroPngPath: "/zotero/INK1.png",
    };
    card.demand(pixels);
    expect((await settledDisplay(card, painted)).image?.bytes).toEqual(redPng);

    stored.mockClear();
    // The saved edit needs a read of its own, and the Held Read still holds the
    // image the card paints: a stored fallback would answer nothing and be
    // thrown away, so the display never asks for one.
    const saved = {
      ...pixels,
      annotation: { ...pixels.annotation, color: "#00ff00" },
    };
    display.revalidate(saved);
    expect(stored).not.toHaveBeenCalled();
  });

  it("starts a replacement from the stored image when the client dropped the Held Read", async () => {
    await using live = harness();
    // The display's own keys carry the client's own retention, so a Held Read
    // that no observer holds is dropped five minutes after it settles, whether
    // a card is mounted on it or not. The deadline is the test's to move: it
    // shortens the retention, advances the clock past it once, and puts the
    // default back so the replacement below runs under the retention the plugin
    // really has.
    live.queries.client.setQueryDefaults([EXCERPT_DISPLAY], { gcTime: 25 });
    const card = live.card();
    const pixels = request("#ff0000");
    // The render is gated by the test, not by a clock, so fake time only drives
    // the client's own retention and never the read.
    vi.useFakeTimers();
    try {
      card.demand(pixels);
      await live.started(0);
      live.finish(0, 1);
      const first = await settledDisplay(card, painted);

      await vi.advanceTimersByTimeAsync(30);
      expect(live.queries.keysUnder([EXCERPT_DISPLAY])).toEqual([]);
      // The card is still mounted and still demands the pixels it was painted
      // from; the Held Read behind it is what the client dropped.
      expect(card.snapshot().image).toBeNull();
      vi.useRealTimers();
      live.queries.client.setQueryDefaults([EXCERPT_DISPLAY], {
        gcTime: 5 * 60 * 1_000,
      });

      // A saved edit starts the read the card is waiting on: what it paints
      // while that read replaces the pixels is the image this device persists...
      live.display.revalidate(request("#00ff00"));
      await live.started(1);
      await vi.waitFor(() => expect(card.snapshot().image).not.toBeNull());
      const held = card.snapshot();
      expect(held.image?.bytes).toEqual(first.image?.bytes);
      expect(held.current).toBe(true);
      expect(held.status).toBe("reading");

      // ...and what it goes on painting once the replacement fails.
      live.fail(1);
      const failed = await settledDisplay(
        card,
        (display) => display.status === "failed",
      );
      expect(failed.image?.bytes).toEqual(first.image?.bytes);
      expect(failed.current).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("replaces what the store holds for an Annotation nothing displays", async () => {
    await using live = harness();
    const shown = live.card();
    const pixels = request("#ff0000");
    shown.demand(pixels);
    await live.started(0);
    live.finish(0, 1);
    await settledDisplay(shown, painted);
    shown.release();

    const saved = request("#00ff00");
    live.display.revalidate(saved);
    await live.storedRead(1);
    await live.started(1);
    live.finish(1, 2);
    await vi.waitFor(() =>
      expect(live.entries.get(excerptKey(saved))?.bytes).toEqual(
        new Uint8Array([2]),
      ),
    );
    expect(live.references.get(stored(saved))?.fingerprint).toBe(
      excerptFingerprint(saved.annotation),
    );

    // An Annotation this device never displayed has nothing to replace, so a
    // saved edit to it stays on demand.
    const untouched = request("#ff0000", "INK2");
    live.display.revalidate(untouched);
    await live.storedRead(2);
    expect(live.renders).toHaveLength(2);
    expect(live.references.has(stored(untouched))).toBe(false);
  });

  it("replaces a stored-image refresh with the newest saved pixels alone", async () => {
    await using live = harness();
    const shown = live.card();
    const pixels = request("#ff0000");
    shown.demand(pixels);
    await live.started(0);
    live.finish(0, 1);
    await settledDisplay(shown, painted);
    shown.release();

    live.display.revalidate(request("#00ff00"));
    await live.storedRead(1);
    await live.started(1);
    const newest = request("#0000ff");
    live.display.revalidate(newest);
    await live.cancelled(1);
    expect(live.renders[1]!.aborted).toBe(true);
    await live.started(2);

    live.finish(2, 3);
    await vi.waitFor(() =>
      expect(live.entries.get(excerptKey(newest))?.bytes).toEqual(
        new Uint8Array([3]),
      ),
    );
    expect(live.references.get(stored(newest))?.fingerprint).toBe(
      excerptFingerprint(newest.annotation),
    );
    expect(live.entries.has(excerptKey(request("#00ff00")))).toBe(false);
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
    const shown = await settledDisplay(live.card, painted);
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
