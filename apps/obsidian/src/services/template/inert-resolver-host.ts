// Adapts Obsidian services to the shared side-effect-free resolver core.

import { normalizePath } from "obsidian";
import type { App, FileManager, TFile, Vault } from "obsidian";
import TurndownService from "turndown";

import type { NoteResolvers } from "@zotlit/db";
import { attachmentAbsPath, resolveAnnotCachePath } from "@zotlit/db/path";
import {
  buildInertNoteResolvers,
  findExistingLitNote,
  resolveExcerptImageContext,
} from "@zotlit/workbench/explorer";
import type { ExcerptImageContext } from "@zotlit/workbench/explorer";

import { attachmentFileLink } from "@/lib/annotation-render";
import { resolveAttachmentFolderPath } from "@/lib/ensure-folder";
import * as m from "@/lib/i18n/generated/messages";
import { creatorSummary } from "@/lib/item-summary";
import { fileUrlLink } from "@/lib/markdown-link";
import {
  commentToMarkdown,
  createCommentTurndown,
} from "@/lib/turndown/comment";
import type { NoteIndex } from "@/services/note-index/service";
import type { Settings } from "@/services/settings/schema";
import type { ZoteroPrefService } from "@/services/zotero-pref/service";

export { findExistingLitNote };
export type { ExcerptImageContext };

export async function resolveObsidianExcerptImageContext(options: {
  app: App;
  settings: Readonly<Settings>;
  litNotePath: string | null;
}): Promise<ExcerptImageContext> {
  return resolveExcerptImageContext({
    attachmentImport: options.settings["attachment.import"],
    attachmentFolderPath: options.settings["attachment.folder-path"],
    litNotePath: options.litNotePath,
    resolveAttachmentFolderPath: (folderPath, sourcePath) =>
      resolveAttachmentFolderPath(options.app, folderPath, sourcePath),
  });
}

export interface ObsidianInertNoteResolverDeps {
  noteIndex: Pick<NoteIndex, "getNotesByItemKey" | "getImportedNoteByNoteKey">;
  fileManager: Pick<FileManager, "generateMarkdownLink">;
  vault: Pick<Vault, "getFileByPath">;
  zoteroPref: Pick<ZoteroPrefService, "dataDir" | "baseAttachmentPath">;
  sourcePath: string;
  excerptImages: ExcerptImageContext;
}

export function buildObsidianInertNoteResolvers(
  deps: ObsidianInertNoteResolverDeps,
): NoteResolvers {
  const { dataDir, baseAttachmentPath } = deps.zoteroPref;
  let turndown: ReturnType<typeof createCommentTurndown> | null = null;

  return buildInertNoteResolvers<TFile>({
    noteIndex: deps.noteIndex,
    getFileByPath: (path) => deps.vault.getFileByPath(path),
    generateMarkdownLink: ({ file, sourcePath, subpath, alias }) =>
      deps.fileManager.generateMarkdownLink(file, sourcePath, subpath, alias),
    sourcePath: deps.sourcePath,
    excerptImages: deps.excerptImages,
    notImportedReason: m.template_data_explorer_not_imported,
    attachmentAbsPath: (attachment) =>
      attachmentAbsPath(attachment, { dataDir, baseAttachmentPath }),
    attachmentFileLink: (attachment, page) =>
      attachmentFileLink(attachment, { dataDir, baseAttachmentPath }, page),
    annotationCachePath: (annotation) =>
      resolveAnnotCachePath(annotation, {
        dataDir,
        groupID: annotation.groupID,
      }),
    commentToMarkdown: (html) => {
      turndown ??= createCommentTurndown(TurndownService);
      return commentToMarkdown(turndown, html);
    },
    authorsShort: creatorSummary,
    fileUrlLink,
    normalizeVaultPath: normalizePath,
  });
}
