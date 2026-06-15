import type TurndownService from "turndown";

import {
  annotationColorToName,
  annotationOpenUri,
  getAttachmentByKey,
  parseAttachmentPath,
} from "@zotlit/db";
import { type NodeDatabaseClient } from "@zotlit/db/client/node";
import { attachmentAbsPath, type AttachmentPathContext } from "@zotlit/db/path";

import { getLogger } from "@/lib/log";
import { createNoteTurndown } from "@/lib/turndown";
import {
  parseAnnotation,
  parseNoteSchema,
  type NoteAnnotation,
} from "@/lib/turndown/parse";
import * as m from "@/paraglide/messages";

const logger = getLogger("note-parser");

/** Collapse runs of 3+ newlines left by per-block conversion to a blank line. */
const EXTRA_BLANK_LINES = /\n{3,}/g;

export interface ParseNoteDeps {
  /** Obsidian's `TurndownService` global at runtime; the npm package in tests. */
  Turndown: typeof TurndownService;
  embeddedImage?: NoteEmbeddedImageDeps;
}

export interface NoteEmbeddedImageDeps {
  client: NodeDatabaseClient;
  libraryID: number;
  pathContext: AttachmentPathContext;
  resolveEmbed: (sourcePath: string, vaultName: string) => string;
}

/**
 * Convert a Zotero note's stored HTML to Obsidian-flavored Markdown, resolving
 * highlight / underline annotation excerpts to linked inline marks.
 *
 * Notes below {@link parseNoteSchema}'s supported schema version convert to a
 * legacy-format callout instead; HTML with no schema container (empty or
 * non-note input) yields `""`.
 *
 * @param html - the note's stored HTML (the `zotero-note znv1` storage wrapper
 *   is tolerated — the schema container is located within).
 */
export function parseNote(deps: ParseNoteDeps, html: string): string {
  const root = new DOMParser().parseFromString(html, "text/html");
  const schema = parseNoteSchema(root);
  if (!schema.supported) {
    if (schema.version === null) return "";
    logger.warn("Skipped legacy Zotero note", {
      schemaVersion: schema.version,
    });
    return m.note_parser_legacy_format_callout({ version: schema.version });
  }

  const td = createNoteTurndown(deps.Turndown, {
    annotationExcerpt: resolveAnnotationExcerpt,
    embeddedImage: deps.embeddedImage
      ? resolveEmbeddedImage(deps.embeddedImage)
      : undefined,
  });
  const md = td.turndown(schema.container.innerHTML);
  return md.replace(EXTRA_BLANK_LINES, "\n\n");
}

/**
 * Resolve a highlight/underline excerpt span to its linked inline mark
 * (highlight → linked `<mark>`, underline → linked `<u>`). Injected as the
 * converter's `annotationExcerpt` replacement; only spans reach it (image
 * excerpts are owned by the `embeddedImage` rule). A malformed payload keeps the
 * converted text.
 */
const resolveAnnotationExcerpt: TurndownService.ReplacementFunction = (
  content,
  node,
) => {
  const el = node as Element;
  const info = parseAnnotation(el);
  if (!info) {
    logger.warn("Invalid data-annotation payload", {
      raw: el.getAttribute("data-annotation")?.slice(0, 100),
    });
    return content;
  }
  let kind: AnnotationMarkKind = "highlight";
  if (el.classList.contains("underline")) {
    kind = "underline";
  } else if (el.classList.contains("highlight")) {
    kind = "highlight";
  }
  return renderAnnotationMark(kind, info, content);
};

function resolveEmbeddedImage(
  deps: NoteEmbeddedImageDeps,
): TurndownService.ReplacementFunction {
  return (_content, node) => {
    const el = node as Element;
    const key = el.getAttribute("data-attachment-key");
    if (!key) return el.outerHTML;

    const attachment = getAttachmentByKey(deps.client, key, deps.libraryID);
    if (!attachment) {
      logger.warn("Embedded image attachment not found", { key });
      return el.outerHTML;
    }

    const sourcePath = attachmentAbsPath(attachment, deps.pathContext);
    if (!sourcePath) {
      logger.warn("Embedded image attachment path is unresolved", { key });
      return el.outerHTML;
    }

    const parsed = parseAttachmentPath(attachment.path, attachment.linkMode);
    const filename =
      parsed.kind === "storage"
        ? parsed.filename
        : basenameFromPath(sourcePath);
    return deps.resolveEmbed(sourcePath, `${attachment.key}-${filename}`);
  };
}

function basenameFromPath(path: string): string {
  const index = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return index === -1 ? path : path.slice(index + 1);
}

type AnnotationMarkKind = "highlight" | "underline";

const MARK_STYLE = {
  highlight: {
    tag: "mark",
    className: "zotlit-hl",
    cssProp: "background-color",
    cssVar: "--zotlit-hl",
  },
  underline: {
    tag: "u",
    className: "zotlit-ul",
    cssProp: "text-decoration-color",
    cssVar: "--zotlit-ul",
  },
} as const;

/**
 * Render a highlight/underline excerpt as an inline mark linking back to the
 * Zotero annotation. Color resolves to a theme-overridable CSS variable with the
 * raw hex as fallback (`var(--zotlit-hl-{name}, {hex})`), so the color works
 * standalone yet a snippet can override it without `!important`. An unmapped hex
 * (rare Mendeley imports) falls back to the inline hex with no variable; a
 * missing attachment ref drops the link but keeps the mark.
 */
function renderAnnotationMark(
  kind: AnnotationMarkKind,
  info: NoteAnnotation,
  text: string,
): string {
  const { tag, className, cssProp, cssVar } = MARK_STYLE[kind];
  let attrs = ` class="${className}"`;
  if (info.color) {
    const colorName = annotationColorToName(info.color);
    if (colorName) {
      attrs += ` data-color="${colorName}" style="${cssProp}: var(${cssVar}-${colorName}, ${info.color});"`;
    } else {
      attrs += ` style="${cssProp}: ${info.color};"`;
    }
  }
  const mark = `<${tag}${attrs}>${text}</${tag}>`;

  const href = annotationHref(info);
  return href ? `[${mark}](${href})` : mark;
}

/**
 * Build the `zotero://open/` backlink for an annotation. Returns `null` when the
 * attachment URI was malformed (no resolved ref), so the caller drops the link
 * gracefully.
 */
function annotationHref(info: NoteAnnotation): string | null {
  const ref = info.attachment;
  if (!ref) return null;
  return annotationOpenUri({
    attachmentKey: ref.key,
    annotationKey: info.annotationKey,
    pageLabel: info.pageLabel ?? null,
    groupID: ref.libraryType === "group" ? ref.groupID : null,
  });
}
