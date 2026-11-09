// Hold an Item picker out of sight until its first answer, so it opens with rows.

/** How long a picker may stay out of sight before it shows a loading row. */
export const LOADING_REVEAL_MS = 100;

export interface FirstAnswerView {
  /** Make the picker transparent; it keeps focus. */
  hide(): void;
  reveal(): void;
  /** Put a loading row in the empty result list. */
  showLoading(): void;
  /** The window the picker opened in, whose timer waits for the first answer. */
  win(): Window;
}

/**
 * The worker answers a search one or two frames after the picker opens, so
 * the picker would paint once with no rows and then grow. The gate keeps it
 * transparent until the first answer settles; past {@link LOADING_REVEAL_MS}
 * it shows the picker with a loading row, which the first answer replaces.
 * The input has focus all the while, so what the reader types is kept.
 */
export class FirstAnswerGate {
  readonly #view: FirstAnswerView;
  #timer: number | undefined;
  /** The window `#timer` was armed on. */
  #timerWin: Window | null = null;
  /** The open that still waits for its first answer, or `null`. */
  #pendingOpen: object | null = null;

  constructor(view: FirstAnswerView) {
    this.#view = view;
  }

  /** Call before the picker asks for its first answer. */
  open(): void {
    this.close();
    const pendingOpen = {};
    this.#pendingOpen = pendingOpen;
    this.#view.hide();
    const win = this.#view.win();
    this.#timerWin = win;
    this.#timer = win.setTimeout(() => {
      if (this.#pendingOpen !== pendingOpen) return;
      this.#view.showLoading();
      this.#settle(pendingOpen);
    }, LOADING_REVEAL_MS);
  }

  close(): void {
    this.#clearTimer();
    this.#pendingOpen = null;
  }

  /** Pass a search answer through; the first one to settle shows the picker. */
  track<T>(answer: T[] | Promise<T[]>): T[] | Promise<T[]> {
    const pendingOpen = this.#pendingOpen;
    if (!pendingOpen) return answer;
    if (Array.isArray(answer)) {
      this.#settle(pendingOpen);
      return answer;
    }
    return answer.finally(() => this.#settle(pendingOpen));
  }

  #settle(pendingOpen: object): void {
    if (this.#pendingOpen !== pendingOpen) return;
    this.#clearTimer();
    this.#pendingOpen = null;
    this.#view.reveal();
  }

  #clearTimer(): void {
    this.#timerWin?.clearTimeout(this.#timer);
    this.#timerWin = null;
    this.#timer = undefined;
  }
}
