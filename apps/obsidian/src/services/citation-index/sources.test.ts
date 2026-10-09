import { afterEach, describe, expect, it } from "vitest";

import type { Attachment } from "@zotlit/db";

import type { ZoteroReadsService } from "@/services/zotero-reads/service";
import {
  inProcessReadsService,
  memoryOpener,
  recordCalls,
  seedWorksSql,
} from "@/services/zotero-reads/test-utils";
import type { SeededWork } from "@/services/zotero-reads/test-utils";

import type { Citation } from "./query";
import { readReferenceSources, toZoteroOpenableAttachments } from "./sources";

const KEY = "ABCD2345";
const OTHER_KEY = "EFGH6789";

/** The cited Item every case seeds, as Zotero holds it. */
const CITED: SeededWork = {
  itemID: 1,
  key: KEY,
  title: "Alpha kernels",
  citationKey: "doe2024",
  date: "2024-03-02",
  creators: [["Jane", "Doe"]],
};

/** ZoteroReads on the in-process adapter over the seeded rows. */
let ready: ZoteroReadsService;
/** The `ItemsByIndexedKeys` calls the readers made. */
let itemReads: ReturnType<typeof recordCalls>["calls"];

/** Open ZoteroReads over `sql`, recording the item reads. */
async function readsOver(sql: string): Promise<ZoteroReadsService> {
  const recorded = recordCalls(["ItemsByIndexedKeys"]);
  itemReads = recorded.calls;
  ready = inProcessReadsService(memoryOpener(() => sql).open, {
    wrap: recorded.wrap,
  });
  await ready.ready;
  return ready;
}

function citation(
  indexedKey: string | null,
  linkpath: string | null,
): Citation {
  return {
    indexedKey,
    linkpath,
    refNumber: 1,
    occurrences: [
      {
        kind: "citekey",
        raw: "doe2024",
        position: {
          start: { line: 0, col: 0, offset: 0 },
          end: { line: 0, col: 8, offset: 8 },
        },
      },
    ],
  };
}

function attachment(overrides: Partial<Attachment>): Attachment {
  return {
    itemID: 20,
    libraryID: 1,
    groupID: null,
    key: "ATCH2345",
    indexedKey: "ATCH2345",
    parentItemID: 1,
    path: null,
    contentType: null,
    linkMode: null,
    dateAdded: Temporal.Instant.from("2024-01-01T00:00:00Z"),
    dateModified: Temporal.Instant.from("2024-01-01T00:00:00Z"),
    ...overrides,
  };
}

