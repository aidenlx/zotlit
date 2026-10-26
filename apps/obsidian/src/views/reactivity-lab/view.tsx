// PROTOTYPE (proto/view-reactivity) — throwaway. A dev-only ItemView that
// renders the same mini Cited By through three state bridges. Switching tabs
// unmounts the previous tree, so each switch is a teardown test.
import type { ManagedRuntime } from "effect";
import type * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { ItemView } from "obsidian";
import type { WorkspaceLeaf } from "obsidian";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";

import { AtomTab } from "./atom-tab";
import { JotaiTab } from "./jotai-tab";
import { DebugStrip } from "./panel";
import { labProbe } from "./source";
import type { LabServices } from "./source";
import { ZustandTab } from "./zustand-tab";

export const REACTIVITY_LAB_VIEW_TYPE = "zotlit-reactivity-lab";

export interface ReactivityLabDeps {
  readonly runtime: Pick<
    ManagedRuntime.ManagedRuntime<LabServices, never>,
    "runSync" | "runFork" | "runPromiseExit" | "scope"
  >;
  /** The plugin-lifetime registry every Atom root shares. */
  readonly registry: AtomRegistry.AtomRegistry;
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

export class ReactivityLabView extends ItemView {
  #root: Root | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    readonly deps: ReactivityLabDeps,
  ) {
    super(leaf);
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

  protected override async onOpen() {
    this.#root = createRoot(this.contentEl);
    this.#root.render(<Lab deps={this.deps} />);
    labProbe.note("view open");
  }

  protected override async onClose() {
    this.#root?.unmount();
    this.#root = null;
    labProbe.note("view close");
  }
}
