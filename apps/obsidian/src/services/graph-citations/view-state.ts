// Per-view graph options: restore before rendering, serialize with the leaf, and keep global defaults independent.

import { around } from "monkey-around";
import type {
  App,
  GraphEngine,
  GraphOptions,
  GraphView,
  View,
  WorkspaceLeaf,
} from "obsidian";

import { disposable } from "@/lib/disposables";

import { CITATION_POPOVER, COLOR_CITATION_LINKS } from "./display";
import {
  CITATION_CONNECTED_ONLY,
  PANDOC_CITATIONS,
  WIKILINK_CITATIONS,
} from "./filters";
import { membersPresent } from "./install";

/** Installs before `load` / `setState`, so bookmark options find their controls. */
export function installGraphViewCreation(
  app: App,
  created: (leaf: WorkspaceLeaf, view: View) => void,
): Disposable {
  const registry = app.viewRegistry;
  if (
    !membersPresent(
      "Graph view factory unavailable; new views install on layout change",
      {
        "viewRegistry.getViewCreatorByType":
          typeof registry?.getViewCreatorByType === "function",
      },
      {},
    )
  )
    return new DisposableStack();
  return disposable(
    around(registry!, {
      getViewCreatorByType: (getCreator) => (type) => {
        const creator = getCreator.call(registry, type);
        if (!creator || (type !== "graph" && type !== "localgraph"))
          return creator;
        return (leaf) => {
          const view = creator(leaf);
          created(leaf, view);
          return view;
        };
      },
    }),
  );
}

/** Local graphs already persist options through their native view state. */
export function installGraphViewState(
  view: View,
  engine: GraphEngine,
): Disposable {
  if (view.getViewType() !== "graph") return new DisposableStack();
  const graph = view as GraphView;
  if (
    !membersPresent(
      "Graph view state unavailable; options remain native",
      {
        "view.getState": typeof graph.getState === "function",
        "view.setState": typeof graph.setState === "function",
        "view.onload": typeof graph.onload === "function",
        "view.onOptionsChange": typeof graph.onOptionsChange === "function",
        "engine.getOptions": typeof engine.getOptions === "function",
        "engine.setOptions": typeof engine.setOptions === "function",
      },
      {},
    )
  )
    return new DisposableStack();

  return disposable(
    around(graph, {
      getState: (native) =>
        function (this: GraphView) {
          return {
            ...native.call(this),
            options: structuredClone(engine.getOptions!()),
          };
        },
      setState: (native) =>
        function (this: GraphView, state, result) {
          const options = (state as { options?: GraphOptions } | null)?.options;
          if (options)
            engine.setOptions!({
              [COLOR_CITATION_LINKS]: false,
              [CITATION_POPOVER]: false,
              ...options,
            });
          return native.call(this, state, result);
        },
      onload: (native) =>
        function (this: GraphView) {
          native.call(this);
          // Old core-plugin data can contain ZotLit choices from earlier versions.
          engine.setOptions!({
            [COLOR_CITATION_LINKS]: false,
            [CITATION_POPOVER]: false,
            [CITATION_CONNECTED_ONLY]: false,
            [PANDOC_CITATIONS]: true,
            [WIKILINK_CITATIONS]: true,
          });
        },
      // Native persistence writes shared defaults, including the shortcut's groups
      // and filters. Keep all choices with this view instead.
      onOptionsChange: () =>
        function (this: GraphView) {
          this.app.workspace.requestSaveLayout();
        },
    }),
  );
}
