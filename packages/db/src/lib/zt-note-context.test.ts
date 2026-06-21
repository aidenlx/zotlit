import { describe, expect, it } from "vitest";

import { Temporal } from "@zotlit/shared/temporal";

import { type Item } from "@/queries/items";

import { USER_LIBRARY_ID } from "./constants";
import { type Annotation } from "./zt-annot";
import { type Attachment } from "./zt-attach";
import { buildNoteContext } from "./zt-note-context";
import { type ItemTag, type Tag } from "./zt-tag";

function makeItem(overrides: Partial<Item> & { itemType: string }): Item {
  return {
    itemID: 1,
    libraryID: USER_LIBRARY_ID,
    key: "ITEM2345",
    indexedKey: "ITEM2345",
    dateModified: Temporal.Instant.from("2024-01-15T10:00:00Z"),
    creators: [],
    primaryCreatorType: "author",
    customFields: new Map(),
    ...overrides,
  } as Item;
}

function makeAttachment(overrides: Partial<Attachment>): Attachment {
  return {
    itemID: 10,
    libraryID: USER_LIBRARY_ID,
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
    libraryID: USER_LIBRARY_ID,
    dateAdded: Temporal.Instant.from("2024-01-01T00:00:00Z"),
    dateModified: Temporal.Instant.from("2024-01-01T00:00:00Z"),
    type: 1,
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

function itemTag(itemID: number, tag: Tag, type: 0 | 1 = 0): ItemTag {
  return { itemID, tag, type };
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
    const itemTagRecord = { tagID: 1, name: "zt" };
    const annotTagRecord = { tagID: 2, name: "claim" };

    const ctx = buildNoteContext({
      item,
      attachments: [attachment],
      annotationsByAttachment: new Map([[attachment.itemID, [annotation]]]),
      tagsByItemID: new Map([
        [item.itemID, [itemTag(item.itemID, itemTagRecord)]],
        [annotation.itemID, [itemTag(annotation.itemID, annotTagRecord, 1)]],
      ]),
      authorsShort: "Smith et al.",
      fileLink: () => "[paper.pdf](file:///x/paper.pdf)",
      imgEmbed: (annotation) => `![[${annotation.key}.png]]`,
    });

    expect(ctx.backlink).toBe("zotero://select/library/items/ITEM2345");
    expect(ctx.tags).toEqual([
      { itemID: item.itemID, tag: itemTagRecord, type: 0 },
    ]);
    expect(ctx.tags[0]?.tag).toBe(itemTagRecord);
    expect(ctx.authorsShort).toBe("Smith et al.");

    expect(ctx.attachments).toHaveLength(1);
    expect(ctx.attachments[0]!.fileLink).toBe(
      "[paper.pdf](file:///x/paper.pdf)",
    );

    expect(ctx.annotations).toHaveLength(1);
    const annot = ctx.annotations[0]!;
    expect(annot.backlink).toBe(
      "zotero://open/library/items/ATCH0001?annotation=ANNO0001&page=5",
    );
    expect(annot.imgEmbed).toBe("![[ANNO0001.png]]");
    expect(annot.tags[0]?.tag).toBe(annotTagRecord);
    expect(annot.parentAttachment).toBe(ctx.attachments[0]);
    expect(annot.parentItem.citationKey).toBe("smith2024");

    expect(ctx.authors.map((a) => a.family)).toEqual(["Smith"]);
  });

  it("passes the resolver's image embed through, including null", () => {
    const attachment = makeAttachment({});
    const annotations: Annotation[] = [
      makeAnnotation({ itemID: 100, key: "WITHIMG1" }),
      makeAnnotation({ itemID: 101, key: "NOIMG001" }),
    ];

    const ctx = buildNoteContext({
      item: makeItem({ itemType: "journalArticle" }),
      attachments: [attachment],
      annotationsByAttachment: new Map([[attachment.itemID, annotations]]),
      tagsByItemID: new Map(),
      authorsShort: "",
      fileLink: () => "",
      imgEmbed: (annotation) =>
        annotation.key === "WITHIMG1" ? `![[${annotation.key}.png]]` : null,
    });

    expect(ctx.annotations.map((a) => a.imgEmbed)).toEqual([
      "![[WITHIMG1.png]]",
      null,
    ]);
  });

  it("resolves group backlinks from a group indexedKey", () => {
    const ctx = buildNoteContext({
      item: makeItem({
        itemType: "book",
        key: "ITEM2345",
        indexedKey: "ITEM2345g99",
      }),
      attachments: [],
      annotationsByAttachment: new Map(),
      tagsByItemID: new Map(),
      authorsShort: "",
      fileLink: () => "",
      imgEmbed: () => "",
    });
    expect(ctx.backlink).toBe("zotero://select/groups/99/items/ITEM2345");
  });
});
