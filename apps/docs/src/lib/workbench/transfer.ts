// How a Profile document leaves this page and comes back: the file a reader
// downloads, and the draft this browser keeps between visits. Every storage
// call is answered even where the browser refuses storage, so a page opened
// with site data blocked still edits and still downloads.

import * as v from "valibot";

import { itemSnapshotSchema } from "@zotlit/workbench/bridge";

import type { SampleItem } from "./fields";

/** What one visit left behind: the source being edited, and the paper it was shown against. */
export interface WorkbenchDraft {
  readonly source: string;
  readonly snapshot: SampleItem;
}

const draftSchema = v.object({
  source: v.string(),
  snapshot: itemSnapshotSchema,
});

/**
 * The name a downloaded Profile document carries. A draft says so in its own
 * name, so an incomplete file stays recognizable as one on disk, and a document
 * that does not parse has no ID to carry.
 */
export function profileFileName(
  id: string | undefined,
  { draft }: { draft: boolean },
): string {
  return ["zotlit-profile", id, draft ? "draft" : undefined, "md"]
    .filter((part) => part !== undefined)
    .join(".");
}

/** Hands `source` to the browser as a file, byte for byte. */
export function downloadProfile(source: string, name: string): void {
  const url = URL.createObjectURL(
    new Blob([source], { type: "text/markdown" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * The draft this browser kept for `reference`, or null when it kept none —
 * which is also what a blocked storage and a record written before the snapshot
 * contract moved on both read as, so a stale record never reaches the renderer.
 */
export function readDraft(reference: string): WorkbenchDraft | null {
  let stored: string | null;
  try {
    stored = localStorage.getItem(draftKey(reference));
  } catch {
    // A browser with site data blocked keeps no draft, which reads as none.
    return null;
  }
  if (stored === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch {
    return null;
  }
  const result = v.safeParse(draftSchema, parsed);
  return result.success ? result.output : null;
}

export function writeDraft(reference: string, draft: WorkbenchDraft): void {
  try {
    localStorage.setItem(draftKey(reference), JSON.stringify(draft));
  } catch {
    // A blocked or full storage keeps the draft on screen alone, which is
    // where the reader is already editing it.
  }
}

export function clearDraft(reference: string): void {
  try {
    localStorage.removeItem(draftKey(reference));
  } catch {
    // Nothing was kept, so nothing is left to remove.
  }
}

/** Where one document's draft is kept: one record per document reference. */
function draftKey(reference: string): string {
  return `zotlit.workbench.draft.${reference}`;
}
