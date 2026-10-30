// The revision proof a borrowed reader document passes: only a document whose
// own bytes are the file's current bytes may stand in for the file.

import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import { it } from "@effect/vitest";
import { Cause, DateTime, Effect, Exit, Fiber } from "effect";
import { mkdtemp, rm, truncate, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, vi } from "vitest";

import { MAX_PDF_BYTES, borrowedExcerptPage } from "./reader-borrow";
import type {
  BorrowedExcerptDocument,
  ExcerptCropPage,
  ExcerptReaderDocuments,
} from "./reader-borrow";

const folders: string[] = [];

/**
 * A fixed revision time later than any write the fixture makes, in the epoch
 * seconds `utimes` takes: a test that moves a file's revision never reads the
 * wall clock to do it.
 */
const LATER_MTIME_SECONDS =
  DateTime.makeUnsafe("2030-01-01T00:00:00Z").epochMilliseconds / 1000;

afterEach(async () => {
  await Promise.all(
    folders
      .splice(0)
      .map((folder) => rm(folder, { recursive: true, force: true })),
  );
});

/** A file on disk, with a distinct modification time per write. */
async function pdfFile(bytes: Uint8Array): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), "zotlit-reader-borrow-"));
  folders.push(folder);
  const path = join(folder, "paper.pdf");
  await writeFile(path, bytes);
  return path;
}

/** The reader's document, with the bytes it answers for itself. */
function readerDocument(options: {
  path: string;
  bytes: Uint8Array | null;
  /** Whether the page read answers the reader's page or finds it gone. */
  page?: ExcerptCropPage | null;
}) {
  const page: ExcerptCropPage = options.page ?? {
    view: [0, 0, 612, 792],
    getViewport: () => ({ convertToViewportPoint: (x, y) => [x, y] }),
    render: () => ({ promise: Promise.resolve(), cancel: () => undefined }),
  };
  const document_ = { name: "reader-document" };
  const bytes = vi.fn(async () => options.bytes);
  const readPage = vi.fn(async (): Promise<ExcerptCropPage | null> => page);
  // A reader that still holds its document, until a test says it withdrew it.
  const current = vi.fn(() => true);
  const borrowed: BorrowedExcerptDocument = {
    path: options.path,
    document: document_,
    bytes,
    page: readPage,
    current,
  };
  const readers: ExcerptReaderDocuments = {
    borrow: vi.fn(() => borrowed),
  };
  return { readers, borrowed, bytes, page: readPage, answered: page, current };
}

it.effect(
  "borrows a document whose own bytes are the file's current bytes",
  () =>
    Effect.gen(function* () {
      const path = yield* Effect.promise(() =>
        pdfFile(new Uint8Array([1, 2, 3, 4])),
      );
      const reader = readerDocument({
        path,
        bytes: new Uint8Array([1, 2, 3, 4]),
      });

      const page = yield* borrowedExcerptPage({
        readers: reader.readers,
        path,
        pageIndex: 2,
      });

      expect(page?.page).toBe(reader.answered);
      expect(reader.page.mock.calls).toEqual([[2]]);
    }).pipe(Effect.provide(NodeFileSystem.layer)),
);

it.effect(
  "refuses a document whose bytes differ from the file at the same size",
  () =>
    Effect.gen(function* () {
      const path = yield* Effect.promise(() =>
        pdfFile(new Uint8Array([1, 2, 3, 4])),
      );
      const reader = readerDocument({
        path,
        bytes: new Uint8Array([9, 9, 9, 9]),
      });

      expect(
        yield* borrowedExcerptPage({
          readers: reader.readers,
          path,
          pageIndex: 0,
        }),
      ).toBeNull();
      expect(reader.page).not.toHaveBeenCalled();
    }).pipe(Effect.provide(NodeFileSystem.layer)),
);

it.effect(
  "remembers one refusal per document revision instead of re-reading the file",
  () =>
    Effect.gen(function* () {
      const path = yield* Effect.promise(() =>
        pdfFile(new Uint8Array([1, 2, 3, 4])),
      );
      const reader = readerDocument({
        path,
        bytes: new Uint8Array([9, 9, 9, 9]),
      });

      const borrow = () =>
        borrowedExcerptPage({
          readers: reader.readers,
          path,
          pageIndex: 0,
        });
      expect(yield* borrow()).toBeNull();
      expect(yield* borrow()).toBeNull();

      expect(reader.bytes).toHaveBeenCalledTimes(1);
    }).pipe(Effect.provide(NodeFileSystem.layer)),
);

