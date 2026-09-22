// Runs the production Excerpt Display and Excerpt Image service over Chromium's
// own IndexedDB, so a saved edit's replacement, a restart, an eviction, and a
// manual clear are the plugin's own code and the plugin's own store.
//
// The host seams the same module tree reaches — Obsidian's PDF.js loader, the
// filesystem, Node's hashing and zlib, the Zotero database — are aliased to
// `__fixtures__/renderer-host.ts` and `__fixtures__/renderer-hash.ts`: nothing
// here opens a PDF, reads a file, or hashes for real, and every crop is a real
// Chromium canvas encoded as lossless WebP. Note-asset and Zotero-cache
// survival need a vault and a Zotero data directory, so they are covered where
// those exist — see `service.test.ts`.
import { QueryClientService } from "@/services/query-client/service";

import { check } from "./__fixtures__/check";
import { settledDisplay } from "./__fixtures__/display-state";
import { renderGate } from "./__fixtures__/render-gate";
import type { GatedRender } from "./__fixtures__/render-gate";
import { excerptAnnotationRecord, excerptKey } from "./contract";
import type { ExcerptRequest } from "./contract";
import { EXCERPT_DISPLAY, ExcerptDisplayService } from "./display";
import type { ExcerptDisplayDemand, ExcerptImageDisplay } from "./display";
import { encodeExcerptImage } from "./encode";
import type { ExcerptImage } from "./format";
import { EXCERPT_JOB_LIMIT } from "./pdf-queue";
import { ExcerptImageService } from "./service";
import type { ExcerptEntry } from "./service";
import { openExcerptStore } from "./store";
import type { ExcerptStore } from "./store";

export interface RefreshReport {
  passed: string[];
  /** The store budget the eviction walk opened with, and one crop's size in it. */
  bytes: {
    budget: number;
    crop: number;
    /** Bytes the store still answered for the walk's own images once it ended. */
    retained: number;
  };
  /** The shared queue's counts after the replacements settled, and its bound. */
  queue: { admitted: number; awaiting: number; limit: number };
  /** References still standing after the eviction walk. */
  references: number;
  /** Crops this trial drew on a real canvas and encoded with the real encoder. */
  crops: number;
}

/**
 * Await one step, and fail with its name where the signal never comes: a trial
 * that stalls reports what it was waiting for, with the state that explains it,
 * instead of timing out anonymously.
 */
async function bounded<T>(
  label: string,
  work: Promise<T>,
  onStall?: () => unknown,
): Promise<T> {
  const stalled = Promise.withResolvers<never>();
  const timer = setTimeout(
    () =>
      stalled.reject(
        new Error(
          `Stalled waiting for ${label}: ${JSON.stringify(onStall?.() ?? null)}`,
        ),
      ),
    15_000,
  );
  try {
    return await Promise.race([work, stalled.promise]);
  } finally {
    clearTimeout(timer);
  }
}

const SOURCE = {
  kind: "zotero-db",
  database: { userID: 1, localUserKey: "LOCAL", serverID: "SERVER" },
  libraryID: 1,
  libraryRevision: 1,
} as const;

const PDF = { size: 100, mtimeMs: 10 };

/** One ink Annotation of the trial's own fixture, with the pixels `color` asks for. */
function request(color: string, key = "INK1"): ExcerptRequest {
  return {
    annotation: {
      key,
      parentKey: "ATTACH01",
      type: "ink",
      color,
      comment: null,
      text: null,
      pageLabel: "1",
      tags: [],
      version: 1,
      position: { kind: "pdf-ink", pageIndex: 0, width: 2, paths: [[20, 30]] },
    },
    source: SOURCE,
    sourceScope: "/zotero",
    attachmentKey: "ATTACH01",
    libraryID: 1,
    pdfPath: "/paper.pdf",
    zoteroPngPath: null,
  };
}

/** The crops this trial has drawn and encoded, which its report carries. */
let crops = 0;

/** One crop, drawn and encoded in this renderer, whose content `seed` decides. */
async function crop(seed: number): Promise<ExcerptImage> {
  const canvas = document.createElement("canvas");
  canvas.width = 320;
  canvas.height = 120;
  const paint = canvas.getContext("2d", { alpha: false });
  if (!paint) throw new Error("Canvas context unavailable");
  paint.fillStyle = "#ffffff";
  paint.fillRect(0, 0, canvas.width, canvas.height);
  paint.fillStyle = "#20242a";
  for (let row = 0; row < 12; row++)
    paint.fillRect(6, 6 + row * 9, canvas.width - 12 - ((row * seed) % 33), 3);
  paint.strokeStyle = "#b03030";
  paint.strokeRect(2, 2, canvas.width - 4, canvas.height - 4);
  const image = await encodeExcerptImage(canvas, new AbortController().signal);
  crops++;
  return image;
}

