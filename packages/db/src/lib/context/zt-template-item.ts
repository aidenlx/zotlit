import { type Temporal } from "@zotlit/shared/temporal";
import { FIELD_ALIASES } from "@zotlit/zotero-types";

import { defineToString } from "@/lib/to-string";
import { type TemplateCollection } from "@/lib/zt-collection";
import { parseItemDate, type ItemDate } from "@/lib/zt-date";
import { type ItemTag } from "@/lib/zt-tag";
import { type Creator, type Item } from "@/queries/items";

export interface TemplateCreator {
  family: string;
  given: string;
  /** Full name for institutional / single-name authors (Zotero `fieldMode=1`). */
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
 * `zt.numPages`, etc. Item-type-specific aliases (e.g. `blogTitle`, `studio`)
 * are normalized to their canonical form. Two CSL-inspired renames:
 * - `abstractNote` → `abstract`
 * - `publicationTitle` → `containerTitle`
 */
export interface TemplateItemBaseData {
  key: string;
  groupID: number | null;
  libraryID: number;
  indexedKey: string;
  itemType: string;
  dateAdded: Temporal.Instant;
  dateModified: Temporal.Instant;

  creators: readonly TemplateCreator[];
  primaryCreatorType: string | null;
  tags: readonly ItemTag[];

  title: string | null;
  abstract: string | null;
  containerTitle: string | null;
  citationKey: string | null;
  /** Alias for {@link citationKey}; both stay accessible on `zt.*`. */
  citekey: string | null;
  date: ItemDate | null;
  shortTitle: string | null;
  DOI: string | null;
  url: string | null;
  ISBN: string | null;
  ISSN: string | null;
  volume: string | null;
  issue: string | null;
  pages: string | null;
  publisher: string | null;
  place: string | null;
  edition: string | null;
  language: string | null;
  extra: string | null;

  /** Additional Zotero fields beyond the explicitly typed ones above. */
  [field: string]: unknown;
}

/** {@link TemplateItemBaseData} plus the app-layer resolvers. Exposed as `zt` in templates. */
export interface TemplateItemData extends TemplateItemBaseData {
  /** Full vault-relative literature note path, including `.md`. `null` when unresolvable. */
  get notePath(): string | null;
  /** Obsidian Markdown link to this item's literature note. See {@link FallibleTemplateLink}. */
  noteLink: FallibleTemplateLink;
  collections: readonly TemplateCollection[];
}

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

export interface TemplateItemResolvers {
  notePath: (item: TemplateItemData) => string | null;
  noteLink: (
    item: TemplateItemData,
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
    if (key === "itemType" || typeof val !== "string") continue;
    const canonical = FIELD_ALIASES[key] ?? key;
    allFields[canonical] = val;
  }
  // Built-in fields win over a custom field of the same name.
  for (const [key, val] of item.customFields) {
    if (val != null && !(key in allFields)) allFields[key] = val;
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
    tags,

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
    extra: allFields.extra ?? null,
  };
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

/**
 * Parent literature item as seen from the standalone `annotation` template. The
 * annot-view drag-insert resolves the item's tags but omits collection rows
 * entirely — `collections` lives only on {@link TemplateItemData}. Read them
 * through the full `note` template (`zt.collections`).
 */
export interface TemplateParentItemData extends TemplateItemBaseData {
  /**
   * Always `null` — resolving the parent's real literature-note path would
   * require app-layer vault-index I/O, which the annotation path (synchronous
   * on `dragstart`) intentionally avoids. Stubbed rather than omitted so
   * `zt.parentItem.notePath` reads as "unresolved" instead of `undefined`.
   */
  notePath: string | null;
  /** Always returns `null`, for the same reason as {@link notePath}. */
  noteLink: FallibleTemplateLink;
}
