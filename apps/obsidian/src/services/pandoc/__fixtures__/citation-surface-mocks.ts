// The module doubles of a Citation Presentation suite, importing nothing at run
// time so a `vi.mock` factory can reach them while its module graph still loads.

import type { CslItemData } from "@zotlit/db";

import type { SeededWork } from "@/services/zotero-reads/test-utils";

/** Everything the clipboard double was handed, newest last. */
export const clipboardWrites: { html: string; text: string }[] = [];

export function collectClipboardWrite(content: {
  html: string;
  text: string;
}): Promise<"rich"> {
  clipboardWrites.push(content);
  return Promise.resolve("rich");
}

/** What the export dialog was opened with, and what this run answers it with. */
export const exportRun = {
  /** Where the dialog's style picker started, which the note decides. */
  referencesStyleId: null as string | null,
  destination: "",
  /** A per-run style the user picked over the one the dialog opened on. */
  override: undefined as string | null | undefined,
};

/** The export dialog, answering with the style this run chose for itself. */
export function answerExportModal(
  _app: unknown,
  options: { referencesStyleId: string | null },
): Promise<{ format: "html"; styleId: string | null; destination: string }> {
  exportRun.referencesStyleId = options.referencesStyleId;
  return Promise.resolve({
    format: "html",
    styleId:
      exportRun.override === undefined
        ? options.referencesStyleId
        : exportRun.override,
    destination: exportRun.destination,
  });
}

/** One cited work, as both Zotero itself and an export read it. */
export interface CitedWork {
  /** The work as the Zotero database holds it. */
  work: SeededWork;
  /** The same work as CSL-JSON, as Zotero hands it to an export. */
  csl: CslItemData;
}

/** Every work the open vault cites, by Indexed Key. */
export const citedWorks = new Map<string, CitedWork>();

/** Zotero itself, answering for the works this vault cites. */
export function fetchCitedBibliography(): Promise<{
  source: "local-api";
  items: Map<string, CslItemData>;
}> {
  return Promise.resolve({
    source: "local-api",
    items: new Map(
      [...citedWorks].map(([indexedKey, work]) => [indexedKey, work.csl]),
    ),
  });
}

/** Leave no clipboard write, export run, or cited work behind for the next test. */
export function resetCitationSurfaceMocks(): void {
  clipboardWrites.length = 0;
  exportRun.referencesStyleId = null;
  exportRun.destination = "";
  exportRun.override = undefined;
  citedWorks.clear();
}
