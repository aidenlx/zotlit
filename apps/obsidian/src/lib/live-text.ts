// A note open in a loaded text view keeps its live text in that view, not on
// disk. The view's own save writes the text it captured before a disk write
// that lands during that save, and that disk write is lost. Obsidian's
// Properties editor edits an open note through its view for this reason; a
// rewrite here does the same, and writes any other note on disk.

import { TextFileView } from "obsidian";
import type { TFile, Vault, Workspace } from "obsidian";

/** The loaded text view that edits `file`, in any window; `null` when none. */
export function loadedTextFileView(
  app: { workspace: Pick<Workspace, "iterateAllLeaves"> },
  file: TFile,
  exclude?: TextFileView,
): TextFileView | null {
  let found: TextFileView | null = null;
  app.workspace.iterateAllLeaves((leaf) => {
    const view = leaf.view;
    if (
      found === null &&
      view !== exclude &&
      view instanceof TextFileView &&
      view.file === file &&
      view.lastSavedData !== null &&
      view.data !== null
    )
      found = view;
  });
  return found;
}

/**
 * Rewrite `file`'s live text with `fn`, which runs synchronously on the text it
 * replaces. When a loaded view edits the note, the view takes the new text as
 * an external change and saves it; else one `vault.process` writes it. An
 * output equal to its input writes nothing, and a throw leaves the note as is.
 *
 * When the view's own save is in progress, the view writes the new text right
 * after that save, so the returned promise can settle before the disk has it.
 */
export async function processLiveText(
  app: {
    vault: Pick<Vault, "process">;
    workspace: Pick<Workspace, "iterateAllLeaves">;
  },
  file: TFile,
  fn: (text: string) => string,
): Promise<void> {
  const view = loadedTextFileView(app, file);
  if (view === null) {
    await app.vault.process(file, fn);
    return;
  }
  const text = view.getViewData();
  const next = fn(text);
  if (next === text) return;
  view.setViewData(next, false);
  await view.save();
}
