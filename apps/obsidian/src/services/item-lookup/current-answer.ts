// The rule every search picker keeps: a choice acts only on the answer to the
// query in the input. Obsidian's suggest popups keep an earlier query's rows on
// screen until the typed query's answer arrives, and choose from them.
import { Scope } from "obsidian";
import type { SuggestModal } from "obsidian";

/**
 * Give `modal` an Enter of its own. The result list takes Enter only while it
 * has a row, so Enter typed before any answer shows, or after an answer with
 * no rows, would do nothing. The modal's own scope takes Enter first and
 * leaves every other key to the list beneath it; the modal's
 * `selectActiveSuggestion` then waits for the typed query's answer through
 * {@link CurrentAnswer.chooseFirst}.
 */
export function takeEnter(modal: SuggestModal<unknown>): void {
  modal.scope = new Scope(modal.scope);
  modal.scope.register([], "Enter", (evt) => {
    if (evt.isComposing) return;
    modal.selectActiveSuggestion(evt);
    return false;
  });
}

/**
 * The answer to the query last typed in one picker. The picker passes each
 * answer through {@link track} and each choice through {@link choose}.
 */
export class CurrentAnswer<T> {
  /** The element of the rows, `aria-busy` while they answer an earlier query. */
  readonly #rowsEl: HTMLElement;
  /** The answer to the query last typed, settled or not. */
  #latest: Promise<readonly T[] | null> = Promise.resolve(null);
  /** Whether {@link #latest} is still to show. Until then the rows answer an earlier query. */
  #pending = false;
  /** Counts the closes: a wait from before a close chooses nothing. */
  #closes = 0;

  constructor(rowsEl: HTMLElement) {
    this.#rowsEl = rowsEl;
  }

  /**
   * Pass a picker's answer through on its way to Obsidian, which shows the
   * rows once it settles, right after this step.
   */
  track<A extends readonly T[] | null>(answer: A | Promise<A>): A | Promise<A> {
    if (!(answer instanceof Promise)) {
      this.#latest = Promise.resolve(answer);
      this.#setPending(false);
      return answer;
    }
    // An answer superseded by a later query settles nothing.
    const shown: Promise<A> = answer.finally(() => {
      if (this.#latest === shown) this.#setPending(false);
    });
    this.#latest = shown;
    this.#setPending(true);
    return shown;
  }

  /** Whether the rows answer the query in the input. */
  get answersTypedQuery(): boolean {
    return !this.#pending;
  }

  /**
   * Act on the chosen row. While the typed query's answer is pending, the row
   * belongs to an earlier query, where another Item can stand in the same
   * place or under the same title: Enter then waits for the answer and acts
   * on its first row, the row Obsidian selects when it shows, and a click is
   * dropped.
   */
  choose(
    value: T,
    evt: MouseEvent | KeyboardEvent,
    select: (value: T) => void,
  ): void {
    if (this.answersTypedQuery) select(value);
    else if (evt.type === "keydown") this.chooseFirst(select);
  }

  /** Wait for the typed query's answer and act on its first row, if it has one. */
  chooseFirst(select: (value: T) => void): void {
    void this.#chooseOnAnswer(select);
  }

  /** The picker closed: a pending answer and a waiting Enter go with it. */
  close(): void {
    this.#closes++;
    this.#latest = Promise.resolve(null);
    this.#setPending(false);
  }

  async #chooseOnAnswer(select: (value: T) => void): Promise<void> {
    const closes = this.#closes;
    let rows: readonly T[] | null;
    // A query typed after Enter supersedes the one Enter waited for.
    for (let answer = this.#latest; ; answer = this.#latest) {
      try {
        rows = await answer;
      } catch {
        rows = null;
      }
      if (closes !== this.#closes) return;
      if (answer === this.#latest) break;
    }
    const first = rows?.[0];
    if (first !== undefined) select(first);
  }

  #setPending(pending: boolean): void {
    this.#pending = pending;
    if (pending) this.#rowsEl.setAttribute("aria-busy", "true");
    else this.#rowsEl.removeAttribute("aria-busy");
  }
}
