// The revision proof a borrowed reader document passes: only a document whose
// own bytes are the file's current bytes may stand in for the file.

import {
  mkdtemp,
  open,
  rm,
  truncate,
  utimes,
  writeFile,
} from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";

import { MAX_PDF_BYTES, borrowedExcerptPage } from "./reader-borrow";
import type {
  BorrowedExcerptDocument,
  ExcerptCropPage,
  ExcerptReaderDocuments,
} from "./reader-borrow";

// `open` is spied so a test can hold an open in flight and watch what the
// borrow does with the handle cancellation races against.
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, open: vi.fn(actual.open) };
});

const folders: string[] = [];

/**
 * A fixed revision time later than any write the fixture makes, in the epoch
 * seconds `utimes` takes: a test that moves a file's revision never reads the
 * wall clock to do it.
 */
const LATER_MTIME_SECONDS =
  Temporal.Instant.from("2030-01-01T00:00:00Z").epochMilliseconds / 1000;

afterEach(async () => {
  vi.mocked(open).mockClear();
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

const SIGNAL = () => new AbortController().signal;

it("borrows a document whose own bytes are the file's current bytes", async () => {
  const path = await pdfFile(new Uint8Array([1, 2, 3, 4]));
  const reader = readerDocument({ path, bytes: new Uint8Array([1, 2, 3, 4]) });

  const page = await borrowedExcerptPage({
    readers: reader.readers,
    path,
    pageIndex: 2,
    signal: SIGNAL(),
  });

  expect(page?.page).toBe(reader.answered);
  expect(reader.page.mock.calls).toEqual([[2]]);
});

it("refuses a document whose bytes differ from the file at the same size", async () => {
  const path = await pdfFile(new Uint8Array([1, 2, 3, 4]));
  const reader = readerDocument({ path, bytes: new Uint8Array([9, 9, 9, 9]) });

  expect(
    await borrowedExcerptPage({
      readers: reader.readers,
      path,
      pageIndex: 0,
      signal: SIGNAL(),
    }),
  ).toBeNull();
  expect(reader.page).not.toHaveBeenCalled();
});

it("remembers one refusal per document revision instead of re-reading the file", async () => {
  const path = await pdfFile(new Uint8Array([1, 2, 3, 4]));
  const reader = readerDocument({ path, bytes: new Uint8Array([9, 9, 9, 9]) });

  const borrow = () =>
    borrowedExcerptPage({
      readers: reader.readers,
      path,
      pageIndex: 0,
      signal: SIGNAL(),
    });
  expect(await borrow()).toBeNull();
  expect(await borrow()).toBeNull();

  expect(reader.bytes).toHaveBeenCalledTimes(1);
});

it("proves again once the file moves past the remembered revision", async () => {
  const path = await pdfFile(new Uint8Array([1, 2, 3, 4]));
  const reader = readerDocument({ path, bytes: new Uint8Array([1, 2, 3, 4]) });
  const borrow = () =>
    borrowedExcerptPage({
      readers: reader.readers,
      path,
      pageIndex: 0,
      signal: SIGNAL(),
    });
  expect(await borrow()).toMatchObject({ page: reader.answered });

  // The reader's document still holds the old bytes; the file does not.
  await writeFile(path, new Uint8Array([5, 6, 7, 8]));
  await utimes(path, LATER_MTIME_SECONDS, LATER_MTIME_SECONDS);

  expect(await borrow()).toBeNull();
  expect(reader.page).toHaveBeenCalledTimes(1);
});

it("borrows the reader's replacement document once it holds the file's bytes again", async () => {
  const path = await pdfFile(new Uint8Array([1, 2, 3, 4]));
  const stale = readerDocument({ path, bytes: new Uint8Array([9, 9, 9, 9]) });
  expect(
    await borrowedExcerptPage({
      readers: stale.readers,
      path,
      pageIndex: 0,
      signal: SIGNAL(),
    }),
  ).toBeNull();

  // Obsidian reloaded the file into a new document object, which holds what
  // the file holds now.
  const reloaded = readerDocument({
    path,
    bytes: new Uint8Array([1, 2, 3, 4]),
  });
  expect(
    await borrowedExcerptPage({
      readers: reloaded.readers,
      path,
      pageIndex: 0,
      signal: SIGNAL(),
    }),
  ).toMatchObject({ page: reloaded.answered });
});

it("refuses a document loaded long before the request when the file changed since", async () => {
  const path = await pdfFile(new Uint8Array([1, 2, 3, 4]));
  const reader = readerDocument({ path, bytes: new Uint8Array([1, 2, 3, 4]) });
  await writeFile(path, new Uint8Array([5, 6]));
  await utimes(path, LATER_MTIME_SECONDS, LATER_MTIME_SECONDS);

  expect(
    await borrowedExcerptPage({
      readers: reader.readers,
      path,
      pageIndex: 0,
      signal: SIGNAL(),
    }),
  ).toBeNull();
});

it("refuses a document whose bytes the host cannot answer", async () => {
  const path = await pdfFile(new Uint8Array([1, 2, 3, 4]));
  const reader = readerDocument({ path, bytes: null });

  expect(
    await borrowedExcerptPage({
      readers: reader.readers,
      path,
      pageIndex: 0,
      signal: SIGNAL(),
    }),
  ).toBeNull();
  expect(reader.page).not.toHaveBeenCalled();
});

it("refuses a reader that holds no document for the file", async () => {
  const readers: ExcerptReaderDocuments = { borrow: vi.fn(() => null) };

  expect(
    await borrowedExcerptPage({
      readers,
      path: "/vault/missing.pdf",
      pageIndex: 0,
      signal: SIGNAL(),
    }),
  ).toBeNull();
});

it("refuses a page the reader no longer holds, though its bytes matched", async () => {
  const path = await pdfFile(new Uint8Array([1, 2, 3, 4]));
  const reader = readerDocument({ path, bytes: new Uint8Array([1, 2, 3, 4]) });
  reader.page.mockResolvedValue(null);

  expect(
    await borrowedExcerptPage({
      readers: reader.readers,
      path,
      pageIndex: 0,
      signal: SIGNAL(),
    }),
  ).toBeNull();
});

it("refuses a page the reader withdrew while its read was in flight", async () => {
  const path = await pdfFile(new Uint8Array([1, 2, 3, 4]));
  const reader = readerDocument({ path, bytes: new Uint8Array([1, 2, 3, 4]) });
  const reading = Promise.withResolvers<ExcerptCropPage | null>();
  reader.page.mockImplementation(() => reading.promise);

  const pending = borrowedExcerptPage({
    readers: reader.readers,
    path,
    pageIndex: 0,
    signal: SIGNAL(),
  });
  await vi.waitFor(() => expect(reader.page).toHaveBeenCalledTimes(1));
  // The reader replaced its document while the page was resolving: the page
  // that read answers belongs to the document the reader moved on from.
  reader.current.mockReturnValue(false);
  reading.resolve(reader.answered);

  expect(await pending).toBeNull();
});

it("stops waiting on a borrowed document read that never settles", async () => {
  const path = await pdfFile(new Uint8Array([1, 2, 3, 4]));
  const reader = readerDocument({ path, bytes: new Uint8Array([1, 2, 3, 4]) });
  const reading = Promise.withResolvers<Uint8Array | null>();
  reader.bytes.mockImplementation(() => reading.promise);
  const caller = new AbortController();

  const pending = borrowedExcerptPage({
    readers: reader.readers,
    path,
    pageIndex: 0,
    signal: caller.signal,
  });
  await vi.waitFor(() => expect(reader.bytes).toHaveBeenCalledTimes(1));
  caller.abort();

  // The reader's own read stays the reader's: this borrow stops waiting for it
  // rather than cancelling or cleaning anything up, and reaches no page.
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  expect(reader.page).not.toHaveBeenCalled();
});

it("stops waiting on a borrowed page read that never settles", async () => {
  const path = await pdfFile(new Uint8Array([1, 2, 3, 4]));
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
  const caller = new AbortController();

  const pending = borrowedExcerptPage({
    readers: reader.readers,
    path,
    pageIndex: 0,
    signal: caller.signal,
  });
  await vi.waitFor(() => expect(reader.page).toHaveBeenCalledTimes(1));
  caller.abort();
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });

  // The page the reader answers after the borrow gave up is its own, and the
  // cancelled borrow draws nothing from it.
  reading.resolve(answered);
  expect(render).not.toHaveBeenCalled();
});

