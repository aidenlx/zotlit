import { type Temporal } from "@zotlit/shared/temporal";
import { FIELD_ALIASES } from "@zotlit/zotero-types";

import { defineToString } from "@/lib/to-string";
import { type TemplateCollection } from "@/lib/zt-collection";
import { parseItemDate, type ItemDate } from "@/lib/zt-date";
import { parseItemExtra, type ItemExtra } from "@/lib/zt-extra";
import { toTemplateTag, type ItemTag, type TemplateTag } from "@/lib/zt-tag";
import { itemSelectUri, itemWebUrl } from "@/lib/zt-uri";
import { type Creator, type Item } from "@/queries/items";

/**
 * One creator of an item, in the template vocabulary. Coerces to
 * {@link TemplateCreator.fullName} in string contexts.
 */
export interface TemplateCreator {
  /** Family / last name; empty for institutional creators. */
  family: string;
  /** Given / first name; empty for institutional creators. */
  given: string;
  /**
   * Full name for institutional / single-name authors (Zotero `fieldMode=1`);
   * `null` for personal names.
   */
  literal: string | null;
  /** Zotero creator type: `"author"`, `"editor"`, `"translator"`, etc. */
  role: string;
  /** `literal` for institutional creators, `"given family"` for personal names. */
  fullName: string;
}

/**
 * Core item data in the v2 template vocabulary, without app-layer resolvers.
 *
 * All Zotero fields are direct properties — `zt.title`, `zt.DOI`,
 * `zt.numPages`, etc. An empty-string field value is normalized away
 * (absent / `null`).
 */
export interface TemplateItemBaseData {
  /** Zotero item key, e.g. `"ABC12345"`; unique within its library. */
  key: string;
  /** Group library ID; `null` for the personal library. */
  groupID: number | null;
  /** Zotero library ID holding the item. */
  libraryID: number;
  /** {@link key} for the personal library, `KEYgGROUPID` for a group library. */
  indexedKey: string;
  /** Zotero item type, e.g. `"journalArticle"`, `"book"`. */
  itemType: string;
  /**
   * When the item was added to Zotero. Second precision — Zotero stores the
   * timestamp as a UTC string with no sub-second component. Renders as the
   * local date (e.g. `2026-06-21`) in `{{ }}` output.
   */
  dateAdded: Temporal.Instant;
  /**
   * When the item was last modified in Zotero; same precision and rendering as
   * {@link TemplateItemBaseData.dateAdded}.
   */
  dateModified: Temporal.Instant;

  /** Every creator on the item, in Zotero's own order. */
  creators: readonly TemplateCreator[];
  /**
   * The creator role Zotero treats as primary for this item type, e.g.
   * `"author"` for a journal article, `"director"` for a film; `null` when the
   * type defines none.
   */
  primaryCreatorType: string | null;
  /** Tags applied to the item. */
  tags: readonly TemplateTag[];

  /** Item title. */
  title: string | null;
  /**
   * Abstract text. The CSL-inspired rename of Zotero's `abstractNote`, which
   * stays accessible — both `zt.abstract` and `zt.abstractNote` work.
   */
  abstract: string | null;
  /**
   * Journal or container title. The CSL-inspired rename of Zotero's
   * `publicationTitle`, which stays accessible — both names work.
   */
  containerTitle: string | null;
  /** Citation key, from Better BibTeX or Zotero's native citation key. */
  citationKey: string | null;
  /** Alias for {@link citationKey}; both stay accessible on `zt.*`. */
  citekey: string | null;
  /** Publication date, parsed from Zotero's multipart `date` field. */
  date: ItemDate | null;
  /** Short title. */
  shortTitle: string | null;
  /** Digital Object Identifier. */
  DOI: string | null;
  /** Item URL. */
  url: string | null;
  /** ISBN. */
  ISBN: string | null;
  /** ISSN. */
  ISSN: string | null;
  /** Volume. */
  volume: string | null;
  /** Issue. */
  issue: string | null;
  /** Page range. */
  pages: string | null;
  /** Publisher. */
  publisher: string | null;
  /** Place of publication. */
  place: string | null;
  /** Edition. */
  edition: string | null;
  /** Language, verbatim as Zotero stores it, e.g. `"en-US"`, `"English"`. */
  language: string | null;
  /**
   * Parsed best-effort from Zotero's free-text `extra` field; prints `raw`.
   * `null` when the field is empty or absent.
   */
  extra: ItemExtra | null;

