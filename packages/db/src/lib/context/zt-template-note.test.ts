import { describe, expect, it } from "vitest";

import type { ItemFields } from "@zotlit/zotero-types";

import { USER_LIBRARY_ID } from "@/lib/constants";
import type { Annotation } from "@/lib/zt-annot";
import type { Attachment } from "@/lib/zt-attach";
import type { ItemTag, Tag } from "@/lib/zt-tag";
import { itemBaseFields, resolveVenue } from "@/lib/zt-venue";
import type { BaseItem, Item } from "@/queries/items";

import type { TemplateFilenameItemData } from "./zt-template-item";
import { buildFilenameContext, buildNoteContext } from "./zt-template-note";

function makeItem(
  fields: { itemType: string } & Record<string, string | null>,
  base?: Partial<BaseItem> & Pick<Partial<Item>, "groupID">,
): Item {
  const baseFields = itemBaseFields(fields as ItemFields);
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
    baseFields,
    venue: resolveVenue(baseFields),
  };
}

function makeAttachment(overrides: Partial<Attachment>): Attachment {
  return {
    itemID: 10,
    libraryID: USER_LIBRARY_ID,
    groupID: null,
    key: "ATCH0001",
    indexedKey: "ATCH0001",
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
    indexedKey: "ANNO0001",
    libraryID: USER_LIBRARY_ID,
    groupID: null,
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
      username: null,
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
    expect(ctx.tags).toEqual([{ name: "zt", type: "manual" }]);
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
    expect(annot.tags).toEqual([{ name: "claim", type: "auto" }]);
    expect(annot.parentAttachment).toBe(ctx.attachments[0]);
    expect(annot.parentItem?.citationKey).toBe("smith2024");
    // annotations have no web page
    expect("weblink" in annot).toBe(false);

    expect(ctx.authors.map((a) => a.family)).toEqual(["Smith"]);
  });

  it("normalizes empty-string annotation fields to null", () => {
    const attachment = makeAttachment({});
    const annotation = makeAnnotation({
      text: "",
      comment: "",
      pageLabel: "",
      authorName: "",
    });

    const ctx = buildNoteContext({
      username: null,
      item: makeItem({ itemType: "journalArticle" }),
      attachments: [attachment],
      annotationsByAttachment: new Map([[attachment.itemID, [annotation]]]),
      tagsByItemID: new Map(),
      collectionsByItemID: new Map(),
      relatedItems: [],
      authorsShort: () => "",
      filePath: () => null,
      fileLink: () => () => null,
      commentToMarkdown: (html) => html,
      notePath: () => "",
      noteLink: () => "",
      annotationImageLink: () => null,
    });

    const annot = ctx.annotations[0]!;
    expect(annot.text).toBeNull();
    expect(annot.commentHtml).toBeNull();
    expect(annot.pageLabel).toBeNull();
    expect(annot.authorName).toBeNull();
    // No comment HTML means `comment` never calls commentToMarkdown.
    expect(annot.comment).toBeNull();
  });

  it("normalizes a commentToMarkdown '' result to a null comment", () => {
    const attachment = makeAttachment({});
    const annotation = makeAnnotation({ comment: "<i></i>" });

    const ctx = buildNoteContext({
      username: null,
      item: makeItem({ itemType: "journalArticle" }),
      attachments: [attachment],
      annotationsByAttachment: new Map([[attachment.itemID, [annotation]]]),
      tagsByItemID: new Map(),
      collectionsByItemID: new Map(),
      relatedItems: [],
      authorsShort: () => "",
      filePath: () => null,
      fileLink: () => () => null,
      commentToMarkdown: () => "",
      notePath: () => "",
      noteLink: () => "",
      annotationImageLink: () => null,
    });

    expect(ctx.annotations[0]!.commentHtml).toBe("<i></i>");
    expect(ctx.annotations[0]!.comment).toBeNull();
  });

  it("derives a null page and unanchored fileLink for positions without a pageIndex", () => {
    const attachment = makeAttachment({ contentType: "application/epub+zip" });
    // EPUB / snapshot positions carry no `pageIndex`.
    const annotation = makeAnnotation({
      position: { type: "FragmentSelector", value: "epubcfi(/6/4!/4)" },
    });

    const ctx = buildNoteContext({
      username: null,
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
      username: null,
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
      username: null,
      item: makeItem(
        { itemType: "book" },
        { key: "ITEM2345", indexedKey: "ITEM2345g99", groupID: 99 },
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

  it("builds the username weblink for a personal-library item with a known username", () => {
    const ctx = buildNoteContext({
      username: "aidenlx",
      item: makeItem({ itemType: "book" }),
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
    expect(ctx.weblink).toBe("https://www.zotero.org/aidenlx/items/ITEM2345");
  });

  it("builds the groups weblink for a group-library item regardless of username", () => {
    const ctx = buildNoteContext({
      username: null,
      item: makeItem(
        { itemType: "book" },
        { key: "ITEM2345", indexedKey: "ITEM2345g99", groupID: 99 },
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
    expect(ctx.weblink).toBe("https://www.zotero.org/groups/99/items/ITEM2345");
  });

  it("returns a null weblink for a personal-library item with no known username", () => {
    const ctx = buildNoteContext({
      username: null,
      item: makeItem({ itemType: "book" }),
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
    expect(ctx.weblink).toBeNull();
  });

  it("returns a null weblink for a personal-library related item with no known username", () => {
    const related = makeItem(
      { itemType: "book" },
      { itemID: 2, key: "REL2345", indexedKey: "REL2345" },
    );
    const ctx = buildNoteContext({
      username: null,
      item: makeItem({ itemType: "book" }),
      attachments: [],
      annotationsByAttachment: new Map(),
      tagsByItemID: new Map(),
      collectionsByItemID: new Map(),
      relatedItems: [related],
      authorsShort: () => "",
      filePath: () => null,
      fileLink: () => () => "",
      commentToMarkdown: (html) => html,
      notePath: () => "",
      noteLink: () => "",
      annotationImageLink: () => null,
    });
    expect(ctx.relatedItems[0]!.weblink).toBeNull();
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
        { itemID: 4, key: "RELA2345", indexedKey: "RELA2345g99", groupID: 99 },
      ),
    ];

    const betaTag = { tagID: 7, name: "method" };
    const ctx = buildNoteContext({
      username: "aidenlx",
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
    expect(beta.tags.map((t) => t.name)).toEqual(["method"]);
    expect(beta.weblink).toBe("https://www.zotero.org/aidenlx/items/RELB2345");
    // group backlink resolved from the related item's own indexedKey
    expect(ctx.relatedItems[0]!.backlink).toBe(
      "zotero://select/groups/99/items/RELA2345",
    );
    expect(ctx.relatedItems[0]!.weblink).toBe(
      "https://www.zotero.org/groups/99/items/RELA2345",
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
      username: null,
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

  // Pins the TemplateItemResolvers invariant: resolvers see the inert item-own twin, not the live context.
  it("hands the notePath/noteLink resolvers the inert item-own twin, not the live context", () => {
    const mainCollections = [{ key: "COLLMAIN", name: "Main", path: ["Main"] }];
    const relatedCollections = [
      { key: "COLLREL0", name: "Related", path: ["Related"] },
    ];
    const related = makeItem(
      { itemType: "journalArticle", title: "Related", citationKey: "rel2024" },
      { itemID: 2, key: "REL12345", indexedKey: "REL12345" },
    );

    const captured: TemplateFilenameItemData[] = [];
    const ctx = buildNoteContext({
      username: null,
      item: makeItem(
        { itemType: "journalArticle", citationKey: "main2024" },
        { indexedKey: "MAIN2345" },
      ),
      attachments: [],
      annotationsByAttachment: new Map(),
      tagsByItemID: new Map(),
      collectionsByItemID: new Map([
        [1, mainCollections],
        [2, relatedCollections],
      ]),
      relatedItems: [related],
      authorsShort: () => "",
      filePath: () => null,
      fileLink: () => () => "",
      commentToMarkdown: (html) => html,
      notePath: (item) => {
        captured.push(item);
        return "";
      },
      noteLink: () => "",
      annotationImageLink: () => null,
    });

    void ctx.notePath;
    void ctx.relatedItems[0]!.notePath;

    expect(captured).toHaveLength(2);
    const [main, rel] = captured as [
      TemplateFilenameItemData,
      TemplateFilenameItemData,
    ];

    expect(Object.getOwnPropertyDescriptor(main, "notePath")?.value).toBe("");
    expect(main.noteLink()).toBe("");
    expect("annotations" in main).toBe(false);
    expect("relatedItems" in main).toBe(false);
    expect(main.indexedKey).toBe("MAIN2345");
    expect(main.citationKey).toBe("main2024");
    expect(main.collections).toBe(mainCollections);

    expect(Object.getOwnPropertyDescriptor(rel, "notePath")?.value).toBe("");
    expect(rel.noteLink()).toBe("");
    expect("annotations" in rel).toBe(false);
    expect("relatedItems" in rel).toBe(false);
    expect(rel.indexedKey).toBe("REL12345");
    expect(rel.citationKey).toBe("rel2024");
    expect(rel.collections).toBe(relatedCollections);
  });

  it("maps child notes through resolveChildNote into the notes list", () => {
    const childNote = {
      itemID: 200,
      libraryID: USER_LIBRARY_ID,
      groupID: null,
      parentItemID: 1,
      key: "NOTE1234",
      indexedKey: "NOTE1234",
      title: "Methods",
      dateModified: Temporal.Instant.from("2024-01-02T00:00:00Z"),
    };

    const ctx = buildNoteContext({
      username: null,
      item: makeItem({ itemType: "journalArticle" }),
      attachments: [],
      annotationsByAttachment: new Map(),
      tagsByItemID: new Map(),
      collectionsByItemID: new Map(),
      relatedItems: [],
      childNotes: [childNote],
      resolveChildNote: (note) => ({
        key: note.key,
        indexedKey: note.indexedKey,
        title: note.title,
        noteLink: (alias) => `[[${note.key}|${alias ?? note.title}]]`,
      }),
      authorsShort: () => "",
      filePath: () => null,
      fileLink: () => () => "",
      commentToMarkdown: (html) => html,
      notePath: () => "",
      noteLink: () => "",
      annotationImageLink: () => null,
    });

    expect(ctx.notes).toHaveLength(1);
    expect(ctx.notes[0]!.key).toBe("NOTE1234");
    expect(ctx.notes[0]!.noteLink()).toBe("[[NOTE1234|Methods]]");
  });

  it("leaves notes empty when no resolveChildNote is given", () => {
    const ctx = buildNoteContext({
      username: null,
      item: makeItem({ itemType: "journalArticle" }),
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

    expect(ctx.notes).toEqual([]);
  });
});

describe("buildFilenameContext", () => {
  it("exposes the primary creators and injected author summary", () => {
    const ctx = buildFilenameContext({
      item: makeItem(
        { itemType: "book", title: "Edited Work" },
        {
          creators: [
            {
              firstName: "Ruth",
              lastName: "Davis",
              creatorType: "editor",
              fieldMode: 0,
            },
          ],
        },
      ),
      tags: [],
      collections: [],
      authorsShort: () => "Davis",
    });

    expect(ctx.authors).toMatchObject([{ family: "Davis", role: "editor" }]);
    expect(ctx.authorsShort).toBe("Davis");
  });

  it("stubs notePath/noteLink to empty strings instead of omitting them", () => {
    const ctx = buildFilenameContext({
      item: makeItem({ itemType: "journalArticle", title: "A Study" }),
      tags: [],
      collections: [],
      authorsShort: () => "",
    });

    // A filename template referencing `zt.noteLink()`/`zt.notePath` (the note
    // does not exist yet at this point) must not throw — it renders "".
    expect(ctx.notePath).toBe("");
    expect(ctx.noteLink()).toBe("");
    expect(ctx.noteLink("alias", "#sub")).toBe("");
  });
});
