// Native graph bookmarks carry per-view options; local graph bookmarks also carry their source file.

import type { App, GraphBookmarks, LocalGraphView } from "obsidian";

import { registerEvent } from "@/lib/disposables";
import * as m from "@/lib/i18n/generated/messages";

import { graphEngineOf, membersPresent, wrapMember } from "./install";

const LOCAL_FILE = "zotlit-local-file";

export function installGraphBookmarks(
  app: App,
  enabled: () => boolean,
): Disposable {
  using stack = new DisposableStack();
  const bookmarks = app.internalPlugins.getEnabledPluginById(
    "bookmarks",
  ) as GraphBookmarks | null;
  if (!bookmarks) return stack.move();
  if (
    !membersPresent(
      "Graph bookmark integration unavailable",
      {
        "bookmarks.addItem": typeof bookmarks.addItem === "function",
        "bookmarks.openBookmarkInLeaf":
          typeof bookmarks.openBookmarkInLeaf === "function",
      },
      {},
    )
  )
    return stack.move();
  stack.use(
    wrapMember(
      bookmarks,
      "openBookmarkInLeaf",
      (native) => async (item, leaf, state) => {
        if (
          item.type !== "graph" ||
          !item.options ||
          (!enabled() && typeof item.options[LOCAL_FILE] !== "string")
        ) {
          return native.call(bookmarks, item, leaf, state);
        }
        const file = item.options[LOCAL_FILE];
        await leaf.setViewState({
          type: typeof file === "string" ? "localgraph" : "graph",
          state: {
            options: structuredClone(item.options),
            ...(typeof file === "string" ? { file } : {}),
          },
        });
      },
    ),
  );
  stack.use(
    registerEvent(
      app.workspace.on("leaf-menu", (menu, leaf) => {
        if (!enabled() || leaf.view.getViewType() !== "localgraph") return;
        const view = leaf.view as LocalGraphView;
        const file = view.file;
        const engine = graphEngineOf(leaf);
        if (!file || !engine?.getOptions) return;
        menu.addItem((item) =>
          item
            .setSection("zotlit")
            .setTitle(m.graph_citations_bookmark_local())
            .setIcon("bookmark")
            .onClick(() =>
              bookmarks.addItem({
                type: "graph",
                title: view.getDisplayText(),
                ctime: Temporal.Now.instant().epochMilliseconds,
                options: {
                  ...structuredClone(engine.getOptions!()),
                  [LOCAL_FILE]: file.path,
                },
              }),
            ),
        );
      }),
    ),
  );
  return stack.move();
}
