import { renderMatches } from "obsidian";
import type { SearchMatches } from "obsidian";

import { isChildItemFields } from "@zotlit/db";
import type { Item } from "@zotlit/db";

import { itemSummary } from "@/lib/item-summary";
import { libraryLabel } from "@/services/library-scope/label";
import type { SettingsService } from "@/services/settings/service";

import type { SearchHit } from "./service";

/** CSS owns this value; JS reads it so the truncation window matches the
 *  visible column width. Themes override by setting the same variable. */
const TITLE_MAX_CHARS_VAR = "--zt-citation-title-max-chars";

/** Must match the CSS default in `views/citation-suggest/style.css`; used
 *  only when CSS hasn't loaded yet (Vitest, very early renders). */
const TITLE_MAX_CHARS_FALLBACK = 60;

/** Identifier chip: the same shape the Profile picker's badges take. It
 *  wraps under the title once the row runs out of width. */
const CITEKEY_CHIP_CLASS =
  "citekey zt:max-w-full zt:truncate zt:rounded-sm zt:bg-muted zt:px-1.5 zt:py-0.5 zt:font-mono zt:text-xs zt:leading-tight zt:font-normal zt:text-muted-foreground";

/**
 * A row is a size container so the Library label can change slot with the
 * row's width: a trailing flair from `@lg` (the 700px prompt), an inline
 * note below it (the 500px editor popup), where a flair would squeeze the
 * title to a few words. Callers put this class on the row.
 */
export const LIBRARY_ROW_CLASS = "zt:@container";

/**
 * The Library copy for a narrow row: a compact faint badge, the same shape
 * as the citekey chip, paired with {@link appendLibraryFlair}. It is a plain
 * inline box, so its text shares the baseline of the text beside it; a box
 * that clips its overflow would move its baseline to its bottom edge. A long
 * name wraps whole to the next line.
 */
export function appendLibraryBadge(
  parent: HTMLElement,
  label: string,
  cls = "",
): void {
  parent.createSpan({
    cls: `library-inline zt:@lg:hidden zt:inline zt:whitespace-nowrap zt:rounded-sm zt:bg-muted zt:px-1.5 zt:py-0.5 zt:text-xs zt:text-faint ${cls}`,
    text: label,
  });
}

/** Trailing-edge Library flair, the same slot on every item row. */
export function appendLibraryFlair(el: HTMLElement, label: string): void {
  // Obsidian's aux slot is an unlayered flex box that a utility cannot hide,
  // so the flair is drawn with the same shape from utilities instead.
  el.createDiv({
    cls: "suggestion-aux-library zt:hidden zt:@lg:flex zt:shrink-0 zt:self-center zt:ps-3 zt:pe-1 zt:text-muted-foreground zt:opacity-(--icon-opacity)",
  }).createSpan({
    cls: "library zt:block zt:truncate zt:text-xs zt:leading-tight zt:max-w-[calc(var(--zt-citation-library-max-chars)*1ch)]",
    text: label,
  });
}

export function renderSuggestion(
  settings: SettingsService,
  hit: SearchHit,
  el: HTMLElement,
): void {
  el.empty();
  if (isChildItemFields(hit.item.fields)) return;

  el.classList.add("zt-citations", "mod-complex", LIBRARY_ROW_CLASS);

  const contentEl = el.createDiv({
    cls: "suggestion-content zt:min-w-0 zt:gap-0.5",
  });
  const titleEl = contentEl.createDiv({
    cls: "suggestion-title zt:flex zt:flex-wrap zt:items-baseline zt:gap-x-2 zt:gap-y-1 zt:text-sm zt:leading-tight zt:font-medium",
  });
  const citationKey =
    "citationKey" in hit.item.fields ? hit.item.fields.citationKey : null;
  const summary = itemSummary(hit.item, hit.item.fields);
  const textEl = titleEl.createSpan({
    cls: "zt:min-w-0 zt:truncate zt:max-w-[calc(var(--zt-citation-title-max-chars)*1ch)]",
  });
  renderTruncatedHighlight(textEl, summary.title, hit.matches);
  // `renderMatches` owns the highlight spans; Obsidian bolds them and the
  // accent color makes the match findable at a glance.
  for (const match of textEl.querySelectorAll(".suggestion-highlight")) {
    match.classList.add("zt:text-accent-foreground");
  }

  if (settings.current?.["citation.show-citekey-in-suggester"] && citationKey) {
    titleEl.createSpan({ cls: CITEKEY_CHIP_CLASS, text: citationKey });
  }

  // Present only while several Libraries can contribute; see ItemLookup.
  // My Library is the implicit source, so only a group earns a label.
  const library =
    hit.library && hit.library.selector.type !== "personal"
      ? libraryLabel(hit.library)
      : null;
  appendMeta(contentEl, {
    subtitle: summary.subtitle,
    item: hit.item,
    library,
  });
  if (library) appendLibraryFlair(el, library);
}

