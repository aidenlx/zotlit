// Resolves a Literature Note to its Item's PDF Attachments, and the `open-pdf` command that opens them.

import { TFile } from "obsidian";
import type { App, FileSystemAdapter, Plugin } from "obsidian";

import type { Attachment } from "@zotlit/db";

import {
  createObsidianAttachmentReader,
  openAttachments,
} from "@/lib/attachment-open";
import type { AttachmentReader } from "@/lib/attachment-open";
import { Effect } from "@/lib/effect";
import * as m from "@/lib/i18n/generated/messages";
import { getLogger } from "@/lib/log";
import { itemKeyFromFrontmatter } from "@/services/note-index/service";
import type { SettingsService } from "@/services/settings/service";
import type { ZoteroPrefService } from "@/services/zotero-pref/service";
import type { ZoteroReadsService } from "@/services/zotero-reads/service";
import { activateAnnotView } from "@/views/annot-view/register";

import type { ObsidianOpenableAttachment } from "./resolve";
import { toObsidianOpenableAttachments } from "./resolve";

const logger = getLogger("attachment-open");

/** What resolving a Literature Note's Attachments needs. */
export interface AttachmentOpenLookupDeps {
  app: App;
  reads: Pick<ZoteroReadsService, "acquireRead">;
  zoteroPref: Pick<ZoteroPrefService, "dataDir" | "baseAttachmentPath">;
  settings: Pick<SettingsService, "current">;
}

/** What opening a PDF in Obsidian needs, wherever the gesture came from. */
export type PdfReaderDeps = Pick<AttachmentOpenLookupDeps, "app" | "settings">;

/**
 * The reader behind every ZotLit gesture that opens a PDF in Obsidian: the
 * file opens, and the annotation view comes forward beside it so the Item's
 * Annotations are on screen. `reader.focus-annot-view` drops the second
 * step for a user who keeps the sidebar arranged their own way.
 */
export function createPdfReader(
  deps: PdfReaderDeps,
): AttachmentReader<ObsidianOpenableAttachment> {
  return createObsidianAttachmentReader(deps.app, {
    onOpened: () => {
      if (deps.settings.current?.["reader.focus-annot-view"] ?? true) {
        void activateAnnotView(deps.app);
      }
    },
  });
}

export type AttachmentOpenDeps = AttachmentOpenLookupDeps;

/**
 * Attachments already fetched from the database, narrowed to the
 * Obsidian-Openable ones — the vault-adapter cast and path-context setup
 * `resolveLiteratureNoteAttachments` and the `open-attachment` protocol
 * handler both need, written once here.
 */
export function toObsidianOpenable(
  attachments: readonly Attachment[],
  deps: Pick<AttachmentOpenLookupDeps, "app" | "zoteroPref">,
): ObsidianOpenableAttachment[] {
  // Desktop-only plugin: the adapter is always a `FileSystemAdapter`.
  const vaultBasePath = (
    deps.app.vault.adapter as FileSystemAdapter
  ).getBasePath();
  return toObsidianOpenableAttachments(attachments, {
    pathContext: {
      dataDir: deps.zoteroPref.dataDir,
      baseAttachmentPath: deps.zoteroPref.baseAttachmentPath,
    },
    vaultBasePath,
    platform: process.platform,
  });
}

/**
 * Resolve a Literature Note's Indexed Key to its Item's Obsidian-Openable PDF
 * Attachments — shared by the `open-pdf` command, the file menu, and the
 * Quick Switcher's PDF chords, so a key→itemID lookup is written once.
 *
 * Both reads share one Snapshot, so a database swap between them cannot pair
 * an itemID with another database's Attachments.
 *
 * @returns no Attachments while the database cannot be read.
 */
export async function resolveLiteratureNoteAttachments(
  deps: AttachmentOpenLookupDeps,
  indexedKey: string,
): Promise<ObsidianOpenableAttachment[]> {
  try {
    await using lease = await deps.reads.acquireRead();
    const { reads } = lease;
    const items = await Effect.runPromise(
      reads.ItemsByIndexedKeys({ indexedKeys: [indexedKey] }),
    );
    const itemID = items.get(indexedKey)?.itemID;
    if (itemID === undefined) return [];
    const attachments = await Effect.runPromise(
      reads.AttachmentsOf({ itemIDs: [itemID] }),
    );
    return toObsidianOpenable(attachments, deps);
  } catch (error) {
    logger.warn("Literature Note Attachments unavailable", {
      indexedKey,
      error,
    });
    return [];
  }
}

async function runOpenPdfCommand(
  deps: AttachmentOpenDeps,
  indexedKey: string,
): Promise<void> {
  const attachments = await resolveLiteratureNoteAttachments(deps, indexedKey);
  openAttachments(attachments, {
    reader: createPdfReader(deps),
    app: deps.app,
  });
}

/** Add the `open-pdf` command palette entry: opens the active Literature Note's PDF, or a picker over several. */
export function addAttachmentOpenActions(
  plugin: Pick<Plugin, "addCommand">,
  deps: AttachmentOpenDeps,
): void {
  plugin.addCommand({
    id: "open-pdf",
    name: m.command_open_pdf_name(),
    checkCallback(checking) {
      const file = deps.app.workspace.getActiveFile();
      if (!(file instanceof TFile)) return false;
      const indexedKey = itemKeyFromFrontmatter(
        deps.app.metadataCache.getFileCache(file),
      );
      if (!indexedKey) return false;
      if (!checking) void runOpenPdfCommand(deps, indexedKey);
      return true;
    },
  });
}