it("refuses a file past the borrow limit without reading its document", async () => {
  const path = await pdfFile(new Uint8Array([1, 2, 3, 4]));
  await truncate(path, MAX_PDF_BYTES + 1);
  const reader = readerDocument({ path, bytes: new Uint8Array([1, 2, 3, 4]) });

  expect(
    await borrowedExcerptPage({
      readers: reader.readers,
      path,
      pageIndex: 0,
      signal: SIGNAL(),
    }),
  ).toBeNull();
  expect(reader.bytes).not.toHaveBeenCalled();
});

it("closes the handle of an open the caller cancelled while it was in flight", async () => {
  const path = await pdfFile(new Uint8Array([1, 2, 3, 4]));
  const reader = readerDocument({ path, bytes: new Uint8Array([1, 2, 3, 4]) });
  const opening = Promise.withResolvers<FileHandle>();
  const close = vi.fn(async () => undefined);
  vi.mocked(open).mockReturnValueOnce(opening.promise);
  const caller = new AbortController();

  const pending = borrowedExcerptPage({
    readers: reader.readers,
    path,
    pageIndex: 0,
    signal: caller.signal,
  });
  await vi.waitFor(() => expect(open).toHaveBeenCalledTimes(1));
  caller.abort();
  // The open the caller cancelled still answers a handle: it belongs to this
  // borrow alone, and nothing else can close it.
  opening.resolve({ close } as unknown as FileHandle);

  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  expect(close).toHaveBeenCalledTimes(1);
  expect(reader.bytes).not.toHaveBeenCalled();
  expect(reader.page).not.toHaveBeenCalled();
});

it("answers null while no reader documents are wired", async () => {
  const path = await pdfFile(new Uint8Array([1, 2, 3, 4]));

  expect(
    await borrowedExcerptPage({
      readers: undefined,
      path,
      pageIndex: 0,
      signal: SIGNAL(),
    }),
  ).toBeNull();
});