describe("readReferenceSources", () => {
  afterEach(() => ready[Symbol.asyncDispose]());

  it("joins the identity and summary of each cited Item", async () => {
    await readsOver(seedWorksSql([CITED]));

    const { sources } = await readReferenceSources(ready, [
      citation(KEY, "Notes/Doe 2024.md"),
    ]);

    expect(sources.get(KEY)).toMatchObject({
      itemKey: KEY,
      itemID: CITED.itemID,
      groupID: null,
      citekey: "doe2024",
      summary: "Doe (2024): Alpha kernels",
      linkpath: "Notes/Doe 2024.md",
    });
    expect(sources.get(KEY)?.csl.title).toBe("Alpha kernels");
  });

  it("carries a null linkpath through for an Item with no Literature Note", async () => {
    await readsOver(seedWorksSql([CITED]));

    const { sources } = await readReferenceSources(ready, [
      citation(KEY, null),
    ]);

    expect(sources.get(KEY)?.linkpath).toBeNull();
  });

  it("reports no citation key when Zotero holds none for the Item", async () => {
    const { citationKey: _, ...uncited } = CITED;
    await readsOver(seedWorksSql([uncited]));

    const { sources } = await readReferenceSources(ready, [
      citation(KEY, null),
    ]);

    expect(sources.get(KEY)?.citekey).toBeNull();
  });

  it("leaves out a citekey that names no live Zotero Item", async () => {
    await readsOver(seedWorksSql([CITED]));

    const { sources } = await readReferenceSources(ready, [
      citation(null, null),
    ]);

    expect(sources.size).toBe(0);
    expect(itemReads.map((call) => call.payload["indexedKeys"])).toEqual([[]]);
  });

  it("leaves out an Item the library no longer holds", async () => {
    await readsOver(seedWorksSql([CITED]));

    const { sources } = await readReferenceSources(ready, [
      citation(KEY, null),
      citation(OTHER_KEY, null),
    ]);

    expect([...sources.keys()]).toStrictEqual([KEY]);
  });

  it("offers the Zotero-Openable Attachments of the cited Item", async () => {
    await readsOver(
      seedWorksSql(
        [CITED],
        [
          {
            itemID: 20,
            key: "ATCH2345",
            parentItemID: CITED.itemID,
            path: "storage:Doe_2024.pdf",
            linkMode: 0,
          },
        ],
      ),
    );

    const { sources } = await readReferenceSources(ready, [
      citation(KEY, null),
    ]);

    expect(sources.get(KEY)?.attachments).toStrictEqual([
      { key: "ATCH2345", groupID: null, label: "Doe_2024.pdf" },
    ]);
  });

  it("keeps the cited Items when the attachment table cannot be read", async () => {
    // A column the attachment read needs; the layout check needs no more
    // than `itemID` and `parentItemID` of the table.
    await readsOver(
      `${seedWorksSql([CITED])}\nalter table itemAttachments drop column linkMode;`,
    );

    const { sources } = await readReferenceSources(ready, [
      citation(KEY, null),
    ]);

    expect(sources.get(KEY)?.attachments).toStrictEqual([]);
  });

  it("answers empty and unreadable when the item read fails", async () => {
    await readsOver(`${seedWorksSql([CITED])}\ndrop table items;`);

    const { sources, database } = await readReferenceSources(ready, [
      citation(KEY, null),
    ]);

    expect(sources.size).toBe(0);
    expect(database).toBe("unreadable");
  });

  it("reads nothing while the database is unavailable, and says so", async () => {
    await readsOver(seedWorksSql([CITED]));

    const { sources, database } = await readReferenceSources(
      { state: "degraded", acquireRead: () => ready.acquireRead() },
      [citation(KEY, null)],
    );

    expect(sources.size).toBe(0);
    expect(database).toBe("unreadable");
    expect(itemReads).toEqual([]);
  });
});

describe("toZoteroOpenableAttachments", () => {
  it("names a stored attachment by its filename", () => {
    expect(
      toZoteroOpenableAttachments([
        attachment({ path: "storage:Rivers_2020.pdf", linkMode: 0 }),
      ]),
    ).toStrictEqual([
      { key: "ATCH2345", groupID: null, label: "Rivers_2020.pdf" },
    ]);
  });

  it("names a snapshot and a linked file the same way, whatever the format", () => {
    expect(
      toZoteroOpenableAttachments([
        attachment({ path: "storage:page.html", linkMode: 1 }),
        attachment({ path: "/Papers/thesis.epub", linkMode: 2 }),
        attachment({ path: "attachments:drafts/notes.docx", linkMode: 2 }),
      ]).map((a) => a.label),
    ).toStrictEqual(["page.html", "thesis.epub", "notes.docx"]);
  });

  it("names a linked file a Windows library recorded, read on any platform", () => {
    expect(
      toZoteroOpenableAttachments([
        attachment({ path: "C:\\Papers\\Rivers 2020.pdf", linkMode: 2 }),
      ]).map((a) => a.label),
    ).toStrictEqual(["Rivers 2020.pdf"]);
  });

  it("leaves out an attachment that names no file", () => {
    expect(
      toZoteroOpenableAttachments([
        // A bare web link, which Zotero's reader cannot open.
        attachment({ path: "https://example.com/paper", linkMode: 3 }),
        // A stored row whose path lost its `storage:` prefix.
        attachment({ path: "paper.pdf", linkMode: 0 }),
        attachment({ path: null, linkMode: 0 }),
      ]),
    ).toStrictEqual([]);
  });

  it("keeps the library order, so the menu reads as Zotero lists it", () => {
    expect(
      toZoteroOpenableAttachments([
        attachment({ key: "ATCHZZZZ", path: "storage:zebra.pdf", linkMode: 0 }),
        attachment({ key: "ATCHAAAA", path: "storage:alpha.pdf", linkMode: 0 }),
      ]).map((a) => a.key),
    ).toStrictEqual(["ATCHZZZZ", "ATCHAAAA"]);
  });

  it("carries the group library through, so the deep link addresses it", () => {
    expect(
      toZoteroOpenableAttachments([
        attachment({ path: "storage:shared.pdf", linkMode: 0, groupID: 42 }),
      ]),
    ).toStrictEqual([{ key: "ATCH2345", groupID: 42, label: "shared.pdf" }]);
  });
});
