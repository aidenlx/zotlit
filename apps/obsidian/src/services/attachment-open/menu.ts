// Literature Note file-menu entry that opens the Item's PDF Attachment(s).

import { TFile } from "obsidian";
import type { Plugin } from "obsidian";

import { openAttachments } from "@/lib/attachment-open";
import * as m from "@/lib/i18n/generated/messages";
import { itemKeyFromFrontmatter } from "@/services/note-index/service";

import type { AttachmentOpenDeps } from "./actions";
import { createPdfReader, resolveLiteratureNoteAttachments } from "./actions";

/**
 * Register the `open-pdf` entry on a Literature Note's file menu. A pointer
 * click shows Obsidian's own context Menu over several Attachments; the entry
 * is absent from `files-menu` (Obsidian's own multi-select bar has no single
 * clicked event to anchor a picker at).
 */
export function registerAttachmentOpenFileMenu(
  plugin: Pick<Plugin, "registerEvent" | "app">,
  deps: AttachmentOpenDeps,
): void {
  plugin.registerEvent(
    plugin.app.workspace.on("file-menu", (menu, file, source) => {
      if (!(file instanceof TFile) || file.extension !== "md") return;
      if (source === "files-menu") return;
      const indexedKey = itemKeyFromFrontmatter(
        plugin.app.metadataCache.getFileCache(file),
      );
      if (!indexedKey) return;

      menu.addItem((item) =>
        item
          .setSection("zotlit")
          .setTitle(m.command_open_pdf_name())
          .setIcon("file-text")
          .onClick((evt) => {
            // Dispatch ends at the first `await` below and nulls
            // `currentTarget`, so the picker's anchor is read now.
            const target = evt.currentTarget as HTMLElement | null;
            const anchor = target
              ? { rect: target.getBoundingClientRect(), doc: target.doc }
              : undefined;
            void (async () => {
              await deps.db.ready;
              const attachments = resolveLiteratureNoteAttachments(
                deps,
                indexedKey,
              );
              openAttachments(attachments, {
                reader: createPdfReader(deps),
                event: evt,
                anchor,
              });
            })();
          }),
      );
    }),
  );
}
