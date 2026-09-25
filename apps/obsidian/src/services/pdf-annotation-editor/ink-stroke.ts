// One Ink Stroke under the pointer: its raw samples in PDF points on the page
// it was pressed on, and its smoothed path published once per animation frame.
import type { ReaderPage } from "./creation";
import type { Point } from "./hit-test";
import { clampToViewBox, StrokeSamples } from "./ink-path";
import { clearLiveStroke, publishLiveStroke } from "./reader-surface-state";
import type { ReaderSurfaceStore } from "./reader-surface-state";
import { pdfPointAt } from "./surface";

export interface InkStrokeOptions {
  /** The pointer that pressed, which alone moves and ends the stroke. */
  pointerId: number;
  /** The page the press fell on, which holds the whole stroke. */
  page: ReaderPage;
  /** Where the press fell, in client coordinates. */
  at: Point;
  width: number;
  color: string;
  surfaceState: ReaderSurfaceStore;
  /** The reader's own window, whose frames the stroke is published on. */
  win: Window;
  /**
   * The stroke reached the position ceiling: the part drawn so far, smoothed
   * and rounded, is finished, and the stroke goes on from the next sample.
   */
  onSplit: (path: number[]) => void;
}

/**
 * The stroke from press to release. The press point is published at once, so
 * a tap shows its dot; every later sample is published with the next frame,
 * smoothed over the whole stroke as the release will store it.
 */
export class InkStroke implements Disposable {
  readonly pointerId: number;
  readonly page: ReaderPage;
  /** The pen width the stroke is drawn at, fixed at the press. */
  readonly width: number;
  /** The colour the stroke is drawn in, fixed at the press. */
  readonly color: string;
  readonly #options;
  readonly #samples: StrokeSamples;
  #frame: number | null = null;

  constructor(options: InkStrokeOptions) {
    this.#options = options;
    this.pointerId = options.pointerId;
    this.page = options.page;
    this.width = options.width;
    this.color = options.color;
    this.#samples = new StrokeSamples({
      pageIndex: options.page.pageIndex,
      width: options.width,
    });
    this.#take(options.at);
    this.#publish();
  }

  /**
   * Takes one move's samples. The browser batches the moves between two
   * events as coalesced events; a move it built by hand lists none, and then
   * the move itself is the sample.
   */
  move(event: PointerEvent): void {
    const coalesced = event.getCoalescedEvents?.() ?? [];
    for (const sample of coalesced.length > 0 ? coalesced : [event])
      this.#take({ x: sample.clientX, y: sample.clientY });
    this.#frame ??= this.#options.win.requestAnimationFrame(() => {
      this.#frame = null;
      this.#publish();
    });
  }

  /**
   * Ends the stroke and takes it off the page.
   *
   * @returns the stroke as Zotero stores it: smoothed, and rounded to three
   *   decimals. A stroke that never moved is its one press point.
   */
  finish(): number[] {
    this[Symbol.dispose]();
    return this.#samples.finish();
  }

  /** Discards the stroke: no more frames, and nothing drawn. */
  [Symbol.dispose](): void {
    if (this.#frame !== null)
      this.#options.win.cancelAnimationFrame(this.#frame);
    this.#frame = null;
    clearLiveStroke(this.#options.surfaceState);
  }

  /**
   * One sample on the press page, measured against the page as it stands now,
   * so a scroll or a zoom mid-stroke keeps it under the pointer. It is pulled
   * onto the page, then kept only a PDF point or more from the last one kept.
   * A sample that parts the stroke at the ceiling hands the finished part on
   * and shows the new part at once, so no frame draws the finished part twice.
   */
  #take(client: Point): void {
    const { view } = this.page;
    const finished = this.#samples.take(
      clampToViewBox(pdfPointAt(view, client), view.viewport.viewBox),
    );
    if (!finished) return;
    this.#options.onSplit(finished);
    this.#publish();
  }

  #publish(): void {
    publishLiveStroke(this.#options.surfaceState, {
      pageIndex: this.page.pageIndex,
      paths: [this.#samples.path],
      width: this.width,
      color: this.color,
    });
  }
}