/** What one live composition hands a scenario. */
interface Live {
  readonly store: ExcerptStore;
  readonly service: ExcerptImageService;
  readonly display: ExcerptDisplayService;
  readonly queries: QueryClientService;
  readonly renders: GatedRender[];
  /** One render, once the service reached it. */
  started(index: number): Promise<GatedRender>;
  /** The `index`-th read of a device-local image, once it settled. */
  storedRead(index: number): Promise<void>;
  /** Answer one crop with real Chromium pixels. */
  answer(index: number, seed: number): Promise<void>;
  /** Fail one crop, which leaves the resolution to the Zotero fallback. */
  fail(index: number): Promise<void>;
  close(): Promise<void>;
}

/** A real service and display over one store, with every crop gated. */
async function live(options: {
  appId: string;
  label: string;
  budget?: number;
}): Promise<Live> {
  const stage = options.label;
  const store = await openExcerptStore(options.appId, options.budget);
  const gate = renderGate();
  const storedReads: Promise<void>[] = [];
  const storedWaiting: (() => void)[] = [];
  const service = new ExcerptImageService({
    cache: store,
    stamp: async () => PDF,
    render: gate.render,
  });
  const queries = new QueryClientService();
  const display = new ExcerptDisplayService({
    queries,
    resolve: (request, signal) => service.resolve(request, signal),
    stored: (request) => {
      const read = service.stored(request);
      storedReads.push(
        read.then(
          () => undefined,
          () => undefined,
        ),
      );
      for (const arrived of storedWaiting.splice(0)) arrived();
      return read;
    },
  });
  await Promise.all([service.ready, display.ready, queries.ready]);
  const app: Live = {
    store,
    service,
    display,
    queries,
    renders: gate.renders,
    async started(index) {
      return await bounded(
        `${stage}: crop ${index}`,
        gate.started(index),
        () => ({
          renders: gate.renders.length,
          queue: service.queueDiagnostics,
        }),
      );
    },
    async storedRead(index) {
      while (storedReads.length <= index) {
        const arrived = Promise.withResolvers<void>();
        storedWaiting.push(() => arrived.resolve());
        await bounded(`${stage}: stored read ${index}`, arrived.promise);
      }
      await bounded(`${stage}: stored read ${index}`, storedReads[index]!);
    },
    async answer(index, seed) {
      (await app.started(index)).answer.resolve(await crop(seed));
    },
    async fail(index) {
      (await app.started(index)).answer.reject(new Error("crop failed"));
    },
    async close() {
      await display[Symbol.asyncDispose]();
      await queries[Symbol.asyncDispose]();
      await service[Symbol.asyncDispose]();
      store[Symbol.dispose]();
    },
  };
  return app;
}

/**
 * The next display state that answers `matches`, as one resolution's signal,
 * which names the Annotation it was waiting on where the signal never comes.
 */
function settled(
  label: string,
  card: ExcerptDisplayDemand,
  matches: (display: ExcerptImageDisplay) => boolean,
): Promise<ExcerptImageDisplay> {
  return bounded(`the display of ${label}`, settledDisplay(card, matches), () =>
    JSON.stringify(card.snapshot()),
  );
}

/** Whether the display paints the pixels the card demands. */
const shows = (display: ExcerptImageDisplay): boolean =>
  display.image !== null && display.current;

/** The image one Annotation's latest reference locates, as a display paints it. */
async function held(
  app: Live,
  reference: ExcerptRequest,
): Promise<ExcerptEntry | undefined> {
  const latest = await app.store.latest(excerptAnnotationRecord(reference));
  return latest && (await app.store.get(latest.key, latest.pdf ?? undefined));
}