it.effect("proves again once the file moves past the remembered revision", () =>
  Effect.gen(function* () {
    const path = yield* Effect.promise(() =>
      pdfFile(new Uint8Array([1, 2, 3, 4])),
    );
    const reader = readerDocument({
      path,
      bytes: new Uint8Array([1, 2, 3, 4]),
    });
    const borrow = () =>
      borrowedExcerptPage({
        readers: reader.readers,
        path,
        pageIndex: 0,
      });
    expect(yield* borrow()).toMatchObject({ page: reader.answered });

    // The reader's document still holds the old bytes; the file does not.
    yield* Effect.promise(() => writeFile(path, new Uint8Array([5, 6, 7, 8])));
    yield* Effect.promise(() =>
      utimes(path, LATER_MTIME_SECONDS, LATER_MTIME_SECONDS),
    );

    expect(yield* borrow()).toBeNull();
    expect(reader.page).toHaveBeenCalledTimes(1);
  }).pipe(Effect.provide(NodeFileSystem.layer)),
);

it.effect(
  "borrows the reader's replacement document once it holds the file's bytes again",
  () =>
    Effect.gen(function* () {
      const path = yield* Effect.promise(() =>
        pdfFile(new Uint8Array([1, 2, 3, 4])),
      );
      const stale = readerDocument({
        path,
        bytes: new Uint8Array([9, 9, 9, 9]),
      });
      expect(
        yield* borrowedExcerptPage({
          readers: stale.readers,
          path,
          pageIndex: 0,
        }),
      ).toBeNull();

      // Obsidian reloaded the file into a new document object, which holds what
      // the file holds now.
      const reloaded = readerDocument({
        path,
        bytes: new Uint8Array([1, 2, 3, 4]),
      });
      expect(
        yield* borrowedExcerptPage({
          readers: reloaded.readers,
          path,
          pageIndex: 0,
        }),
      ).toMatchObject({ page: reloaded.answered });
    }).pipe(Effect.provide(NodeFileSystem.layer)),
);

it.effect(
  "refuses a document loaded long before the request when the file changed since",
  () =>
    Effect.gen(function* () {
      const path = yield* Effect.promise(() =>
        pdfFile(new Uint8Array([1, 2, 3, 4])),
      );
      const reader = readerDocument({
        path,
        bytes: new Uint8Array([1, 2, 3, 4]),
      });
      yield* Effect.promise(() => writeFile(path, new Uint8Array([5, 6])));
      yield* Effect.promise(() =>
        utimes(path, LATER_MTIME_SECONDS, LATER_MTIME_SECONDS),
      );

      expect(
        yield* borrowedExcerptPage({
          readers: reader.readers,
          path,
          pageIndex: 0,
        }),
      ).toBeNull();
    }).pipe(Effect.provide(NodeFileSystem.layer)),
);

it.effect("refuses a document whose bytes the host cannot answer", () =>
  Effect.gen(function* () {
    const path = yield* Effect.promise(() =>
      pdfFile(new Uint8Array([1, 2, 3, 4])),
    );
    const reader = readerDocument({ path, bytes: null });

    expect(
      yield* borrowedExcerptPage({
        readers: reader.readers,
        path,
        pageIndex: 0,
      }),
    ).toBeNull();
    expect(reader.page).not.toHaveBeenCalled();
  }).pipe(Effect.provide(NodeFileSystem.layer)),
);

it.effect("refuses a reader that holds no document for the file", () =>
  Effect.gen(function* () {
    const readers: ExcerptReaderDocuments = { borrow: vi.fn(() => null) };

    expect(
      yield* borrowedExcerptPage({
        readers,
        path: "/vault/missing.pdf",
        pageIndex: 0,
      }),
    ).toBeNull();
  }).pipe(Effect.provide(NodeFileSystem.layer)),
);

it.effect(
  "refuses a page the reader no longer holds, though its bytes matched",
  () =>
    Effect.gen(function* () {
      const path = yield* Effect.promise(() =>
        pdfFile(new Uint8Array([1, 2, 3, 4])),
      );
      const reader = readerDocument({
        path,
        bytes: new Uint8Array([1, 2, 3, 4]),
      });
      reader.page.mockResolvedValue(null);

      expect(
        yield* borrowedExcerptPage({
          readers: reader.readers,
          path,
          pageIndex: 0,
        }),
      ).toBeNull();
    }).pipe(Effect.provide(NodeFileSystem.layer)),
);

