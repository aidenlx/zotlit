// ItemView shell for the Cited By Sidebar: follows the active Literature Note.
import { ItemView } from "obsidian";
import type { App, ViewStateResult, WorkspaceLeaf } from "obsidian";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";

import * as m from "@/lib/i18n/generated/messages";
import { ViewRegistryProvider } from "@/lib/view-atoms";
import type { ViewRegistryHandle } from "@/lib/view-atoms";
import { activeKeyAtom } from "@/services/note-index/atoms";

import { revisionsAtom } from "./atoms";
import { CitedBy } from "./CitedBy";
import {
  CitedByModelContext,
  dropExpansions,
  EMPTY_CITED_BY_NOTE_STATE,
  holdCitedByModel,
  makeCitedByModel,
  readSavedLayout,
} from "./model";
import type { CitedByLayout } from "./model";

export const CITED_BY_VIEW_TYPE = "zotlit-cited-by";

export interface CitedByViewDeps {
  app: App;
  /** The plugin's view registry: the followed note, its Cited By and previews. */
  registry: ViewRegistryHandle;
}

export class CitedByView extends ItemView {
  readonly #deps: CitedByViewDeps;
  readonly #model = makeCitedByModel();
  #release: (() => void) | null;
  #root: Root | null = null;

  constructor(leaf: WorkspaceLeaf, deps: CitedByViewDeps) {
    super(leaf);
    this.contentEl.addClass("zt-root", "zt-cited-by-view");
    this.#deps = deps;
    // Obsidian sets the layout state before the view opens.
    this.#release = holdCitedByModel(deps.registry, this.#model);
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
    return { ...this.#deps.registry.get(this.#model.layout) };
  }

  override async setState(
    state: unknown,
    result: ViewStateResult,
  ): Promise<void> {
    await super.setState(state, result);
    const saved = readSavedLayout(state);
    this.#deps.registry.update(this.#model.layout, (layout) => ({
      ...layout,
      ...saved,
    }));
  }

  protected override async onOpen(): Promise<void> {
    const { app, registry } = this.#deps;
    this.#release ??= holdCitedByModel(registry, this.#model);
    this.#root = createRoot(this.contentEl);
    this.#root.render(
      <ViewRegistryProvider registry={registry}>
        <CitedByModelContext value={this.#model}>
          <CitedBy />
        </CitedByModelContext>
      </ViewRegistryProvider>,
    );

    // Nothing else touches the layout when a control changes, so the view asks
    // for the save that carries its controls across a restart.
    let saved = registry.get(this.#model.layout);
    this.register(
      registry.subscribe(this.#model.layout, (layout) => {
        if (sameLayout(layout, saved)) return;
        saved = layout;
        app.workspace.requestSaveLayout();
      }),
    );
    // Collapse and excerpt expansions belong to one Literature Note's Item.
    this.register(
      registry.subscribe(activeKeyAtom, () =>
        registry.set(this.#model.note, EMPTY_CITED_BY_NOTE_STATE),
      ),
    );
    // An expansion holds offsets into the source it was made from, so a note
    // that changed drops its expansions.
    let revisions = registry.get(revisionsAtom);
    this.register(
      registry.subscribe(revisionsAtom, (next) => {
        const changed = Object.keys(next).filter(
          (path) => next[path] !== revisions[path],
        );
        revisions = next;
        if (changed.length > 0) {
          registry.update(this.#model.note, dropExpansions(changed));
        }
      }),
    );
  }

  protected override async onClose(): Promise<void> {
    this.#root?.unmount();
    this.#root = null;
    this.#release?.();
    this.#release = null;
  }
}

/** The state the workspace layout holds; everything else lives one session. */
const LAYOUT_KEYS = ["searchVisible", "search", "moreContext", "sort"] as const;

function sameLayout(a: CitedByLayout, b: CitedByLayout): boolean {
  return LAYOUT_KEYS.every((key) => a[key] === b[key]);
}
