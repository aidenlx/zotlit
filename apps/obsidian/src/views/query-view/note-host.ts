// The Query View that a note holds, as the Query File embed and the Query
// Block share it. `this` is the Item of the note's `zotero-key`, read from the
// metadata cache of the note, since Live Preview hands a code block no
// frontmatter. The view takes the card keys while a card in it has focus, and
// a click in it does not select it in Live Preview. Each host keeps its own
// storage: the embed its Query File, the block its text in the note.
//
// @see apps/obsidian/docs/adr/0068-query-files-are-a-zotlit-file-type-embedded-through-the-private-embed-registry.md
import { Component, Scope } from "obsidian";

import { keepPlaces } from "@/lib/keep-places";
import { observeResize } from "@/lib/observe-resize";
import { itemKeyFromFrontmatter } from "@/services/note-index/parse";

import "./note-host.css";
import { makeNoteBindingAtom } from "./note-binding";
import { QueryView } from "./view";
import type { QueryViewDeps, QueryViewHost } from "./view";

/** What a note host gives the view beside the note: its storage. */
export type NoteStorage = Pick<QueryViewHost, "save" | "canSave" | "openFile">;

/**
 * The height each view a note shows last stood at with its rows, in this
 * session, by the note and the view: a host that shows the view again, as
 * Live Preview builds a block again once the cursor leaves it, stands at
 * that height while its rows come.
 */
const drawnHeights = new Map<string, number>();
/** The hosts whose rows have not come yet. */
const reserving = new Set<NoteQueryHost>();

export class NoteQueryHost extends Component {
  readonly #query: QueryView;
  readonly #deps: QueryViewDeps;
  readonly #el: HTMLElement;
  readonly #sourcePath: () => string;
  readonly #scope: Scope;
  /** The Item key `this` reads, as the note's Properties give it. */
  #item: string | null;
  readonly #binding: ReturnType<typeof makeNoteBindingAtom>;
  /** What lets the view run: it comes near the screen, or a print shows it. */
  readonly #start = Promise.withResolvers<void>();
  /** The note and the view, as {@link drawnHeights} knows them. */
  #key: string;

