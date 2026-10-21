import { expect, it, vi } from "vitest";

import type { AttachmentWithParentKey } from "@zotlit/db";

import { DATA_DIR, nextAnnouncement, resolverHarness } from "./__fixtures__";
import type { ResolverHarnessOptions } from "./__fixtures__";
import { buildPathIndex } from "./service";
import type { AttachmentResolution } from "./service";

// The Fixture's own attachment rows are the oracle: the same item ids, keys and
// parents it builds, with its three roots given literal paths. Two rows depart
// from it deliberately and say so where they are seeded — the base-directory
// row, which the Fixture has no equivalent of, and the standalone row.
// @see packages/scripts/lib/fixture/spec.ts — `ATTACHMENTS`
const VAULT_DIR = "/fixture/zt-fixture-vault";
const LINKED_FILES_DIR = "/fixture/linked-files";
const BASE_ATTACHMENT_DIR = "/fixture/base-attachments";

const FIXTURE_ROWS = `
  insert into items (itemID, itemTypeID, dateAdded, dateModified, libraryID, key)
    values
      (20, 1, '2025-02-20 12:00:00', '2025-02-20 12:00:00', 1, 'SAKIMA22'),
      (21, 2, '2025-02-20 12:00:00', '2025-02-20 12:00:00', 1, 'PDFSTR22'),
      (22, 2, '2025-02-19 12:00:00', '2025-02-19 12:00:00', 1, 'HTMLSNAP'),
      (23, 2, '2025-02-18 12:00:00', '2025-02-18 12:00:00', 1, 'PDFLINKD'),
      (24, 2, '2025-02-17 12:00:00', '2025-02-17 12:00:00', 1, 'LINKURL2'),
      (28, 1, '2025-02-12 12:00:00', '2025-02-12 12:00:00', 1, 'IANNP5A2'),
      (29, 2, '2025-02-12 12:00:00', '2025-02-12 12:00:00', 1, 'IANPDF25'),
      (46, 1, '2025-02-04 12:00:00', '2025-02-04 12:00:00', 1, 'RUGIER24'),
      (47, 2, '2025-02-04 12:00:00', '2025-02-04 12:00:00', 1, 'RGRPDF24'),
      (80, 2, '2025-02-04 12:00:00', '2025-02-04 12:00:00', 1, 'LSEPDF22');

  insert into itemAttachments (itemID, parentItemID, linkMode, contentType, path)
    values
      (21, 20, 0, 'application/pdf', 'storage:sakimas-song.pdf'),
      (22, 20, 1, 'text/html', 'storage:sakimas-song.html'),
      (23, 20, 2, 'application/pdf', '${LINKED_FILES_DIR}/sakimas-song.pdf'),
      (24, 20, 3, 'text/html', null),
      -- The Fixture declares no base-directory attachment. This row departs
      -- from it to carry Zotero's own \`attachments:\` placeholder, the form
      -- \`parseAttachmentPath\` reads, onto the Fixture's Ioannidis Item.
      (29, 28, 2, 'application/pdf', 'attachments:ioannidis-2005/ioannidis-2005.pdf'),
      (47, 46, 2, 'application/pdf', '${VAULT_DIR}/attachments/rougier-2014.pdf'),
      -- Also not in the Fixture: a standalone attachment, which Zotero allows
      -- and which names no parent Item (Ruling 14).
      (80, null, 0, 'application/pdf', 'storage:loose-reading.pdf');
`;

const ROUGIER = {
  kind: "resolved",
  serverID: null,
  attachmentKey: "RGRPDF24",
  itemKey: "RUGIER24",
  openable: true,
};

