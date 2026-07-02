// Zotero note HTML → Obsidian Markdown: schema gate, an annotation-template
// prepass, and in-rule resolution of annotation excerpts, citation marks, and
// embedded images.
import { distinct } from "@std/collections";
import type TurndownService from "turndown";

import {
  annotationColorToName,
  annotationOpenUri,
  attachmentToTemplateData,
  getAttachmentByKey,
  getCitekeyByItemKey,
  type CitationItem,
} from "@zotlit/db";
import { type NodeDatabaseClient } from "@zotlit/db/client/node";
import { attachmentAbsPath, type AttachmentPathContext } from "@zotlit/db/path";

import { getLogger } from "@/lib/log";
import {
  ANNOTATION_CALLOUT_ATTR,
  createNoteTurndown,
  encodeCalloutAttr,
} from "@/lib/turndown";
import {
  findAnnotationParagraphs,
  parseAnnotation,
  parseCitation,
  parseEmbeddedCitations,
  parseNoteSchema,
  type NoteAnnotation,
} from "@/lib/turndown/parse";
import * as m from "@/paraglide/messages";
import { type AttachmentImport } from "@/services/attachment-import/service";

const logger = getLogger(["note-import", "note-parser"]);

/**
 * Per-note dependencies wiring every DB/link-backed resolver in
 * {@link createNoteParser}. Omitted entirely for standalone conversion (no DB),
 * where each such rule falls back to raw-HTML passthrough.
 */
export interface NoteParserDeps {
  client: NodeDatabaseClient;
  /** The note's library, scoping DB citekey and attachment lookups. */
  libraryID: number;
  /**
   * The note's embedded `data-citation-items` snapshot, read off the schema
   * container by {@link parseNote} and closed over by the
   * citation rule.
   */
  citationMap: ReadonlyMap<string, string>;
  /** Render the resolved cited items through the user's `cite` template. */
  renderCite: RenderCite;
  /** Resolves `storage:` / linked attachment paths to absolute filesystem paths. */
  pathContext: AttachmentPathContext;
  /** Copies a resolved image into the vault and returns its embed link. */
  resolveLink: AttachmentImport["resolveLink"];
}

/** Render cited items through the user's `cite` template. */
export type RenderCite = (
  items: readonly { citationKey: string | null }[],
) => string;

/**
 * Render every clean single-annotation paragraph in a note through the
 * `annotation` template in one batch. The second argument is the per-note
 * `resolveLink`, supplied by the batch at write time so any excerpt cache image
 * copies into that note's attachment folder.
 *
 * @returns A `data-annotation key → callout` map.
 */
export type RenderAnnotationParagraph = (
  annotationKeys: readonly string[],
  resolveLink: NoteParserDeps["resolveLink"],
) => ReadonlyMap<string, string>;

/**
 * Caller-supplied subset of {@link NoteParserDeps}; `parseNote` fills
 * `citationMap`. `renderAnnotationParagraph` lives here, not on
 * {@link NoteParserDeps}: it drives the prepass, never a Turndown rule.
 */
export type ParseNoteDeps = Omit<NoteParserDeps, "citationMap"> & {
  /**
   * Render this note's clean single-annotation paragraphs through the user's
   * `annotation` template in one batch. A key absent from the result declines
   * (the annotation is gone from the DB); a present-but-blank callout is dropped
   * by the prepass. A declined paragraph falls to inline conversion —
   * highlight/underline to linked marks, an image excerpt to a bare embed.
   * Supplied only when `note.import-annotations-as-template` is enabled.
   *
   * @returns A `data-annotation key → callout` map.
   */
  renderAnnotationParagraph?: (
    annotationKeys: readonly string[],
  ) => ReadonlyMap<string, string>;
};

/**
 * Build the per-note Turndown: Obsidian's base config plus the Zotero rules,
 * with the highlight/underline excerpt resolver always injected and the
 * DB/link-backed citation + embedded-image resolvers wired when `deps` is
 * present. Built fresh per note (sub-millisecond) so each rule closes over that
 * note's deps; without `deps` the DB-backed rules pass their elements through raw.
 *
 * @param Turndown - Obsidian's `TurndownService` global at runtime; the npm
 *   package in tests.
 */
export function createNoteParser(
  Turndown: typeof TurndownService,
  deps?: NoteParserDeps,
): TurndownService {
  return createNoteTurndown(Turndown, {
    annotationExcerpt: resolveAnnotationExcerpt,
    citation: deps ? resolveCitation(deps) : undefined,
    embeddedImage: deps ? resolveEmbeddedImage(deps) : undefined,
  });
}

/**
 * Convert a Zotero note's stored HTML to Obsidian-flavored Markdown, building a
 * per-note Turndown that resolves highlight / underline excerpts to linked
 * inline marks and — when `deps` is supplied — citation marks to the user's cite
 * syntax and embedded images to real vault embeds.
 *
 * Notes below {@link parseNoteSchema}'s supported schema version convert to a
 * legacy-format callout instead; HTML with no schema container (empty or
 * non-note input) yields `""`.
 *
 * @param Turndown - Obsidian's `TurndownService` global at runtime; the npm
 *   package in tests.
 * @param html - the note's stored HTML (the `zotero-note znv1` storage wrapper
 *   is tolerated — the schema container is located within).
 * @param deps - when supplied, the citation + embedded-image rules resolve
 *   against the DB; omitted leaves both as raw-HTML passthrough.
 */