  constructor(
    deps: QueryViewDeps,
    {
      el,
      sourcePath,
      storage,
      view,
    }: {
      /** The element the view draws into. */
      el: HTMLElement;
      /** The note that holds the view. */
      sourcePath: () => string;
      storage: NoteStorage;
      /** Which view the host shows: the same for a host that shows it again. */
      view: string;
    },
  ) {
    super();
    this.#deps = deps;
    this.#el = el;
    this.#sourcePath = sourcePath;
    this.#scope = new Scope(deps.app.scope);
    this.#item = this.#readItem();
    this.#binding = makeNoteBindingAtom(sourcePath, this.#item);
    // `zt-query-note`: the view stands in a note (see `note-host.css`).
    el.addClass("zt-root", "zt-query-note", "interactive-child");
    this.#query = new QueryView(deps, {
      ...storage,
      scope: this.#scope,
      sourcePath,
      context: () => (this.#item === null ? undefined : { item: this.#item }),
      contextSource: "note",
      // The view runs once it comes near the screen (see `onload`).
      start: this.#start.promise,
    });
    // The view stands at the height it last drew at until its rows come, or
    // at the most room they take, so the note keeps its height as its views
    // load (see `note-host.css`).
    el.dataset.queryWaiting = "";
    this.#key = JSON.stringify([sourcePath(), view]);
    this.#reserve(drawnHeights.get(this.#key));
    // e2e-only: packages/e2e reaches the view of every host from its element.
    // A dev-build port, absent from a production build.
    if (__DEV__) Object.assign(el, { zotlitQueryView: this.#query });
  }

  override onload(): void {
    this.addChild(this.#query);
    this.#query.render(this.#el);
    // A note can hold many views, each a query of its own: a view runs once
    // it stands within a screen of what the note shows, so the ones on
    // screen come first. One the note hides, as a folded callout or the
    // editor behind Reading view does, runs once it shows.
    this.register(this.#deps.nearScreen(this.#el, () => this.#start.resolve()));
    reserving.add(this);
    this.register(() => reserving.delete(this));
    this.register(
      this.#query.state.subscribe((state) => {
        const settled =
          state.phase === "ready" ||
          state.phase === "failed" ||
          state.problems.length > 0;
        if (!settled) return;
        const done = () => {
          delete this.#el.dataset.queryWaiting;
          reserving.delete(this);
        };
        // The rows draw a paint after the state that holds them: the view
        // keeps its room until they do.
        if (state.phase === "ready") void this.#query.drawn().then(done);
        else done();
      }),
    );
    const resize = observeResize(this.#el, [this.#el], () => this.#drew());
    this.register(() => resize[Symbol.dispose]());
    // The note takes the element off the page as it scrolls far from it:
    // the view's lists come back where the reader left them.
    const places = keepPlaces(this.#el);
    this.register(() => places[Symbol.dispose]());
    // A card in the view takes the card keys while it has focus.
    const keys = this.#deps.cardFocus.hold(this.#el, this.#scope, this.#query);
    this.register(() => keys[Symbol.dispose]());
    const { registry } = this.#deps;
    this.register(registry.mount(this.#binding));
    this.register(
      registry.subscribe(this.#binding, (key) => {
        this.#item = key;
        this.#query.contextChanged();
      }),
    );
  }

  /** Read the Query File's text, as the host holds it. */
  setText(text: string): void {
    this.#query.setText(text);
  }

  /** Show the view named `name`, or the file's first view for `null`. */
  selectView(name: string | null): void {
    this.#query.selectView(name);
  }

  /** The name of the view shown. */
  get viewName(): string | null {
    return this.#query.viewName;
  }

  /**
   * Settles once the view shows its first rows, as Export to PDF waits for
   * it to print them; outside a print, at once for a view that waits to
   * come near the screen. Never rejects.
   */
  async shown(): Promise<void> {
    // Export to PDF prints every view of the note, near the screen or not.
    if (this.#el.closest(".print")) this.#start.resolve();
    // Elsewhere a view that waits to come near the screen shows nothing yet.
    else if (this.#query.state.getState().phase === "waiting") return;
    await this.#query.shownIn(this.#el);
  }

  /**
   * The host shows `view` from now on, as a Query Block does once a toolbar
   * change rewrites its text: the host the note builds for the new text
   * stands at this one's height while its rows come.
   */
  showsAs(view: string): void {
    const height = drawnHeights.get(this.#key);
    this.#key = JSON.stringify([this.#sourcePath(), view]);
    if (height !== undefined) drawnHeights.set(this.#key, height);
  }

  /** Stand at `height` until the rows come; the cap for `undefined`. */
  #reserve(height: number | undefined): void {
    if (height !== undefined)
      this.#el.style.setProperty("--zt-query-note-reserve", `${height}px`);
  }

  /**
   * The view's height changed: keep it for a host that shows the view again,
   * and give it to one that waits for its rows. A print lays every row out,
   * past the cap, and a view the note hides stands at no height.
   */
  #drew(): void {
    const el = this.#el;
    if (reserving.has(this) || el.closest(".print")) return;
    const { height } = el.getBoundingClientRect();
    if (height === 0) return;
    drawnHeights.set(this.#key, height);
    for (const host of reserving)
      if (host.#key === this.#key) host.#reserve(height);
  }

  #readItem(): string | null {
    const { vault, metadataCache } = this.#deps.app;
    const note = vault.getFileByPath(this.#sourcePath());
    return note === null
      ? null
      : itemKeyFromFrontmatter(metadataCache.getFileCache(note));
  }
}

/**
 * Call `near` once `el` stands within a screen of what the box it scrolls in
 * shows, in whichever window shows it; an element the note hides never
 * comes near. Returns what ends the watch.
 */
export function whenNear(el: HTMLElement, near: () => void): () => void {
  let observer: IntersectionObserver | null = null;
  let frame: { win: Window; id: number } | null = null;
  let done = false;
  const end = () => {
    observer?.disconnect();
    observer = null;
    if (frame) frame.win.cancelAnimationFrame(frame.id);
    frame = null;
  };
  const watch = (win: Window) => {
    end();
    if (done) return;
    // The element joins the note after the host loads; its box is known then.
    if (!el.isConnected) {
      frame = { win, id: win.requestAnimationFrame(() => watch(win)) };
      return;
    }
    // The window's own observer: a pop-out window has one of its own.
    const { IntersectionObserver } = win as typeof window;
    observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        done = true;
        end();
        near();
      },
      // The box the note scrolls in, a screen further up and down: the
      // window and the panes around the note would clip the margin.
      { root: scrollBox(el), rootMargin: "100% 0px" },
    );
    observer.observe(el);
  };
  watch(el.win);
  const unmigrate = el.onWindowMigrated(watch);
  return () => {
    done = true;
    unmigrate();
    end();
  };
}

/** The nearest box `el` scrolls in; `null` for the window. */
function scrollBox(el: HTMLElement): HTMLElement | null {
  for (let box = el.parentElement; box; box = box.parentElement) {
    const { overflowY } = box.win.getComputedStyle(box);
    if (overflowY === "auto" || overflowY === "scroll") return box;
  }
  return null;
}