it.effect(
  "refuses a page the reader withdrew while its read was in flight",
  () =>
    Effect.gen(function* () {
      const path = yield* Effect.promise(() =>
        pdfFile(new Uint8Array([1, 2, 3, 4])),
      );
      const reader = readerDocument({
        path,
        bytes: new Uint8Array([1, 2, 3, 4]),
      });
      const reading = Promise.withResolvers<ExcerptCropPage | null>();
      reader.page.mockImplementation(() => reading.promise);

      const pending = yield* borrowedExcerptPage({
        readers: reader.readers,
        path,
        pageIndex: 0,
      }).pipe(Effect.forkChild);
      yield* Effect.promise(() =>
        vi.waitFor(() => expect(reader.page).toHaveBeenCalledTimes(1)),
      );
      // The reader replaced its document while the page was resolving: the page
      // that read answers belongs to the document the reader moved on from.
      reader.current.mockReturnValue(false);
      reading.resolve(reader.answered);

      expect(yield* Fiber.join(pending)).toBeNull();
    }).pipe(Effect.provide(NodeFileSystem.layer)),
);

it.effect("stops waiting on a borrowed document read that never settles", () =>
  Effect.gen(function* () {
    const path = yield* Effect.promise(() =>
      pdfFile(new Uint8Array([1, 2, 3, 4])),
    );
    const reader = readerDocument({
      path,
      bytes: new Uint8Array([1, 2, 3, 4]),
    });
    const reading = Promise.withResolvers<Uint8Array | null>();
    reader.bytes.mockImplementation(() => reading.promise);

    const pending = yield* borrowedExcerptPage({
      readers: reader.readers,
      path,
      pageIndex: 0,
    }).pipe(Effect.forkChild);
    yield* Effect.promise(() =>
      vi.waitFor(() => expect(reader.bytes).toHaveBeenCalledTimes(1)),
    );
    yield* Fiber.interrupt(pending);

    // The reader's own read stays the reader's: this borrow stops waiting for it
    // rather than cancelling or cleaning anything up, and reaches no page.
    const exit = yield* Fiber.await(pending);
    expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(
      true,
    );
    expect(reader.page).not.toHaveBeenCalled();
  }).pipe(Effect.provide(NodeFileSystem.layer)),
);

it.effect("stops waiting on a borrowed page read that never settles", () =>
  Effect.gen(function* () {
    const path = yield* Effect.promise(() =>
      pdfFile(new Uint8Array([1, 2, 3, 4])),
    );
    const render = vi.fn(() => ({
      promise: Promise.resolve(),
      cancel: vi.fn(),
    }));
    const answered: ExcerptCropPage = {
      view: [0, 0, 612, 792],
      getViewport: () => ({ convertToViewportPoint: (x, y) => [x, y] }),
      render,
    };
    const reader = readerDocument({
      path,
      bytes: new Uint8Array([1, 2, 3, 4]),
      page: answered,
    });
    const reading = Promise.withResolvers<ExcerptCropPage | null>();
    reader.page.mockImplementation(() => reading.promise);

    const pending = yield* borrowedExcerptPage({
      readers: reader.readers,
      path,
      pageIndex: 0,
    }).pipe(Effect.forkChild);
    yield* Effect.promise(() =>
      vi.waitFor(() => expect(reader.page).toHaveBeenCalledTimes(1)),
    );
    yield* Fiber.interrupt(pending);
    const exit = yield* Fiber.await(pending);
    expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(
      true,
    );

    // The page the reader answers after the borrow gave up is its own, and the
    // cancelled borrow draws nothing from it.
    reading.resolve(answered);
    expect(render).not.toHaveBeenCalled();
  }).pipe(Effect.provide(NodeFileSystem.layer)),
);

it.effect(
  "refuses a file past the borrow limit without reading its document",
  () =>
    Effect.gen(function* () {
      const path = yield* Effect.promise(() =>
        pdfFile(new Uint8Array([1, 2, 3, 4])),
      );
      yield* Effect.promise(() => truncate(path, MAX_PDF_BYTES + 1));
      const reader = readerDocument({
        path,
        bytes: new Uint8Array([1, 2, 3, 4]),
      });

      expect(
        yield* borrowedExcerptPage({
          readers: reader.readers,
          path,
          pageIndex: 0,
        }),
      ).toBeNull();
      expect(reader.bytes).not.toHaveBeenCalled();
    }).pipe(Effect.provide(NodeFileSystem.layer)),
);

it.effect("answers null while no reader documents are wired", () =>
  Effect.gen(function* () {
    const path = yield* Effect.promise(() =>
      pdfFile(new Uint8Array([1, 2, 3, 4])),
    );

    expect(
      yield* borrowedExcerptPage({
        readers: undefined,
        path,
        pageIndex: 0,
      }),
    ).toBeNull();
  }).pipe(Effect.provide(NodeFileSystem.layer)),
);
