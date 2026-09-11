// Per-view graph options: restore before rendering, serialize with the leaf, and keep global defaults independent.

import type {
  App,
  GraphEngine,
  GraphOptions,
  GraphView,
  View,
  WorkspaceLeaf,
} from "obsidian";

import { CITATION_POPOVER, COLOR_CITATION_LINKS } from "./display";
import {
  CITATION_CONNECTED_ONLY,
  PANDOC_CITATIONS,
  WIKILINK_CITATIONS,
} from "./filters";
import { membersPresent, wrapMember } from "./install";

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
  return wrapMember(
    registry!,
    "getViewCreatorByType",
    (getCreator) => (type) => {
      const creator = getCreator.call(registry, type);
      if (!creator || (type !== "graph" && type !== "localgraph"))
        return creator;
      return (leaf) => {
        const view = creator(leaf);
        created(leaf, view);
        return view;
      };
    },
  );
}

export function installGraphViewState(
  view: View,
  engine: GraphEngine,
): Disposable {
  using stack = new DisposableStack();
  if (
    !membersPresent(
      "Graph view state unavailable; options remain native",
      {
        "view.getState": typeof view.getState === "function",
        "view.setState": typeof view.setState === "function",
        "engine.getOptions": typeof engine.getOptions === "function",
        "engine.setOptions": typeof engine.setOptions === "function",
      },
      { viewType: view.getViewType() },
    )
  )
    return stack.move();
  stack.use(
    wrapMember(view, "getState", (native) => () => {
      return {
        ...native.call(view),
        options: structuredClone(engine.getOptions!()),
      };
    }),
  );
  stack.use(
    wrapMember(view, "setState", (native) => async (state, result) => {
      const options = (state as { options?: GraphOptions } | null)?.options;
      if (options) {
        engine.setOptions!({
          [COLOR_CITATION_LINKS]: false,
          [CITATION_POPOVER]: false,
          ...options,
        });
      }
      await native.call(view, state, result);
    }),
  );
  if (view.getViewType() === "graph") {
    const graph = view as GraphView;
    if (typeof graph.onload === "function") {
      stack.use(
        wrapMember(graph, "onload", (native) => () => {
          native.call(graph);
          engine.setOptions!({
            [COLOR_CITATION_LINKS]: false,
            [CITATION_POPOVER]: false,
            [CITATION_CONNECTED_ONLY]: false,
            [PANDOC_CITATIONS]: true,
            [WIKILINK_CITATIONS]: true,
          });
        }),
      );
    }
    if (typeof graph.onOptionsChange === "function") {
      stack.use(
        wrapMember(graph, "onOptionsChange", () => () => {
          view.app.workspace.requestSaveLayout();
        }),
      );
    }
  }
  return stack.move();
}
