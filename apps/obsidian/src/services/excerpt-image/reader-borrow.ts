// Borrowing the PDF document an open reader already holds, and the revision
// proof a borrowed document passes before excerpt work crops from it.

import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";

import { getLogger } from "@/lib/log";

import { abortable } from "./abort";
import type { ExcerptViewport } from "./geometry";

const logger = getLogger(["excerpt-image", "reader"]);

/**
 * The largest PDF the excerpt path parses, borrowed or detached. The renderer
 * already depends on this module, so the one definition lives here rather than
 * beside the detached load that reads it: a file past this limit is refused
 * before its document's bytes are read, because the renderer would refuse it
 * too.
 */
export const MAX_PDF_BYTES = 256 * 1024 * 1024;

/**
 * The page facts a crop draws from, whichever document supplies the page. A
 * borrowed page is the reader's own PDF.js page proxy, and the reader owns it
 * for its whole lifetime: excerpt work reads it and starts its own render task
 * on its own canvas, never cleans the page up, and never cancels a task it did
 * not create. Only a page this renderer loaded itself extends this with its own
 * `cleanup`, and that page is the one whose lifetime excerpt work ends.
 */
export interface ExcerptCropPage {
  view: number[];
  getViewport(options: {
    scale: number;
    offsetX?: number;
    offsetY?: number;
  }): ExcerptViewport;
  render(options: {
    canvasContext: CanvasRenderingContext2D;
    viewport: ExcerptViewport;
    intent: "display";
  }): {
    promise: Promise<void>;
    cancel(): void;
    onContinue?: (continueCallback: () => void) => void;
  };
}

/**
 * One open reader's document, as excerpt work may reach it. The reader keeps
 * ownership of the document and of every page and render task it holds; this
 * handle only reads.
 */
export interface BorrowedExcerptDocument {
  /** The absolute path of the file the reader loaded. */
  readonly path: string;
  /**
   * The reader's own PDF.js document proxy. A reader that replaces its
   * document presents a new object, so it is also the identity a proof is
   * remembered against.
   */
  readonly document: object;
  /**
   * The bytes this exact document holds, from PDF.js's own `getData()`.
   * `null` when the host cannot answer — an unprovable document is never
   * borrowed.
   */
  bytes(): Promise<Uint8Array | null>;
  /**
   * A page proxy of this document, one-based in PDF.js but taken here as the
   * same zero-based index an Annotation carries. `null` once the reader closed
   * or replaced the document.
   */
  page(pageIndex: number): Promise<ExcerptCropPage | null>;
  /**
   * Whether the reader still holds this exact document, asked live rather than
   * snapshotted when the handle was taken. A reader that closed, swapped its
   * file, or dropped its viewer answers `false`, and nothing read through this
   * handle may stand in for the file after that.
   *
   * @see apps/obsidian/docs/adr/0054-reader-and-detached-excerpts-share-cache-publication.md
   */
  current(): boolean;
}

/**
 * Where excerpt work reaches a loaded reader document. The plugin's reader
 * registry answers it.
 *
 * @see apps/obsidian/docs/adr/0054-reader-and-detached-excerpts-share-cache-publication.md
 */
export interface ExcerptReaderDocuments {
  /**
   * @param path the absolute path of the file a reader may hold open.
   * @returns that reader's document, or `null` while none holds the file.
   */
  borrow(path: string): BorrowedExcerptDocument | null;
}

/**
 * One borrowed crop: the reader's own page, and the live check that the
 * document it came from still stands behind it. A reader that closes or
 * replaces its document while the crop draws answers `false` afterwards, and
 * the image drawn from that page must not be published as the outcome — the
 * caller renders from the file instead.
 */
export interface BorrowedExcerptCrop {
  page: ExcerptCropPage;
  /** Whether the reader still holds the document this page came from. */
  current(): boolean;
}

/** A document revision the file was shown to hold, or the refusal of one. */
interface BorrowVerdict {
  size: number;
  mtimeMs: number;
  /** The document's own digest, `null` when the file held other bytes. */
  digest: string | null;
}

/**
 * Verdicts by document, held weakly: a reader that closes or replaces its
 * document takes its verdict with the proxy it was proven against.
 */
const verdicts = new WeakMap<object, BorrowVerdict>();

/**
 * A page of the reader's own document for `path`, once that document's bytes
 * have been shown to be the file's current bytes. `null` when no reader holds
 * the file, when its document cannot be shown to be current, or when it closed
 * or was replaced before the page was read — the caller then renders detached
 * from the file, which is the one source that needs no proof.
 *
 * A current size and modification time cannot show that a document loaded
 * earlier holds the current bytes, so the proof compares content: the
 * document's own bytes against a stable read of the file. Only a document
 * whose bytes are byte-for-byte the file's is borrowed, however long ago the
 * reader loaded it.
 *
 * Both reads the reader answers are bounded by `signal`: a host that never
 * settles one of them cannot hold a resolution open past its deadline. Nothing
 * of the reader's is cancelled or cleaned up to end that wait — the borrow
 * stops waiting and the caller renders from the file.
 *
 * @see apps/obsidian/docs/adr/0054-reader-and-detached-excerpts-share-cache-publication.md
 */
