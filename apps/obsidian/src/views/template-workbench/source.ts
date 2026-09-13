// Native source readers use the same live-file identity across all windows.
import { TextFileView } from "obsidian";
import type { App, TFile } from "obsidian";

export function currentProfileSource(
  app: App,
  file: TFile,
  exclude?: TextFileView,
): string | null {
  let source: string | null = null;
  app.workspace.iterateAllLeaves((leaf) => {
    const view = leaf.view;
    if (
      source === null &&
      view !== exclude &&
      view instanceof TextFileView &&
      view.file === file &&
      view.lastSavedData !== null &&
      view.data !== null
    )
      source = view.getViewData();
  });
  return source;
}
