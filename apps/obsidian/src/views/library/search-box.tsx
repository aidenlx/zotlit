// The search box of the Library View, its front door: the words go to the
// worker search, ranked as the quick switcher ranks, over the Library of the
// tree node or over every Library in the Library Scope; the host lists the
// Indexed Keys it found in that order. Escape clears the search, and the
// view lists the tree node again.
//
// @see apps/obsidian/docs/adr/0072-search-enters-the-library-view-as-an-ordered-key-set.md
import { Component } from "obsidian";
import type { KeyboardEvent, ReactNode } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import type { StoreApi } from "zustand/vanilla";

import { useUniqueId } from "@zotlit/ui";

import { SearchInput } from "@/components/obsidian/search-input";
import * as m from "@/lib/i18n/generated/messages";
import type { ItemLookup, SearchSession } from "@/services/item-lookup/service";
import type { LibrarySelector } from "@/services/library-scope/scope";
import type { LibraryScopeService } from "@/services/library-scope/service";
import type { QueryViewState } from "@/views/query-view/view";

import type { LibraryNode } from "./document";
import { searchTerms } from "./search";
import { sameLibrary } from "./tree";

/**
 * The most hits a search asks for: past them, an Item that matches does not
 * show. It stays below the row limit, so the sort never cuts a hit.
 */
export const LIBRARY_SEARCH_LIMIT = 500;

export interface LibrarySearchDeps {
  lookup: Pick<ItemLookup, "openSession">;
  libraryScope: Pick<LibraryScopeService, "on" | "current" | "libraries">;
}

/** What a search found, as the derivation reads it. */
export interface SearchFound {
  /** The text searched for. */
  readonly text: string;
  /** The ranked Indexed Keys of the words; absent while there are none. */
  readonly keys?: readonly string[];
  /** The Libraries a search of all libraries reads; absent while it keeps to the node. */
  readonly everywhere?: readonly LibrarySelector[];
}

export interface LibrarySearchHost {
  /** The tree node the search keeps to. */
  node: () => LibraryNode;
  /** List what the search found. */
  found: (found: SearchFound) => void;
  /** The researcher changed the text: keep it. */
  keep: (text: string) => void;
}

interface SearchState {
  readonly text: string;
  /** Whether the search reads every Library in the Library Scope. */
  readonly everywhere: boolean;
}

export class LibrarySearch extends Component {
  readonly store: StoreApi<SearchState>;
  readonly #deps: LibrarySearchDeps;
  readonly #host: LibrarySearchHost;
  #session: SearchSession | null = null;
  #input: HTMLInputElement | null = null;
  /** Counts the searches, so only the newest one lists its hits. */
  #runs = 0;
  #settled: Promise<void> = Promise.resolve();
  #roots: Root[] = [];

  constructor(deps: LibrarySearchDeps, host: LibrarySearchHost) {
    super();
    this.#deps = deps;
    this.#host = host;
    this.store = createStore<SearchState>(() => ({
      text: "",
      everywhere: false,
    }));
  }

  /** Settles once the newest search listed its hits. Never rejects. */
  get settled(): Promise<void> {
    return this.#settled;
  }

