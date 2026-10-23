// Current-occurrence validation and source-range navigation for the Cited By Sidebar.
import { Keymap, TFile } from "obsidian";
import type { App } from "obsidian";
import type { MouseEvent } from "react";

import { occurrencesEqual } from "@/services/citation-index/scan";
import type {
  CitationIndex,
  CitedByGroup,
  CitationOccurrence,
} from "@/services/citation-index/service";
import type { FileScan } from "@/services/citation-index/store";
import { revealMarkdownOccurrence } from "@/views/reveal-occurrence";

export async function openCitedByOccurrence(
  app: App,
  options: {
    citationIndex: Pick<CitationIndex, "getFileScan">;
    group: CitedByGroup;
    occurrence: CitationOccurrence;
    event: MouseEvent;
  },
): Promise<void> {
  const { citationIndex, group, occurrence, event } = options;
  const pane = Keymap.isModEvent(event.nativeEvent);
  const file = app.vault.getAbstractFileByPath(group.path);
  if (!(file instanceof TFile)) {
    await app.workspace.openLinkText(group.path, "", pane);
    return;
  }

  let current: CitationOccurrence | null = null;
  try {
    const mtime = file.stat.mtime;
    const [source, scan] = await Promise.all([
      app.vault.cachedRead(file),
      citationIndex.getFileScan(file),
    ]);
    if (file.stat.mtime === mtime) {
      current = currentOccurrence({ scan, source, occurrence });
    }
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
  scan: Readonly<FileScan> | null;
  source: string;
  occurrence: CitationOccurrence;
}): CitationOccurrence | null {
  const { scan, source, occurrence } = options;
  if (scan === null) return null;
  const candidates: CitationOccurrence[] = [
    ...scan.citekeys,
    ...scan.wikilinks,
    ...scan.annotations
      .filter(({ form }) => form === "citation")
      .map(({ indexedKey, position, pageLabel }): CitationOccurrence => ({
        kind: "annotation",
        raw: indexedKey,
        position,
        pageLabel,
      })),
  ];
  return (
    candidates.find(
      (candidate) =>
        occurrencesEqual([candidate], [occurrence]) &&
        positionMatchesSource(source, candidate),
    ) ?? null
  );
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
