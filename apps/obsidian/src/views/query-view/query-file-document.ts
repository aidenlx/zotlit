// The Query File document: the text of one Query View's file, the file it
// parses to, the view on screen, every edit, and when an edit saves. Each
// Query View has its own, so two tabs or embeds of one file each keep their
// own view on screen. The host stays the adapter: it writes the text and
// remembers the view through its save and select-view callbacks.
import type { MatchTree } from "@zotlit/templates/facade";

import * as m from "@/lib/i18n/generated/messages";
import { getLogger } from "@/lib/log";

import {
  editView,
  formulaProperty,
  parseQueryFile,
  removeFormula,
  serializeQueryFile,
  withDisplayName,
  withFilters,
  withFormula,
} from "./query-file";
import type {
  FilterSection,
  QueryFile,
  QueryFileDataset,
  QueryFileView,
  QueryFileViewEdit,
} from "./query-file";
import type { QueryViewHost } from "./view";
import * as edits from "./view-edits";
import { viewProperties } from "./view-properties";

const logger = getLogger(["views", "query-view"]);

/** What the document needs of the host: its save and select-view callbacks. */
export type DocumentHost = Pick<
  QueryViewHost,
  "save" | "canSave" | "onSelectView"
>;

/** What the document tells the Query View that holds it. */
export interface DocumentEvents {
  /** The file or the view on screen changed. */
  show: () => void;
  /** The last save failed, or a later one worked. */
  saveFailed: (failed: boolean) => void;
}

/** How long typed text, such as a limit or a view name, waits after the last key before it is saved. */
export const SAVE_DELAY_MS = 500;

/** How an edit saves: typed text waits for {@link SAVE_DELAY_MS}. */
export interface EditTiming {
  typed?: boolean;
}

export class QueryFileDocument {
  readonly #host: DocumentHost;
  readonly #events: DocumentEvents;
  /** The text the file on screen was read from. */
  #text: string | null = null;
  #file: QueryFile | null = null;
  /** The view the host asked for by name; the first view where `null`. */
  #wanted: string | null = null;
  /** The place of the view on screen in the file's list; `-1` for none. */
  #shown = -1;
  /** The text of a typed change that waits for its delay before it is saved. */
  #typedSave: { text: string; timer: ReturnType<typeof setTimeout> } | null =
    null;
  /** The host's last write, which settles once it is done. Never rejects. */
  #writing: Promise<void> = Promise.resolve();
  /** How many writes the host has to do or to finish. */
  #pending = 0;
  /** How many saves the document started, so that only the last one's result shows. */
  #saves = 0;

  constructor(host: DocumentHost, events: DocumentEvents) {
    this.#host = host;
    this.#events = events;
  }

  /** The file on screen; `null` until the host gives its text. */
  get file(): QueryFile | null {
    return this.#file;
  }

  /** The view on screen; `null` while the file has none, or none of the name asked for. */
  get view(): QueryFileView | null {
    return this.#file?.views[this.#shown] ?? null;
  }

  /** The name the host asked for; `null` for the first view. */
  get wanted(): string | null {
    return this.#wanted;
  }

