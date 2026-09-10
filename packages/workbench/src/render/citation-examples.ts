// The built-in Citation example sets a Citation Template preview renders.

import type { ItemSnapshot } from "#/snapshot/types";

import {
  citekeysToCiteTemplateData,
  narrowBaseDataToCiteItemData,
} from "@zotlit/db";
import type {
  CitationTemplateData,
  CitationVariant,
  CiteRef,
  TemplateCiteItemData,
  TemplateFilenameItemData,
} from "@zotlit/db";

import { restoreTemplateData } from "./restore-template-data";
import { SAMPLE_ANNOTATIONS } from "./sample-annotations";

import book from "#/samples/book.json" with { type: "json" };
import journalArticle from "#/samples/journal-article.json" with { type: "json" };

/** Every example set, in the order a chooser lists them. */
export const CITATION_EXAMPLE_IDS = [
  "one-item",
  "two-items",
  "item-with-page",
  "suppressed-author",
  "prefix-and-suffix",
  "annotation-citation",
] as const;

/** The id naming one built-in Citation example set. */
export type CitationExampleId = (typeof CITATION_EXAMPLE_IDS)[number];

/** The example set a Citation Template preview and the Explorer open on. */
export const DEFAULT_CITATION_EXAMPLE: CitationExampleId = "one-item";

/**
 * The Citation set a Citation Template preview renders, and the Citation
 * Variant it renders under. A null `example` means the reader chose one of
 * their own Items, whose one-item set {@link sampleItemCitation} builds.
 */
export interface CitationPreviewSelection {
  readonly variant: CitationVariant;
  readonly example: CitationExampleId | null;
}

export function isCitationExampleId(value: string): value is CitationExampleId {
  return (CITATION_EXAMPLE_IDS as readonly string[]).includes(value);
}

/**
 * The Citation data for `id` under `variant`, the same shape the suggester
 * hands the Citation Template.
 */
export function citationExampleData(
  id: CitationExampleId,
  variant: CitationVariant,
): CitationTemplateData {
  return citekeysToCiteTemplateData(exampleRefs()[id], variant);
}

/**
 * The one-item Citation set a chosen Item yields: its citation key alone, with
 * no locator, prefix, or suffix — what the suggester inserts for a plain Enter.
 */
export function sampleItemCitation(
  snapshot: ItemSnapshot,
  variant: CitationVariant,
): CitationTemplateData {
  return citekeysToCiteTemplateData([citedRef(snapshot)], variant);
}

/**
 * The page label of the Sample Annotation the `annotation-citation` example
 * pins, so the example and the annotation root's own `citation` agree on the
 * locator. The bundled set always carries the highlight; a build that lost it
 * is a defect, not a Citation with an empty locator.
 */
const HIGHLIGHT_PAGE_LABEL = highlightPageLabel();

function highlightPageLabel(): string {
  const pageLabel = SAMPLE_ANNOTATIONS.find(
    ({ id }) => id === "example:highlight",
  )?.root.pageLabel;
  if (typeof pageLabel !== "string") {
    throw new Error(
      "The bundled Sample Annotations carry no 'example:highlight' with a page label.",
    );
  }
  return pageLabel;
}

const article = journalArticle as unknown as ItemSnapshot;
const monograph = book as unknown as ItemSnapshot;

/**
 * The Sample Item every example set cites, which a preview names as the paper
 * it rendered: an example carries its own citation data, so this stands for
 * the set rather than supplying it.
 */
export const CITATION_EXAMPLE_ITEM: ItemSnapshot = article;

/**
 * The refs each example set names, built on demand. A browser without native
 * `Temporal` installs its polyfill after this module loads, and restoring a
 * Sample Item's `dateAdded` needs `Temporal`, so the restoration waits for the
 * first read instead of running at import.
 */
function exampleRefs(): Record<CitationExampleId, readonly CiteRef[]> {
  const cited = citedRef(article);
  return {
    "one-item": [cited],
    "two-items": [cited, citedRef(monograph)],
    "item-with-page": [{ ...cited, locator: "12-14", label: "page" }],
    "suppressed-author": [{ ...cited, suppressAuthor: true }],
    // Pandoc reads an affix only when it is separated from the key, so both
    // carry the space the formatter refuses to insert.
    "prefix-and-suffix": [
      { ...cited, prefix: "see ", suffix: " for a review" },
    ],
    "annotation-citation": [
      { ...cited, locator: HIGHLIGHT_PAGE_LABEL, label: "page" },
    ],
  };
}

function citedRef(snapshot: ItemSnapshot): CiteRef {
  const item = citedItem(snapshot);
  return { citationKey: item.citationKey, item };
}

/**
 * A Sample Item's cited-item data, narrowed the way a live Item is: the
 * snapshot's filename root carries the whole item vocabulary, and its three
 * note-tier additions leave with the vault and library context.
 */
function citedItem(snapshot: ItemSnapshot): TemplateCiteItemData {
  const base = restoreTemplateData(
    snapshot.roots.filename,
    snapshot.descriptors.filename,
  ) as unknown as TemplateFilenameItemData;
  const {
    authors: _authors,
    authorsShort: _authorsShort,
    collections: _collections,
    ...item
  } = narrowBaseDataToCiteItemData(base, base.citationKey);
  return item;
}