  override onload(): void {
    const session = this.#deps.lookup.openSession();
    this.#session = session;
    this.register(() => session.close());
    // The Libraries of the Library Scope are what a search of all libraries
    // reads, and what Recent lists.
    this.register(
      this.#deps.libraryScope.on("changed", () => {
        if (this.store.getState().everywhere || this.onRecent) void this.run();
      }),
    );
  }

  override onunload(): void {
    // A search that answers after the tab closed lists nothing.
    this.#runs++;
    for (const root of this.#roots) root.unmount();
    this.#roots = [];
    this.#session = null;
  }

  /** Show `text` as the search, and list what it finds. */
  open(text: string): Promise<void> {
    this.store.setState({ text });
    return this.run();
  }

  /** The researcher typed `text`. */
  type(text: string): void {
    this.store.setState({ text, everywhere: this.#everywhere(text) });
    this.#host.keep(text);
    void this.run();
  }

  /** Clear the search, and list the tree node again. */
  clear(): void {
    this.type("");
  }

  /** Search every Library in the Library Scope, past the tree node. */
  widen(): void {
    this.store.setState({ everywhere: true });
    void this.run();
  }

  /** Keep the search to the tree node again, as after a tree selection. */
  narrow(): void {
    this.store.setState({ everywhere: false });
  }

  /** Put the cursor in the search box. */
  focus(): void {
    this.#input?.focus();
  }

  /** Whether the tree node is Recent, which reads the Library Scope already. */
  get onRecent(): boolean {
    return this.#host.node().kind === "recent";
  }

  /** Whether the search reads every Library; an empty search reads none. */
  #everywhere(text: string): boolean {
    return text.trim() !== "" && this.store.getState().everywhere;
  }

  /** Search again, and list the hits once no newer search started. */
  run(): Promise<void> {
    const run = ++this.#runs;
    const { text, everywhere } = this.store.getState();
    const { words } = searchTerms(text);
    const { libraryScope } = this.#deps;
    const node = this.#host.node();
    const libraries =
      everywhere || node.kind === "recent"
        ? (libraryScope.current?.available ?? [])
        : libraryScope.libraries.filter(({ selector }) =>
            sameLibrary(selector, node.library),
          );
    this.#settled = (async () => {
      const hits =
        words === "" || !this.#session
          ? null
          : await this.#session.search(words, {
              limit: LIBRARY_SEARCH_LIMIT,
              libraries,
            });
      if (run !== this.#runs) return;
      this.#host.found({
        text,
        ...(hits && { keys: hits.map(({ item }) => item.indexedKey) }),
        ...(everywhere && {
          everywhere: libraries.map(({ selector }) => selector),
        }),
      });
    })();
    return this.#settled;
  }

  /** Draw the search box into `el`. */
  render(el: HTMLElement): void {
    const root = createRoot(el);
    root.render(<SearchBox search={this} />);
    this.#roots.push(root);
  }

  /**
   * The header's text while a search is on screen: its match count with the
   * offer to search all libraries; otherwise `fallback`.
   */
  summary(
    query: StoreApi<QueryViewState>,
    { selection, fallback }: { selection: string; fallback: ReactNode },
  ): ReactNode {
    return (
      <SearchSummary
        search={this}
        query={query}
        selection={selection}
        fallback={fallback}
      />
    );
  }

  /** @internal The box's input, for {@link focus}. */
  set input(input: HTMLInputElement | null) {
    this.#input = input;
  }
}

function SearchBox({ search }: { search: LibrarySearch }) {
  const text = useStore(search.store, (s) => s.text);
  const label = useUniqueId();
  return (
    <div
      data-library-search=""
      className="zt:ps-(--zt-query-toolbar-inset-start) zt:pe-(--zt-query-toolbar-inset-end) zt:pt-(--size-4-2)"
    >
      <span id={label} className="zt:sr-only">
        {m.library_view_search_label()}
      </span>
      <SearchInput
        ref={(input) => {
          search.input = input;
        }}
        // Escape clears the box here, not the browser's own clear, so the
        // view lists the tree node again at once.
        type="text"
        aria-labelledby={label}
        className="zt:w-full"
        value={text}
        placeholder={m.library_view_search_placeholder()}
        clearLabel={m.library_view_search_clear()}
        onChange={(next) => search.type(next)}
        onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
          if (event.key !== "Escape" || text === "") return;
          event.preventDefault();
          event.stopPropagation();
          search.clear();
        }}
      />
    </div>
  );
}

function SearchSummary({
  search,
  query,
  selection,
  fallback,
}: {
  search: LibrarySearch;
  query: StoreApi<QueryViewState>;
  selection: string;
  fallback: ReactNode;
}) {
  const text = useStore(search.store, (s) => s.text);
  const everywhere = useStore(search.store, (s) => s.everywhere);
  const matched = useStore(query, (s) => s.results?.matched ?? null);
  if (text.trim() === "") return fallback;
  if (matched === null) return selection;
  // Recent reads every Library of the Library Scope already.
  if (search.onRecent)
    return m.library_view_search_matches({ selection, count: matched });
  if (everywhere)
    return m.library_view_search_matches_everywhere({ count: matched });
  const widen = () => search.widen();
  return (
    <>
      {m.library_view_search_matches({ selection, count: matched })}
      <span aria-hidden="true"> · </span>
      <span
        role="button"
        tabIndex={0}
        data-library-search-all=""
        className="zt:cursor-(--cursor) zt:font-(--font-normal) zt:text-(--text-accent) zt:hover:text-(--text-accent-hover)"
        onClick={widen}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          widen();
        }}
      >
        {m.library_view_search_everywhere()}
      </span>
    </>
  );
}