  /**
   * Item-type-specific Zotero fields beyond the typed ones above, each under
   * its canonical name — e.g. `zt.conferenceName`, `zt.numPages`. A field
   * Zotero maps to a base field is reachable through that base name alone:
   * read `blogTitle` as `zt.publicationTitle`, `studio` as `zt.publisher`,
   * `reportNumber` as `zt.number`, `thesisType` as `zt.type`.
   */
  [field: string]: unknown;
}

/** {@link TemplateItemBaseData} plus the app-layer resolvers. Exposed as `zt` in templates. */
export interface TemplateItemData extends TemplateItemBaseData {
  /** Full vault-relative literature note path, including `.md`. `null` when unresolvable. */
  get notePath(): string | null;
  /**
   * Obsidian Markdown link to this item's literature note. In Liquid it
   * renders on plain access (`{{ zt.noteLink }}`); pipe the item itself
   * through the `note_link` filter to override the alias or subpath. In Eta
   * call it with those arguments. See {@link FallibleTemplateLink}.
   */
  noteLink: FallibleTemplateLink;
  /** Collections the item belongs to, sorted by name; trashed collections excluded. */
  collections: readonly TemplateCollection[];
}

/**
 * The `zt` root of the `filename` template: an item's own
 * {@link TemplateItemBaseData}, its collections, and inert `notePath` /
 * `noteLink` stubs. The note-body context is absent — no `backlink`,
 * `weblink`, `annotations`, `attachments`, `relatedItems`, `authors`,
 * `authorsShort`, or `notes` — so naming a note stays a single-item read.
 */
export interface TemplateFilenameItemData extends TemplateItemBaseData {
  /**
   * Always `""` — the note does not exist yet when a filename is resolved.
   * Stubbed (rather than omitted) so a filename template that references
   * {@link TemplateItemData.notePath} does not throw; matches
   * {@link TemplateItemData.notePath}'s `string | null` contract.
   */
  notePath: string | null;
  /** Always returns `""`; matches {@link TemplateItemData.noteLink}'s signature. */
  noteLink: FallibleTemplateLink;
  /** Collections the item belongs to, sorted by name; trashed collections excluded. */
  collections: readonly TemplateCollection[];
}

/**
 * A lazy Markdown-link helper exposed on the template context. Called with no
 * args it renders the default link with its display text already filled in (so
 * Markdown links are never blank); pass `alias` to override the display text and
 * `subpath` to append a `#`-fragment (heading / block / `page=N`).
 */
export type TemplateLink = (alias?: string, subpath?: string) => string;

/**
 * Like {@link TemplateLink} but `null` when the target is unresolvable
 * (path collision, recursive resolution, template error).
 */
export type FallibleTemplateLink = (
  alias?: string,
  subpath?: string,
) => string | null;

/**
 * Resolvers receive the item-own {@link TemplateFilenameItemData} twin — not the
 * live {@link TemplateItemData} — so a filename template rendered during
 * note-path resolution reads inert `notePath`/`noteLink` stubs and cannot
 * re-enter resolution.
 */
export interface TemplateItemResolvers {
  notePath: (item: TemplateFilenameItemData) => string | null;
  noteLink: (
    item: TemplateFilenameItemData,
    alias?: string,
    subpath?: string,
  ) => string | null;
  /** Short author summary (e.g. `"Smith et al."`) for any item. */
  authorsShort: (item: Item) => string;
}

