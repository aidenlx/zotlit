// One reader, named by its source, the Attachment it holds, and its selection.
import { createNanoEvents } from "@zotlit/shared/nanoevents";

/**
 * Which reader a session speaks for. A surface picks one session and follows
 * it; two sessions are never merged, and no event from one overrides another.
 *
 * @see apps/obsidian/docs/adr/0041-the-annotation-view-changes-its-follow-mode-only-on-a-user-gesture.md
 */
export type ReaderSource = "zotero" | "obsidian-pdf";

/** What a reader has open, in the one identity every surface shares. */
export interface ReaderSessionTarget {
  /** The Attachment's Indexed Key. */
  attachmentKey: string;
  /**
   * The parent Item's Indexed Key; `null` for a standalone Attachment, which
   * Zotero allows and which holds Annotations like any other.
   *
   * @see https://github.com/aidenlx/zotlit/issues/1141
   */
  itemKey: string | null;
}

export interface ReaderSessionEvents {
  /** The reader moved to another Attachment, or stopped holding one. */
  "target-changed": (target: ReaderSessionTarget | null) => void;
  /** The Annotations selected in the reader, by Indexed Key. */
  "selection-changed": (selected: readonly string[]) => void;
}

/**
 * A live reader, as every consumer sees it: what it holds, what is selected in
 * it, and the two gestures a consumer can send back to it.
 */
export interface ReaderSession {
  /**
   * Which reader this is. The Annotation View follows one session at a time and
   * says which in its own surfaces; the Mark Popup reads it to decide whether a
   * gesture can reach the reader at all (aidenlx/zotlit#1148).
   */
  readonly source: ReaderSource;
  readonly target: ReaderSessionTarget | null;
  /** Indexed Keys of the Annotations selected in the reader. */
  readonly selected: readonly string[];
  /**
   * Bring the reader to this Annotation. Called when a card is activated
   * (aidenlx/zotlit#1148); the Annotation View reads the other direction today.
   */
  navigateToAnnotation(annotationKey: string): void;
  /**
   * Ask the reader to select these Annotations, and nothing else. Called from
   * the card and the Mark Popup's stepper (aidenlx/zotlit#1148).
   */
  setSelectedAnnotations(annotationKeys: readonly string[]): void;
  /**
   * Name an element outside the reader that drives this selection, such as the
   * Annotation View's card list. A press inside it is no click-away: the
   * surface's own gesture says what the selection becomes. A reader without
   * click-away has nothing to ask it.
   *
   * @returns what takes the element back.
   */
  addSelectionSurface(el: HTMLElement): () => void;
  on<K extends keyof ReaderSessionEvents>(
    event: K,
    cb: ReaderSessionEvents[K],
  ): () => void;
}

export interface ReaderSessionHostDeps {
  source: ReaderSource;
  /** Reaches the reader for {@link ReaderSession.navigateToAnnotation}. */
  navigate: (annotationKey: string) => void;
  /**
   * Reaches the reader for {@link ReaderSession.setSelectedAnnotations}. A
   * reader that took the selection answers by calling {@link
   * ReaderSessionHost.reportSelection}; one that cannot be told what to select
   * reports nothing, so the session never claims a selection its reader does
   * not hold.
   */
  select: (annotationKeys: readonly string[]) => void;
}

/**
 * The producer's side of a {@link ReaderSession}: whoever owns the reader
 * drives {@link setTarget} and {@link reportSelection}, and every consumer
 * reads the same session through the narrower {@link ReaderSession}.
 */
export class ReaderSessionHost implements ReaderSession, Disposable {
  readonly source: ReaderSource;
  readonly #navigate;
  readonly #select;
  readonly #emitter = createNanoEvents<ReaderSessionEvents>();
  #target: ReaderSessionTarget | null = null;
  #selected: readonly string[] = [];
  readonly #selectionSurfaces = new Set<HTMLElement>();

  constructor({ source, navigate, select }: ReaderSessionHostDeps) {
    this.source = source;
    this.#navigate = navigate;
    this.#select = select;
  }

  get target(): ReaderSessionTarget | null {
    return this.#target;
  }

  get selected(): readonly string[] {
    return this.#selected;
  }

  navigateToAnnotation(annotationKey: string): void {
    this.#navigate(annotationKey);
  }

  setSelectedAnnotations(annotationKeys: readonly string[]): void {
    this.#select(annotationKeys);
  }

  addSelectionSurface(el: HTMLElement): () => void {
    this.#selectionSurfaces.add(el);
    return () => {
      this.#selectionSurfaces.delete(el);
    };
  }

  /** Whether a node lies inside a surface that drives this selection. */
  onSelectionSurface(node: Node | null): boolean {
    for (const el of this.#selectionSurfaces)
      if (el.contains(node)) return true;
    return false;
  }

  on<K extends keyof ReaderSessionEvents>(
    event: K,
    cb: ReaderSessionEvents[K],
  ): () => void {
    return this.#emitter.on(event, cb);
  }

  /**
   * The reader now holds `target`. A selection belongs to one Attachment, so a
   * move to another clears it before the target change is announced.
   */
  setTarget(target: ReaderSessionTarget | null): void {
    if (sameTarget(this.#target, target)) return;
    this.#target = target;
    if (this.#selected.length > 0) this.reportSelection([]);
    this.#emitter.emit("target-changed", target);
  }

  /** The reader now holds this selection, by Indexed Key. */
  reportSelection(selected: readonly string[]): void {
    if (sameKeys(this.#selected, selected)) return;
    this.#selected = [...selected];
    this.#emitter.emit("selection-changed", this.#selected);
  }

  /**
   * Drops every subscriber and surface, so a closed reader announces nothing
   * further.
   */
  [Symbol.dispose](): void {
    this.#emitter.events = {};
    this.#selectionSurfaces.clear();
  }
}

function sameTarget(
  a: ReaderSessionTarget | null,
  b: ReaderSessionTarget | null,
): boolean {
  if (a === null || b === null) return a === b;
  return a.attachmentKey === b.attachmentKey && a.itemKey === b.itemKey;
}

function sameKeys(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((key, index) => key === b[index]);
}
