// Current-occurrence validation and source-range navigation for the Cited By Sidebar.
import { Keymap, TFile } from "obsidian";
import type { App } from "obsidian";
import type { MouseEvent } from "react";

import {
  documentWikilinks,
  occurrencesEqual,
  scanCitekeyOccurrences,
} from "@/services/citation-index/scan";
import type {
  CitedByGroup,
  CitationOccurrence,
} from "@/services/citation-index/service";
import { revealMarkdownOccurrence } from "@/views/reveal-occurrence";

export async function openCitedByOccurrence(
  app: App,
  options: {
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

  let current: CitationOccurrence | null = null;
  try {
    const source = await app.vault.cachedRead(file);
    current = currentOccurrence({ app, file, source, occurrence });
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

export function currentOccurrence(options: {
  app: App;
  file: TFile;
  source: string;
  occurrence: CitationOccurrence;
}): CitationOccurrence | null {
  const { app, file, source, occurrence } = options;
  if (occurrence.kind === "citekey") {
    return (
      scanCitekeyOccurrences(source).find((candidate) =>
        occurrencesEqual([candidate], [occurrence]),
      ) ?? null
    );
  }
  for (const link of app.metadataCache.getFileCache(file)?.links ?? []) {
    if (
      source.slice(link.position.start.offset, link.position.end.offset) !==
      link.original
    ) {
      continue;
    }
    const candidate = documentWikilinks([link]).occurrences[0];
    if (
      candidate &&
      occurrencesEqual([candidate], [occurrence]) &&
      positionMatchesSource(source, candidate)
    ) {
      return candidate;
    }
  }
  return null;
}

function positionMatchesSource(
  source: string,
  occurrence: CitationOccurrence,
): boolean {
  const { start, end } = occurrence.position;
  const beforeStart = source.slice(0, start.offset);
  const beforeEnd = source.slice(0, end.offset);
  return (
    start.line === beforeStart.split("\n").length - 1 &&
    start.col === start.offset - (beforeStart.lastIndexOf("\n") + 1) &&
    end.line === beforeEnd.split("\n").length - 1 &&
    end.col === end.offset - (beforeEnd.lastIndexOf("\n") + 1)
  );
}
