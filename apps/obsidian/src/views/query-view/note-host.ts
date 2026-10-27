// The Query View that a note holds, as the Query File embed and the Query
// Block share it. `this` is the Item of the note's `zotero-key`, read from the
// metadata cache of the note, since Live Preview hands a code block no
// frontmatter. The view takes the card keys while a card in it has focus, and
// a click in it does not select it in Live Preview. Each host keeps its own
// storage: the embed its Query File, the block its text in the note.
//
// @see apps/obsidian/docs/adr/0068-query-files-are-a-zotlit-file-type-embedded-through-the-private-embed-registry.md
import { Component, Scope } from "obsidian";

import { itemKeyFromFrontmatter } from "@/services/note-index/parse";

import "./note-host.css";
import { makeNoteBindingAtom } from "./note-binding";
import { QueryView } from "./view";
import type { QueryViewDeps, QueryViewHost } from "./view";

/** What a note host gives the view beside the note: its storage. */
export type NoteStorage = Pick<QueryViewHost, "save" | "canSave" | "openFile">;

export class NoteQueryHost extends Component {
  readonly #query: QueryView;
  readonly #deps: QueryViewDeps;
  readonly #el: HTMLElement;
  readonly #sourcePath: () => string;
  readonly #scope: Scope;
  /** The Item key `this` reads, as the note's Properties give it. */
  #item: string | null;
  readonly #binding: ReturnType<typeof makeNoteBindingAtom>;

  constructor(
    deps: QueryViewDeps,
    {
      el,
      sourcePath,
      storage,
    }: {
      /** The element the view draws into. */
      el: HTMLElement;
      /** The note that holds the view. */
      sourcePath: () => string;
      storage: NoteStorage;
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
    });
    // e2e-only: packages/e2e reaches the view of every host from its element.
    // A dev-build port, absent from a production build.
    if (__DEV__) Object.assign(el, { zotlitQueryView: this.#query });
  }

  override onload(): void {
    this.addChild(this.#query);
    this.#query.render(this.#el);
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
   * it to print them. Never rejects.
   */
  shown(): Promise<void> {
    return this.#query.shownIn(this.#el);
  }

  #readItem(): string | null {
    const { vault, metadataCache } = this.#deps.app;
    const note = vault.getFileByPath(this.#sourcePath());
    return note === null
      ? null
      : itemKeyFromFrontmatter(metadataCache.getFileCache(note));
  }
}
