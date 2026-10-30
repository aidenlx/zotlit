// Opens a Literature Note's PDF Attachments: the picker's reader and the `open-pdf` command.

import { TFile } from "obsidian";
import type { App, PaneType, Plugin } from "obsidian";

import { openAttachments } from "@/lib/attachment-open";
import type { AttachmentReader } from "@/lib/attachment-open";
import type { EffectBridge } from "@/lib/effect-bridge";
import * as m from "@/lib/i18n/generated/messages";
import { BaseNotice } from "@/lib/notice";
import { itemKeyFromFrontmatter } from "@/services/note-index/service";

import type { LiteratureNoteAttachmentsHandle } from "./handle";
import type { OpenTarget, TargetOpener } from "./open-target";
import type { ObsidianOpenableAttachment } from "./resolve";

/**
 * An open a gesture starts outside Effect. Its caller runs each open on a
 * runner that unload interrupts, and the opener reports a failure itself, so
 * the gesture fires the open and forgets it.
 */
export interface TargetOpenGesture {
  open(target: OpenTarget, pane: PaneType | boolean): void;
}

/** {@link TargetOpenGesture} that runs each open of `opener` through `run`. */
export function openGesture(
  opener: Pick<TargetOpener["Service"], "open">,
  run: (open: ReturnType<TargetOpener["Service"]["open"]>) => void,
): TargetOpenGesture {
  return { open: (target, pane) => run(opener.open(target, pane)) };
}

/**
 * A picker's reader that opens each row through the Target Opener, by the
 * row's key, so a picked Attachment is opened by the same rule as every other.
 */
export function pdfPickerReader(
  opener: TargetOpenGesture,
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
  opener: Pick<TargetOpener["Service"], "open">;
  /** Runs each open the picker fires; unload interrupts it. */
  bridge: Pick<EffectBridge, "runAndForget">;
}

async function runOpenPdfCommand(
  deps: AttachmentOpenDeps,
  indexedKey: string,
): Promise<void> {
  const attachments =
    await deps.attachments.literatureNoteAttachments(indexedKey);
  if (!attachments) return;
  openAttachments(attachments, {
    reader: pdfPickerReader(openGesture(deps.opener, deps.bridge.runAndForget)),
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