export async function borrowedExcerptPage(options: {
  readers: ExcerptReaderDocuments | undefined;
  path: string | null;
  pageIndex: number;
  signal: AbortSignal;
}): Promise<BorrowedExcerptCrop | null> {
  const { readers, path, pageIndex, signal } = options;
  if (!readers || !path) return null;
  const borrowed = await provenDocument({ readers, path, signal });
  if (!borrowed) return null;
  // The reader owns the read it answers: stopping to wait for one that never
  // settles is this call's alone to do, and it leaves the reader's own task,
  // page, and document untouched.
  const page = await abortable(borrowed.page(pageIndex), signal);
  // The reader may have closed or replaced its document while the page read
  // was in flight, so the page is re-checked against the document it came from
  // rather than trusted for having been asked of it.
  if (!page || !borrowed.current()) {
    logger.debug("Reader document closed before its page could be borrowed", {
      path,
      page: pageIndex + 1,
    });
    return null;
  }
  return { page, current: () => borrowed.current() };
}

/**
 * The reader's document for `path`, or `null` unless its own bytes are the
 * file's current bytes. A proven pair is remembered until the file's size or
 * modification time moves, so a batch pays the proof for its first excerpt
 * alone; a refusal is remembered the same way, so a file no reader matches is
 * not read again for every excerpt.
 */
async function provenDocument(options: {
  readers: ExcerptReaderDocuments;
  path: string;
  signal: AbortSignal;
}): Promise<BorrowedExcerptDocument | null> {
  const { readers, path, signal } = options;
  const borrowed = readers.borrow(path);
  if (!borrowed) return null;
  let verdict: BorrowVerdict | null;
  try {
    verdict = await verdictFor(borrowed, signal);
  } catch (error) {
    signal.throwIfAborted();
    logger.debug("Reader document proof failed", { path, error });
    return null;
  }
  if (!verdict?.digest) {
    logger.debug("Reader document does not hold the file's current bytes", {
      path,
    });
    return null;
  }
  logger.debug("Reader document holds the file's current bytes", { path });
  return borrowed;
}

/** The remembered verdict for this document and file revision, or a fresh one. */
async function verdictFor(
  borrowed: BorrowedExcerptDocument,
  signal: AbortSignal,
): Promise<BorrowVerdict | null> {
  await using file = await openAbortable(borrowed.path, signal);
  const info = await file.stat();
  signal.throwIfAborted();
  const remembered = verdicts.get(borrowed.document);
  if (
    remembered &&
    remembered.size === info.size &&
    remembered.mtimeMs === info.mtimeMs
  )
    return remembered;
  const verdict = await verify({
    borrowed,
    size: info.size,
    mtimeMs: info.mtimeMs,
    signal,
  });
  if (verdict) verdicts.set(borrowed.document, verdict);
  return verdict;
}

/**
 * Open a file for reading, closing the handle even when cancellation wins the
 * race with `open`. A handle that arrives after the caller's signal aborted
 * belongs to this call alone and has no other owner, so it is closed rather
 * than leaked; the cancellation is what the caller sees.
 */
async function openAbortable(
  path: string,
  signal: AbortSignal,
): Promise<FileHandle> {
  const opening = open(path, "r");
  try {
    return await abortable(opening, signal);
  } catch (error) {
    // Cancellation can win before open returns. Keep acquisition and its
    // eventual close inside this call's teardown, including the handoff race.
    await opening
      .then(
        (file) => file.close(),
        () => undefined,
      )
      .catch((closeError: unknown) => {
        logger.debug("Cancelled read could not close its file", {
          path,
          error: closeError,
        });
      });
    throw error;
  }
}

/**
 * Compare the document's own bytes with a stable read of the file. `null` when
 * the read cannot be trusted, which leaves the verdict unremembered so a later
 * excerpt proves the revision again.
 */
async function verify(options: {
  borrowed: BorrowedExcerptDocument;
  size: number;
  mtimeMs: number;
  signal: AbortSignal;
}): Promise<BorrowVerdict | null> {
  const { borrowed, size, mtimeMs, signal } = options;
  logger.trace("Proving the reader's document against the file", {
    path: borrowed.path,
    size,
  });
  // A file past the excerpt limit is refused before its document's bytes are
  // read: it is also past what the detached renderer parses.
  if (size > MAX_PDF_BYTES) return { size, mtimeMs, digest: null };
  // `getData()` on a reader's document is the reader's own work: a host that
  // never settles it must not hold this proof — and the resolution behind it —
  // open past the caller's bound.
  const data = await abortable(borrowed.bytes(), signal);
  signal.throwIfAborted();
  if (!data || data.byteLength !== size) return { size, mtimeMs, digest: null };
  const document = createHash("sha256").update(data).digest("hex");
  const bytes = await readVerifiedBytes(
    borrowed.path,
    { size, mtimeMs },
    signal,
  );
  if (!bytes) return null;
  const file = createHash("sha256").update(bytes).digest("hex");
  return { size, mtimeMs, digest: file === document ? document : null };
}

/**
 * Read exactly the stamped revision's bytes, and answer `null` when the file
 * moved under the read.
 */
async function readVerifiedBytes(
  path: string,
  stamp: { size: number; mtimeMs: number },
  signal: AbortSignal,
): Promise<Uint8Array | null> {
  await using file = await openAbortable(path, signal);
  const before = await file.stat();
  if (before.size !== stamp.size || before.mtimeMs !== stamp.mtimeMs)
    return null;
  const bytes = new Uint8Array(stamp.size);
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
  const after = await file.stat();
  if (
    offset !== bytes.length ||
    after.size !== stamp.size ||
    after.mtimeMs !== stamp.mtimeMs
  )
    return null;
  return bytes;
}