it("resolves every link mode the Fixture carries, inside the vault and outside it", async () => {
  await using stack = new AsyncDisposableStack();
  const { resolver } = await setup(stack, {
    baseAttachmentPath: BASE_ATTACHMENT_DIR,
  });
  const paths = [
    `${DATA_DIR}/storage/PDFSTR22/sakimas-song.pdf`,
    `${DATA_DIR}/storage/HTMLSNAP/sakimas-song.html`,
    `${LINKED_FILES_DIR}/sakimas-song.pdf`,
    `${VAULT_DIR}/attachments/rougier-2014.pdf`,
    `${BASE_ATTACHMENT_DIR}/ioannidis-2005/ioannidis-2005.pdf`,
    `${DATA_DIR}/storage/LSEPDF22/loose-reading.pdf`,
    "https://www.storybookscanada.ca/stories/en/0315/",
    `${VAULT_DIR}/attachments/never-imported.pdf`,
  ];

  expect(paths.map((path) => resolver.resolve(path))).toEqual([
    {
      kind: "resolved",
      serverID: null,
      attachmentKey: "PDFSTR22",
      itemKey: "SAKIMA22",
      openable: true,
    },
    // A web snapshot resolves, but Obsidian's PDF view cannot host it.
    {
      kind: "resolved",
      serverID: null,
      attachmentKey: "HTMLSNAP",
      itemKey: "SAKIMA22",
      openable: false,
    },
    {
      kind: "resolved",
      serverID: null,
      attachmentKey: "PDFLINKD",
      itemKey: "SAKIMA22",
      openable: true,
    },
    ROUGIER,
    {
      kind: "resolved",
      serverID: null,
      attachmentKey: "IANPDF25",
      itemKey: "IANNP5A2",
      openable: true,
    },
    // A standalone attachment names itself and no Item (Ruling 14).
    {
      kind: "resolved",
      serverID: null,
      attachmentKey: "LSEPDF22",
      itemKey: null,
      openable: true,
    },
    { kind: "unresolved" },
    { kind: "unresolved" },
  ]);
});

// The lookup a caller holding a key needs — a `zotero://open` link, a card, a
// row — names an Attachment by its key, never by a path.
it("looks an Attachment up by its Indexed Key, with its file and its openable verdict", async () => {
  await using stack = new AsyncDisposableStack();
  const { resolver } = await setup(stack, { baseAttachmentPath: null });

  expect(
    ["RGRPDF24", "HTMLSNAP", "LINKURL2", "IANPDF25", "ZZZZZZZZ"].map((key) =>
      resolver.lookup(key),
    ),
  ).toEqual([
    {
      ...ROUGIER,
      absolutePath: `${VAULT_DIR}/attachments/rougier-2014.pdf`,
    },
    {
      kind: "resolved",
      serverID: null,
      attachmentKey: "HTMLSNAP",
      itemKey: "SAKIMA22",
      openable: false,
      absolutePath: `${DATA_DIR}/storage/HTMLSNAP/sakimas-song.html`,
    },
    // A web link names no file.
    { kind: "unresolved" },
    // A base-directory row names none while the base pref is unset.
    { kind: "unresolved" },
    { kind: "unresolved" },
  ]);
});

it("looks a group-library Attachment up by its group's Indexed Key alone", async () => {
  await using stack = new AsyncDisposableStack();
  const { resolver } = await setup(stack, {
    rows: `
      insert into libraries (libraryID, type) values (1, 'user'), (2, 'group');
      insert into groups (groupID, libraryID, name)
        values (4200309, 2, 'Shared Reading');
      insert into items (itemID, itemTypeID, dateAdded, dateModified, libraryID, key)
        values
          (30, 2, '2025-02-04 12:00:00', '2025-02-04 12:00:00', 2, 'RGRGRUP9'),
          (31, 1, '2025-02-04 12:00:00', '2025-02-04 12:00:00', 2, 'RUGIERG9');
      insert into itemAttachments (itemID, parentItemID, linkMode, contentType, path)
        values (30, 31, 0, 'application/pdf', 'storage:shared.pdf');
    `,
  });

  expect(resolver.lookup("RGRGRUP9g4200309")).toEqual({
    kind: "resolved",
    serverID: null,
    attachmentKey: "RGRGRUP9g4200309",
    itemKey: "RUGIERG9g4200309",
    openable: true,
    absolutePath: `${DATA_DIR}/storage/RGRGRUP9/shared.pdf`,
  });
  expect(resolver.lookup("RGRGRUP9")).toEqual({ kind: "unresolved" });
});

