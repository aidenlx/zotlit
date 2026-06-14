import { describe, expect, it } from "vitest";

import { type Annotation, type Attachment, type Item } from "@zotlit/db";
import { Temporal } from "@zotlit/shared/temporal";

import { buildNoteContext } from "./context";

function makeItem(overrides: Partial<Item> & { itemType: string }): Item {
  return {
    itemID: 1,
    libraryID: 1,
    key: "ITEM0001",
    indexedKey: "ITEM0001",
    dateModified: Temporal.Instant.from("2024-01-15T10:00:00Z"),
    creators: [],
    primaryCreatorType: "author",
    fields: new Map(),
    ...overrides,
  } as Item;
}

function makeAttachment(overrides: Partial<Attachment>): Attachment {
  return {
    itemID: 10,
    libraryID: 1,
    key: "ATCH0001",
    parentItemID: 1,
    path: "storage:paper.pdf",
    contentType: "application/pdf",
    linkMode: 0,
    dateAdded: Temporal.Instant.from("2024-01-01T00:00:00Z"),
    dateModified: Temporal.Instant.from("2024-01-01T00:00:00Z"),
    ...overrides,
  };
}

function makeAnnotation(overrides: Partial<Annotation>): Annotation {
  return {
    itemID: 100,
    key: "ANNO0001",
    libraryID: 1,
    dateAdded: Temporal.Instant.from("2024-01-01T00:00:00Z"),
    dateModified: Temporal.Instant.from("2024-01-01T00:00:00Z"),
    type: "highlight",
    text: "excerpt",
    comment: null,
    color: "#ffd400",
    pageLabel: "5",
    sortIndex: "0",
    position: { pageIndex: 0, rects: [] },
    authorName: null,
    isExternal: false,
    parentItemID: 10,
    parentKey: "ATCH0001",
    ...overrides,
  };
}

describe("buildNoteContext", () => {
  it("assembles backlink, attachments, flattened annotations and parents", () => {
    const item = makeItem({
      itemType: "journalArticle",
      title: "A Study",
      citationKey: "smith2024",
      creators: [
        {
          firstName: "Jane",
          lastName: "Smith",
          creatorType: "author",
          fieldMode: 0,
        },
        {
          firstName: "Ed",
          lastName: "Jones",
          creatorType: "editor",
          fieldMode: 0,
        },
      ],
    });
    const attachment = makeAttachment({});
    const annotation = makeAnnotation({});

    const ctx = buildNoteContext({
      item,
      attachments: [attachment],
      annotationsByAttachment: new Map([[attachment.itemID, [annotation]]]),
      tags: ["zt", "method"],
      authorsShort: "Smith et al.",
      fileLink: () => "[paper.pdf](file:///x/paper.pdf)",
    });

    expect(ctx.backlink).toBe("zotero://select/library/items/ITEM0001");
    expect(ctx.tags).toEqual(["zt", "method"]);
    expect(ctx.authorsShort).toBe("Smith et al.");

    expect(ctx.attachments).toHaveLength(1);
    expect(ctx.attachments[0]!.fileLink).toBe(
      "[paper.pdf](file:///x/paper.pdf)",
    );

    expect(ctx.annotations).toHaveLength(1);
    const annot = ctx.annotations[0]!;
    expect(annot.backlink).toBe(
      "zotero://open/library/items/ATCH0001?page=5&annotation=ANNO0001",
    );
    expect(annot.imgEmbed).toBe("");
    expect(annot.parentAttachment).toBe(ctx.attachments[0]);
    expect(annot.parentItem.citationKey).toBe("smith2024");

    // authors filtered to the primary creator type
    expect(ctx.authors.map((a) => a.family)).toEqual(["Smith"]);
  });

  it("resolves group backlinks from a group indexedKey", () => {
    const ctx = buildNoteContext({
      item: makeItem({
        itemType: "book",
        key: "ITEM0001",
        indexedKey: "ITEM0001g99",
      }),
      attachments: [],
      annotationsByAttachment: new Map(),
      tags: [],
      authorsShort: "",
      fileLink: () => "",
    });
    expect(ctx.backlink).toBe("zotero://select/groups/99/items/ITEM0001");
  });
});
