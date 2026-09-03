import Ajv2020 from "ajv/dist/2020";
import type { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

import { CONTRACT_VERSION } from "@zotlit/db";
import { createClient } from "@zotlit/db/client/node";
import annotationSchema from "@zotlit/db/contract/annotation.schema.json";
import filenameSchema from "@zotlit/db/contract/filename.schema.json";
import noteSchema from "@zotlit/db/contract/note.schema.json";
import { createFixtureSchema } from "@zotlit/db/test-utils";

import { exportItemSnapshot } from "./index";

describe("exportItemSnapshot", () => {
  it("exports the selected Item with contract identity and provenance", () => {
    using fixture = createFixture();

    const snapshot = exportItemSnapshot(
      fixture.client,
      { library: { type: "personal" }, key: "MAIN2345" },
      { provenance: { kind: "sample", id: "journal-article" } },
    );

    expect(snapshot).toMatchObject({
      contractVersion: CONTRACT_VERSION,
      item: {
        key: "MAIN2345",
        indexedKey: "MAIN2345",
        itemType: "journalArticle",
        title: "An exported paper",
        library: { type: "personal" },
      },
      provenance: { kind: "sample", id: "journal-article" },
      roots: {
        note: { title: "An exported paper" },
        filename: { title: "An exported paper" },
        annotations: [{ text: "Reviewed annotation text" }],
      },
      descriptors: {
        note: {
          stringCoercions: expect.arrayContaining([
            { path: ["date"], value: "2026" },
          ]),
          temporalValues: expect.arrayContaining([
            { path: ["dateAdded"], type: "Temporal.Instant" },
          ]),
          graphReferences: expect.any(Array),
        },
      },
    });
    expect(snapshot.revision).toHaveLength(64);
    expect(
      snapshot.revision
        .split("")
        .every((character) => "0123456789abcdef".includes(character)),
    ).toBe(true);
  });

  it("redacts host data and records unavailable values explicitly", () => {
    using fixture = createFixture();

    const snapshot = exportItemSnapshot(
      fixture.client,
      { library: { type: "personal" }, key: "MAIN2345" },
      { provenance: { kind: "sample", id: "journal-article" } },
    );
    const json = JSON.stringify(snapshot);

    expect(json).not.toContain("/Users/researcher/Zotero/storage/paper.pdf");
    expect(json).not.toContain("PRIVATE_ATTACHMENT_CONTENT");
    expect(json).not.toContain("PRIVATE CHILD NOTE BODY");
    expect(snapshot.unavailable).toEqual(
      expect.arrayContaining([
        {
          path: "zt.attachments[0].filePath",
          reason: "Attachment paths are not included in Item Snapshots.",
        },
        {
          path: "zt.attachments[0].fileLink",
          reason: "The Attachment has no permitted vault-relative target.",
        },
        {
          path: "zt.notes[0].noteLink",
          reason: "The Child Note has no permitted vault-relative target.",
        },
      ]),
    );
  });

  it("keeps every exported root valid against the current contract", () => {
    using fixture = createFixture();
    const snapshot = exportItemSnapshot(
      fixture.client,
      { library: { type: "personal" }, key: "MAIN2345" },
      { provenance: { kind: "sample", id: "journal-article" } },
    );
    const ajv = new Ajv2020({ strict: true });

    for (const [schema, data] of [
      [noteSchema, snapshot.roots.note],
      [filenameSchema, snapshot.roots.filename],
      [annotationSchema, snapshot.roots.annotations[0]],
    ] as const) {
      const validate = ajv.compile(schema);
      expect(validate(data)).toBe(true);
    }
  });

  it("includes only selected vault-relative link targets", () => {
    using fixture = createFixture();
    const snapshot = exportItemSnapshot(
      fixture.client,
      { library: { type: "personal" }, key: "MAIN2345" },
      {
        provenance: { kind: "sample", id: "journal-article" },
        vaultTargets: {
          notes: { NOTE2345: "Notes/Reading note.md" },
          attachments: { ATCH2345: "Attachments/paper.pdf" },
        },
      },
    );

    expect(snapshot.roots.note).toMatchObject({
      attachments: [
        { fileLink: { value: "[[Attachments/paper.pdf|paper.pdf]]" } },
      ],
      notes: [
        {
          noteLink: {
            value: "[[Notes/Reading note.md|Reading note]]",
          },
        },
      ],
      annotations: [
        {
          fileLink: {
            value: "[[Attachments/paper.pdf#page=7|paper.pdf]]",
          },
        },
      ],
    });
    expect(snapshot.unavailable).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "zt.attachments[0].fileLink" }),
        expect.objectContaining({ path: "zt.notes[0].noteLink" }),
      ]),
    );
  });

  it("rejects absolute and parent-traversing vault targets", () => {
    using fixture = createFixture();
    const exportWithTarget = (path: string) =>
      exportItemSnapshot(
        fixture.client,
        { library: { type: "personal" }, key: "MAIN2345" },
        {
          provenance: { kind: "sample", id: "journal-article" },
          vaultTargets: { attachments: { ATCH2345: path } },
        },
      );

    expect(() => exportWithTarget("/outside/paper.pdf")).toThrow(
      "absolute path",
    );
    expect(() => exportWithTarget("Attachments/../paper.pdf")).toThrow(
      "must be vault-relative",
    );
  });

  it("rejects an absolute path in connected provenance", () => {
    using fixture = createFixture();

    expect(() =>
      exportItemSnapshot(
        fixture.client,
        { library: { type: "personal" }, key: "MAIN2345" },
        {
          provenance: {
            kind: "connected",
            installationId: "installation-1",
            vault: "/Users/researcher/Vault",
          },
        },
      ),
    ).toThrow("absolute path");
  });
});

