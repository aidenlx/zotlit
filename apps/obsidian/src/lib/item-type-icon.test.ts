import { describe, expect, it } from "vitest";

import { ITEM_TYPES } from "@zotlit/zotero-types/item-types";

import { ITEM_TYPE_ICONS, itemTypeIcon } from "./item-type-icon";

describe("itemTypeIcon", () => {
  it("draws each Zotero item type as the Lucide icon chosen for it", () => {
    expect(ITEM_TYPE_ICONS).toEqual({
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
    });
  });

  it("names every item type of the bundled Zotero schema", () => {
    const unnamed = ITEM_TYPES.map(({ name }) => name).filter(
      (name) => !Object.hasOwn(ITEM_TYPE_ICONS, name),
    );
    expect(unnamed).toEqual([]);
  });

  it("draws a document for a type the map does not name, or no type", () => {
    expect(itemTypeIcon("book")).toBe("book");
    expect(itemTypeIcon("someFutureType")).toBe("file");
    expect(itemTypeIcon("toString")).toBe("file");
    expect(itemTypeIcon(null)).toBe("file");
  });
});
