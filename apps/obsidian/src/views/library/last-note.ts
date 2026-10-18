// The note the researcher was in last, so a Library View row can cite into it
// while its own tab is active and Obsidian names no active editor.
import { MarkdownView } from "obsidian";
import type { MarkdownFileInfo, Workspace } from "obsidian";

/**
 * The note active last that is still open and shows an editor, in Source
 * mode or Live Preview; `null` where none does. The workspace keeps, also
 * across a plugin reload, the file of the tab active last and the files
 * left before it, newest first; what each open tab shows is read now, as a
 * new tab is active before it opens its note.
 */
export function lastEditor(
  workspace: Pick<
    Workspace,
    "getActiveFile" | "getLastOpenFiles" | "iterateAllLeaves"
  >,
): MarkdownFileInfo | null {
  const editors = new Map<string, MarkdownView>();
  workspace.iterateAllLeaves(({ view }) => {
    if (
      view instanceof MarkdownView &&
      view.getMode() === "source" &&
      view.file
    )
      editors.set(view.file.path, view);
  });
  const active = workspace.getActiveFile()?.path;
  for (const path of [
    ...(active === undefined ? [] : [active]),
    ...workspace.getLastOpenFiles(),
  ]) {
    const view = editors.get(path);
    if (view) return view;
  }
  return null;
}
