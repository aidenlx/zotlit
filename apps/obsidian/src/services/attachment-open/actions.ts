// Resolves a Literature Note to its Item's PDF Attachments, and the `open-pdf` command that opens them.

import { TFile } from "obsidian";
import type { App, FileSystemAdapter, Plugin } from "obsidian";

import type { Attachment } from "@zotlit/db";
import {
  getAttachmentsByParents,
  getItemsByKey,
  resolveIndexedKeyLibrary,
} from "@zotlit/db";

import {
  createObsidianAttachmentReader,
  openAttachments,
} from "@/lib/attachment-open";
import type { AttachmentReader } from "@/lib/attachment-open";
import * as m from "@/lib/i18n/generated/messages";
import type { DatabaseService } from "@/services/database/service";
import { itemKeyFromFrontmatter } from "@/services/note-index/service";
import type { SettingsService } from "@/services/settings/service";
import type { ZoteroPrefService } from "@/services/zotero-pref/service";
import { activateAnnotView } from "@/views/annot-view/register";

import type { ObsidianOpenableAttachment } from "./resolve";
import { toObsidianOpenableAttachments } from "./resolve";

/** What resolving a Literature Note's Attachments needs — no `ready` wait, since a caller resolves at its own moment. */
export interface AttachmentOpenLookupDeps {
  app: App;
  db: Pick<DatabaseService, "state" | "client">;
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

export interface AttachmentOpenDeps extends AttachmentOpenLookupDeps {
  db: Pick<DatabaseService, "state" | "client" | "ready">;
}

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
 */
export function resolveLiteratureNoteAttachments(
  deps: AttachmentOpenLookupDeps,
  indexedKey: string,
): ObsidianOpenableAttachment[] {
  if (deps.db.state !== "ready") return [];
  const resolved = resolveIndexedKeyLibrary(deps.db.client, indexedKey);
  if (!resolved) return [];
  const itemID = getItemsByKey(deps.db.client, resolved.libraryID, [
    resolved.key,
  ])[0]?.itemID;
  if (itemID == null) return [];

  const attachments = getAttachmentsByParents(deps.db.client, [itemID]);
  return toObsidianOpenable(attachments, deps);
}

async function runOpenPdfCommand(
  deps: AttachmentOpenDeps,
  indexedKey: string,
): Promise<void> {
  await deps.db.ready;
  const attachments = resolveLiteratureNoteAttachments(deps, indexedKey);
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
