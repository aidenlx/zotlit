import { renderMatches, type SearchMatches } from "obsidian";
import { regex } from "arkregex";
import {
  isJournalArticleItem,
  type Creator,
  type JournalArticleItem,
} from "@zotlit/db";
import type { SettingsService } from "@/services/settings/service";
import type { SearchHit } from "./engine";

const YEAR = regex("\\d{4}");

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
  const title = hit.item.title ?? hit.item.citekey ?? hit.item.key;
  renderTruncatedHighlight(titleEl.createSpan(), title, hit.matches);

  if (
    settings.current?.["citation.show-citekey-in-suggester"] &&
    hit.item.citekey
  ) {
    contentEl.createDiv({ cls: "citekey", text: hit.item.citekey });
  }

  if (isJournalArticleItem(hit.item)) {
    appendJournalMeta(contentEl, hit.item);
  }
}

function appendJournalMeta(
  contentEl: HTMLElement,
  item: JournalArticleItem,
): void {
  const creators = creatorSummary(item.creators);
  const year = yearFromDate(item.date);
  const { publicationTitle, volume, issue, pages } = item;

  const hasAuthorYear = !!creators || !!year;
  if (!hasAuthorYear && !publicationTitle && !volume && !issue && !pages) {
    return;
  }

  const metaEl = contentEl.createDiv("meta");
  if (hasAuthorYear) {
    const ay = metaEl.createSpan("author-year");
    if (creators) ay.createSpan({ cls: "creators", text: creators });
    if (year) ay.createSpan({ cls: "date", text: year });
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

function creatorSummary(creators: Creator[]): string {
  if (creators.length === 0) return "";
  const names = creators
    .map((creator) => creator.lastName ?? creator.firstName)
    .filter((name): name is string => !!name);
  if (names.length === 0) return "";
  if (names.length === 1) return names[0]!;
  return `${names[0]} et al.`;
}

function yearFromDate(date: string | null): string {
  return date?.match(YEAR)?.[0] ?? "";
}