it("leaves a base-directory attachment unresolved while the base pref is unset", async () => {
  await using stack = new AsyncDisposableStack();
  const { resolver } = await setup(stack, { baseAttachmentPath: null });

  expect(
    resolver.resolve(
      `${BASE_ATTACHMENT_DIR}/ioannidis-2005/ioannidis-2005.pdf`,
    ),
  ).toEqual({ kind: "unresolved" });
});

it("meets a backslash-stored Windows row with the forward slashes Obsidian supplies", async () => {
  await using stack = new AsyncDisposableStack();
  const { resolver } = await setup(stack, {
    platform: "win32",
    rows: `
      insert into items (itemID, itemTypeID, dateAdded, dateModified, libraryID, key)
        values
          (46, 1, '2025-02-04 12:00:00', '2025-02-04 12:00:00', 1, 'RUGIER24'),
          (47, 2, '2025-02-04 12:00:00', '2025-02-04 12:00:00', 1, 'RGRPDF24');
      insert into itemAttachments (itemID, parentItemID, linkMode, contentType, path)
        values (47, 46, 2, 'application/pdf',
          'C:\\Users\\me\\zt-fixture-vault\\attachments\\rougier-2014.pdf');
    `,
  });

  expect(
    resolver.resolve(
      "C:/Users/me/zt-fixture-vault/attachments/rougier-2014.pdf",
    ),
  ).toEqual(ROUGIER);
});

it.each<[NodeJS.Platform, object]>([
  ["darwin", ROUGIER],
  ["win32", ROUGIER],
  ["linux", { kind: "unresolved" }],
])("answers a differently cased path on %s", async (platform, expected) => {
  await using stack = new AsyncDisposableStack();
  const { resolver } = await setup(stack, { platform });

  expect(resolver.resolve(`${VAULT_DIR}/Attachments/Rougier-2014.PDF`)).toEqual(
    expected,
  );
});

it("prefers the personal library, then the lowest item ID, when several attachments name one file", async () => {
  await using stack = new AsyncDisposableStack();
  const { resolver } = await setup(stack, {
    // Rows arrive group first, then personal 47 ahead of personal 40, so
    // neither "the first row wins" nor "the lowest id wins" alone answers
    // `RGREARL8`.
    rows: `
      insert into libraries (libraryID, type) values (1, 'user'), (2, 'group');
      insert into groups (groupID, libraryID, name)
        values (4200309, 2, 'Shared Reading');

      insert into items (itemID, itemTypeID, dateAdded, dateModified, libraryID, key)
        values
          (30, 2, '2025-02-04 12:00:00', '2025-02-04 12:00:00', 2, 'RGRGRUP9'),
          (31, 1, '2025-02-04 12:00:00', '2025-02-04 12:00:00', 2, 'RUGIERG9'),
          (40, 2, '2025-02-04 12:00:00', '2025-02-04 12:00:00', 1, 'RGREARL8'),
          (41, 1, '2025-02-04 12:00:00', '2025-02-04 12:00:00', 1, 'RUGIERE8'),
          (46, 1, '2025-02-04 12:00:00', '2025-02-04 12:00:00', 1, 'RUGIER24'),
          (47, 2, '2025-02-04 12:00:00', '2025-02-04 12:00:00', 1, 'RGRPDF24');

      insert into itemAttachments (itemID, parentItemID, linkMode, contentType, path)
        values
          (30, 31, 2, 'application/pdf', '${VAULT_DIR}/attachments/rougier-2014.pdf'),
          (47, 46, 2, 'application/pdf', '${VAULT_DIR}/attachments/rougier-2014.pdf'),
          (40, 41, 2, 'application/pdf', '${VAULT_DIR}/attachments/rougier-2014.pdf');
    `,
  });

  expect(resolver.resolve(`${VAULT_DIR}/attachments/rougier-2014.pdf`)).toEqual(
    {
      kind: "resolved",
      serverID: null,
      attachmentKey: "RGREARL8",
      itemKey: "RUGIERE8",
      openable: true,
    },
  );
});

