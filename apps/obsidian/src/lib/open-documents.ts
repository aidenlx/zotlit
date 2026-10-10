// The documents open in the workspace, for an owner that keeps per-document state only while one is.
import { MarkdownView } from "obsidian";
import type { App } from "obsidian";

import { registerEvent } from "@/lib/disposables";

export interface OpenDocuments {
  /** Vault paths shown in at least one Markdown leaf. */
  paths(): ReadonlySet<string>;
  /** Calls `changed` whenever {@link paths} may answer differently. */
  subscribe(changed: () => void): Disposable;
}

/**
 * Open documents as the workspace reports them. A deferred background tab
 * counts once its view loads, which is also when it first asks for anything.
 */
export function workspaceOpenDocuments(app: App): OpenDocuments {
  return {
    paths() {
      const open = new Set<string>();
      for (const leaf of app.workspace.getLeavesOfType("markdown")) {
        const { view } = leaf;
        if (view instanceof MarkdownView && view.file) open.add(view.file.path);
      }
      return open;
    },
    subscribe(changed) {
      const stack = new DisposableStack();
      stack.use(registerEvent(app.workspace.on("layout-change", changed)));
      stack.use(registerEvent(app.workspace.on("file-open", () => changed())));
      // A rename moves an open document to a new path without a layout change.
      stack.use(registerEvent(app.vault.on("rename", () => changed())));
      return stack;
    },
  };
}
