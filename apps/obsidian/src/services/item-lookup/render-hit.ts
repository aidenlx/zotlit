import { renderMatches, type SearchMatches } from "obsidian";

import { parseItemDate, type Item } from "@zotlit/db";
import { type JournalArticleFields } from "@zotlit/zotero-types";

import { type SettingsService } from "@/services/settings/service";

import { creatorSummary } from "./creator-summary";
import { type SearchHit } from "./service";

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
  el.addClass("zt-citations");

  const contentEl = el.createDiv("suggestion-content");
  const titleEl = contentEl.createDiv("suggestion-title");
  const title = "title" in hit.item.fields ? hit.item.fields.title : null;
  const citationKey =
    "citationKey" in hit.item.fields ? hit.item.fields.citationKey : null;
  const displayTitle = title ?? citationKey ?? hit.item.key;
  renderTruncatedHighlight(titleEl.createSpan(), displayTitle, hit.matches);

  if (settings.current?.["citation.show-citekey-in-suggester"] && citationKey) {
    contentEl.createDiv({ cls: "citekey", text: citationKey });
  }

  if (hit.item.fields.itemType === "journalArticle") {
    appendJournalMeta(contentEl, hit.item, hit.item.fields);
  }
}

function appendJournalMeta(
  contentEl: HTMLElement,
  item: Item,
  fields: JournalArticleFields,
): void {
  const creators = creatorSummary(item);
  const year = parseItemDate(fields.date)?.year ?? "";
  const { publicationTitle, volume, issue, pages } = fields;

  const hasAuthorYear = !!creators || !!year;
  if (!hasAuthorYear && !publicationTitle && !volume && !issue && !pages) {
    return;
  }

  const metaEl = contentEl.createDiv("meta");
  if (hasAuthorYear) {
    const ay = metaEl.createSpan("author-year");
    if (creators) ay.createSpan({ cls: "creators", text: creators });
    if (year) ay.createSpan({ cls: "date", text: year.toString() });
  }
  if (publicationTitle) {
    metaEl.createSpan({ cls: "publication", text: publicationTitle });
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
