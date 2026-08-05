// Zotero note HTML → Obsidian Markdown: schema gate, an annotation-template
// prepass, and in-rule resolution of annotation excerpts, citation marks, and
// embedded images.
import { distinct } from "@std/collections";
import type TurndownService from "turndown";

import {
  annotationColorToName,
  annotationOpenUri,
  attachmentToTemplateData,
  DEFAULT_LOCATOR_LABEL_SHORT,
  getAttachmentByKey,
  getItemsByKey,
  getLibraryByGroupID,
  resolveCitedItem,
  type Attachment,
  type CitationItem,
  type Item,
  type ResolvedCiteRef,
  type ZoteroRef,
} from "@zotlit/db";
import { type NodeDatabaseClient } from "@zotlit/db/client/node";
import {
  attachmentAbsPath,
  parseAttachmentPath,
  type AttachmentPathContext,
} from "@zotlit/db/path";

import * as m from "@/lib/i18n/generated/messages";
import { getLogger } from "@/lib/log";
import {
  ANNOTATION_CALLOUT_ATTR,
  createNoteTurndown,
  encodeCalloutAttr,
} from "@/lib/turndown";
import { renderColorMark, type ColorMarkKind } from "@/lib/turndown/color-mark";
import {
  type AttachmentImport,
  type SourceOrigin,
} from "@/services/attachment-import/service";

import {
  findAnnotationParagraphs,
  parseAnnotation,
  parseCitation,
  parseEmbeddedCitations,
  parseEmbeddedItemSnapshots,
  parseNoteSchema,
  type NoteAnnotation,
} from "./note-marks";

const logger = getLogger(["note-import", "note-parser"]);

/** Per-note dependencies wiring every DB/link-backed resolver in
 * {@link createNoteParser}. */
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
  /**
   * The same snapshot's full CSL-JSON item data per cited URI — the item-data
   * fallback when a ref's live DB row can't be resolved (cross-library cite,
   * degraded DB). Read off the schema container by {@link parseNote}.
   */
  citationSnapshots: ReadonlyMap<string, Record<string, unknown>>;
  /** Render the resolved cited items through the user's `cite` template. */
  renderCite: RenderCite;
  /** Resolves `storage:` / linked attachment paths to absolute filesystem paths. */
  pathContext: AttachmentPathContext;
  /**
   * Decides each resolved image against the canonical roots, copies an
   * approved one into the vault, and returns its embed link.
   */
  attachmentImport: Pick<AttachmentImport, "decide" | "resolveLink">;
}

/** Render cited items through the user's `cite` template. */
export type RenderCite = (items: readonly ResolvedCiteRef[]) => string;

/**
 * Caller-supplied subset of {@link NoteParserDeps}; `parseNote` fills
 * `citationMap`. `renderAnnotationParagraph` lives here, not on
 * {@link NoteParserDeps}: it drives the prepass, never a Turndown rule.
 */
export type ParseNoteDeps = Omit<
  NoteParserDeps,
  "citationMap" | "citationSnapshots"