// Two Attachments of one file, as Zotero allows: the path answers one of them,
// and a caller that already knows which one it opened says so.
const SHARED_FILE_ROWS = `
  insert into items (itemID, itemTypeID, dateAdded, dateModified, libraryID, key)
    values
      (40, 2, '2025-02-04 12:00:00', '2025-02-04 12:00:00', 1, 'RGREARL8'),
      (41, 1, '2025-02-04 12:00:00', '2025-02-04 12:00:00', 1, 'RUGIERE8'),
      (46, 1, '2025-02-04 12:00:00', '2025-02-04 12:00:00', 1, 'RUGIER24'),
      (47, 2, '2025-02-04 12:00:00', '2025-02-04 12:00:00', 1, 'RGRPDF24'),
      (21, 2, '2025-02-20 12:00:00', '2025-02-20 12:00:00', 1, 'PDFSTR22'),
      (20, 1, '2025-02-20 12:00:00', '2025-02-20 12:00:00', 1, 'SAKIMA22');
  insert into itemAttachments (itemID, parentItemID, linkMode, contentType, path)
    values
      (40, 41, 2, 'application/pdf', '${VAULT_DIR}/attachments/rougier-2014.pdf'),
      (47, 46, 2, 'application/pdf', '${VAULT_DIR}/attachments/rougier-2014.pdf'),
      (21, 20, 0, 'application/pdf', 'storage:sakimas-song.pdf');
`;

it("answers the Attachment a shared file's path does not choose by its own key", async () => {
  await using stack = new AsyncDisposableStack();
  const { resolver } = await setup(stack, { rows: SHARED_FILE_ROWS });

  expect(resolver.lookup("RGRPDF24")).toEqual({
    ...ROUGIER,
    absolutePath: `${VAULT_DIR}/attachments/rougier-2014.pdf`,
  });
});

it("resolves a shared file to the Attachment the opener named", async () => {
  await using stack = new AsyncDisposableStack();
  const { resolver } = await setup(stack, { rows: SHARED_FILE_ROWS });
  const path = `${VAULT_DIR}/attachments/rougier-2014.pdf`;

  expect(resolver.resolve(path, { attachmentKey: "RGRPDF24" })).toEqual(
    ROUGIER,
  );
  expect(resolver.resolve(path)).toMatchObject({ attachmentKey: "RGREARL8" });
});

// A name left over from an earlier open must not rename the file now shown.
it("resolves by the path alone when the named Attachment keeps another file", async () => {
  await using stack = new AsyncDisposableStack();
  const { resolver } = await setup(stack, { rows: SHARED_FILE_ROWS });

  expect(
    resolver.resolve(`${VAULT_DIR}/attachments/rougier-2014.pdf`, {
      attachmentKey: "PDFSTR22",
    }),
  ).toMatchObject({ attachmentKey: "RGREARL8" });
  expect(
    resolver.resolve(`${VAULT_DIR}/attachments/rougier-2014.pdf`, {
      attachmentKey: "ZZZZZZZZ",
    }),
  ).toMatchObject({ attachmentKey: "RGREARL8" });
});

it("reports each file several attachments name, with the one it kept and the ones it dropped", () => {
  const path = `${VAULT_DIR}/attachments/rougier-2014.pdf`;
  const { index, collisions } = buildPathIndex(
    // Ranked last, first and second, so neither arrival order nor item id alone
    // produces this outcome.
    [
      linkedAttachment({
        itemID: 30,
        key: "RGRGRUP9",
        groupID: 4200309,
        parentIndexedKey: "RUGIERG9g4200309",
        path,
      }),
      linkedAttachment({
        itemID: 47,
        key: "RGRPDF24",
        parentIndexedKey: "RUGIER24",
        path,
      }),
      linkedAttachment({
        itemID: 40,
        key: "RGREARL8",
        parentIndexedKey: "RUGIERE8",
        path,
      }),
    ],
    { dataDir: DATA_DIR, baseAttachmentPath: null, platform: "linux" },
  );

  expect(collisions).toEqual([
    {
      pathKey: path,
      chosen: "RGREARL8",
      discarded: ["RGRPDF24", "RGRGRUP9g4200309"],
    },
  ]);
  expect(index.get(path)).toEqual({
    kind: "resolved",
    serverID: null,
    attachmentKey: "RGREARL8",
    itemKey: "RUGIERE8",
    openable: true,
  });
});