export function parseNote(
  Turndown: typeof TurndownService,
  html: string,
  deps?: ParseNoteDeps,
): string {
  const root = new DOMParser().parseFromString(html, "text/html");
  const schema = parseNoteSchema(root);
  if (!schema.supported) {
    if (schema.version === null) return "";
    logger.warn("Skipped legacy Zotero note", {
      schemaVersion: schema.version,
    });
    return m.note_parser_legacy_format_callout({ version: schema.version });
  }
  let td;
  if (deps) {
    const { renderAnnotationParagraph, ...parserDeps } = deps;
    if (renderAnnotationParagraph) {
      subsumeAnnotationParagraphs(schema.container, renderAnnotationParagraph);
    }
    td = createNoteParser(Turndown, {
      ...parserDeps,
      citationMap: parseEmbeddedCitations(schema.container),
    });
  } else {
    td = createNoteParser(Turndown);
  }
  return td.turndown(schema.container);
}

/**
 * Prepass replacing each clean single-annotation paragraph with a callout
 * sentinel carrying the template-rendered Markdown. Runs before the Turndown is
 * built so a subsumed image excerpt's inner `<img>` is gone before the in-rule
 * image leg would queue a copy — otherwise the storage attachment would be
 * copied as an orphan while the callout embeds the annotation cache image. A
 * paragraph the renderer declines (its key absent from the map) or whose callout
 * renders blank is left untouched for inline conversion.
 */
function subsumeAnnotationParagraphs(
  container: HTMLElement,
  render: (annotationKeys: readonly string[]) => ReadonlyMap<string, string>,
): void {
  const paragraphs = [...findAnnotationParagraphs(container)];
  if (paragraphs.length === 0) return;
  const callouts = render(
    distinct(paragraphs.map(({ annotationKey }) => annotationKey)),
  );
  for (const { paragraph, annotationKey } of paragraphs) {
    // Skip a declined key (absent) or a blank callout: an all-blank sentinel
    // hits Turndown's blankRule and silently drops the paragraph's content.
    const callout = callouts.get(annotationKey);
    if (callout === undefined || callout.trim() === "") continue;
    const sentinel = paragraph.ownerDocument.createElement("div");
    sentinel.setAttribute(ANNOTATION_CALLOUT_ATTR, encodeCalloutAttr(callout));
    // Single placeholder so Turndown's blankRule keeps the node; avoids
    // duplicating the full callout through the escape pass.
    sentinel.textContent = "\u200B";
    paragraph.replaceWith(sentinel);
  }
}

/**
 * Resolve a `span.citation[data-citation]` to the user's cite syntax in-rule.
 * Each cited item resolves to one citekey via DB → embedded map → `${key}?`
 * sentinel; a multi-item mark renders through one `renderCite` call so the
 * template joins them. A mark whose every cited item is unresolvable (no DB hit,
 * no embedded entry, no parseable key) passes through as raw HTML.
 *
 * Turndown does not escape rule-replacement output, so the cite syntax survives
 * unescaped. `.trim()` strips the template's structural newlines (e.g.
 * `cite.eta`'s trailing `\n`) so the mark stays inline.
 */
function resolveCitation(
  deps: NoteParserDeps,
): TurndownService.ReplacementFunction {
  return (_content, node) => {
    const el = node as Element;
    const info = parseCitation(el);
    if (!info) return el.outerHTML;
    const items = info.citationItems.map((item) => ({
      citationKey: resolveCitekey(item, deps.citationMap, deps),
    }));
    if (items.every((item) => item.citationKey === null)) return el.outerHTML;
    return deps.renderCite(items).trim();
  };
}

/**
 * Resolve one cited item to a single citekey: the live DB by its Zotero key,
 * else the note's embedded snapshot map by any of its URIs, else a visible
 * `${key}?` sentinel. `null` only when the item has no parseable key at all
 * (every URI failed to parse into a ref) and the embedded map also misses.
 */
function resolveCitekey(
  item: CitationItem,
  embedded: ReadonlyMap<string, string>,
  deps: Pick<NoteParserDeps, "client" | "libraryID">,
): string | null {
  const { ref } = item;
  if (ref) {
    const fromDb = getCitekeyByItemKey(deps.client, deps.libraryID, ref.key);
    if (fromDb) return fromDb;
  }
  for (const uri of item.uris) {
    const fromEmbedded = embedded.get(uri);
    if (fromEmbedded) return fromEmbedded;
  }
  return ref ? `${ref.key}?` : null;
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
  deps: NoteParserDeps,
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

    const filename =
      attachmentToTemplateData(attachment).filename ?? attachment.key;
    const link = deps.resolveLink({
      sourcePath,
      vaultName: `${attachment.key}-${filename}`,
    });
    return `!${link()}`;
  };
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
