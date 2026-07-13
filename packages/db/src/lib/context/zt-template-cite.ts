// Cite-template contract: narrowed cited-item data and the Citation Item wrapper.
import { type ItemDate } from "@/lib/zt-date";
import { type Item } from "@/queries/items";

import { emptyToNull } from "./normalize";
import { cslToTemplateItem } from "./zt-csl";
import {
  itemToTemplateBaseData,
  type TemplateCreator,
  type TemplateItemBaseData,
} from "./zt-template-item";

/**
 * Cited-item data in the v2 template vocabulary, narrowed to the fields both
 * cite legs can supply — the live-DB item and the embedded CSL-JSON snapshot.
 * Vault/DB-only context ({@link TemplateItemData} tags, dates-added/modified,
 * library identity, and resolvers) is excluded: the embedded snapshot cannot
 * express it. Unresolved refs are stubbed with null fields, so a cite template
 * never null-checks the item itself.
 */
export interface TemplateCiteItemData {
  itemType: string | null;
  creators: readonly TemplateCreator[];
  primaryCreatorType: string | null;
  title: string | null;
  abstract: string | null;
  containerTitle: string | null;
  citationKey: string | null;
  /** Alias for {@link citationKey}; both stay accessible on the item. */
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

/**
 * One cited item within a Citation: the pure item data plus the
 * citation-scoped properties, which never live on the item. Exposed to cite
 * templates as `zt.citations`, with `zt.items` the same items bare.
 */
export interface CitationTemplateItem {
  /** Never null; a stub with null fields when the ref is unresolved. */
  item: TemplateCiteItemData;
  locator: string | null;
  /** Raw CSL locator label, e.g. `"page"`. */
  label: string | null;
  /** Pandoc-style abbreviation, e.g. `"p."`; `"page"`/absent → `"p."`. */
  labelShort: string;
  suppressAuthor: boolean;
  prefix: string | null;
  suffix: string | null;
}

/** The cite-template data root (`zt`): `citations[i].item === items[i]`. */
export interface CitationTemplateData {
  items: readonly TemplateCiteItemData[];
  citations: readonly CitationTemplateItem[];
}

/**
 * A resolved ref's citation-scoped properties, as carried by the note-import
 * parser leg. The DB-query leg (citation-suggest) omits these and gets the
 * {@link toCitationItem} defaults.
 */
export interface CiteRef {
  citationKey: string | null;
  /**
   * The cited item's data, when resolved: the live DB row, or already-narrowed
   * data from a fallback leg (e.g. the embedded CSL-JSON snapshot, via
   * {@link resolveCitedItem}). A citekey-only stub otherwise.
   */
  item?: Item | TemplateCiteItemData;
  locator?: string | null;
  label?: string | null;
  labelShort?: string;
  suppressAuthor?: boolean;
  prefix?: string | null;
  suffix?: string | null;
}

/**
 * A {@link CiteRef} with every citation-scoped property resolved (never
 * omitted), as produced by the note-import parser leg — the DB-query leg is
 * the only caller relying on {@link CiteRef}'s optionality/defaults.
 */
export type ResolvedCiteRef = Required<Omit<CiteRef, "item">> &
  Pick<CiteRef, "item">;

/**
 * Build the cite-template contract from resolved refs — a real DB item is
 * narrowed onto {@link TemplateCiteItemData} when supplied, else a
 * citekey-only stub — wrapped in a Citation Item carrying each ref's
 * citation-scoped properties (locator/label/suppress-author/prefix/suffix),
 * defaulted when a caller (the DB-query leg) doesn't supply them. The ref's
 * own `citationKey` always wins over the item's, so legs may mix (e.g. an
 * embedded-snapshot key with live DB item data).
 */
export function citekeysToCiteTemplateData(
  refs: readonly CiteRef[],
): CitationTemplateData {
  const citations = refs.map((ref) => {
    const item = ref.item
      ? isDbItem(ref.item)
        ? narrowToCiteItemData(ref.item, ref.citationKey)
        : {
            ...ref.item,
            citationKey: emptyToNull(ref.citationKey),
            citekey: emptyToNull(ref.citationKey),
          }
      : stubCiteItem(ref.citationKey);
    return toCitationItem(item, ref);
  });
  return { items: citations.map((c) => c.item), citations };
}

/** A raw DB {@link Item} carries `fields`; already-narrowed cite data never does. */
function isDbItem(item: Item | TemplateCiteItemData): item is Item {
  return "fields" in item;
}

/**
 * Narrow a full DB {@link Item} onto {@link TemplateCiteItemData}: the same
 * field vocabulary as {@link TemplateItemData}, dropping vault/DB-only context
 * (tags, dates-added/modified, library identity) the embedded CSL-JSON
 * snapshot leg can't express. `citationKey`/`citekey` are overridden with the
 * ref's already-resolved key rather than the item's own.
 */
function narrowToCiteItemData(
  item: Item,
  citationKey: string | null,
): TemplateCiteItemData {
  return narrowBaseDataToCiteItemData(
    itemToTemplateBaseData({ item, tags: [] }),
    citationKey,
  );
}

/**
 * Narrow any already-built {@link TemplateItemBaseData} (e.g. the annotation
 * path's `TemplateParentItemData`) onto {@link TemplateCiteItemData},
 * dropping the same vault/DB-only context {@link narrowToCiteItemData} strips
 * from a raw DB item. Exported for callers (the annotation-citation path)
 * that build a {@link CiteRef} from template data rather than a raw DB item.
 */
export function narrowBaseDataToCiteItemData(
  base: TemplateItemBaseData,
  citationKey: string | null,
): TemplateCiteItemData {
  const {
    key: _key,
    groupID: _groupID,
    libraryID: _libraryID,
    indexedKey: _indexedKey,
    dateAdded: _dateAdded,
    dateModified: _dateModified,
    tags: _tags,
    // Parent-item resolvers (present when narrowing a TemplateParentItemData via
    // the annotation-citation leg); excluded like the other vault/DB context.
    notePath: _notePath,
    noteLink: _noteLink,
    // Cite/CSL output feeds the raw CSL `note` variable, so the parsed
    // ItemExtra is flattened back to its verbatim raw string here.
    extra,
    ...rest
  } = base;
  const key = emptyToNull(citationKey);
  return {
    ...rest,
    extra: extra?.raw ?? null,
    citationKey: key,
    citekey: key,
  };
}

/**
 * The three-tier Citation item-data policy (ADR-0003), as one named function:
 * the live DB row wins, else the note's embedded CSL-JSON snapshot, else a
 * citekey-only stub. The already-resolved citation key — which may originate in
 * a different tier than the item data (e.g. an embedded-snapshot key over live
 * DB data) — is stamped onto whichever tier supplies the data.
 *
 * The note-import parser leg calls this after fetching the live row and locating
 * the embedded snapshot; other legs build their {@link CiteRef} `item` directly.
 *
 * @param dbItem - the cited item's live DB row, when one was found
 * @param snapshot - the note's embedded CSL-JSON `itemData` for this ref, when present
 * @param citationKey - the ref's already-resolved citation key
 */
export function resolveCitedItem(
  dbItem: Item | undefined,
  snapshot: Record<string, unknown> | undefined,
  citationKey: string | null,
): TemplateCiteItemData {
  if (dbItem) return narrowToCiteItemData(dbItem, citationKey);
  if (snapshot) {
    const key = emptyToNull(citationKey);
    return {
      ...cslToTemplateItem(snapshot),
      citationKey: key,
      citekey: key,
    };
  }
  return stubCiteItem(citationKey);
}

function stubCiteItem(citationKey: string | null): TemplateCiteItemData {
  const key = emptyToNull(citationKey);
  return {
    itemType: null,
    creators: [],
    primaryCreatorType: null,
    title: null,
    abstract: null,
    containerTitle: null,
    citationKey: key,
    citekey: key,
    date: null,
    shortTitle: null,
    DOI: null,
    url: null,
    ISBN: null,
    ISSN: null,
    volume: null,
    issue: null,
    pages: null,
    publisher: null,
    place: null,
    edition: null,
    language: null,
    extra: null,
  };
}

/**
 * Fallback `labelShort` for an absent/unrecognized CSL locator label — Pandoc's
 * own default locator term. Shared with the note-import parser's
 * `pandocLocatorLabel`, which owns the full label vocabulary but defers to
 * this constant for its own fallback case.
 */
export const DEFAULT_LOCATOR_LABEL_SHORT = "p.";

function toCitationItem(
  item: TemplateCiteItemData,
  props: Omit<CiteRef, "citationKey"> = {},
): CitationTemplateItem {
  return {
    item,
    locator: emptyToNull(props.locator ?? null),
    label: emptyToNull(props.label ?? null),
    labelShort: props.labelShort ?? DEFAULT_LOCATOR_LABEL_SHORT,
    suppressAuthor: props.suppressAuthor ?? false,
    prefix: emptyToNull(props.prefix ?? null),
    suffix: emptyToNull(props.suffix ?? null),
  };
}
