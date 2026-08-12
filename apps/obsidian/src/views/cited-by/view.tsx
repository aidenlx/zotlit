// ItemView shell for the Cited By Sidebar: follows the active Literature Note.
import { ItemView } from "obsidian";
import type { App, TFile, ViewStateResult, WorkspaceLeaf } from "obsidian";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";

import * as m from "@/lib/i18n/generated/messages";
import type { CitationIndex } from "@/services/citation-index/service";
import { itemKeyFromFrontmatter } from "@/services/note-index/parse";

import { CitedByActionsContext, createCitedByActions } from "./actions";
import type { CitedByActions } from "./actions";
import { CitedBy } from "./CitedBy";
import {
  createCitedByStore,
  CitedByStoreProvider,
  EMPTY_CITED_BY_SNAPSHOT,
  isCitedBySortMode,
} from "./store";
import type { CitedByState } from "./store";

export const CITED_BY_VIEW_TYPE = "zotlit-cited-by";

export interface CitedByViewDeps {
  app: App;
  citationIndex: Pick<CitationIndex, "observeCitedBy">;
}

export class CitedByView extends ItemView {
  readonly #store = createCitedByStore();
  readonly #deps: CitedByViewDeps;
  readonly #actions: CitedByActions;
  #root: Root | null = null;
  #stopObserving: (() => void) | null = null;
  #indexedKey: string | null = null;

  constructor(leaf: WorkspaceLeaf, deps: CitedByViewDeps) {
    super(leaf);
    this.contentEl.addClass("zt-root", "zt-cited-by-view");
    this.#deps = deps;
    this.#actions = createCitedByActions({ app: deps.app, store: this.#store });
  }

  override getViewType(): string {
    return CITED_BY_VIEW_TYPE;
  }

  override getDisplayText(): string {
    return m.cited_by_view_name();
  }

  override getIcon(): string {
    return "file-input";
  }

  /**
   * The controls the workspace layout carries: the search field and its query,
   * the Show more context mode, and the sort mode. Per-group collapse and
   * manual excerpt expansions stay in memory, so they never appear here.
   */
  override getState(): Record<string, unknown> {
    return { ...layoutState(this.#store.getState()) };
  }

  override async setState(
    state: unknown,
    result: ViewStateResult,
  ): Promise<void> {
    await super.setState(state, result);
    if (!state || typeof state !== "object") return;
    const { search, searchVisible, moreContext, sort } = state as Record<
      string,
      unknown
    >;
    this.#store.setState({
      ...(typeof searchVisible === "boolean" && { searchVisible }),
      ...(typeof search === "string" && { search }),
      ...(typeof moreContext === "boolean" && { moreContext }),
      ...(isCitedBySortMode(sort) && { sort }),
    });
  }

  protected override async onOpen(): Promise<void> {
    this.#root = createRoot(this.contentEl);
    this.#root.render(
      <CitedByStoreProvider value={this.#store}>
        <CitedByActionsContext value={this.#actions}>
          <CitedBy />
        </CitedByActionsContext>
      </CitedByStoreProvider>,
    );

    // Nothing else touches the layout when a control changes, so the view asks
    // for the save that carries its controls across a restart.
    this.register(
      this.#store.subscribe((state, previous) => {
        if (sameLayoutState(state, previous)) return;
        this.#deps.app.workspace.requestSaveLayout();
      }),
    );

    this.registerEvent(
      this.#deps.app.workspace.on("active-leaf-change", () =>
        this.#followActiveNote(),
      ),
    );
    this.registerEvent(
      this.#deps.app.metadataCache.on("changed", (file) => {
        this.#actions.invalidatePreview(file.path);
        if (file.path === this.#deps.app.workspace.getActiveFile()?.path) {
          this.#followActiveNote();
        }
      }),
    );
    this.registerEvent(
      this.#deps.app.vault.on("rename", (file, oldPath) => {
        this.#actions.invalidatePreview(oldPath);
        this.#actions.invalidatePreview(file.path);
        if (file === this.#deps.app.workspace.getActiveFile()) {
          this.#followActiveNote();
        }
      }),
    );
    this.registerEvent(
      this.#deps.app.vault.on("delete", (file) => {
        this.#actions.invalidatePreview(file.path);
        if (file === this.#deps.app.workspace.getActiveFile()) {
          this.#followActiveNote(null);
        }
      }),
    );
    this.#followActiveNote();
  }

  protected override async onClose(): Promise<void> {
    this.#stopObserving?.();
    this.#stopObserving = null;
    this.#root?.unmount();
    this.#root = null;
  }

  #followActiveNote(
    file: TFile | null = this.#deps.app.workspace.getActiveFile(),
  ): void {
    this.#stopObserving?.();
    this.#stopObserving = null;
    this.#indexedKey =
      file?.extension === "md"
        ? itemKeyFromFrontmatter(
            this.#deps.app.metadataCache.getFileCache(file),
          )
        : null;
    this.#store.setState({
      indexedKey: this.#indexedKey,
      activePath: file?.path ?? null,
      snapshot: EMPTY_CITED_BY_SNAPSHOT,
      collapsed: [],
      expansions: {},
    });
    if (!this.#indexedKey) return;

    const indexedKey = this.#indexedKey;
    this.#stopObserving = this.#deps.citationIndex.observeCitedBy(
      indexedKey,
      (snapshot) => {
        if (this.#indexedKey !== indexedKey) return;
        this.#store.setState({ snapshot });
      },
    );
  }
}

/** The state the workspace layout holds; everything else lives one session. */
const LAYOUT_KEYS = ["searchVisible", "search", "moreContext", "sort"] as const;

type CitedByLayoutState = Pick<CitedByState, (typeof LAYOUT_KEYS)[number]>;

function layoutState(state: CitedByState): CitedByLayoutState {
  const { searchVisible, search, moreContext, sort } = state;
  return { searchVisible, search, moreContext, sort };
}

function sameLayoutState(a: CitedByState, b: CitedByState): boolean {
  return LAYOUT_KEYS.every((key) => a[key] === b[key]);
}
