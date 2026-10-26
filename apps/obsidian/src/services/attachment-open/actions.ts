// Opens a Literature Note's PDF Attachments: the PDF reader, the picker's reader, and the `open-pdf` command.

import { TFile } from "obsidian";
import type { App, Plugin } from "obsidian";

import {
  createObsidianAttachmentReader,
  openAttachments,
} from "@/lib/attachment-open";
import type { AttachmentReader } from "@/lib/attachment-open";
import type { EffectBridge } from "@/lib/effect-bridge";
import * as m from "@/lib/i18n/generated/messages";
import { BaseNotice } from "@/lib/notice";
import { itemKeyFromFrontmatter } from "@/services/note-index/service";
import type { PluginSettings } from "@/services/settings/service";
import { activateAnnotView } from "@/views/annot-view/register";

import type { LiteratureNoteAttachmentsHandle } from "./handle";
import type { TargetOpener, TargetReader } from "./open-target";
import type { ObsidianOpenableAttachment } from "./resolve";

/** What opening a PDF in Obsidian needs, wherever the gesture came from. */
export interface PdfReaderDeps {
  app: App;
  settings: Pick<PluginSettings["Service"], "current">;
  bridge: Pick<EffectBridge, "runSync">;
}

/**
 * Obsidian's PDF view as the Target Opener drives it: the file opens, and the
 * annotation view comes forward beside it so the Item's Annotations are on
 * screen. `reader.focus-annot-view` drops the second step for a user who
 * keeps the sidebar arranged their own way.
 */
export function createPdfReader(deps: PdfReaderDeps): TargetReader {
  return createObsidianAttachmentReader(deps.app, {
    onOpened: () => {
      if (
        deps.bridge.runSync(deps.settings.current)["reader.focus-annot-view"]
      ) {
        void activateAnnotView(deps.app);
      }
    },
  });
}

/**
 * A picker's reader that opens each row through the Target Opener, by the
 * row's key, so a picked Attachment is opened by the same rule as every other.
 */
export function pdfPickerReader(
  opener: Pick<TargetOpener, "open">,
): AttachmentReader<ObsidianOpenableAttachment> {
  return {
    icon: "file-text",
    onEmpty: () => new BaseNotice(m.notice_no_pdf_attachment()),
    open: (attachment, pane) =>
      opener.open(
        { kind: "attachment", attachmentKey: attachment.indexedKey },
        pane,
      ),
  };
}

export interface AttachmentOpenDeps {
  app: App;
  /** Resolves a Literature Note's Indexed Key to its Item's PDF Attachments. */
  attachments: LiteratureNoteAttachmentsHandle;
  opener: Pick<TargetOpener, "open">;
}

async function runOpenPdfCommand(
  deps: AttachmentOpenDeps,
  indexedKey: string,
): Promise<void> {
  const attachments =
    await deps.attachments.literatureNoteAttachments(indexedKey);
  openAttachments(attachments, {
    reader: pdfPickerReader(deps.opener),
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