function createFixture(): {
  client: ReturnType<typeof createClient>;
  [Symbol.dispose](): void;
} {
  const client = createClient(":memory:");
  const sqlite = client.$client as DatabaseSync;
  try {
    seed(sqlite);
    return {
      client,
      [Symbol.dispose]() {
        sqlite.close();
      },
    };
  } catch (error) {
    sqlite.close();
    throw error;
  }
}

function seed(sqlite: DatabaseSync): void {
  createFixtureSchema(sqlite);
  sqlite.exec(`
    insert into libraries (libraryID, type, editable, filesEditable)
      values (1, 'user', 1, 1);
    insert into itemTypes (itemTypeID, typeName)
      values
        (1, 'journalArticle'),
        (2, 'attachment'),
        (3, 'annotation'),
        (4, 'note');
    insert into fieldsCombined (fieldID, fieldName, custom)
      values
        (10, 'title', 0),
        (11, 'citationKey', 0),
        (12, 'date', 0);
    insert into itemDataValues (valueID, value)
      values
        (100, 'An exported paper'),
        (101, 'exported2026'),
        (102, '2026');
    insert into items (itemID, itemTypeID, dateAdded, dateModified, libraryID, key)
      values
        (1, 1, '2026-01-01 00:00:00', '2026-01-02 00:00:00', 1, 'MAIN2345'),
        (2, 2, '2026-01-01 00:00:00', '2026-01-02 00:00:00', 1, 'ATCH2345'),
        (3, 3, '2026-01-01 00:00:00', '2026-01-02 00:00:00', 1, 'ANNO2345'),
        (4, 4, '2026-01-01 00:00:00', '2026-01-02 00:00:00', 1, 'NOTE2345');
    insert into itemData (itemID, fieldID, valueID)
      values (1, 10, 100), (1, 11, 101), (1, 12, 102);
    insert into itemAttachments (itemID, parentItemID, linkMode, contentType, path)
      values (
        2, 1, 2, 'application/pdf',
        '/Users/researcher/Zotero/storage/paper.pdf'
      );
    insert into itemAnnotations (
      itemID, parentItemID, type, text, comment, color, pageLabel, sortIndex,
      position, isExternal
    ) values (
      3, 2, 1, 'Reviewed annotation text', null, '#ffd400', '7',
      '00000|000001|00000', '{"pageIndex":6,"rects":[]}', 0
    );
    insert into itemNotes (itemID, parentItemID, note, title)
      values (4, 1, '<p>PRIVATE CHILD NOTE BODY</p>', 'Reading note');
    create table fulltextWords (wordID integer primary key, word text not null);
    create table fulltextItemWords (wordID integer not null, itemID integer not null);
    insert into fulltextWords (wordID, word)
      values (1, 'PRIVATE_ATTACHMENT_CONTENT');
    insert into fulltextItemWords (wordID, itemID) values (1, 2);
  `);
}
