// PROTOTYPE (proto/view-reactivity) — throwaway. A dev-only ItemView that
// renders the same mini Cited By through three state bridges. Switching tabs
// unmounts the previous tree, so each switch is a teardown test.
//
// The class is the Obsidian adapter of the Atom shape: it owns the leaf's view
// model and answers Obsidian's synchronous calls (getState/setState, ephemeral
// state, Scope keys, header action, pane menu) through registry.get/set.
import { ItemView, Scope, setIcon } from "obsidian";
import type { Menu, ViewStateResult, WorkspaceLeaf } from "obsidian";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";

import { AtomTab } from "./atom-tab";
import type { ViewRegistryHandle } from "./edge";
import { JotaiTab } from "./jotai-tab";
import { DebugStrip } from "./panel";
import { labProbe } from "./source";
import {
  LabViewModelContext,
  holdViewModel,
  makeLabViewModel,
  readSavedLayout,
} from "./view-model";
import type { LabSort } from "./view-model";
import { ZustandTab } from "./zustand-tab";
import type { LabRuntime } from "./zustand-tab";

export const REACTIVITY_LAB_VIEW_TYPE = "zotlit-reactivity-lab";

export interface ReactivityLabDeps {
  readonly runtime: LabRuntime;
  /** The plugin-lifetime registry every Atom root shares. */
  readonly registry: ViewRegistryHandle;
}

type Tab = "atom" | "zustand" | "jotai" | "none";

function Lab(props: { readonly deps: ReactivityLabDeps }) {
  const [tab, setTab] = useState<Tab>("atom");
  const choose = (next: Tab) => {
    labProbe.note(`tab ${tab} → ${next}`);
    setTab(next);
  };
  return (
    <div style={{ padding: 8 }}>
      <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
        {(["atom", "zustand", "jotai", "none"] as const).map((name) => (
          <button
            key={name}
            style={{ fontWeight: name === tab ? "bold" : undefined }}
            onClick={() => choose(name)}
          >
            {name}
          </button>
        ))}
      </div>
      <DebugStrip />
      {tab === "atom" && <AtomTab registry={props.deps.registry} />}
      {tab === "zustand" && <ZustandTab runtime={props.deps.runtime} />}
      {tab === "jotai" && <JotaiTab runtime={props.deps.runtime} />}
    </div>
  );
}

const nextSort = (sort: LabSort): LabSort =>
  sort === "path" ? "count" : "path";

export class ReactivityLabView extends ItemView {
  readonly model = makeLabViewModel();
  readonly #registry: ViewRegistryHandle;
  // Held from construction: Obsidian may call setState before onOpen, and an
  // unmounted atom loses its value once the registry's idle TTL passes.
  readonly #releaseModel: () => void;
  #root: Root | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    readonly deps: ReactivityLabDeps,
  ) {
    super(leaf);
    this.#registry = deps.registry;
    this.#releaseModel = holdViewModel(this.#registry, this.model);
    // View-level keys: Obsidian hands each key to the active leaf's Scope.
    this.scope = new Scope(this.app.scope);
    this.scope.register(["Mod", "Shift"], "s", () => {
      this.#toggleSort();
      return false;
    });
  }

  override getViewType() {
    return REACTIVITY_LAB_VIEW_TYPE;
  }

  override getDisplayText() {
    return "Reactivity lab (prototype)";
  }

  override getIcon() {
    return "flask-conical";
  }

  // --- Saved state: the workspace layout ---------------------------------

  override getState(): Record<string, unknown> {
    return { ...super.getState(), ...this.#registry.get(this.model.layout) };
  }

  override async setState(
    state: unknown,
    result: ViewStateResult,
  ): Promise<void> {
    await super.setState(state, result);
    const saved = readSavedLayout(state);
    this.#registry.update(this.model.layout, (layout) => ({
      ...layout,
      ...saved,
    }));
  }

  // --- Ephemeral state: DOM-owned, so read from the DOM ------------------

  override getEphemeralState(): Record<string, unknown> {
    return { scrollTop: this.contentEl.scrollTop };
  }

  override setEphemeralState(state: unknown): void {
    const scrollTop = (state as { scrollTop?: unknown } | null)?.scrollTop;
    if (typeof scrollTop === "number") this.contentEl.scrollTop = scrollTop;
  }

  // --- Pane menu: read the model synchronously, write it on click --------

  override onPaneMenu(menu: Menu, source: string): void {
    super.onPaneMenu(menu, source);
    const { sort, search } = this.#registry.get(this.model.layout);
    menu.addItem((item) =>
      item
        .setTitle("Sort by citations")
        .setChecked(sort === "count")
        .onClick(() => this.#toggleSort()),
    );
    menu.addItem((item) =>
      item
        .setTitle("Clear filter")
        .setDisabled(search === "")
        .onClick(() =>
          this.#registry.update(this.model.layout, (layout) => ({
            ...layout,
            search: "",
          })),
        ),
    );
  }

  #toggleSort() {
    this.#registry.update(this.model.layout, (layout) => ({
      ...layout,
      sort: nextSort(layout.sort),
    }));
  }

  protected override async onOpen() {
    // Header action: click writes the model; the icon follows the model.
    const sortAction = this.addAction("arrow-down-wide-narrow", "Sort", () =>
      this.#toggleSort(),
    );
    this.register(
      this.#registry.subscribe(
        this.model.layout,
        (layout) => {
          setIcon(
            sortAction,
            layout.sort === "count" ? "arrow-down-1-0" : "arrow-down-a-z",
          );
          sortAction.setAttr("aria-label", `Sort: ${layout.sort}`);
        },
        { immediate: true },
      ),
    );
    // A saved field changed: ask Obsidian to save the layout.
    this.register(
      this.#registry.subscribe(this.model.layout, () =>
        this.app.workspace.requestSaveLayout(),
      ),
    );
    this.#root = createRoot(this.contentEl);
    this.#root.render(
      <LabViewModelContext value={this.model}>
        <Lab deps={this.deps} />
      </LabViewModelContext>,
    );
    labProbe.note("view open");
  }

  protected override async onClose() {
    this.#root?.unmount();
    this.#root = null;
    this.#releaseModel();
    labProbe.note("view close");
  }
}