it("reports no collision when every attachment names its own file", () => {
  const { collisions } = buildPathIndex(
    [
      linkedAttachment({
        itemID: 47,
        key: "RGRPDF24",
        parentIndexedKey: "RUGIER24",
        path: `${VAULT_DIR}/attachments/rougier-2014.pdf`,
      }),
      linkedAttachment({
        itemID: 23,
        key: "PDFLINKD",
        parentIndexedKey: "SAKIMA22",
        path: `${LINKED_FILES_DIR}/sakimas-song.pdf`,
      }),
    ],
    { dataDir: DATA_DIR, baseAttachmentPath: null, platform: "linux" },
  );

  expect(collisions).toEqual([]);
});

it("answers pending, and keeps no index, while the database cannot be read", async () => {
  await using stack = new AsyncDisposableStack();
  const { resolver, reads } = await setup(stack, {
    seeds: [null, FIXTURE_ROWS],
    prime: false,
  });
  const path = `${VAULT_DIR}/attachments/rougier-2014.pdf`;

  // Not `unresolved`: "I cannot answer yet" and "Zotero does not know this
  // file" are different answers, and only the second one is final.
  expect(resolver.resolve(path)).toEqual({ kind: "pending" });
  await expect.poll(() => reads.state).toBe("degraded");
  expect(resolver.resolve(path)).toEqual({ kind: "pending" });
  expect(resolver.lookup("RGRPDF24")).toEqual({ kind: "pending" });

  // The database recovers: the build it was waiting on lands and says so.
  const announced = nextAnnouncement(resolver);
  await reads.refresh();
  await announced;

  expect(resolver.resolve(path)).toEqual(ROUGIER);
});

// `indexed` is what a caller waits on to know lookups answer for real; waiting
// on it must not be what builds the index, or it could not tell a warmed
// resolver from one nobody asked.
it("settles indexed once the first index lands, and builds nothing itself", async () => {
  await using stack = new AsyncDisposableStack();
  const { resolver, queries } = await setup(stack, { prime: false });
  // Every build asks the query client for the index, as it starts.
  const builds = vi.spyOn(queries, "ask");

  const indexed = resolver.indexed;
  expect(builds).not.toHaveBeenCalled();

  resolver.warm();
  expect(builds).toHaveBeenCalledOnce();
  await indexed;
  expect(resolver.lookup("RGRPDF24")).toMatchObject({ kind: "resolved" });
});

it("builds the first index when warmed, before any lookup", async () => {
  await using stack = new AsyncDisposableStack();
  const { resolver } = await setup(stack, { prime: false });

  const announced = nextAnnouncement(resolver);
  resolver.warm();
  await announced;

  expect(resolver.lookup("RGRPDF24")).toEqual({
    ...ROUGIER,
    absolutePath: `${VAULT_DIR}/attachments/rougier-2014.pdf`,
  });
});

it("announces the first index to a caller that was told pending", async () => {
  await using stack = new AsyncDisposableStack();
  const { resolver } = await setup(stack, { prime: false });
  const path = `${VAULT_DIR}/attachments/rougier-2014.pdf`;
  const announced: AttachmentResolution[] = [];
  stack.defer(
    resolver.on("resolutions-changed", () =>
      announced.push(resolver.resolve(path)),
    ),
  );

  expect(resolver.resolve(path)).toEqual({ kind: "pending" });

  await expect.poll(() => announced).toEqual([ROUGIER]);
});