> & {
  /**
   * Render this note's clean single-annotation paragraphs through the user's
   * `annotation` template in one batch. The service supplies this with the
   * per-note attachment-import batch already bound, so any excerpt-cache image
   * copies into that note's attachment folder. A key absent from the result declines (the
   * annotation is gone from the DB); a present-but-blank callout is dropped by
   * the prepass. A declined paragraph falls to inline conversion —
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
 * with the highlight/underline excerpt resolver and the DB/link-backed citation
 * + embedded-image resolvers all wired from `deps`. Built fresh per note
 * (sub-millisecond) so each rule closes over that note's deps.
 *
 * @param Turndown - Obsidian's `TurndownService` global at runtime; the npm
 *   package in tests.
 */
export function createNoteParser(
  Turndown: typeof TurndownService,
  deps: NoteParserDeps,
): TurndownService {
  return createNoteTurndown(Turndown, {
    annotationExcerpt: resolveAnnotationExcerpt,
    citation: resolveCitation(deps),
    embeddedImage: resolveEmbeddedImage(deps),
  });
}

/**
 * Convert a Zotero note's stored HTML to Obsidian-flavored Markdown, building a
 * per-note Turndown that resolves highlight / underline excerpts to linked
 * inline marks, citation marks to the user's cite syntax, and embedded images to
 * real vault embeds.
 *
 * Notes below {@link parseNoteSchema}'s supported schema version convert to a
 * legacy-format callout instead; HTML with no schema container (empty or
 * non-note input) yields `""`.
 *
 * @param Turndown - Obsidian's `TurndownService` global at runtime; the npm
 *   package in tests.
 * @param html - the note's stored HTML (the `zotero-note znv1` storage wrapper
 *   is tolerated — the schema container is located within).
 */
export function parseNote(
  Turndown: typeof TurndownService,
  html: string,
  deps: ParseNoteDeps,
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
  const { renderAnnotationParagraph, ...parserDeps } = deps;
  if (renderAnnotationParagraph) {
    subsumeAnnotationParagraphs(schema.container, renderAnnotationParagraph);
  }
  const td = createNoteParser(Turndown, {
    ...parserDeps,
    citationMap: parseEmbeddedCitations(schema.container),
    citationSnapshots: parseEmbeddedItemSnapshots(schema.container),
  });
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
    const raw = callouts.get(annotationKey);
    if (raw === undefined) continue;
    // Collapse blank runs and trim edges within this self-contained callout
    // block only — never a global post-pass (contrast the removed
    // EXTRA_BLANK_LINES pass, de520fe2), since that would also flatten
    // intentional blank lines inside the note body's own code/math blocks.
    // A custom `annotation` template's un-`bq()`-wrapped output is the only
    // path that reaches here without already being trimmed.
    const callout = raw.replaceAll(/\n{3,}/g, "\n\n").trim();
    if (callout === "") continue;
    // `ownerDocument` here is a detached `DOMParser` document (see line 152),
    // not the app's window document, so `createDiv()`/`.win` aren't available.
    // eslint-disable-next-line obsidianmd/prefer-create-el
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
    const dbItems = fetchCitedDbItems(info.citationItems, deps);
    const items = info.citationItems.map((item) => {
      const dbItem = item.ref
        ? dbItems.get(
            dbItemMapKey(citedLibraryID(item.ref, deps), item.ref.key),
          )
        : undefined;
      const citationKey = resolveCitekey(item, dbItem, deps.citationMap);
      return {
        citationKey,
        item: resolveCitedItem(
          dbItem,
          findEmbeddedSnapshot(item, deps.citationSnapshots),
          citationKey,
        ),
        locator: item.locator ?? null,
        label: item.label ?? null,
        labelShort: pandocLocatorLabel(item.label),
        suppressAuthor: item.suppressAuthor ?? false,
        prefix: item.prefix ?? null,
        suffix: item.suffix ?? null,
      };
    });
    if (items.every((item) => item.citationKey === null)) return el.outerHTML;
    return deps.renderCite(items).trim();
  };
}

/**
 * Fetch every cited item's live DB row up front, grouped by the cited
 * library so a mark citing items across libraries (a cross-library
 * citation) issues one `getItemsByKey` call per library rather than one per
 * item. Items with no parseable ref (malformed URI) are skipped — they
 * resolve through the embedded-snapshot/sentinel path only.
 */
function fetchCitedDbItems(
  citationItems: readonly CitationItem[],
  deps: Pick<NoteParserDeps, "client" | "libraryID">,
): ReadonlyMap<string, Item> {
  const keysByLibrary = new Map<number, string[]>();
  for (const { ref } of citationItems) {
    if (!ref) continue;
    const libraryID = citedLibraryID(ref, deps);
    const keys = keysByLibrary.get(libraryID);
    if (keys) keys.push(ref.key);
    else keysByLibrary.set(libraryID, [ref.key]);
  }
  const items = new Map<string, Item>();
  for (const [libraryID, keys] of keysByLibrary) {
    const rows = getItemsByKey(deps.client, libraryID, keys) ?? [];
    for (const item of rows) {
      items.set(dbItemMapKey(libraryID, item.key), item);
    }
  }
  return items;
}

function dbItemMapKey(libraryID: number, key: string): string {
  return `${libraryID}:${key}`;
}

/**
 * Pandoc-style abbreviation for a raw CSL locator label (e.g. `"chapter"` →
 * `"chap."`). An absent or unrecognized label (custom producer, `"page"`
 * itself) falls back to {@link DEFAULT_LOCATOR_LABEL_SHORT}, matching
 * Pandoc's own default locator term.
 *
 * @see https://github.com/citation-style-language/locales/blob/master/locales-en-US.xml
 *   (short-form locator terms; Pandoc resolves locator abbreviations against
 *   the CSL locale, not a Pandoc-specific table)
 */
