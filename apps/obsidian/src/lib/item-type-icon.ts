// The Lucide icon of each Zotero item type, as Zotero's item list starts each
// row with one. Every name is in the Lucide set Obsidian bundles.
//
// @see apps/obsidian/docs/adr/0075-the-papers-layout-is-a-query-view-layout-the-library-view-offers-with-the-table.md
import type { IconName } from "obsidian";

/** The icon of a type the map does not name. */
const FALLBACK_ICON: IconName = "file";

/** Every top-level item type of the bundled Zotero schema, by name. */
export const ITEM_TYPE_ICONS: Readonly<Record<string, IconName>> = {
  artwork: "palette",
  audioRecording: "audio-lines",
  bill: "scale",
  blogPost: "globe",
  book: "book",
  bookSection: "book-open",
  case: "scale",
  computerProgram: "code",
  conferencePaper: "presentation",
  dataset: "database",
  dictionaryEntry: "book-a",
  document: "file",
  email: "mail",
  encyclopediaArticle: "book-text",
  film: "film",
  forumPost: "messages-square",
  hearing: "landmark",
  instantMessage: "message-square-text",
  interview: "mic",
  journalArticle: "file-text",
  letter: "mail",
  magazineArticle: "newspaper",
  manuscript: "scroll-text",
  map: "map",
  newspaperArticle: "newspaper",
  patent: "award",
  podcast: "audio-lines",
  preprint: "file-pen",
  presentation: "presentation",
  radioBroadcast: "radio",
  report: "file-chart-column",
  standard: "file-badge",
  statute: "scale",
  thesis: "graduation-cap",
  tvBroadcast: "tv",
  videoRecording: "film",
  webpage: "globe",
};

/** The icon of `itemType`, a document for a type the map does not name. */
export function itemTypeIcon(itemType: string | null): IconName {
  return itemType !== null && Object.hasOwn(ITEM_TYPE_ICONS, itemType)
    ? ITEM_TYPE_ICONS[itemType]!
    : FALLBACK_ICON;
}
