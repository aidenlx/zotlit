// The tabs the researcher was in, newest first, so a Library View row can
// cite into the last one while its own tab is active and Obsidian names no
// active editor.
import { MarkdownView } from "obsidian";
import type { EventRef, MarkdownFileInfo, WorkspaceLeaf } from "obsidian";
import type { Workspace } from "obsidian";

export class LastNote implements Disposable {
  readonly #workspace: Workspace;
  readonly #ref: EventRef;
  /**
   * The leaves that became active, newest first. What each shows is read on
   * each ask: a new tab is active before it opens its note.
   */
  #leaves: WorkspaceLeaf[] = [];

  constructor(workspace: Workspace) {
    this.#workspace = workspace;
    this.#ref = workspace.on("active-leaf-change", (leaf) => this.#enter(leaf));
    workspace.onLayoutReady(() => this.#enter(workspace.getMostRecentLeaf()));
  }

  /**
   * The note active last that is still open and shows an editor, in Source
   * mode or Live Preview; `null` where none does.
   */
  editor(): MarkdownFileInfo | null {
    const open = new Set<WorkspaceLeaf>();
    // A callback that returns a truthy value stops the iteration.
    this.#workspace.iterateAllLeaves((leaf) => {
      open.add(leaf);
    });
    this.#leaves = this.#leaves.filter((leaf) => open.has(leaf));
    for (const { view } of this.#leaves)
      if (view instanceof MarkdownView && view.getMode() === "source")
        return view;
    return null;
  }

  #enter(leaf: WorkspaceLeaf | null): void {
    if (!leaf) return;
    this.#leaves = [leaf, ...this.#leaves.filter((held) => held !== leaf)];
  }

  [Symbol.dispose](): void {
    this.#workspace.offref(this.#ref);
  }
}
