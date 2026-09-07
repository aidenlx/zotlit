// How a Profile document leaves this page and comes back: the file a reader
// downloads, and the draft this browser keeps between visits. Every storage
// call is answered even where the browser refuses storage, so a page opened
// with site data blocked still edits and still downloads.
//
// The two halves of a draft are kept in different storages. The text and the
// revision it answers for are the reader's own work, so they persist; a paper
// read out of a vault is that vault's, so on this public origin it is kept for
// the tab alone and no longer. A Sample Item is bundled with the page, so it
// rides in the persistent record like the text does.

import { customAlphabet } from "nanoid";
import * as v from "valibot";

import { buildImportProfileProtocolUrl } from "@zotlit/protocol";
import {
  expectedProfileRevisionSchema,
  itemSnapshotSchema,
} from "@zotlit/workbench/bridge";
import type { SaveSelectedProfileRequest } from "@zotlit/workbench/bridge";
import { WorkbenchDocumentController } from "@zotlit/workbench/document";

import type { SampleItem } from "./fields";

/**
 * What one visit left behind: the source being edited, and the paper it was
 * shown against. A tab that closed on a paper read out of a vault comes back
 * to the text alone, so the paper is optional.
 */
export interface WorkbenchDraft {
  readonly source: string;
  readonly snapshot?: SampleItem;
  readonly annotationSelection?: string;
  readonly expected?: SaveSelectedProfileRequest["expected"];
}

/**
 * Which document a record belongs to. A vault document is named by the vault
 * as well, so two vaults holding the same reference keep drafts of their own.
 */
export interface DraftLocation {
  readonly reference: string;
  /** The vault the document was read from; absent for a standalone document. */
  readonly installationId?: string;
}

const draftSchema = v.object({
  source: v.string(),
  snapshot: v.optional(itemSnapshotSchema),
  annotationSelection: v.optional(v.string()),
  expected: v.optional(expectedProfileRevisionSchema),
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
 * The draft this browser kept for `location`, or null when it kept none —
 * which is also what a blocked storage and a record written before the snapshot
 * contract moved on both read as, so a stale record never reaches the renderer.
 * A vault paper comes back only while the tab that read it is still open.
 */
export function readDraft(location: DraftLocation): WorkbenchDraft | null {
  const record = readRecord(draftSchema, browser, draftKey(location));
  if (!record) return null;
  if (record.snapshot) return record;
  const snapshot = readRecord(itemSnapshotSchema, tab, snapshotKey(location));
  return snapshot ? { ...record, snapshot } : record;
}

export function writeDraft(
  location: DraftLocation,
  draft: WorkbenchDraft,
): void {
  const vaultPaper = draft.snapshot?.provenance.kind === "connected";
  const { snapshot, ...rest } = draft;
  writeRecord(browser, draftKey(location), vaultPaper ? rest : draft);
  if (vaultPaper) writeRecord(tab, snapshotKey(location), snapshot);
  else clearRecord(tab, snapshotKey(location));
}

export function clearDraft(location: DraftLocation): void {
  clearRecord(browser, draftKey(location));
  clearRecord(tab, snapshotKey(location));
}

// The two storages, each reached at the moment it is used: a browser that
// refuses site data throws on the property itself, which is what the guards
// below catch.
const browser = () => localStorage;
const tab = () => sessionStorage;

/** Where one document's draft is kept: one record per document, per vault. */
function draftKey(location: DraftLocation): string {
  return `zotlit.workbench.draft.${scope(location)}`;
}

/** Where the tab keeps the vault paper that draft was shown against. */
function snapshotKey(location: DraftLocation): string {
  return `zotlit.workbench.snapshot.${scope(location)}`;
}

function scope({ installationId, reference }: DraftLocation): string {
  return installationId === undefined
    ? reference
    : `${installationId}.${reference}`;
}

function readRecord<TSchema extends v.GenericSchema>(
  schema: TSchema,
  storage: () => Storage,
  key: string,
): v.InferOutput<TSchema> | null {
  let stored: string | null;
  try {
    stored = storage().getItem(key);
  } catch {
    // A browser with site data blocked keeps no record, which reads as none.
    return null;
  }
  if (stored === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch {
    return null;
  }
  const result = v.safeParse(schema, parsed);
  return result.success ? result.output : null;
}

function writeRecord(
  storage: () => Storage,
  key: string,
  record: unknown,
): void {
  try {
    storage().setItem(key, JSON.stringify(record));
  } catch {
    // A blocked or full storage keeps the draft on screen alone, which is
    // where the reader is already editing it.
  }
}

function clearRecord(storage: () => Storage, key: string): void {
  try {
    storage().removeItem(key);
  } catch {
    // Nothing was kept, so nothing is left to remove.
  }
}

/** Copies the exact document before handing control to the native import sheet. */
export async function openProfileInObsidian(source: string): Promise<void> {
  await navigator.clipboard.writeText(source);
  const link = document.createElement("a");
  link.href = buildImportProfileProtocolUrl();
  link.click();
}

/** One transferable Default copy per editor, so a later handoff can replace it. */
export function createProfileHandoffSource(): (source: string) => string {
  const mintId = customAlphabet(
    "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
    12,
  );
  let defaultId: string | undefined;
  return (source) => {
    const document = new WorkbenchDocumentController(source, {
      runtime: "native",
    });
    if (document.document?.manifest.id !== "default") return source;
    defaultId ??= mintId();
    document.setManifestKey("id", defaultId);
    return document.source;
  };
}
