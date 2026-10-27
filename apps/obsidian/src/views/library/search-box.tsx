// The search box of the Library View, its front door: the words go to the
// worker search, ranked as the quick switcher ranks, over the Library of the
// tree node or over every Library in the Library Scope; the host lists the
// Indexed Keys it found in that order. Escape clears the search, and the
// view lists the tree node again.
//
// @see apps/obsidian/docs/adr/0073-search-enters-the-library-view-as-an-ordered-key-set.md
import { Component } from "obsidian";
import { useSyncExternalStore } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";

import { useUniqueId } from "@zotlit/ui";

import { SearchInput } from "@/components/obsidian/search-input";
import * as m from "@/lib/i18n/generated/messages";
import { ViewRegistryProvider } from "@/lib/view-atoms";
import type { ViewRegistryHandle } from "@/lib/view-atoms";
import type {
  LibraryScope,
  LibrarySelector,
} from "@/services/library-scope/scope";
import type { QueryView } from "@/views/query-view/view";

import type { LibraryNode } from "./document";
import type { HeaderSearch } from "./heading";
import { waitForRead } from "./model";
import {
  makeSearchModel,
  patchSearch,
  SearchModelProvider,
  useSearchState,
} from "./search-model";
import type { SearchSession } from "./search-model";
import { TextAction } from "./text-action";
import { TreeModelProvider, useTreeState } from "./tree-model";
import type { TreeModel } from "./tree-model";

export interface LibrarySearchDeps {
  registry: ViewRegistryHandle;
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
  /** The Library Scope in force, which Recent reads. */
  scope: () => LibraryScope;
  /** List what the search found. */
  found: (found: SearchFound) => void;
  /** The researcher changed the text: keep it. */
  keep: (text: string) => void;
}

export class LibrarySearch extends Component {
  readonly model = makeSearchModel();
  readonly registry;
  readonly #host;
  #release: (() => void) | null;
  #active = false;
  #lastFound: SearchFound | null = null;
  readonly #waiting = new Set<() => void>();
  #input: HTMLInputElement | null = null;
  #roots: Root[] = [];

  constructor(deps: LibrarySearchDeps, host: LibrarySearchHost) {
    super();
    this.registry = deps.registry;
    this.#host = host;
    this.#release = this.registry.mount(this.model.session);
  }
  get state() {
    return this.registry.get(this.model.session);
  }
  #patch(patch: Partial<SearchSession>): void {
    this.registry.update(this.model.session, patchSearch(patch));
  }

  /** Settles once the newest search listed its hits. Never rejects. */
  get settled(): Promise<void> {
    return this.#active
      ? waitForRead(this.registry, this.model.loaded, this.#waiting).then(
          () => {
            if (this.#active)
              this.#publish(this.registry.get(this.model.found));
          },
        )
      : Promise.resolve();
  }

  #publish(found: SearchFound | null): void {
    if (found && found !== this.#lastFound) {
      this.#lastFound = found;
      this.#host.found(found);
    }
  }

  override onload(): void {
    this.#active = true;
    this.#release ??= this.registry.mount(this.model.session);
    this.register(
      this.registry.subscribe(this.model.found, (found) => {
        this.#publish(found);
      }),
    );
    this.register(() => {
      this.#release?.();
      this.#release = null;
    });
  }

  override onunload(): void {
    this.#active = false;
    for (const finish of this.#waiting) finish();
    for (const root of this.#roots) root.unmount();
    this.#roots = [];
  }

  /** Show `text` as the search, and list what it finds. */
  open(text: string): Promise<void> {
    this.#patch({ text });
    return this.run();
  }

  /** The researcher typed `text`. */
  type(text: string): void {
    this.#patch({ text, everywhere: this.#everywhere(text) });
    this.#host.keep(text);
    void this.run();
  }

  /** Clear the search, and list the tree node again. */
  clear(): void {
    this.type("");
  }

  /** Search every Library in the Library Scope, past the tree node. */
  widen(): void {
    this.#patch({ everywhere: true });
    void this.run();
  }

  /** Keep the search to the tree node again, as after a tree selection. */
  narrow(): void {
    this.#patch({ everywhere: false });
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
    return text.trim() !== "" && this.state.everywhere;
  }

  /** Search again, and list the hits once no newer search started. */
  run(): Promise<void> {
    this.#patch({
      request: { node: this.#host.node(), scope: this.#host.scope() },
    });
    return this.settled;
  }

  /** Draw the search box into `el`. */
  render(el: HTMLElement): void {
    const root = createRoot(el);
    root.render(
      <ViewRegistryProvider registry={this.registry}>
        <SearchModelProvider value={this.model}>
          <SearchBox search={this} />
        </SearchModelProvider>
      </ViewRegistryProvider>,
    );
    this.#roots.push(root);
  }

  /**
   * What the search puts in the heading: its title and its status, where it
   * searches, and the offer to search all libraries while some match.
   */
  header(query: QueryView["state"]): HeaderSearch {
    const subscribe = (listener: () => void) => {
      const offText = this.registry.subscribe(this.model.session, listener);
      const offQuery = query.subscribe(listener);
      return () => {
        offText();
        offQuery();
      };
    };
    const header: HeaderSearch = {
      subscribe,
      summary: (selection) => {
        const shown = this.#shown(query);
        if (!shown || shown.matched === null) return null;
        if (shown.everywhere && !this.onRecent)
          return m.library_view_search_matches_everywhere({
            count: shown.matched,
          });
        return m.library_view_search_matches({
          selection,
          count: shown.matched,
        });
      },
      title: () => {
        const shown = this.#shown(query);
        if (!shown || shown.matched === null) return null;
        return m.library_view_heading_search({
          count: shown.matched,
          query: this.state.text.trim(),
        });
      },
      everywhere: () => {
        const shown = this.#shown(query);
        return shown !== null && shown.everywhere && !this.onRecent;
      },
      action: (
        <SearchAllButton
          search={this}
          subscribe={subscribe}
          offered={() => {
            const shown = this.#shown(query);
            return (
              shown !== null &&
              !shown.everywhere &&
              !this.onRecent &&
              shown.matched !== 0
            );
          }}
        />
      ),
    };
    return header;
  }

  /**
   * The search on screen and the count it matched, `null` while unknown;
   * `null` itself while the box is empty.
   */
  #shown(
    query: QueryView["state"],
  ): { everywhere: boolean; matched: number | null } | null {
    const { text, everywhere } = this.state;
    if (text.trim() === "") return null;
    return {
      everywhere,
      matched: query.getState().results?.matched ?? null,
    };
  }

  /**
   * What an empty list says left it empty: the search, with the offer to
   * search all libraries or to clear it, else the facets that are on or the
   * tags selected, else
   * `fallback`, the Query View's own sentence.
   */
  empty(tree: TreeModel, fallback: string): ReactNode {
    return (
      <ViewRegistryProvider registry={this.registry}>
        <SearchModelProvider value={this.model}>
          <TreeModelProvider value={tree}>
            <EmptyList search={this} fallback={fallback} />
          </TreeModelProvider>
        </SearchModelProvider>
      </ViewRegistryProvider>
    );
  }

  /** @internal The box's input, for {@link focus}. */
  set input(input: HTMLInputElement | null) {
    this.#input = input;
  }
}

