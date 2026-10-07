// Annotation-render leaf: direct attachment file links, import-capable
// annotation image links, and the batch annotation-template render.
import { basename } from "node:path";

import {
  buildAnnotationsTemplateData,
  formatAnnotationSubpath,
  narrowBaseDataToCiteItemData,
  withAnnotationCitation,
} from "@zotlit/db";
import type {
  AnnotationFileLinkAnchor,
  AnnotationResolvers,
  AnnotationSources,
  AnnotationTemplateContext,
  Attachment,
  FallibleTemplateLink,
  TemplateAnnotation,
  TemplateParentItemData,
} from "@zotlit/db";
import { attachmentAbsPath, resolveAnnotCachePath } from "@zotlit/db/path";
import type { AttachmentPathContext } from "@zotlit/db/path";

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
 * (`[name](file://…)`). Rendered with no override it shows the filename and,
 * for annotation-level links, anchors to the Annotation's page and to the
 * Annotation itself (`#page=N&zt-annotation=KEY`); pass `alias` / `subpath` to
 * override either. The helper returns `null` when the path cannot be resolved.
 * This direct source link never queues Attachment Import.
 */
export function attachmentFileLink(
  attachment: Attachment,
  ctx: AttachmentPathContext,
  anchor?: AnnotationFileLinkAnchor,
): FallibleTemplateLink {
  const abs = attachmentAbsPath(attachment, ctx);
  if (!abs) return () => null;
  const filename = basename(abs) || "attachment";
  return fileUrlLink(
    abs,
    filename,
    anchor ? formatAnnotationSubpath(anchor) : "",
  );
}

/**
 * Resolvers for direct attachment file paths and annotation rendering (comment
 * conversion, import-capable excerpt images). Shared by the full note context
 * (`buildNoteResolvers`) and the annotation paths
 * ({@link renderAnnotationSources}), so both render annotations identically.
 */
export function buildAnnotationResolvers(options: {
  zoteroPref: Pick<ZoteroPrefService, "dataDir" | "baseAttachmentPath">;
  attachmentImport: Pick<AttachmentImport, "decide" | "resolveLink">;
  annotationImageLink?: AnnotationResolvers["annotationImageLink"];
}): AnnotationResolvers {
  const dataDir = options.zoteroPref.dataDir;
  const baseAttachmentPath = options.zoteroPref.baseAttachmentPath;
  const { attachmentImport } = options;
  let commentTurndown: ReturnType<typeof createCommentTurndown> | null = null;

  return {
    filePath: (a) => attachmentAbsPath(a, { dataDir, baseAttachmentPath }),
    fileLink: (a, anchor) =>
      attachmentFileLink(a, { dataDir, baseAttachmentPath }, anchor),
    commentToMarkdown: (html) => {
      commentTurndown ??= createCommentTurndown(TurndownService);
      return commentToMarkdown(commentTurndown, html);
    },
    authorsShort: creatorSummary,
    annotationImageLink: (annotation) => {
      if (options.annotationImageLink)
        return options.annotationImageLink(annotation);
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

/** How {@link renderAnnotationSources} renders. */
interface RenderAnnotationsOptions {
  template: Pick<TemplateService, "render" | "renderCitation">;
  zoteroPref: Pick<ZoteroPrefService, "dataDir" | "baseAttachmentPath">;
  attachmentImport: Pick<AttachmentImport, "decide" | "resolveLink">;
  renderAnnotation?: (data: AnnotationTemplateContext) => string;
  annotationImageLink?: AnnotationResolvers["annotationImageLink"];
}

/**
 * Resolve already-read {@link AnnotationSources} to their template data and
 * render each through the `annotation` template, returning a `key → rendered
 * string` map. `attachmentImport` decides each excerpt-cache image and copies
 * an approved one into the target note's attachment folder. Reads no database.
 */
export function renderAnnotationSources(
  sources: AnnotationSources,
  options: RenderAnnotationsOptions,
): Map<string, string> {
  const dataByKey = buildAnnotationsTemplateData(
    sources,
    annotationResolvers(options),
  );
  return renderTemplateData(dataByKey, options);
}

function annotationResolvers(
  options: RenderAnnotationsOptions,
): AnnotationResolvers {
  return buildAnnotationResolvers({
    zoteroPref: options.zoteroPref,
    attachmentImport: options.attachmentImport,
    annotationImageLink: options.annotationImageLink,
  });
}

/** Render each annotation's template data through the `annotation` template. */
function renderTemplateData(
  dataByKey: ReadonlyMap<string, TemplateAnnotation>,
  options: RenderAnnotationsOptions,
): Map<string, string> {
  const result = new Map<string, string>();
  for (const [key, data] of dataByKey) {
    const root = withAnnotationCitation(data, () =>
      annotationCitation(data.parentItem, data.pageLabel, options.template),
    );
    result.set(
      key,
      options.renderAnnotation?.(root) ??
        options.template.render("annotation", root),
    );
  }
  return result;
}

/**
 * Render an annotation's page-pinned citation through the Citation Template —
 * the parent item with the annotation's page label as locator (label
 * `"page"`), mirroring Zotero's own annotation citations. The main Citation
 * Variant carries it, so an annotation excerpt and an Enter-inserted citation
 * agree. `null` when there is no parent item or it carries no citation key.
 * Shared by the `zt.citation` template field above and the annot-view "Copy
 * citation" action (`renderAnnotationCitation`).
 */
export function annotationCitation(
  parentItem: TemplateParentItemData | null,
  pageLabel: string | null,
  template: Pick<TemplateService, "renderCitation">,
): string | null {
  if (!parentItem?.citekey) return null;
  return template.renderCitation(
    [
      {
        citationKey: parentItem.citekey,
        item: narrowBaseDataToCiteItemData(parentItem, parentItem.citekey),
        label: "page",
        locator: pageLabel,
      },
    ],
    "main",
  );
}
