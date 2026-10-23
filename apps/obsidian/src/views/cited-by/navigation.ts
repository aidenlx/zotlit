// Current-occurrence validation and source-range navigation for the Cited By Sidebar.
import { Keymap, TFile } from "obsidian";
import type { App } from "obsidian";
import type { MouseEvent } from "react";

export { currentOccurrence } from "@/services/citation-index/parsed-note";
import type {
  CitationIndex,
  CitedByGroup,
  CitationOccurrence,
} from "@/services/citation-index/service";
import { revealMarkdownOccurrence } from "@/views/reveal-occurrence";

export async function openCitedByOccurrence(
  app: App,
  options: {
    citationIndex: Pick<CitationIndex, "getParsedNote">;
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
    const facts = await citationIndex.getParsedNote(file);
    current = facts.currentOccurrence(occurrence);
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
