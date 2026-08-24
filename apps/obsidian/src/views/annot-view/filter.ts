// Pure filtering and derived data for the annotation view's search & filter surfaces.
import type { AnnotViewItem } from "@zotlit/db";

export interface AnnotFilter {
  /** Case-insensitive substring query; "" disables the query group. */
  query: string;
  /** Selected swatch colors as canonical uppercase "#RRGGBB"; [] disables the color group. */
  colors: readonly string[];
  /** Selected tag IDs; [] disables the tag group. */
  tagIDs: readonly number[];
}

/**
 * Ordering for {@link deriveSwatchColors} — the Zotero reader's swatch order.
 * @see packages/db/src/lib/zt-color.ts for provenance of each hex value.
 */
const SWATCH_PALETTE_ORDER = [
  "#FFD400",
  "#FF6666",
  "#5FB236",
  "#2EA8E5",
  "#A28AE5",
  "#E56EEE",
  "#F19837",
  "#AAAAAA",
];

const HTML_TAG = /<[^>]*>/g;

function stripHtml(html: string): string {
  return html.replace(HTML_TAG, " ");
}

function matchesQuery(annot: AnnotViewItem, query: string): boolean {
  const needle = query.toLowerCase();
  if (annot.text?.toLowerCase().includes(needle)) return true;
  if (annot.comment && stripHtml(annot.comment).toLowerCase().includes(needle))
    return true;
  if (annot.tags.some((tag) => tag.name.toLowerCase().includes(needle)))
    return true;
  if (annot.pageLabel?.toLowerCase().includes(needle)) return true;
  return false;
}

function matchesColors(
  annot: AnnotViewItem,
  colors: readonly string[],
): boolean {
  if (colors.length === 0) return true;
  return annot.color !== null && colors.includes(annot.color.toUpperCase());
}

function matchesTags(annot: AnnotViewItem, tagIDs: readonly number[]): boolean {
  return annot.tags.some((tag) => tagIDs.includes(tag.tagID));
}

export function isFilterActive(filter: AnnotFilter): boolean {
  return (
    filter.query !== "" || filter.colors.length > 0 || filter.tagIDs.length > 0
  );
}

/** Annotations surviving the filter: colors OR within group, tags OR within group, groups AND each other and the query. */
export function filterAnnotations(
  annots: readonly AnnotViewItem[],
  filter: AnnotFilter,
): AnnotViewItem[] {
  return annots.filter(
    (annot) =>
      (filter.query === "" || matchesQuery(annot, filter.query)) &&
      matchesColors(annot, filter.colors) &&
      (filter.tagIDs.length === 0 || matchesTags(annot, filter.tagIDs)),
  );
}

/** Canonical uppercase colors present in the annotations. */
function collectColors(annots: readonly AnnotViewItem[]): Set<string> {
  const seen = new Set<string>();
  for (const annot of annots) {
    if (annot.color) seen.add(annot.color.toUpperCase());
  }
  return seen;
}

/** Distinct colors present in the annotations, canonical uppercase, ordered by the Zotero reader palette; unknown colors appended in first-seen order. Null colors are skipped. */
export function deriveSwatchColors(annots: readonly AnnotViewItem[]): string[] {
  const seen = collectColors(annots);
  const known = SWATCH_PALETTE_ORDER.filter((color) => seen.has(color));
  const unknown = [...seen].filter(
    (color) => !SWATCH_PALETTE_ORDER.includes(color),
  );
  return [...known, ...unknown];
}

export interface SavedFilter {
  colors: string[];
  tagIDs: number[];
}

/**
 * Parse and prune a persisted filter selection against the loaded annotations,
 * dropping colors/tags no longer present (a vanished selection would filter
 * invisibly).
 * @returns `null` for malformed input or when nothing survives.
 */
export function sanitizeSavedFilter(
  raw: unknown,
  annots: readonly AnnotViewItem[],
): SavedFilter | null {
  if (typeof raw !== "string") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (parsed === null) return null;
  const { colors, tags } = parsed as Record<string, unknown>;
  if (!Array.isArray(colors) || !Array.isArray(tags)) return null;
  if (!colors.every((c) => typeof c === "string")) return null;
  if (!tags.every((t) => typeof t === "number")) return null;

  const availableColors = collectColors(annots);
  const availableTagIDs = new Set(
    annots.flatMap((a) => a.tags.map((t) => t.tagID)),
  );

  const survivingColors = [
    ...new Set(colors.map((c) => c.toUpperCase())),
  ].filter((c) => availableColors.has(c));
  const survivingTagIDs = [...new Set(tags)].filter((id) =>
    availableTagIDs.has(id),
  );

  if (survivingColors.length === 0 && survivingTagIDs.length === 0) return null;
  return { colors: survivingColors, tagIDs: survivingTagIDs };
}

export interface TagChip {
  tagID: number;
  name: string;
  selected: boolean;
  /** Number of annotations carrying the tag among those passing the color+query groups (the tag group is ignored for this count). */
  hitCount: number;
  /** `hitCount > 0` */
  available: boolean;
}

/** Distinct tags across the annotations, ordered alphabetically by name (localeCompare). Stable regardless of selection so the drawer never reorders on toggle. */
export function deriveTagChips(
  annots: readonly AnnotViewItem[],
  filter: AnnotFilter,
): TagChip[] {
  const availableFilter: AnnotFilter = { ...filter, tagIDs: [] };
  const tags = new Map<number, string>();
  const hitCounts = new Map<number, number>();
  for (const annot of annots) {
    const passesColorAndQuery =
      matchesColors(annot, availableFilter.colors) &&
      (availableFilter.query === "" ||
        matchesQuery(annot, availableFilter.query));
    for (const tag of annot.tags) {
      tags.set(tag.tagID, tag.name);
      if (passesColorAndQuery) {
        hitCounts.set(tag.tagID, (hitCounts.get(tag.tagID) ?? 0) + 1);
      }
    }
  }

  const chips = [...tags].map(([tagID, name]) => {
    const hitCount = hitCounts.get(tagID) ?? 0;
    return {
      tagID,
      name,
      selected: filter.tagIDs.includes(tagID),
      hitCount,
      available: hitCount > 0,
    };
  });

  return chips.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The filter bar's first-tag chip: the first selected tag (alphabetically) while
 * filtering, else the first alphabetical tag.
 * @returns `undefined` when the tag vocabulary is empty.
 */
export function pickFirstTagChip(
  chips: readonly TagChip[],
): TagChip | undefined {
  return chips.find((chip) => chip.selected) ?? chips[0];
}