/**
 * The meta line belongs to every item type: the Author Summary and year, the
 * Venue, and whichever locator fields the type records, as one comma-joined
 * line. The Venue keeps the `publication` class the journal-article
 * publication had, so theme CSS written against this row still matches.
 * On a narrow row a Library badge ends the line, set apart from the
 * bibliographic text because it is a source, not a part of it.
 *
 * @see docs/adr/0026-venue-resolves-the-container-role-before-the-publisher-role.md
 */
function appendMeta(
  contentEl: HTMLElement,
  {
    subtitle,
    item,
    library,
  }: { subtitle: string; item: Item; library: string | null },
): void {
  const { venue } = item;
  const { volume, issue, pages } = item.baseFields;

  if (!subtitle && !venue && !volume && !issue && !pages && !library) return;

  const metaEl = contentEl.createDiv({
    cls: "meta zt:text-xs zt:leading-tight zt:text-muted-foreground",
  });
  let parts = 0;
  const separate = () => {
    if (parts > 0) metaEl.append(", ");
    parts += 1;
  };
  if (subtitle) {
    separate();
    metaEl.createSpan({ cls: "author-year", text: subtitle });
  }
  if (venue) {
    separate();
    metaEl.createSpan({ cls: "publication zt:italic", text: venue });
  }
  if (volume || issue) {
    separate();
    const vi = metaEl.createSpan("vol-issue");
    if (volume) vi.createSpan({ cls: "volume", text: volume });
    if (issue) {
      vi.append("(");
      vi.createSpan({ cls: "issue", text: issue });
      vi.append(")");
    }
  }
  if (pages) {
    separate();
    metaEl.createSpan({ cls: "pages", text: pages });
  }
  if (library)
    appendLibraryBadge(metaEl, library, parts > 0 ? "zt:ms-1.5" : "");
}

/**
 * Render `text` into `el` with highlights, scrolling the visible window to
 * keep the first match in view when `text` exceeds the column budget.
 */
function renderTruncatedHighlight(
  el: HTMLElement,
  text: string,
  matches: SearchMatches,
): void {
  const maxChars = readTitleMaxChars(el);
  if (text.length <= maxChars || matches.length === 0) {
    renderMatches(el, text.substring(0, maxChars), matches);
    if (matches.length === 0 && text.length > maxChars) el.appendText("…");
    return;
  }

  // Leave ~1/3 of the budget as context before the first match, the rest
  // stretches past it. Shift left if the match would otherwise sit at the
  // very edge.
  const firstMatch = matches[0]!;
  const matchLen = firstMatch[1] - firstMatch[0];
  const contextBefore = Math.floor((maxChars - matchLen) / 3);
  let windowStart = Math.max(0, firstMatch[0] - contextBefore);
  const windowEnd = Math.min(text.length, windowStart + maxChars);
  if (windowEnd === text.length) {
    windowStart = Math.max(0, windowEnd - maxChars);
  }

  if (windowStart > 0) el.appendText("…");
  renderMatches(
    el,
    text.substring(windowStart, windowEnd),
    matches,
    -windowStart,
  );
  if (windowEnd < text.length) el.appendText("…");
}

// Cached after first successful read; the CSS value is plugin-session
// stable, and `getComputedStyle` would otherwise fire per row per keystroke.
let cachedTitleMaxChars: number | null = null;

function readTitleMaxChars(el: HTMLElement): number {
  if (cachedTitleMaxChars !== null) return cachedTitleMaxChars;
  if (typeof window === "undefined") return TITLE_MAX_CHARS_FALLBACK;
  const raw = getComputedStyle(el).getPropertyValue(TITLE_MAX_CHARS_VAR).trim();
  const parsed = Number.parseInt(raw, 10);
  if (Number.isFinite(parsed) && parsed > 0) {
    cachedTitleMaxChars = parsed;
    return parsed;
  }
  return TITLE_MAX_CHARS_FALLBACK;
}
