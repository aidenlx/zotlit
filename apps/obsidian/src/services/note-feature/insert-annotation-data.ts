// The annotation template's data for one captured card, read lazily by the render.
import { annotationColorToName } from "@zotlit/db";
import type {
  AnnotationParent,
  AnnotationResolvers,
  FallibleTemplateLink,
  TemplateLink,
} from "@zotlit/db";
import { TemplateError } from "@zotlit/templates/facade";

import type { AnnotationRecord } from "@/services/annotation-repository/service";

/**
 * The template data of `annotation`, the captured card. Each date and fact
 * the card's source may omit throws a {@link TemplateError} only when a
 * template reads it, and `citation` renders only when read.
 */
export function annotationInsertData(options: {
  annotation: AnnotationRecord;
  /** The Annotation's own key, without its group prefix. */
  key: string;
  libraryID: number;
  page: number | null;
  resolvers: Pick<AnnotationResolvers, "commentToMarkdown">;
  imgLink: TemplateLink | null;
  fileLink: FallibleTemplateLink;
  backlink: string;
  parent: Pick<AnnotationParent, "parentItem" | "tplAttachment">;
  citation: () => string | null;
}) {
  const { annotation: a, resolvers, parent } = options;
  const metadata = a.templateMetadata;
  return {
    key: options.key,
    indexedKey: a.key,
    libraryID: options.libraryID,
    type: a.type,
    text: a.text,
    commentHtml: a.comment,
    get comment() {
      return a.comment ? resolvers.commentToMarkdown(a.comment) : null;
    },
    colorHex: a.color,
    colorName: annotationColorToName(a.color),
    pageLabel: a.pageLabel,
    page: options.page,
    authorName: metadata?.authorName ?? null,
    get isExternal() {
      return requireFact(metadata?.isExternal, "isExternal");
    },
    get dateAdded() {
      return Temporal.Instant.from(
        requireFact(metadata?.dateAdded, "dateAdded"),
      );
    },
    get dateModified() {
      return Temporal.Instant.from(
        requireFact(metadata?.dateModified, "dateModified"),
      );
    },
    tags: a.tags.map((name) => ({
      name,
      type: metadata?.tags?.find((tag) => tag.name === name)?.type ?? "unknown",
      toString: () => name,
    })),
    imgLink: options.imgLink,
    fileLink: options.fileLink,
    backlink: options.backlink,
    parentItem: parent.parentItem,
    parentAttachment: parent.tplAttachment,
    get citation() {
      return options.citation();
    },
    toString: () => a.text ?? a.comment ?? a.type,
  };
}

function requireFact<T>(value: T | null | undefined, field: string): T {
  if (value == null)
    throw new TemplateError(
      `Annotation source did not supply ${field}`,
      "annotation",
    );
  return value;
}
