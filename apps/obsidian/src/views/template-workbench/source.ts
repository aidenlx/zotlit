// Native source readers use the same live-file identity across all windows.
import type { App, TextFileView, TFile } from "obsidian";

import { loadedTextFileView } from "@/lib/live-text";

export function currentProfileSource(
  app: App,
  file: TFile,
  exclude?: TextFileView,
): string | null {
  return loadedTextFileView(app, file, exclude)?.getViewData() ?? null;
}
