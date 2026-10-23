// Current-occurrence validation and source-range navigation for the Cited By Sidebar.
import { Keymap, TFile } from "obsidian";
import type { App } from "obsidian";
import type { MouseEvent } from "react";

import { occurrencesEqual } from "@/services/citation-index/scan";
import type { NoteScanRecord } from "@/services/citation-index/scan-note";
import type {
  CitedByGroup,
  CitationOccurrence,
} from "@/services/citation-index/service";
import type { ParseClient } from "@/services/citation-parse/client";
import { revealMarkdownOccurrence } from "@/views/reveal-occurrence";

export async function openCitedByOccurrence(
  app: App,
  options: {
    citationParse: ParseClient;
    group: CitedByGroup;
    occurrence: CitationOccurrence;
    event: MouseEvent;
  },
): Promise<void> {
  const { group, occurrence, event } = options;
  const pane = Keymap.isModEvent(event.nativeEvent);
  const file = app.vault.getAbstractFileByPath(group.path);
  if (!(file instanceof TFile)) {
    await app.workspace.openLinkText(group.path, "", pane);
    return;
  }

  const mtime = file.stat.mtime;
  let current: CitationOccurrence | null = null;
  try {
    const source = await app.vault.cachedRead(file);
    const { record } = await options.citationParse.parse(
      { path: file.path, generation: 0, text: source },
      new AbortController().signal,
    );
    if (file.stat.mtime === mtime)
      current = currentOccurrence(record, occurrence);
  } catch {
    // Opening the note remains useful when its current source cannot be read.
  }
  if (!current) {
    await app.workspace.openLinkText(group.path, "", pane);
    return;
  }

  await app.workspace.openLinkText(group.path, "", pane);
  revealMarkdownOccurrence({
    app,
    sourcePath: group.path,
    occurrence: current,
    preferredLeaf: app.workspace.activeLeaf,
  });
}

export function currentOccurrence(
  record: NoteScanRecord,
  occurrence: CitationOccurrence,
): CitationOccurrence | null {
  const candidates =
    occurrence.kind === "citekey" ? record.citekeys : record.wikilinks;
  return (
    candidates.find((candidate) =>
      occurrencesEqual([candidate], [occurrence]),
    ) ?? null
  );
}