  /**
   * Read the file's text, as the host holds it. The text the file on screen
   * was read from changes nothing, so the host can give the document's own
   * save back. Answers whether the file changed.
   */
  setText(text: string): boolean {
    if (text === this.#text) return false;
    this.#text = text;
    this.#file = parseQueryFile(text);
    this.#choose();
    return true;
  }

  /** Show the view named `name`, or the file's first view for `null`. */
  selectView(name: string | null): void {
    if (name === this.#wanted && this.view?.name === name) return;
    this.#wanted = name;
    this.#choose();
  }

  /** Show nothing until the next {@link setText}. */
  clear(): void {
    this.#text = null;
    this.#file = null;
  }

  /** The name of the view on screen, as the host remembers it. */
  get viewName(): string | null {
    return this.view?.name ?? this.#wanted;
  }

  /** The user picked a view from the view menu: show it, and tell the host. */
  pickView(name: string): void {
    this.selectView(name);
    this.#host.onSelectView?.(name);
  }

  /** Whether a change can stay. */
  get canSave(): boolean {
    return this.#host.canSave?.() ?? true;
  }

  /** Change the view on screen, as a toolbar control asks. */
  editView(edit: QueryFileViewEdit, timing: EditTiming = {}): void {
    const { file, view } = this;
    if (!file || !view) return;
    this.#commit(editView(file, view, edit), this.#shown, timing);
  }

  /**
   * Save new filters: for all views, or for the view on screen. `undefined`
   * removes them. Answers whether the document took the change.
   */
  setFilters(section: FilterSection, filters: MatchTree | undefined): boolean {
    const { file, view } = this;
    if (!file || !view) return false;
    const index = section === "all" ? null : this.#shown;
    this.#commit(withFilters(file, index, filters), this.#shown);
    return true;
  }

  /**
   * Save the Display Name of `property`; an empty name removes it. Answers
   * whether the document took the change.
   */
  renameProperty(property: string, name: string): boolean {
    const { file, view } = this;
    if (!file || !view) return false;
    this.#commit(
      withDisplayName(file, property, name.trim() || undefined),
      this.#shown,
    );
    return true;
  }

  /**
   * Save the Formula `name` with its text and, where given, its Display Name;
   * an empty Display Name removes it. A new Formula also shows in the view on
   * screen, after its other properties. Answers whether the document took
   * the change.
   */
  saveFormula(name: string, text: string, label?: string): boolean {
    const { file, view } = this;
    if (!file || !view) return false;
    let next = withFormula(file, name, text);
    const property = formulaProperty(name);
    if (label !== undefined)
      next = withDisplayName(next, property, label.trim() || undefined);
    if (
      !Object.hasOwn(file.formulas ?? {}, name) &&
      !(view.order ?? []).includes(property)
    ) {
      // A view that shows no property chosen shows the defaults; they stay.
      const { order, visibleProperties } = viewProperties(file, view);
      const shown = visibleProperties.some((entry) => entry.place !== null)
        ? order
        : visibleProperties.map((entry) => entry.path);
      next = editView(next, view, { order: [...shown, property] });
    }
    this.#commit(next, this.#shown);
    return true;
  }

  /**
   * Remove the Formula `name` from the file and from every view. Answers
   * whether the document took the change.
   */
  removeFormula(name: string): boolean {
    const { file, view } = this;
    if (!file || !view) return false;
    this.#commit(removeFormula(file, name), this.#shown);
    return true;
  }

  /** Add a view at the end of the list, and show it. Returns its name. */
  addView(base: string = m.query_view_new_view_name()): string {
    const file = this.#file;
    if (!file) return base;
    // A new view reads what the view on screen reads.
    const edit = edits.addView(file, base, this.view?.from ?? "annotations");
    this.#commit(edit.file, file.views.length);
    return edit.name;
  }

  /** Rename a view as the researcher types its name; it saves after a short wait. */
  renameView(index: number, name: string): void {
    const file = this.#file;
    if (!file) return;
    this.#commit(edits.renameView(file, index, name), this.#shown, {
      typed: true,
    });
  }

  /** Copy a view after itself, and show the copy. */
  duplicateView(index: number): void {
    const file = this.#file;
    if (!file) return;
    this.#commit(edits.duplicateView(file, index).file, index + 1);
  }

  /** Delete a view; where it was on screen, its neighbour shows: the view before it, or after the first. */
  deleteView(index: number): void {
    const file = this.#file;
    if (!file || file.views.length <= 1) return;
    const shown = this.#shown;
    this.#commit(
      edits.deleteView(file, index).file,
      shown === index
        ? Math.max(0, index - 1)
        : shown > index
          ? shown - 1
          : shown,
    );
  }

  /** Move a view to `to`; a move to `0` makes it the default view. The view on screen stays. */
  moveView(from: number, to: number): void {
    const file = this.#file;
    if (!file || from === to) return;
    const shown = this.#shown;
    this.#commit(
      edits.moveView(file, from, to),
      shown === from
        ? to
        : from < shown && to >= shown
          ? shown - 1
          : from > shown && to <= shown
            ? shown + 1
            : shown,
    );
  }

  /** Set a layout option of a view, or remove it for `undefined`. */
  setViewOption(index: number, key: string, value: unknown): void {
    const file = this.#file;
    if (!file) return;
    this.#commit(edits.setViewOption(file, index, { key, value }), this.#shown);
  }

  setViewLayout(index: number, type: string): void {
    const file = this.#file;
    if (!file) return;
    this.#commit(edits.setViewLayout(file, index, type), this.#shown);
  }

  /** Set the dataset a view reads; what the dataset lacks stays in the file, unused. */
  setViewDataset(index: number, dataset: QueryFileDataset): void {
    const file = this.#file;
    if (!file) return;
    this.#commit(edits.setViewDataset(file, index, dataset), this.#shown);
  }

  /** Save typed text that waits for its delay now. Settles once the host wrote it. Never rejects. */
  flush(): Promise<void> {
    const typed = this.#typedSave;
    this.#cancelTypedSave();
    if (typed) this.#save(typed.text);
    return this.#writing;
  }

  /**
   * The one path of an edit: show `next` at once with the view at `place` on
   * screen, and hand its text to the host to save, at once or, for typed
   * text, after {@link SAVE_DELAY_MS}. A `place` of `-1` keeps the view the
   * host asked for.
   */
  #commit(next: QueryFile, place: number, { typed }: EditTiming = {}): void {
    const text = serializeQueryFile(next);
    const before = this.view?.name ?? null;
    const file = parseQueryFile(text);
    this.#text = text;
    this.#file = file;
    const view = file.views[place];
    if (view) {
      // The view the host asked for stays asked for while it names the view
      // on screen; otherwise the view on screen is the one asked for now.
      if (placeOf(file, this.#wanted, place) !== place)
        this.#wanted = view.name;
      this.#shown = place;
      this.#events.show();
      if (view.name !== before) this.#host.onSelectView?.(view.name);
    } else this.#choose();
    this.#cancelTypedSave();
    if (typed) {
      const timer = setTimeout(() => {
        this.#typedSave = null;
        this.#save(text);
      }, SAVE_DELAY_MS);
      this.#typedSave = { text, timer };
    } else this.#save(text);
  }

  #cancelTypedSave(): void {
    if (this.#typedSave) clearTimeout(this.#typedSave.timer);
    this.#typedSave = null;
  }

  /**
   * Hand `text` to the host to write once its earlier writes are done, so the
   * saves land in the order of the edits. A failed write keeps the change on
   * screen and says so.
   */
  #save(text: string): void {
    if (!this.canSave) return;
    const save = ++this.#saves;
    const write = async () => {
      let failed = false;
      try {
        await this.#host.save(text);
      } catch (error) {
        failed = true;
        logger.warn("A Query View could not save its file", { error });
      }
      this.#pending--;
      if (save === this.#saves) this.#events.saveFailed(failed);
    };
    // With no write in progress, the host starts to write at once.
    this.#writing = this.#pending++ === 0 ? write() : this.#writing.then(write);
  }

  /** Show the view the host asks for, at its place where the view on screen has its name. */
  #choose(): void {
    if (!this.#file) return;
    this.#shown = placeOf(this.#file, this.#wanted, this.#shown);
    this.#events.show();
  }
}

/**
 * The place of the view named `wanted` in `file`: the first view for `null`.
 * Of views with one name, such as views without a name, `prefer` wins.
 */
function placeOf(
  file: QueryFile,
  wanted: string | null,
  prefer: number,
): number {
  if (wanted === null) return file.views.length > 0 ? 0 : -1;
  if (file.views[prefer]?.name === wanted) return prefer;
  return file.views.findIndex((view) => view.name === wanted);
}
