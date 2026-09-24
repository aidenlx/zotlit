// One Ink Stroke under the pointer: its raw samples in PDF points on the page
// it was pressed on, and its smoothed path published once per animation frame.
import { roundCoordinate } from "@/services/annotation-repository/write";

import type { ReaderPage } from "./creation";
import type { PdfPoint } from "./geometry-edit";
import type { Point } from "./hit-test";
import { clampToViewBox, keepsSample, smoothPath } from "./ink-path";
import { clearLiveStroke, publishLiveStroke } from "./reader-surface-state";
import type { ReaderSurfaceStore } from "./reader-surface-state";
import { drawnBoxOf, pdfPointOf, unitsOf } from "./surface";

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
  /** The kept samples, a flat `[x0, y0, x1, y1, …]` run in PDF points. */
  readonly #raw: number[] = [];
  #frame: number | null = null;

  constructor(options: InkStrokeOptions) {
    this.#options = options;
    this.pointerId = options.pointerId;
    this.page = options.page;
    this.width = options.width;
    this.color = options.color;
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
    return smoothPath(this.#raw).map(roundCoordinate);
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
   */
  #take(client: Point): void {
    const { view } = this.page;
    const [x1 = 0, y1 = 0, x2 = 0, y2 = 0] = view.viewport.viewBox;
    const point = clampToViewBox(
      pdfPointOf(view, unitsOf(drawnBoxOf(view), client)),
      [x1, y1, x2, y2],
    );
    const last: PdfPoint | undefined =
      this.#raw.length > 0 ? [this.#raw.at(-2)!, this.#raw.at(-1)!] : undefined;
    if (keepsSample(last, point)) this.#raw.push(...point);
  }

  #publish(): void {
    publishLiveStroke(this.#options.surfaceState, {
      pageIndex: this.page.pageIndex,
      path: smoothPath(this.#raw),
      width: this.width,
      color: this.color,
    });
  }
}