export function itemToTemplateBaseData({
  item,
  tags,
}: {
  item: Item;
  tags: readonly ItemTag[];
}): TemplateItemBaseData {
  const allFields: Record<string, string> = {};

  for (const [key, val] of Object.entries(item.fields)) {
    if (key === "itemType" || typeof val !== "string" || val === "") continue;
    const canonical = FIELD_ALIASES[key] ?? key;
    allFields[canonical] = val;
  }
  // Built-in fields win over a custom field of the same name.
  for (const [key, val] of item.customFields) {
    if (val != null && val !== "" && !(key in allFields)) allFields[key] = val;
  }

  const creators = item.creators.map(toTemplateCreator);

  return {
    ...allFields,
    key: item.key,
    groupID: item.groupID,
    libraryID: item.libraryID,
    indexedKey: item.indexedKey,
    itemType: item.fields.itemType,
    dateAdded: item.dateAdded,
    dateModified: item.dateModified,
    creators,
    primaryCreatorType: item.primaryCreatorType,
    tags: tags.map(toTemplateTag),

    title: allFields.title ?? null,
    // CSL-inspired aliases: the canonical source field stays accessible via the
    // `...allFields` spread, and these expose the CSL name alongside it.
    abstract: allFields.abstractNote ?? null, // ← abstractNote
    containerTitle: allFields.publicationTitle ?? null, // ← publicationTitle
    citationKey: allFields.citationKey ?? null,
    citekey: allFields.citationKey ?? null, // ← citationKey
    date: parseItemDate(allFields.date),
    shortTitle: allFields.shortTitle ?? null,
    DOI: allFields.DOI ?? null,
    url: allFields.url ?? null,
    ISBN: allFields.ISBN ?? null,
    ISSN: allFields.ISSN ?? null,
    volume: allFields.volume ?? null,
    issue: allFields.issue ?? null,
    pages: allFields.pages ?? null,
    publisher: allFields.publisher ?? null,
    place: allFields.place ?? null,
    edition: allFields.edition ?? null,
    language: allFields.language ?? null,
    extra: parseItemExtra(allFields.extra),
  };
}

/**
 * Apply after resolver getters are attached because a spread drops the
 * non-enumerable string form.
 */
export function withItemPreview<T extends TemplateItemBaseData>(item: T): T {
  return defineToString(item, function () {
    return this.title ?? this.key;
  });
}

function toTemplateCreator(c: Creator): TemplateCreator {
  if (c.fieldMode === 1) {
    const literal = c.lastName ?? "";
    return defineToString(
      {
        family: "",
        given: "",
        literal,
        role: c.creatorType,
        fullName: literal,
      },
      function () {
        return this.fullName;
      },
    );
  }
  const family = c.lastName ?? "";
  const given = c.firstName ?? "";
  return defineToString(
    {
      family,
      given,
      literal: null,
      role: c.creatorType,
      fullName: `${given} ${family}`.trim(),
    },
    function () {
      return this.fullName;
    },
  );
}

/** Creators filtered to the item's primary creator type; all when none. */
function selectPrimaryAuthors(data: TemplateItemBaseData): TemplateCreator[] {
  return data.primaryCreatorType
    ? data.creators.filter((c) => c.role === data.primaryCreatorType)
    : [...data.creators];
}

/** The app-layer convenience fields shared by every resolved item shape
 *  (note main item, related item, annotation parentItem). Centralized so a new
 *  convenience is a compile error at every projection site until supplied. */
export interface ResolvedItemCore {
  /** Zotero desktop deep link (`zotero://select/...`). */
  backlink: string;
  /** Zotero web library URL (`https://www.zotero.org/...`); `null` for a never-synced personal library. */
  weblink: string | null;
  /** Creators filtered to {@link TemplateItemBaseData.primaryCreatorType}; all when none. */
  authors: TemplateCreator[];
  /** Formatted short author string, e.g. `"Smith et al."`. */
  authorsShort: string;
}

/** Compute the {@link ResolvedItemCore} conveniences for an item. The single
 *  seam all three item-assembly sites call, so these fields never diverge. */
export function resolveItemCore(input: {
  item: Item;
  baseData: TemplateItemBaseData;
  username: string | null;
  authorsShort: (item: Item) => string;
}): ResolvedItemCore {
  return {
    backlink: itemSelectUri(input.item.key, input.item.groupID),
    weblink: itemWebUrl(input.item.key, input.item.groupID, input.username),
    authors: selectPrimaryAuthors(input.baseData),
    authorsShort: input.authorsShort(input.item),
  };
}

/**
 * Parent literature item as seen from the standalone `annotation` template. The
 * annot-view drag-insert resolves the item's tags but omits collection rows
 * entirely — `collections` lives only on {@link TemplateItemData}. Read them
 * through the full `note` template (`zt.collections`).
 */
export interface TemplateParentItemData
  extends TemplateItemBaseData, ResolvedItemCore {
  /**
   * Always `null` on a standalone annotation render (annotation-view
   * drag/insert, note import) — resolving the parent's real literature-note
   * path would require app-layer vault-index I/O, which the annotation path
   * (synchronous on `dragstart`) intentionally avoids. Stubbed rather than
   * omitted so `zt.parentItem.notePath` reads as "unresolved" instead of
   * `undefined`.
   */
  notePath: string | null;
  /** Always returns `null`, for the same reason as {@link notePath}. */
  noteLink: FallibleTemplateLink;
}
