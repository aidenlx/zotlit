import { expect, it } from "vitest";

import type { AttachmentWithParentKey } from "@zotlit/db";
import { createClient } from "@zotlit/db/client/node";
import { createFixtureSchema } from "@zotlit/db/test-utils";
import { createNanoEvents } from "@zotlit/shared/nanoevents";

import type {
  DatabaseEvents,
  DatabaseService,
} from "@/services/database/service";
import type { ZoteroPrefEvents } from "@/services/zotero-pref/service";

import { AttachmentResolver, buildPathIndex } from "./service";
import type { AttachmentResolution } from "./service";

// The Fixture's own attachment rows are the oracle: the same item ids, keys and
// parents it builds, with its three roots given literal paths. Two rows depart
// from it deliberately and say so where they are seeded — the base-directory
// row, which the Fixture has no equivalent of, and the standalone row.
// @see packages/scripts/lib/fixture/spec.ts — `ATTACHMENTS`
const DATA_DIR = "/fixture/zotero-data";
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
      attachmentKey: "PDFSTR22",
      itemKey: "SAKIMA22",
      openable: true,
    },
    // A web snapshot resolves, but Obsidian's PDF view cannot host it.
    {
      kind: "resolved",
      attachmentKey: "HTMLSNAP",
      itemKey: "SAKIMA22",
      openable: false,
    },
    {
      kind: "resolved",
      attachmentKey: "PDFLINKD",
      itemKey: "SAKIMA22",
      openable: true,
    },
    ROUGIER,
    {
      kind: "resolved",
      attachmentKey: "IANPDF25",
      itemKey: "IANNP5A2",
      openable: true,
    },
    // A standalone attachment names itself and no Item (Ruling 14).
    {
      kind: "resolved",
      attachmentKey: "LSEPDF22",
      itemKey: null,
      openable: true,
    },
    { kind: "unresolved" },
    { kind: "unresolved" },
  ]);
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
      attachmentKey: "RGREARL8",
      itemKey: "RUGIERE8",
      openable: true,
    },
  );
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
  const { resolver, db } = await setup(stack, { databaseState: "degraded" });
  const path = `${VAULT_DIR}/attachments/rougier-2014.pdf`;

  // Not `unresolved`: "I cannot answer yet" and "Zotero does not know this
  // file" are different answers, and only the second one is final.
  expect(resolver.resolve(path)).toEqual({ kind: "pending" });

  db.state = "ready";

  expect(resolver.resolve(path)).toEqual(ROUGIER);
});

it("announces the database it was waiting on, having cached no index", async () => {
  await using stack = new AsyncDisposableStack();
  const { resolver, db, dbEvents } = await setup(stack, {
    databaseState: "loading",
  });
  const path = `${VAULT_DIR}/attachments/rougier-2014.pdf`;
  const announced: AttachmentResolution[] = [];
  stack.defer(
    resolver.on("resolutions-changed", () =>
      announced.push(resolver.resolve(path)),
    ),
  );

  expect(resolver.resolve(path)).toEqual({ kind: "pending" });

  // What plugin startup does: the database reaches `ready` and says so, with
  // no index yet built for the announcement to drop.
  db.state = "ready";
  dbEvents.emit("changed");

  expect(announced).toEqual([ROUGIER]);
});

it("rebuilds on the next lookup after the database changed", async () => {
  await using stack = new AsyncDisposableStack();
  const { resolver, client, dbEvents } = await setup(stack);
  const path = `${LINKED_FILES_DIR}/ioannidis-2005.pdf`;

  expect(resolver.resolve(path)).toEqual({ kind: "unresolved" });

  client.$client.exec(
    `update itemAttachments set path = '${path}' where itemID = 29;`,
  );

  expect(resolver.resolve(path)).toEqual({ kind: "unresolved" });

  dbEvents.emit("changed");

  expect(resolver.resolve(path)).toEqual({
    kind: "resolved",
    attachmentKey: "IANPDF25",
    itemKey: "IANNP5A2",
    openable: true,
  });
});

it("rebuilds on the next lookup after the resolved Zotero paths changed", async () => {
  await using stack = new AsyncDisposableStack();
  const { resolver, zoteroPref, prefEvents } = await setup(stack);
  const path = "/moved-zotero/storage/PDFSTR22/sakimas-song.pdf";

  expect(resolver.resolve(path)).toEqual({ kind: "unresolved" });

  zoteroPref.dataDir = "/moved-zotero";
  prefEvents.emit("resolved-changed");

  expect(resolver.resolve(path)).toEqual({
    kind: "resolved",
    attachmentKey: "PDFSTR22",
    itemKey: "SAKIMA22",
    openable: true,
  });
});

/** A `linked_file` row of the shape `getAllAttachments` returns. */
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

interface SetupOptions {
  platform?: NodeJS.Platform;
  baseAttachmentPath?: string | null;
  databaseState?: DatabaseService["state"];
  rows?: string;
}

async function setup(stack: AsyncDisposableStack, options: SetupOptions = {}) {
  const client = createClient(":memory:");
  stack.defer(() => client.$client.close());
  createFixtureSchema(client.$client);
  client.$client.exec(options.rows ?? FIXTURE_ROWS);

  const dbEvents = createNanoEvents<DatabaseEvents>();
  const db = {
    state: options.databaseState ?? ("ready" as DatabaseService["state"]),
    client,
    on: <K extends keyof DatabaseEvents>(event: K, cb: DatabaseEvents[K]) =>
      dbEvents.on(event, cb),
  };

  const prefEvents = createNanoEvents<ZoteroPrefEvents>();
  const zoteroPref = {
    dataDir: DATA_DIR,
    baseAttachmentPath: options.baseAttachmentPath ?? null,
    on: <K extends keyof ZoteroPrefEvents>(event: K, cb: ZoteroPrefEvents[K]) =>
      prefEvents.on(event, cb),
  };

  const resolver = new AttachmentResolver({
    db,
    zoteroPref,
    platform: options.platform ?? "linux",
  });
  stack.use(resolver);
  await resolver.ready;
  return { resolver, db, zoteroPref, client, dbEvents, prefEvents };
}