function SearchBox({ search }: { search: LibrarySearch }) {
  const text = useSearchState((s) => s.text);
  const label = useUniqueId();
  return (
    <div data-library-search="">
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

function EmptyList({
  search,
  fallback,
}: {
  search: LibrarySearch;
  fallback: string;
}) {
  const text = useSearchState((s) => s.text.trim());
  const everywhere = useSearchState((s) => s.everywhere);
  const filters = useTreeState((s) => s.facets.length + s.tags.length);
  if (text === "")
    return filters === 0 ? (
      fallback
    ) : (
      <p className="zt:m-0" data-library-empty="">
        {m.library_view_empty_facets()}
      </p>
    );
  // Recent reads every Library of the Library Scope already.
  const widen = !everywhere && !search.onRecent;
  // The heading says nothing matched; the list says how to recover. Muted,
  // not the faint of an empty pane, so the hint reads at 4.5:1.
  return (
    <div className="zt:flex zt:flex-col zt:items-center zt:gap-(--size-4-2) zt:text-muted-foreground">
      <p className="zt:m-0 zt:text-balance" data-library-empty="">
        {widen
          ? m.library_view_empty_search_widen()
          : m.library_view_empty_search_clear()}
      </p>
      <TextAction
        data-library-empty-action={widen ? "widen" : "clear"}
        onActivate={() => (widen ? search.widen() : search.clear())}
      >
        {widen
          ? m.library_view_search_everywhere()
          : m.library_view_search_clear()}
      </TextAction>
    </div>
  );
}

/**
 * The offer to search all libraries, beside the header, while a search
 * keeps to a Library or a Collection and finds something there: an empty
 * list makes the same offer itself. Recent reads every Library of the
 * Library Scope already.
 */
function SearchAllButton({
  search,
  subscribe,
  offered,
}: {
  search: LibrarySearch;
  subscribe: HeaderSearch["subscribe"];
  /** Whether the search on screen keeps to the node and finds something there. */
  offered: () => boolean;
}) {
  if (!useSyncExternalStore(subscribe, offered)) return null;
  return (
    <TextAction
      data-library-search-all=""
      className="zt:shrink-0 zt:group-data-zotero-missing:hidden"
      onActivate={() => search.widen()}
    >
      {m.library_view_search_everywhere()}
    </TextAction>
  );
}
