import { beforeEach, describe, expect, it, vi } from "vitest";

import { getAttachmentsByParents, getItemsByKey } from "@zotlit/db";
import type { Attachment, Item } from "@zotlit/db";
import type { NodeDatabaseClient } from "@zotlit/db/client/node";
import { makeCreator, makeItem } from "@zotlit/item-lookup/fixtures";
import type { ItemFixtureOptions } from "@zotlit/item-lookup/fixtures";

import type { DatabaseService } from "@/services/database/service";

import type { Citation } from "./query";
import { readReferenceSources, toOpenableAttachments } from "./sources";

vi.mock("@zotlit/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@zotlit/db")>();
  return {
    ...actual,
    // The stand-in client runs no queries, so the table reads are stubbed per
    // test. Key parsing and the CSL mapping stay real: both are pure.
    getZoteroIdentity: () => ({
      userID: null,
      localUserKey: null,
      username: null,
    }),
    getItemsByKey: vi.fn(() => []),
    getAttachmentsByParents: vi.fn(() => []),
  };
});

const KEY = "ABCD2345";
const OTHER_KEY = "EFGH6789";

const ready: Pick<DatabaseService, "state" | "client"> = {
  state: "ready",
  client: {} as NodeDatabaseClient,
};

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

/** A live Zotero Item, as the item read hands one over. */
function item(key: string, overrides: Partial<ItemFixtureOptions> = {}): Item {
  return makeItem({
    key,
    title: "Alpha kernels",
    citationKey: "doe2024",
    date: "2024-03-02",
    creators: [makeCreator("Jane", "Doe")],
    primaryCreatorType: "author",
    ...overrides,
  });
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
  beforeEach(() => {
    vi.mocked(getItemsByKey).mockReturnValue([]);
    vi.mocked(getAttachmentsByParents).mockReturnValue([]);
  });

  it("joins the identity and summary of each cited Item", () => {
    const cited = item(KEY);
    vi.mocked(getItemsByKey).mockReturnValue([cited]);

    const { sources } = readReferenceSources(ready, [
      citation(KEY, "Notes/Doe 2024.md"),
    ]);

    expect(sources.get(KEY)).toMatchObject({
      itemKey: KEY,
      itemID: cited.itemID,
      groupID: null,
      citekey: "doe2024",
      summary: "Doe (2024): Alpha kernels",
      linkpath: "Notes/Doe 2024.md",
    });
    expect(sources.get(KEY)?.csl.title).toBe("Alpha kernels");
  });

  it("carries a null linkpath through for an Item with no Literature Note", () => {
    vi.mocked(getItemsByKey).mockReturnValue([item(KEY)]);

    const { sources } = readReferenceSources(ready, [citation(KEY, null)]);

    expect(sources.get(KEY)?.linkpath).toBeNull();
  });

  it("reports no citation key when Zotero holds none for the Item", () => {
    vi.mocked(getItemsByKey).mockReturnValue([
      item(KEY, { citationKey: null }),
    ]);

    const { sources } = readReferenceSources(ready, [citation(KEY, null)]);

    expect(sources.get(KEY)?.citekey).toBeNull();
  });

  it("leaves out a citekey that names no live Zotero Item", () => {
    const { sources } = readReferenceSources(ready, [citation(null, null)]);

    expect(sources.size).toBe(0);
    expect(getItemsByKey).not.toHaveBeenCalled();
  });

  it("leaves out an Item the library no longer holds", () => {
    vi.mocked(getItemsByKey).mockImplementation((_client, _libraryID, keys) =>
      keys[0] === KEY ? [item(KEY)] : [],
    );

    const { sources } = readReferenceSources(ready, [
      citation(KEY, null),
      citation(OTHER_KEY, null),
    ]);

    expect([...sources.keys()]).toStrictEqual([KEY]);
  });

  it("offers the Openable Attachments of the cited Item", () => {
    const cited = item(KEY);
    vi.mocked(getItemsByKey).mockReturnValue([cited]);
    vi.mocked(getAttachmentsByParents).mockReturnValue([
      attachment({
        parentItemID: cited.itemID,
        path: "storage:Doe_2024.pdf",
        linkMode: 0,
      }),
    ]);

    const { sources } = readReferenceSources(ready, [citation(KEY, null)]);

    expect(sources.get(KEY)?.attachments).toStrictEqual([
      { key: "ATCH2345", groupID: null, label: "Doe_2024.pdf" },
    ]);
  });

  it("keeps the cited Items when the attachment table cannot be read", () => {
    vi.mocked(getItemsByKey).mockReturnValue([item(KEY)]);
    vi.mocked(getAttachmentsByParents).mockImplementation(() => {
      throw new Error("attachments unavailable");
    });

    const { sources } = readReferenceSources(ready, [citation(KEY, null)]);

    expect(sources.get(KEY)?.attachments).toStrictEqual([]);
  });

  it("answers empty and unreadable when the item read fails", () => {
    vi.mocked(getItemsByKey).mockImplementation(() => {
      throw new Error("database locked");
    });

    const { sources, database } = readReferenceSources(ready, [
      citation(KEY, null),
    ]);

    expect(sources.size).toBe(0);
    expect(database).toBe("unreadable");
  });

  it("reads nothing while the database is unavailable, and says so", () => {
    const { sources, database } = readReferenceSources(
      { state: "loading", client: {} as NodeDatabaseClient },
      [citation(KEY, null)],
    );

    expect(sources.size).toBe(0);
    expect(database).toBe("unreadable");
    expect(getItemsByKey).not.toHaveBeenCalled();
  });
});

describe("toOpenableAttachments", () => {
  it("names a stored attachment by its filename", () => {
    expect(
      toOpenableAttachments([
        attachment({ path: "storage:Rivers_2020.pdf", linkMode: 0 }),
      ]),
    ).toStrictEqual([
      { key: "ATCH2345", groupID: null, label: "Rivers_2020.pdf" },
    ]);
  });

  it("names a snapshot and a linked file the same way, whatever the format", () => {
    expect(
      toOpenableAttachments([
        attachment({ path: "storage:page.html", linkMode: 1 }),
        attachment({ path: "/Papers/thesis.epub", linkMode: 2 }),
        attachment({ path: "attachments:drafts/notes.docx", linkMode: 2 }),
      ]).map((a) => a.label),
    ).toStrictEqual(["page.html", "thesis.epub", "notes.docx"]);
  });

  it("names a linked file a Windows library recorded, read on any platform", () => {
    expect(
      toOpenableAttachments([
        attachment({ path: "C:\\Papers\\Rivers 2020.pdf", linkMode: 2 }),
      ]).map((a) => a.label),
    ).toStrictEqual(["Rivers 2020.pdf"]);
  });

  it("leaves out an attachment that names no file", () => {
    expect(
      toOpenableAttachments([
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
      toOpenableAttachments([
        attachment({ key: "ATCHZZZZ", path: "storage:zebra.pdf", linkMode: 0 }),
        attachment({ key: "ATCHAAAA", path: "storage:alpha.pdf", linkMode: 0 }),
      ]).map((a) => a.key),
    ).toStrictEqual(["ATCHZZZZ", "ATCHAAAA"]);
  });

  it("carries the group library through, so the deep link addresses it", () => {
    expect(
      toOpenableAttachments([
        attachment({ path: "storage:shared.pdf", linkMode: 0, groupID: 42 }),
      ]),
    ).toStrictEqual([{ key: "ATCH2345", groupID: 42, label: "shared.pdf" }]);
  });
});