it("rebuilds after the database changed, answering from the previous index meanwhile", async () => {
  await using stack = new AsyncDisposableStack();
  const path = `${LINKED_FILES_DIR}/ioannidis-2005.pdf`;
  const { resolver, reads, gate } = await setup(stack, {
    seeds: [
      FIXTURE_ROWS,
      `${
        FIXTURE_ROWS
      }update itemAttachments set path = '${path}' where itemID = 29;`,
    ],
  });

  expect(resolver.resolve(path)).toEqual({ kind: "unresolved" });

  const held = gate();
  const announced = nextAnnouncement(resolver);
  await reads.refresh();
  await expect.poll(() => held.waiting).toBe(true);

  expect(resolver.resolve(path)).toEqual({ kind: "unresolved" });
  held.release();
  await announced;

  expect(resolver.resolve(path)).toEqual({
    kind: "resolved",
    serverID: null,
    attachmentKey: "IANPDF25",
    itemKey: "IANNP5A2",
    openable: true,
  });
});

it("keeps the previous index when a rebuild fails, and asks again after the failure cooldown", async () => {
  await using stack = new AsyncDisposableStack();
  const path = `${LINKED_FILES_DIR}/ioannidis-2005.pdf`;
  const f = await setup(stack, {
    seeds: [
      FIXTURE_ROWS,
      `${
        FIXTURE_ROWS
      }update itemAttachments set path = '${path}' where itemID = 29;`,
    ],
  });

  f.failReads(true);
  await f.reads.refresh();
  await expect.poll(() => f.failures).toBe(1);

  expect(f.resolver.resolve(path)).toEqual({ kind: "unresolved" });
  expect(f.failures).toBe(1);

  f.failReads(false);
  f.advance(10);
  const announced = nextAnnouncement(f.resolver);
  expect(f.resolver.resolve(path)).toEqual({ kind: "unresolved" });
  await announced;

  expect(f.resolver.resolve(path)).toMatchObject({
    kind: "resolved",
    serverID: null,
    attachmentKey: "IANPDF25",
  });
});

it("rebuilds after the resolved Zotero paths changed", async () => {
  await using stack = new AsyncDisposableStack();
  const { resolver, zoteroPref, prefEvents } = await setup(stack);
  const path = "/moved-zotero/storage/PDFSTR22/sakimas-song.pdf";

  expect(resolver.resolve(path)).toEqual({ kind: "unresolved" });

  const announced = nextAnnouncement(resolver);
  zoteroPref.dataDir = "/moved-zotero";
  prefEvents.emit("resolved-changed");
  await announced;

  expect(resolver.resolve(path)).toEqual({
    kind: "resolved",
    serverID: null,
    attachmentKey: "PDFSTR22",
    itemKey: "SAKIMA22",
    openable: true,
  });
});

/** A `linked_file` row of the shape `getAttachmentPage` returns. */
function linkedAttachment({
  itemID,
  key,
  parentIndexedKey,
  path,
  groupID = null,
}: {
  itemID: number;
  key: string;
  parentIndexedKey: string | null;
  path: string;
  groupID?: number | null;
}): AttachmentWithParentKey {
  return {
    itemID,
    libraryID: groupID === null ? 1 : 2,
    groupID,
    key,
    indexedKey: groupID === null ? key : `${key}g${groupID}`,
    parentIndexedKey,
    parentItemID: itemID - 1,
    path,
    contentType: "application/pdf",
    linkMode: 2,
    dateAdded: Temporal.Instant.from("2025-02-04T12:00:00Z"),
    dateModified: Temporal.Instant.from("2025-02-04T12:00:00Z"),
  };
}

/** The resolver over {@link FIXTURE_ROWS}, unless the case seeds its own. */
function setup(
  stack: AsyncDisposableStack,
  options: ResolverHarnessOptions = {},
) {
  return resolverHarness(stack, { rows: FIXTURE_ROWS, ...options });
}
