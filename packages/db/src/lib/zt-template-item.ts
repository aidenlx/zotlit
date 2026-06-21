import { type Temporal } from "@zotlit/shared/temporal";
import { FIELD_ALIASES } from "@zotlit/zotero-types";

import { type Creator, type Item } from "@/queries/items";

import { defineToString } from "./to-string";
import { parseItemDate, type ItemDate } from "./zt-date";
import { type ItemTag } from "./zt-tag";

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
 * Core item data in the v2 template vocabulary. Exposed as `zt` in templates.
 *
 * All Zotero fields are direct properties — `zt.title`, `zt.DOI`,
 * `zt.numPages`, etc. Item-type-specific aliases (e.g. `blogTitle`, `studio`)
 * are normalized to their canonical form. Two CSL-inspired renames:
 * - `abstractNote` → `abstract`
 * - `publicationTitle` → `containerTitle`
 */
export interface TemplateItemData {
  key: string;
  libraryID: number;
  indexedKey: string;
  itemType: string;
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

const BASE_ITEM_KEYS = new Set([
  "itemID",
  "libraryID",
  "key",
  "indexedKey",
  "dateModified",
  "creators",
  "primaryCreatorType",
  "customFields",
  "itemType",
]);

export function itemToTemplateData(
  item: Item,
  tags: readonly ItemTag[] = [],
): TemplateItemData {
  const allFields: Record<string, string> = {};

  for (const [key, val] of Object.entries(item)) {
    if (BASE_ITEM_KEYS.has(key) || typeof val !== "string") continue;
    const canonical = FIELD_ALIASES[key] ?? key;
    allFields[canonical] = val;
  }
  for (const [key, val] of item.customFields) {
    if (val != null) allFields[key] = val;
  }

  const creators = item.creators.map(toTemplateCreator);

  return {
    ...allFields,
    key: item.key,
    libraryID: item.libraryID,
    indexedKey: item.indexedKey,
    itemType: item.itemType,
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