export async function run(): Promise<RefreshReport> {
  const passed: string[] = [];
  const bytes = { budget: 0, crop: 0, retained: 0 };
  let queue = { admitted: 0, awaiting: 0, limit: EXCERPT_JOB_LIMIT };
  let references = 0;

  // 1. One resolution over the real store renders a crop, stores it, and
  //    remembers which image the Annotation has.
  {
    const app = await live({ appId: "refresh-baseline", label: "baseline" });
    try {
      const pixels = request("#ff0000");
      const pending = app.service.resolve(pixels);
      await app.answer(0, 0);
      const outcome = await bounded("baseline: one resolution", pending);
      check(
        outcome.kind === "available" && outcome.provenance === "rendered",
        `A resolution answered ${JSON.stringify(outcome.kind)}`,
      );
      const stored = await bounded(
        "baseline: the stored crop",
        app.service.resolve(pixels),
      );
      check(
        stored.kind === "available" && stored.provenance === "cache",
        `The stored crop answered ${JSON.stringify(stored)}`,
      );
      check(
        (await app.store.latest(excerptAnnotationRecord(pixels)))?.key ===
          excerptKey(pixels),
        "A resolution left no reference to the image it stored",
      );
      passed.push("one resolution over the real store");
    } finally {
      await app.close();
    }
  }

  // 2. A saved edit replaces an Annotation nothing displays, because the device
  //    still holds an image for it, and leaves one it never displayed alone.
  {
    const app = await live({ appId: "refresh", label: "inactive" });
    try {
      const card = app.display.open();
      card.demand(request("#ff0000"));
      await app.answer(0, 1);
      const first = await settled("the first card", card, shows);
      check(first.image !== null, "The first crop never reached the card");
      check(
        (await app.store.latest(excerptAnnotationRecord(request("#ff0000"))))
          ?.key === excerptKey(request("#ff0000")),
        "A displayed image left no reference",
      );

      card.release();
      check(
        app.queries.keysUnder([EXCERPT_DISPLAY]).length === 0,
        "A released card left its Held Read behind",
      );

      const saved = request("#00ff00");
      app.display.revalidate(saved);
      await app.storedRead(1);
      await app.answer(1, 2);
      check(
        (await held(app, saved)) !== undefined,
        "The inactive replacement stored no image",
      );
      check(
        (await app.store.latest(excerptAnnotationRecord(saved)))?.key ===
          excerptKey(saved),
        "The inactive replacement left the reference behind",
      );
      queue = { ...app.service.queueDiagnostics, limit: EXCERPT_JOB_LIMIT };
      check(
        queue.admitted <= queue.limit,
        `The replacements exceeded the admission bound: ${queue.admitted}`,
      );
      check(queue.awaiting === 0, "A settled queue is still waiting on slots");

      // An Annotation this device never displayed has nothing to replace.
      const untouched = request("#ff0000", "INK2");
      app.display.revalidate(untouched);
      await app.storedRead(2);
      check(
        app.renders.length === 2,
        `An Annotation that was never displayed was replaced: ${app.renders.length} crops`,
      );
      check(
        (await app.store.latest(excerptAnnotationRecord(untouched))) ===
          undefined,
        "An Annotation that was never displayed has a reference",
      );
      passed.push("inactive replacement through the shared queue");
    } finally {
      await app.close();
    }
  }

  // 3. The next launch paints the image the device stored while the pixels that
  //    are saved now resolve, so a reopened view is not blank.
  {
    const app = await live({ appId: "refresh", label: "restart" });
    try {
      const card = app.display.open();
      const saved = request("#0000ff");
      card.demand(saved);
      await app.answer(0, 3);
      const seeded = await settled(
        "the restarted card",
        card,
        (display) => display.image !== null,
      );
      const previous = await held(app, request("#00ff00"));
      check(
        previous !== undefined,
        "The restarted store lost the image it had stored",
      );
      check(
        seeded.current === false,
        "A restarted display claimed the stored pixels were the saved ones",
      );
      // The bytes themselves, not their length: a crop of the saved pixels
      // rendered afresh is the same size as the stored one and a different
      // image, so only an exact comparison catches the stored image not being
      // the one the card paints.
      const painted = seeded.image?.bytes;
      check(
        painted !== undefined &&
          painted.byteLength === previous.bytes.byteLength &&
          painted.every((byte, index) => byte === previous.bytes[index]) &&
          seeded.status === "reading",
        "A restarted display painted other bytes than the store holds",
      );

      const replaced = await settled("the replaced card", card, shows);
      check(replaced.image !== null, "The current crop never reached the card");
      check(
        (await app.store.latest(excerptAnnotationRecord(saved)))?.key ===
          excerptKey(saved),
        "The current crop left the reference behind",
      );
      card.release();
      passed.push("restart paints the stored image, then replaces it");
    } finally {
      await app.close();
    }
  }

  // 4. Eviction takes the reference with the bytes it locates, and references
  //    themselves never charge the image budget.
  {
    const measured = await crop(4);
    bytes.crop = measured.bytes.byteLength;
    bytes.budget = bytes.crop * 2;
    const app = await live({
      appId: "refresh-budget",
      label: "budget",
      budget: bytes.budget,
    });
    try {
      const oldest = request("#ff0000");
      await app.store.put(excerptKey(oldest), {
        bytes: measured.bytes,
        format: measured.format,
        pdf: PDF,
      });
      await app.store.putLatest(excerptAnnotationRecord(oldest), {
        key: excerptKey(oldest),
        fingerprint: "F1",
        pdf: PDF,
      });
      check(
        (await app.store.latest(excerptAnnotationRecord(oldest)))?.key ===
          excerptKey(oldest),
        "A reference did not survive its own write",
      );

      // A reference costs no image bytes: the budget still takes a full crop,
      // however many Annotations remember an image.
      for (const [index, key] of Array.from(
        { length: 40 },
        (_, index) => `INK${index}`,
      ).entries())
        await app.store.putLatest(`identity-${key}`, {
          key: `key-${key}`,
          fingerprint: `F${index}`,
          pdf: null,
        });
      await app.store.put("replacement", {
        bytes: measured.bytes,
        format: measured.format,
        pdf: PDF,
      });
      check(
        (await app.store.get("replacement")) !== undefined,
        "References charged the image budget",
      );

      // The next crop pushes the oldest image out, and its reference with it.
      await app.store.put("newest", {
        bytes: measured.bytes,
        format: measured.format,
        pdf: PDF,
      });
      check(
        (await app.store.get(excerptKey(oldest))) === undefined &&
          (await app.store.latest(excerptAnnotationRecord(oldest))) ===
            undefined,
        "Eviction kept the oldest image or its reference",
      );
      check(
        (await app.store.get("newest")) !== undefined,
        "Eviction took the newest image",
      );
      // What the walk left behind, measured back from the store: the budget it
      // opened with is a bound on these bytes, not a restatement of itself.
      const kept = await Promise.all(
        [excerptKey(oldest), "replacement", "newest"].map((key) =>
          app.store.get(key),
        ),
      );
      bytes.retained = kept.reduce(
        (total, entry) => total + (entry?.bytes.byteLength ?? 0),
        0,
      );
      const standing = await Promise.all(
        Array.from({ length: 40 }, (_, index) =>
          app.store.latest(`identity-INK${index}`),
        ),
      );
      references = standing.filter(
        (reference) => reference !== undefined,
      ).length;
      check(
        references === 40,
        `Eviction pruned references it did not evict: ${references}`,
      );
      passed.push("eviction, references, and image byte accounting");
    } finally {
      await app.close();
    }
  }

  // 5. A manual clear removes the Held Read, the images, and the references
  //    together, and the crop work it overtook restores none of them.
  {
    const app = await live({ appId: "refresh-clear", label: "clear" });
    try {
      const card = app.display.open();
      card.demand(request("#ff0000"));
      await app.answer(0, 5);
      await settled("the cleared card", card, shows);

      // One crop is running and one is queued when the user clears.
      const running = app.service.resolve(request("#00ff00"));
      await app.started(1);
      const queued = app.service.resolve(request("#0000ff"));
      check(
        app.service.queueDiagnostics.admitted === 1,
        `The queued crop was admitted while one ran: ${app.service.queueDiagnostics.admitted}`,
      );

      app.display.clear();
      await app.service.clear();
      check(
        app.queries.keysUnder([EXCERPT_DISPLAY]).length === 0,
        "A cleared display kept its Held Read",
      );
      check(
        card.snapshot().image === null,
        "A card mounted at clear time went on painting the cleared image",
      );

      await app.answer(1, 6);
      await app.answer(2, 7);
      await Promise.all([running, queued]);
      for (const color of ["#ff0000", "#00ff00", "#0000ff"]) {
        const pixels = request(color);
        check(
          (await app.store.get(excerptKey(pixels))) === undefined &&
            (await app.store.latest(excerptAnnotationRecord(pixels))) ===
              undefined,
          `A clear left ${color} behind`,
        );
      }

      // The next demand paints nothing until its own crop lands: nothing the
      // clear removed comes back to the display.
      const after = app.display.open();
      after.demand(request("#ff0000"));
      await app.storedRead(1);
      check(
        after.snapshot().image === null,
        "A cleared image came back to a new card",
      );
      after.release();
      card.release();
      passed.push("clear races with running and queued crop work");
    } finally {
      await app.close();
    }
  }

  return { passed, bytes, queue, references, crops };
}
