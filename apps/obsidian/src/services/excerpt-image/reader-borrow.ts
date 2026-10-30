// Borrowing the PDF document an open reader already holds, and the revision
// proof a borrowed document passes before excerpt work crops from it.

import { Effect } from "effect";

import { withLogCategory } from "@/lib/effect-log";

import { openExcerptFile, pdfStamp, readBounded } from "./file";
import type { ExcerptViewport } from "./geometry";

const logged = withLogCategory("excerpt-image", "reader");

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
  /** Whether the document's own bytes were the file's, byte for byte. */
  match: boolean;
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
 * The calling fiber bounds the reader and file reads. Interruption stops
 * waiting on the reader and closes the scoped file. The reader keeps
 * ownership of its document, page, and render tasks.
 *
 * @see apps/obsidian/docs/adr/0054-reader-and-detached-excerpts-share-cache-publication.md
 */
export const borrowedExcerptPage = Effect.fn("ExcerptImage.borrowedPage")(
  function* (options: {
    readers: ExcerptReaderDocuments | undefined;
    path: string | null;
    pageIndex: number;
  }) {
    const { readers, path, pageIndex } = options;
    if (!readers || !path) return null;
    const borrowed = readers.borrow(path);
    if (!borrowed) return null;
    const verdict = yield* verdictFor(borrowed).pipe(
      Effect.catch((error) =>
        Effect.logDebug("Reader document proof failed").pipe(
          Effect.annotateLogs({ path, error }),
          Effect.as(null),
        ),
      ),
    );
    if (!verdict?.match) return null;
    // The reader owns this work. Interruption stops waiting and leaves its
    // document and page untouched.
    const page = yield* Effect.tryPromise(() => borrowed.page(pageIndex));
    if (!page || !borrowed.current()) return null;
    return {
      page,
      current: () => borrowed.current(),
    } satisfies BorrowedExcerptCrop;
  },
  logged,
);

/** One proof per document and stable file revision, shared by all its crops. */
const verdictFor = Effect.fnUntraced(function* (
  borrowed: BorrowedExcerptDocument,
) {
  const file = yield* openExcerptFile(borrowed.path);
  const info = pdfStamp(yield* file.stat);
  const remembered = verdicts.get(borrowed.document);
  if (
    remembered &&
    remembered.size === info.size &&
    remembered.mtimeMs === info.mtimeMs
  )
    return remembered;
  if (info.size > MAX_PDF_BYTES) {
    const verdict = { ...info, match: false };
    verdicts.set(borrowed.document, verdict);
    return verdict;
  }
  const data = yield* Effect.tryPromise(() => borrowed.bytes());
  let match = false;
  if (data && data.byteLength === info.size) {
    const bytes = yield* readBounded(file, info.size + 1);
    const after = pdfStamp(yield* file.stat);
    if (
      bytes.length !== info.size ||
      after.size !== info.size ||
      after.mtimeMs !== info.mtimeMs
    )
      return null;
    match = sameBytes(data, bytes);
  }
  const verdict = { ...info, match };
  verdicts.set(borrowed.document, verdict);
  return verdict;
}, Effect.scoped);

/** Whether two byte views hold the same bytes, however either was read. */
function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index++)
    if (left[index] !== right[index]) return false;
  return true;
}
