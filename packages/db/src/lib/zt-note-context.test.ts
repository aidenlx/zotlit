import { describe, expect, it } from "vitest";

import { Temporal } from "@zotlit/shared/temporal";
import { type ItemFields } from "@zotlit/zotero-types";

import { type BaseItem, type Item } from "@/queries/items";

import { USER_LIBRARY_ID } from "./constants";
import { type Annotation } from "./zt-annot";
import { type Attachment } from "./zt-attach";
import { buildNoteContext } from "./zt-note-context";
import { type ItemTag, type Tag } from "./zt-tag";

function makeItem(
  fields: { itemType: string } & Record<string, string | null>,
  base?: Partial<BaseItem>,
): Item {
  return {
    itemID: 1,
    libraryID: USER_LIBRARY_ID,
    key: "ITEM2345",
    indexedKey: "ITEM2345",
    dateAdded: Temporal.Instant.from("2024-01-15T10:00:00Z"),
    dateModified: Temporal.Instant.from("2024-01-15T10:00:00Z"),
    creators: [],
    primaryCreatorType: "author",
    customFields: new Map(),
    groupID: null,
    ...base,
    fields: fields as ItemFields,
  };
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
    const item = makeItem(
      {
        itemType: "journalArticle",
        title: "A Study",
        citationKey: "smith2024",
      },
      {
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
      },
    );
    const attachment = makeAttachment({});
    const annotation = makeAnnotation({ comment: "<i>raw</i>" });
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
      collectionsByItemID: new Map(),
      relatedItems: [],
      authorsShort: () => "Smith et al.",
      filePath: () => "/x/paper.pdf",
      fileLink: (_attachment, page) => () =>
        page == null
          ? "[paper.pdf](file:///x/paper.pdf)"
          : `[paper.pdf](file:///x/paper.pdf#page=${page})`,
      commentToMarkdown: (html) => `md(${html})`,
      notePath: () => "",
      noteLink: () => "",
      annotationImageLink: (annotation) => () => `[[${annotation.key}.png]]`,
    });

    expect(ctx.backlink).toBe("zotero://select/library/items/ITEM2345");
    expect(ctx.tags).toEqual([
      { itemID: item.itemID, tag: itemTagRecord, type: 0 },
    ]);
    expect(ctx.tags[0]?.tag).toBe(itemTagRecord);
    expect(ctx.authorsShort).toBe("Smith et al.");

    expect(ctx.attachments).toHaveLength(1);
    expect(ctx.attachments[0]!.fileLink()).toBe(
      "[paper.pdf](file:///x/paper.pdf)",
    );

    expect(ctx.annotations).toHaveLength(1);
    const annot = ctx.annotations[0]!;
    expect(annot.backlink).toBe(
      "zotero://open/library/items/ATCH0001?annotation=ANNO0001&page=5",
    );
    expect(annot.imgLink?.()).toBe("[[ANNO0001.png]]");
    // prefix `!` to embed the excerpt image
    expect(`!${annot.imgLink?.()}`).toBe("![[ANNO0001.png]]");
    // raw HTML from the mapper; `comment` lazily converts it via commentToMarkdown
    expect(annot.commentHtml).toBe("<i>raw</i>");
    expect(annot.comment).toBe("md(<i>raw</i>)");
    // page derived from position.pageIndex (0) + 1; fileLink anchors to it
    expect(annot.page).toBe(1);
    expect(annot.fileLink()).toBe("[paper.pdf](file:///x/paper.pdf#page=1)");
    expect(ctx.attachments[0]!.filePath).toBe("/x/paper.pdf");
    expect(annot.tags[0]?.tag).toBe(annotTagRecord);
    expect(annot.parentAttachment).toBe(ctx.attachments[0]);
    expect(annot.parentItem.citationKey).toBe("smith2024");

    expect(ctx.authors.map((a) => a.family)).toEqual(["Smith"]);
  });

  it("derives a null page and unanchored fileLink for positions without a pageIndex", () => {
    const attachment = makeAttachment({ contentType: "application/epub+zip" });
    // EPUB / snapshot positions carry no `pageIndex`.
    const annotation = makeAnnotation({
      position: { type: "FragmentSelector", value: "epubcfi(/6/4!/4)" },
    });

    const ctx = buildNoteContext({
      item: makeItem({ itemType: "book" }),
      attachments: [attachment],
      annotationsByAttachment: new Map([[attachment.itemID, [annotation]]]),
      tagsByItemID: new Map(),
      collectionsByItemID: new Map(),
      relatedItems: [],
      authorsShort: () => "",
      filePath: () => null,
      fileLink: (_attachment, page) => () =>
        page == null
          ? "[book.epub](file:///x/book.epub)"
          : `[book.epub](file:///x/book.epub#page=${page})`,
      commentToMarkdown: (html) => html,
      notePath: () => "",
      noteLink: () => "",
      annotationImageLink: () => null,
    });

    const annot = ctx.annotations[0]!;
    expect(annot.page).toBeNull();
    expect(annot.fileLink()).toBe("[book.epub](file:///x/book.epub)");
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
      collectionsByItemID: new Map(),
      relatedItems: [],
      authorsShort: () => "",
      filePath: () => null,
      fileLink: () => () => "",
      commentToMarkdown: (html) => html,
      notePath: () => "",
      noteLink: () => "",
      annotationImageLink: (annotation) =>
        annotation.key === "WITHIMG1"
          ? () => `[[${annotation.key}.png]]`
          : null,
    });

    // `null` when there is no cached image; otherwise a link helper. Prefix `!`
    // to the rendered link for an embed.
    expect(
      ctx.annotations.map((a) => (a.imgLink ? `!${a.imgLink()}` : null)),
    ).toEqual(["![[WITHIMG1.png]]", null]);
    expect(ctx.annotations.map((a) => a.imgLink?.() ?? null)).toEqual([
      "[[WITHIMG1.png]]",
      null,
    ]);
  });

  it("resolves group backlinks from a group indexedKey", () => {
    const ctx = buildNoteContext({
      item: makeItem(
        { itemType: "book" },
        { key: "ITEM2345", indexedKey: "ITEM2345g99" },
      ),
      attachments: [],
      annotationsByAttachment: new Map(),
      tagsByItemID: new Map(),
      collectionsByItemID: new Map(),
      relatedItems: [],
      authorsShort: () => "",
      filePath: () => null,
      fileLink: () => () => "",
      commentToMarkdown: (html) => html,
      notePath: () => "",
      noteLink: () => "",
      annotationImageLink: () => null,
    });
    expect(ctx.backlink).toBe("zotero://select/groups/99/items/ITEM2345");
  });

  it("maps related items title-sorted with flattened authors, untitled last", () => {
    const related = [
      makeItem(
        { itemType: "journalArticle", title: "Beta", citationKey: "b2024" },
        {
          itemID: 2,
          key: "RELB2345",
          indexedKey: "RELB2345",
          creators: [
            {
              firstName: "A",
              lastName: "Adams",
              creatorType: "author",
              fieldMode: 0,
            },
            {
              firstName: "E",
              lastName: "Eng",
              creatorType: "editor",
              fieldMode: 0,
            },
          ],
        },
      ),
      makeItem(
        { itemType: "book", title: null },
        { itemID: 3, key: "RELN2345", indexedKey: "RELN2345" },
      ),
      makeItem(
        { itemType: "journalArticle", title: "Alpha" },
        { itemID: 4, key: "RELA2345", indexedKey: "RELA2345g99" },
      ),
    ];

    const betaTag = { tagID: 7, name: "method" };
    const ctx = buildNoteContext({
      item: makeItem({ itemType: "journalArticle" }),
      attachments: [],
      annotationsByAttachment: new Map(),
      tagsByItemID: new Map([[2, [itemTag(2, betaTag)]]]),
      collectionsByItemID: new Map(),
      relatedItems: related,
      authorsShort: (item) => `short:${item.key}`,
      filePath: () => null,
      fileLink: () => () => "",
      commentToMarkdown: (html) => html,
      notePath: () => "",
      noteLink: () => "",
      annotationImageLink: () => null,
    });

    expect(ctx.relatedItems.map((r) => r.title)).toEqual([
      "Alpha",
      "Beta",
      null,
    ]);
    const beta = ctx.relatedItems[1]!;
    expect(beta.backlink).toBe("zotero://select/library/items/RELB2345");
    expect(beta.authors.map((a) => a.family)).toEqual(["Adams"]);
    expect(beta.authorsShort).toBe("short:RELB2345");
    expect(beta.tags.map((t) => t.tag.name)).toEqual(["method"]);
    // group backlink resolved from the related item's own indexedKey
    expect(ctx.relatedItems[0]!.backlink).toBe(
      "zotero://select/groups/99/items/RELA2345",
    );
    // depth-1 boundary: no nested annotations / attachments / relatedItems
    expect("annotations" in beta).toBe(false);
    expect("attachments" in beta).toBe(false);
    expect("relatedItems" in beta).toBe(false);
  });

  it("attaches lazy note path and note link helpers to root and related items", () => {
    const related = makeItem(
      { itemType: "journalArticle", title: "Related", citationKey: "rel2024" },
      { itemID: 2, key: "REL12345", indexedKey: "REL12345" },
    );
    const calls: string[] = [];

    const ctx = buildNoteContext({
      item: makeItem(
        { itemType: "journalArticle", citationKey: "main2024" },
        { indexedKey: "MAIN2345" },
      ),
      attachments: [],
      annotationsByAttachment: new Map(),
      tagsByItemID: new Map(),
      collectionsByItemID: new Map(),
      relatedItems: [related],
      authorsShort: () => "",
      filePath: () => null,
      fileLink: () => () => "",
      commentToMarkdown: (html) => html,
      notePath: (item) => {
        calls.push(`path:${item.indexedKey}`);
        return `notes/${item.indexedKey}.md`;
      },
      noteLink: (item, alias) => {
        calls.push(`link:${item.indexedKey}:${alias ?? ""}`);
        return alias
          ? `[[${item.indexedKey}|${alias}]]`
          : `[[${item.indexedKey}]]`;
      },
      annotationImageLink: () => null,
    });

    expect(calls).toEqual([]);
    expect(ctx.notePath).toBe("notes/MAIN2345.md");
    expect(ctx.noteLink("Main")).toBe("[[MAIN2345|Main]]");
    expect(ctx.relatedItems[0]!.notePath).toBe("notes/REL12345.md");
    expect(ctx.relatedItems[0]!.noteLink()).toBe("[[REL12345]]");
    expect(calls).toEqual([
      "path:MAIN2345",
      "link:MAIN2345:Main",
      "path:REL12345",
      "link:REL12345:",
    ]);
  });
});
