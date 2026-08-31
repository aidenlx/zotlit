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

export function renderSuggestion(
  settings: SettingsService,
  hit: SearchHit,
  el: HTMLElement,
): void {
  el.empty();
  if (isChildItemFields(hit.item.fields)) return;

  el.addClasses(["zt-citations", "mod-complex"]);

  const contentEl = el.createDiv("suggestion-content");
  const titleEl = contentEl.createDiv("suggestion-title");
  const citationKey =
    "citationKey" in hit.item.fields ? hit.item.fields.citationKey : null;
  const summary = itemSummary(hit.item, hit.item.fields);
  renderTruncatedHighlight(titleEl.createSpan(), summary.title, hit.matches);

  if (settings.current?.["citation.show-citekey-in-suggester"] && citationKey) {
    contentEl.createDiv({ cls: "citekey", text: citationKey });
  }

  appendMeta(contentEl, summary.subtitle, hit.item);

  // Present only while several Libraries can contribute; see ItemLookup.
  // My Library is the implicit source, so only a group earns a label. The aux
  // slot keeps that label on the trailing edge, clear of the title.
  if (hit.library && hit.library.selector.type !== "personal") {
    el.createDiv("suggestion-aux").createSpan({
      cls: "suggestion-flair library",
      text: libraryLabel(hit.library),
    });
  }
}

/**
 * The meta line belongs to every item type: the Author Summary and year, the
 * Venue, and whichever locator fields the type records. The Venue keeps the
 * `publication` class the journal-article publication had, so theme CSS
 * written against this row still matches.
 *
 * @see docs/adr/0026-venue-resolves-the-container-role-before-the-publisher-role.md
 */
function appendMeta(
  contentEl: HTMLElement,
  subtitle: string,
  item: Item,
): void {
  const { venue } = item;
  const { volume, issue, pages } = item.baseFields;

  if (!subtitle && !venue && !volume && !issue && !pages) return;

  const metaEl = contentEl.createDiv("meta");
  if (subtitle) {
    metaEl.createSpan({ cls: "author-year", text: subtitle });
  }
  if (venue) {
    metaEl.createSpan({ cls: "publication", text: venue });
  }
  if (volume || issue) {
    const vi = metaEl.createSpan("vol-issue");
    if (volume) vi.createSpan({ cls: "volume", text: volume });
    if (issue) vi.createSpan({ cls: "issue", text: issue });
  }
  if (pages) metaEl.createSpan({ cls: "pages", text: pages });
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
