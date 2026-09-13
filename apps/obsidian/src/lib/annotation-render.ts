// Annotation-render leaf: direct attachment file links, import-capable
// annotation image links, and the batch annotation-template render.
import { basename } from "node:path";

import {
  citekeysToCiteTemplateData,
  fetchAnnotationsTemplateData,
  narrowBaseDataToCiteItemData,
  withAnnotationCitation,
} from "@zotlit/db";
import type {
  Annotation,
  AnnotationResolvers,
  Attachment,
  FallibleTemplateLink,
  GroupIDMemo,
  TagMemo,
  TemplateParentItemData,
} from "@zotlit/db";
import type { NodeDatabaseClient } from "@zotlit/db/client/node";
import { attachmentAbsPath, resolveAnnotCachePath } from "@zotlit/db/path";
import type { AttachmentPathContext } from "@zotlit/db/path";

import { inlineCitation } from "@/lib/inline-citation";
import { creatorSummary } from "@/lib/item-summary";
import { fileUrlLink } from "@/lib/markdown-link";
import {
  commentToMarkdown,
  createCommentTurndown,
} from "@/lib/turndown/comment";
import type { AttachmentImport } from "@/services/attachment-import/service";
import type { TemplateService } from "@/services/template/service";
import type { ZoteroPrefService } from "@/services/zotero-pref/service";

/**
 * Build the {@link FallibleTemplateLink} for an attachment's on-disk file
 * (`[name](file://…)`). Rendered with no override it shows the filename and, for
 * annotation-level links, anchors to `#page=N` when `page` is a number; pass
 * `alias` / `subpath` to override either. The helper returns `null` when the
 * path cannot be resolved. This direct source link never queues Attachment
 * Import.
 */
export function attachmentFileLink(
  attachment: Attachment,
  ctx: AttachmentPathContext,
  page?: number | null,
): FallibleTemplateLink {
  const abs = attachmentAbsPath(attachment, ctx);
  if (!abs) return () => null;
  const filename = basename(abs) || "attachment";
  return fileUrlLink(abs, filename, page != null ? `#page=${page}` : "");
}

/**
 * Resolvers for direct attachment file paths and annotation rendering (comment
 * conversion, import-capable excerpt images). Shared by the full note context
 * (`buildNoteResolvers`) and the single-annotation drag/paragraph paths
 * ({@link renderAnnotations}), so both render annotations identically.
 */
export function buildAnnotationResolvers(options: {
  zoteroPref: Pick<ZoteroPrefService, "dataDir" | "baseAttachmentPath">;
  attachmentImport: Pick<AttachmentImport, "decide" | "resolveLink">;
}): AnnotationResolvers {
  const dataDir = options.zoteroPref.dataDir;
  const baseAttachmentPath = options.zoteroPref.baseAttachmentPath;
  const { attachmentImport } = options;
  let commentTurndown: ReturnType<typeof createCommentTurndown> | null = null;

  return {
    filePath: (a) => attachmentAbsPath(a, { dataDir, baseAttachmentPath }),
    fileLink: (a, page) =>
      attachmentFileLink(a, { dataDir, baseAttachmentPath }, page),
    commentToMarkdown: (html) => {
      commentTurndown ??= createCommentTurndown(TurndownService);
      return commentToMarkdown(commentTurndown, html);
    },
    authorsShort: creatorSummary,
    annotationImageLink: (annotation) => {
      const cachePath = resolveAnnotCachePath(annotation, {
        dataDir,
        groupID: annotation.groupID,
      });
      if (cachePath == null) return null;
      return attachmentImport.resolveLink({
        source: attachmentImport.decide(cachePath, "annotation-cache"),
        vaultName: `${annotation.key}.png`,
      });
    },
  };
}

/**
 * Resolve already-fetched annotations to their template data and render each
 * through the `annotation` template, returning a `key → rendered string` map.
 * `attachmentImport` decides each excerpt-cache image and copies an approved
 * one into the target note's attachment folder.
 */
export function renderAnnotations(
  client: NodeDatabaseClient,
  annotations: readonly Annotation[],
  options: {
    template: Pick<TemplateService, "render">;
    zoteroPref: Pick<ZoteroPrefService, "dataDir" | "baseAttachmentPath">;
    attachmentImport: Pick<AttachmentImport, "decide" | "resolveLink">;
    groupIdMemo?: GroupIDMemo;
    tagMemo?: TagMemo;
  },
): Map<string, string> {
  const resolvers = buildAnnotationResolvers({
    zoteroPref: options.zoteroPref,
    attachmentImport: options.attachmentImport,
  });
  const dataByKey = fetchAnnotationsTemplateData(client, annotations, {
    resolvers,
    groupIdMemo: options.groupIdMemo,
    tagMemo: options.tagMemo,
  });
  const result = new Map<string, string>();
  for (const [key, data] of dataByKey) {
    const root = withAnnotationCitation(data, () =>
      annotationCitation(data.parentItem, data.pageLabel, options.template),
    );
    result.set(key, options.template.render("annotation", root));
  }
  return result;
}

/**
 * Render an annotation's page-pinned citation through the `cite` template —
 * the parent item with the annotation's page label as locator (label
 * `"page"`), mirroring Zotero's own annotation citations. `null` when there is
 * no parent item or it carries no citation key. Shared by the `zt.citation`
 * template field above and the annot-view "Copy citation" action
 * (`renderAnnotationCitation`).
 */
export function annotationCitation(
  parentItem: TemplateParentItemData | null,
  pageLabel: string | null,
  template: Pick<TemplateService, "render">,
): string | null {
  if (!parentItem?.citekey) return null;
  return inlineCitation(
    template.render(
      "cite",
      citekeysToCiteTemplateData([
        {
          citationKey: parentItem.citekey,
          item: narrowBaseDataToCiteItemData(parentItem, parentItem.citekey),
          label: "page",
          locator: pageLabel,
        },
      ]),
    ),
  );
}
