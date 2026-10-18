// The note the researcher was in last, so a Library View row can cite into it
// while its own tab is active and Obsidian names no active editor.
import { MarkdownView } from "obsidian";
import type { MarkdownFileInfo, Workspace } from "obsidian";

/**
 * The note active last that is still open and shows an editor, in Source
 * mode or Live Preview; `null` where none does. The workspace says when each
 * leaf was active last, also for the tabs open before the plugin loaded, and
 * what each shows now: a new tab is active before it opens its note.
 */
export function lastEditor(workspace: Workspace): MarkdownFileInfo | null {
  let last: MarkdownView | null = null;
  let lastTime = -Infinity;
  workspace.iterateAllLeaves((leaf) => {
    const { view, activeTime } = leaf;
    if (
      view instanceof MarkdownView &&
      view.getMode() === "source" &&
      activeTime > lastTime
    ) {
      last = view;
      lastTime = activeTime;
    }
  });
  return last;
}
