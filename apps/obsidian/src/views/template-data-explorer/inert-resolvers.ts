// Display-only NoteResolvers for the Template Data Explorer: side-effect-free helpers resolve for real; the two write-triggering helpers (excerpt-image copy, child-note import) resolve to their existing target when already imported, and to an inert placeholder otherwise, so browsing never queues a vault write (ADR 0005).
import {
  normalizePath,
  type App,
  type FileManager,
  type TFile,
  type Vault,
} from "obsidian";
import type TurndownService from "turndown";

import {
  type Annotation,
  type Attachment,
  type ChildNote,
  type NoteResolvers,
  type TemplateFilenameItemData,
  type TemplateNoteLink,
} from "@zotlit/db";
import { attachmentAbsPath, resolveAnnotCachePath } from "@zotlit/db/path";

import { attachmentFileLink } from "@/lib/annotation-render";
import {
  joinFolderPath,
  resolveAttachmentFolderPath,
} from "@/lib/ensure-folder";
import { fileUrlLink } from "@/lib/markdown-link";
import {
  commentToMarkdown,
  createCommentTurndown,
} from "@/lib/turndown/comment";
import * as m from "@/paraglide/messages";
import { creatorSummary } from "@/services/item-lookup/creator-summary";
import { type NoteIndex } from "@/services/note-index/service";
import { type Settings } from "@/services/settings/schema";
import { type ZoteroPrefService } from "@/services/zotero-pref/service";

import { markInertPlaceholder } from "./display-tree";

/** Which excerpt-image rendering path applies for the current item, resolved once per `#buildTree`. */
export type ExcerptImageContext =
  | { kind: "file-url" }
  | { kind: "not-imported" }
  | { kind: "vault"; folderPath: string };

/**
 * Resolve which excerpt-image rendering path applies: real `file://` links
 * when attachment import is disabled (side-effect-free either way); otherwise
 * a vault-relative folder — deterministic when `attachment.folder-path` is
 * set explicitly, or anchored to an existing literature note when it isn't
 * — or "not-imported" when the default attachment folder is configured but
 * no literature note exists to anchor it.
 */
export async function resolveExcerptImageContext(opts: {
  app: App;
  settings: Readonly<Settings>;
  litNotePath: string | null;
}): Promise<ExcerptImageContext> {
  if (!opts.settings["attachment.import"]) return { kind: "file-url" };
  const explicitFolder = opts.settings["attachment.folder-path"];
  if (!explicitFolder && opts.litNotePath === null) {
    return { kind: "not-imported" };
  }
  const folderPath = await resolveAttachmentFolderPath(
    opts.app,
    explicitFolder,
    opts.litNotePath ?? undefined,
  );
  return { kind: "vault", folderPath };
}

/** Look up an item's existing literature note: by indexed key first, falling back to citation key. */
export function findExistingLitNote(
  noteIndex: Pick<NoteIndex, "getNotesByItemKey" | "getNotesByCitekey">,
  item: { indexedKey: string; citationKey: string | null },
): TFile | null {
  return (
    noteIndex.getNotesByItemKey(item.indexedKey)[0] ??
    (item.citationKey
      ? noteIndex.getNotesByCitekey(item.citationKey)[0]
      : undefined) ??
    null
  );
}

export interface InertNoteResolverDeps {
  noteIndex: Pick<
    NoteIndex,
    "getNotesByItemKey" | "getNotesByCitekey" | "getImportedNoteByNoteKey"
  >;
  fileManager: Pick<FileManager, "generateMarkdownLink">;
  vault: Pick<Vault, "getFileByPath">;
  zoteroPref: Pick<ZoteroPrefService, "dataDir" | "baseAttachmentPath">;
  /** Turndown constructor for annotation-comment → Markdown conversion (injected; no ambient global). */
  Turndown: typeof TurndownService;
  /** The item's existing literature-note path, or "" when none; the `generateMarkdownLink` source for child-note and excerpt-image vault links. */
  sourcePath: string;
  excerptImages: ExcerptImageContext;
}

export function buildInertNoteResolvers(
  deps: InertNoteResolverDeps,
): NoteResolvers {
  const { dataDir, baseAttachmentPath } = deps.zoteroPref;
  let commentTurndown: ReturnType<typeof createCommentTurndown> | null = null;

  const resolveExistingNote = (
    item: Pick<TemplateFilenameItemData, "indexedKey" | "citationKey">,
  ): TFile | null =>
    findExistingLitNote(deps.noteIndex, {
      indexedKey: item.indexedKey,
      citationKey: item.citationKey ?? null,
    });

  const notImportedPlaceholder = () =>
    markInertPlaceholder(() => "", m.template_data_explorer_not_imported());

  return {
    annotation: {
      filePath: (a: Attachment) =>
        attachmentAbsPath(a, { dataDir, baseAttachmentPath }),
      fileLink: (a: Attachment, page) =>
        attachmentFileLink(a, { dataDir, baseAttachmentPath }, page),
      commentToMarkdown: (html: string) => {
        commentTurndown ??= createCommentTurndown(deps.Turndown);
        return commentToMarkdown(commentTurndown, html);
      },
      annotationImageLink: (annotation: Annotation) => {
        const cachePath = resolveAnnotCachePath(annotation, {
          dataDir,
          groupID: annotation.groupID,
        });
        if (cachePath == null) return null;

        const vaultName = `${annotation.key}.png`;
        switch (deps.excerptImages.kind) {
          case "file-url":
            return fileUrlLink(cachePath, vaultName);
          case "not-imported":
            return notImportedPlaceholder();
          case "vault": {
            const vaultPath = normalizePath(
              joinFolderPath(deps.excerptImages.folderPath, vaultName),
            );
            const existing = deps.vault.getFileByPath(vaultPath);
            return existing
              ? (alias, subpath) =>
                  deps.fileManager.generateMarkdownLink(
                    existing,
                    deps.sourcePath,
                    subpath,
                    alias,
                  )
              : notImportedPlaceholder();
          }
        }
      },
    },
    item: {
      authorsShort: creatorSummary,
      notePath: (item) => resolveExistingNote(item)?.path ?? null,
      noteLink: (item, alias, subpath) => {
        const file = resolveExistingNote(item);
        return file
          ? deps.fileManager.generateMarkdownLink(file, "", subpath, alias)
          : null;
      },
    },
    resolveChildNote: (note: ChildNote): TemplateNoteLink => {
      const existing = deps.noteIndex.getImportedNoteByNoteKey(
        note.indexedKey,
      )[0];
      return {
        key: note.key,
        title: note.title,
        noteLink: existing
          ? (alias, subpath) =>
              deps.fileManager.generateMarkdownLink(
                existing,
                deps.sourcePath,
                subpath,
                alias ?? note.title ?? undefined,
              )
          : notImportedPlaceholder(),
      };
    },
  };
}