const PANDOC_LOCATOR_LABELS: Readonly<Record<string, string>> = {
  book: "bk.",
  chapter: "chap.",
  column: "col.",
  figure: "fig.",
  folio: "fol.",
  issue: "no.",
  line: "l.",
  note: "n.",
  opus: "op.",
  paragraph: "para.",
  part: "pt.",
  section: "sec.",
  "sub-verbo": "s.v.",
  verse: "v.",
  volume: "vol.",
};

function pandocLocatorLabel(label: string | undefined): string {
  if (label && Object.hasOwn(PANDOC_LOCATOR_LABELS, label)) {
    return PANDOC_LOCATOR_LABELS[label]!;
  }
  return DEFAULT_LOCATOR_LABEL_SHORT;
}

/**
 * Resolve one cited item to a single citekey: the already-fetched live DB row's
 * own citation key, else the note's embedded snapshot map by any of its URIs,
 * else a visible `${key}?` sentinel. `null` only when the item has no
 * parseable key at all (every URI failed to parse into a ref) and the
 * embedded map also misses.
 */
function resolveCitekey(
  item: CitationItem,
  dbItem: Item | undefined,
  embedded: ReadonlyMap<string, string>,
): string | null {
  const { ref } = item;
  if (dbItem && "citationKey" in dbItem.fields && dbItem.fields.citationKey) {
    return dbItem.fields.citationKey;
  }
  for (const uri of item.uris) {
    const fromEmbedded = embedded.get(uri);
    if (fromEmbedded) return fromEmbedded;
  }
  return ref ? `${ref.key}?` : null;
}

/**
 * The note's embedded CSL-JSON snapshot for a cited item — the item-data
 * fallback {@link resolveCitedItem} narrows when the live DB has no row
 * (cross-library cite, degraded DB). Tried against every URI of the citation
 * item, mirroring {@link resolveCitekey}'s embedded-map lookup.
 */
function findEmbeddedSnapshot(
  item: CitationItem,
  snapshots: ReadonlyMap<string, Record<string, unknown>>,
): Record<string, unknown> | undefined {
  for (const uri of item.uris) {
    const itemData = snapshots.get(uri);
    if (itemData) return itemData;
  }
  return undefined;
}

/**
 * Resolve the library a cited ref's key must be looked up in: the note's own
 * library for a user-library ref, else the library backing the ref's group
 * (a cross-library citation, e.g. a personal-library note citing a group
 * item). Falls back to the note's library when the group can't be resolved
 * (not yet synced locally), matching the DB-miss → embedded → sentinel chain
 * that already handles an unresolvable citekey.
 */
function citedLibraryID(
  ref: ZoteroRef,
  deps: Pick<NoteParserDeps, "client" | "libraryID">,
): number {
  if (ref.libraryType !== "group" || ref.groupID === null)
    return deps.libraryID;
  return (
    getLibraryByGroupID(deps.client, ref.groupID)?.libraryID ?? deps.libraryID
  );
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
  let kind: ColorMarkKind = "highlight";
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
    const link = deps.attachmentImport.resolveLink({
      source: deps.attachmentImport.decide(
        sourcePath,
        attachmentPathOrigin(attachment),
      ),
      vaultName: `${attachment.key}-${filename}`,
    });
    return `!${link()}`;
  };
}

/**
 * Classify an embedded image's resolved path into the {@link SourceOrigin}
 * the source decision carries. Only called once `attachmentAbsPath`
 * has already returned a resolvable path, so the URL/unknown kinds — the only
 * ones `attachmentAbsPath` doesn't resolve to a path — are unreachable here.
 */
function attachmentPathOrigin(attachment: Attachment): SourceOrigin {
  const { kind } = parseAttachmentPath(
    attachment.path,
    attachment.linkMode,
    attachment.key,
  );
  switch (kind) {
    case "storage":
    case "linked-base":
    case "linked-absolute":
      return kind;
    case "linked-url":
    case "unknown":
      throw new Error(
        `Embedded image attachment has no resolvable origin: ${kind}`,
      );
  }
}

/**
 * Render a highlight/underline excerpt as an inline mark linking back to the
 * Zotero annotation. Delegates the mark HTML to {@link renderColorMark} (color
 * resolved through {@link annotationColorToName}); an unmapped hex (rare
 * Mendeley imports) falls back to the inline hex, and a missing attachment ref
 * drops the link but keeps the mark.
 */
function renderAnnotationMark(
  kind: ColorMarkKind,
  info: NoteAnnotation,
  text: string,
): string {
  const mark = renderColorMark(
    kind,
    text,
    info.color
      ? { raw: info.color, name: annotationColorToName(info.color) }
      : null,
  );
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
