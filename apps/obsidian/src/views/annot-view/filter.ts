// Pure filtering and derived data for the annotation view's search & filter surfaces.
import type { AnnotationRecord } from "@/services/annotation-repository/service";

export interface AnnotFilter {
  /** Case-insensitive substring query; "" disables the query group. */
  query: string;
  /** Selected swatch colors as canonical uppercase "#RRGGBB"; [] disables the color group. */
  colors: readonly string[];
  /** Selected tag names; [] disables the tag group. */
  tags: readonly string[];
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

function matchesQuery(annot: AnnotationRecord, query: string): boolean {
  const needle = query.toLowerCase();
  if (annot.text?.toLowerCase().includes(needle)) return true;
  if (annot.comment && stripHtml(annot.comment).toLowerCase().includes(needle))
    return true;
  if (annot.tags.some((tag) => tag.toLowerCase().includes(needle))) return true;
  if (annot.pageLabel?.toLowerCase().includes(needle)) return true;
  return false;
}

function matchesColors(
  annot: AnnotationRecord,
  colors: readonly string[],
): boolean {
  if (colors.length === 0) return true;
  return annot.color !== null && colors.includes(annot.color.toUpperCase());
}

function matchesTags(
  annot: AnnotationRecord,
  tags: readonly string[],
): boolean {
  return annot.tags.some((tag) => tags.includes(tag));
}

export function isFilterActive(filter: AnnotFilter): boolean {
  return (
    filter.query !== "" || filter.colors.length > 0 || filter.tags.length > 0
  );
}

/** Annotations surviving the filter: colors OR within group, tags OR within group, groups AND each other and the query. */
export function filterAnnotations(
  annots: readonly AnnotationRecord[],
  filter: AnnotFilter,
): AnnotationRecord[] {
  return annots.filter(
    (annot) =>
      (filter.query === "" || matchesQuery(annot, filter.query)) &&
      matchesColors(annot, filter.colors) &&
      (filter.tags.length === 0 || matchesTags(annot, filter.tags)),
  );
}

/** Canonical uppercase colors present in the annotations. */
function collectColors(annots: readonly AnnotationRecord[]): Set<string> {
  const seen = new Set<string>();
  for (const annot of annots) {
    if (annot.color) seen.add(annot.color.toUpperCase());
  }
  return seen;
}

/** Distinct colors present in the annotations, canonical uppercase, ordered by the Zotero reader palette; unknown colors appended in first-seen order. Null colors are skipped. */
export function deriveSwatchColors(
  annots: readonly AnnotationRecord[],
): string[] {
  const seen = collectColors(annots);
  const known = SWATCH_PALETTE_ORDER.filter((color) => seen.has(color));
  const unknown = [...seen].filter(
    (color) => !SWATCH_PALETTE_ORDER.includes(color),
  );
  return [...known, ...unknown];
}

export interface SavedFilter {
  colors: string[];
  tags: string[];
}

/**
 * Parse and prune a persisted filter selection against the loaded annotations,
 * dropping colors/tags no longer present (a vanished selection would filter
 * invisibly).
 *
 * A filter saved by a released build that still keyed tags by numeric id
 * fails the `typeof t === "string"` check below and reads as absent — a
 * graceful lapse of a stale selection, not a bug.
 * @returns `null` for malformed input or when nothing survives.
 */
export function sanitizeSavedFilter(
  raw: unknown,
  annots: readonly AnnotationRecord[],
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
  if (!tags.every((t) => typeof t === "string")) return null;

  const availableColors = collectColors(annots);
  const availableTags = new Set(annots.flatMap((a) => a.tags));

  const survivingColors = [
    ...new Set(colors.map((c) => c.toUpperCase())),
  ].filter((c) => availableColors.has(c));
  const survivingTags = [...new Set(tags)].filter((tag) =>
    availableTags.has(tag),
  );

  if (survivingColors.length === 0 && survivingTags.length === 0) return null;
  return { colors: survivingColors, tags: survivingTags };
}

export interface TagChip {
  name: string;
  selected: boolean;
  /** Number of annotations carrying the tag among those passing the color+query groups (the tag group is ignored for this count). */
  hitCount: number;
  /** `hitCount > 0` */
  available: boolean;
}

/**
 * Distinct tags across the annotations, ordered alphabetically by name
 * (localeCompare). Stable regardless of selection so the drawer never
 * reorders on toggle.
 *
 * Keyed by name, not a numeric id — the Local API source has none, and two
 * annotations' same-named tags were already indistinguishable to a reader,
 * so they collapse into one chip here.
 */
export function deriveTagChips(
  annots: readonly AnnotationRecord[],
  filter: AnnotFilter,
): TagChip[] {
  const availableFilter: AnnotFilter = { ...filter, tags: [] };
  const seen = new Set<string>();
  const hitCounts = new Map<string, number>();
  for (const annot of annots) {
    const passesColorAndQuery =
      matchesColors(annot, availableFilter.colors) &&
      (availableFilter.query === "" ||
        matchesQuery(annot, availableFilter.query));
    for (const tag of annot.tags) {
      seen.add(tag);
      if (passesColorAndQuery) {
        hitCounts.set(tag, (hitCounts.get(tag) ?? 0) + 1);
      }
    }
  }

  const chips = [...seen].map((name) => {
    const hitCount = hitCounts.get(name) ?? 0;
    return {
      name,
      selected: filter.tags.includes(name),
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
