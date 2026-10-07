// One Annotation reached through the Local API and the database must reuse pixels.
import { describe, expect, it, vi } from "vitest";

import { createClient } from "@zotlit/db/client/node";
import { createFixtureSchema } from "@zotlit/db/test-utils";

import type {
  AnnotationRecord,
  AnnotationSource,
} from "@/services/annotation-repository/service";
import type {
  ZoteroReadsApi,
  ZoteroReadsService,
} from "@/services/zotero-reads/service";
import {
  inProcessReadsService,
  sharedClientOpener,
} from "@/services/zotero-reads/test-utils";

import { PNG_FORMAT } from "./format";
import { savedExcerptRequest } from "./request";
import { ExcerptImageService, excerptKey, excerptRequest } from "./service";
import type { ExcerptEntry } from "./service";

const SERVER_ID = "A8sf5Zsz8ySw";
const LOCAL_USER_KEY = "v3aG8nQf";
const USER_ID = 475425;
const GROUP_ID = 99;
const ATTACHMENT = "ATCH2345";
const ANNOTATION = "ANNT2345";

const annotation: AnnotationRecord = {
  key: ANNOTATION,
  parentKey: ATTACHMENT,
  type: "image",
  color: "#ff0000",
  comment: null,
  text: null,
  pageLabel: "1",
  sortIndex: "00000|000000|00000",
  tags: [],
  version: null,
  lock: null,
  position: { kind: "pdf-rects", pageIndex: 0, rects: [[10, 20, 80, 90]] },
};

const paths = { dataDir: "/zotero", baseAttachmentPath: null };
const databaseSource: AnnotationSource = {
  kind: "zotero-db",
  database: {
    userID: USER_ID,
    localUserKey: LOCAL_USER_KEY,
    serverID: SERVER_ID,
  },
  libraryID: 1,
  libraryRevision: 4,
};
const apiSource: AnnotationSource = {
  kind: "zotero-local-api",
  serverID: SERVER_ID,
};
const groupRecord: AnnotationRecord = {
  ...annotation,
  key: `${ANNOTATION}g${GROUP_ID}`,
  parentKey: `${ATTACHMENT}g${GROUP_ID}`,
};

/** One Attachment, in each of the user Library and a group Library. */
async function fixture(serverID: string | null = SERVER_ID): Promise<
  AsyncDisposableStack & {
    reads: ZoteroReadsApi;
    zoteroReads: Pick<ZoteroReadsService, "acquireRead">;
  }
> {
  const stack = new AsyncDisposableStack();
  const client = stack.adopt(createClient(":memory:"), (db) =>
    db.$client.close(),
  );
  createFixtureSchema(client.$client);
  // An empty Server ID is what Zotero holds before Local API initialization.
  client.$client.exec(`
    insert into libraries (libraryID, type) values (1, 'user'), (2, 'group');
    insert into groups (groupID, libraryID, name) values (${GROUP_ID}, 2, 'Shared');
    insert into settings (setting, key, value) values
      ('account', 'userID', ${USER_ID}),
      ('account', 'localUserKey', '${LOCAL_USER_KEY}'),
      ('localAPI', 'serverID', '${serverID ?? ""}');
    insert into items (itemID, itemTypeID, dateAdded, dateModified, libraryID, key) values
      (1, 2, '2025-01-01 00:00:00', '2025-01-01 00:00:00', 1, '${ATTACHMENT}'),
      (2, 2, '2025-01-01 00:00:00', '2025-01-01 00:00:00', 2, '${ATTACHMENT}');
    insert into itemAttachments (itemID, parentItemID, linkMode, contentType, path) values
      (1, null, 0, 'application/pdf', 'storage:paper.pdf'),
      (2, null, 0, 'application/pdf', 'storage:paper.pdf');
  `);
  const zoteroReads = stack.use(
    inProcessReadsService(sharedClientOpener(client)),
  );
  const { reads } = await zoteroReads.ready;
  return Object.assign(stack, { reads, zoteroReads });
}

describe("Saved excerpt request", () => {
  it("resolves to nothing where the database cannot answer", async () => {
    const closed = createClient(":memory:");
    closed.$client.close();
    await using zoteroReads = inProcessReadsService(sharedClientOpener(closed));

    expect(
      await savedExcerptRequest({
        annotation,
        source: apiSource,
        sourceScope: paths.dataDir,
        zoteroReads,
        paths,
      }),
    ).toBeNull();
  });

  it("resolves to nothing where the data directory moves during the read", async () => {
    await using db = await fixture();
    const moving = { ...paths };

    const request = await savedExcerptRequest({
      annotation,
      source: apiSource,
      sourceScope: paths.dataDir,
      zoteroReads: {
        acquireRead: async () => {
          const lease = await db.zoteroReads.acquireRead();
          moving.dataDir = "/other-zotero";
          return lease;
        },
      },
      paths: moving,
    });

    expect(request).toBeNull();
  });
});

describe("Excerpt request verification", () => {
  it("gives one identity to the API and database representations of an Annotation", async () => {
    await using db = await fixture();
    const fromDatabase = await excerptRequest({
      annotation,
      source: databaseSource,
      reads: db.reads,
      paths,
    });
    const fromApi = await excerptRequest({
      annotation,
      source: apiSource,
      reads: db.reads,
      paths,
    });
    expect(fromApi).not.toBeNull();
    expect(excerptKey(fromApi!)).toBe(excerptKey(fromDatabase!));
    expect(fromApi!.pdfPath).toBe(fromDatabase!.pdfPath);
    expect(fromApi!.attachmentKey).toBe(ATTACHMENT);
  });

  it("reuses one render for an API request followed by a database request", async () => {
    await using db = await fixture();
    const fromApi = (await excerptRequest({
      annotation,
      source: apiSource,
      reads: db.reads,
      paths,
    }))!;
    const fromDatabase = (await excerptRequest({
      annotation,
      source: databaseSource,
      reads: db.reads,
      paths,
    }))!;
    const bytes = new Uint8Array([1, 2, 3]);
    const entries = new Map<string, ExcerptEntry>();
    const render = vi.fn(async () => ({ bytes, format: PNG_FORMAT }));
    // The cache evidence the record in docs/excerpt-image-reuse-measurements.md
    // states: reads, the reads that answered an entry, and writes, counted on
    // the double the production preflight and the render path actually drive.
    const cache = { reads: 0, hits: 0, writes: 0 };
    await using service = new ExcerptImageService({
      stamp: async () => ({ size: 100, mtimeMs: 10 }),
      render,
      cache: {
        get: async (key) => {
          cache.reads++;
          const entry = entries.get(key);
          if (entry) cache.hits++;
          return entry;
        },
        put: async (key, entry) => {
          cache.writes++;
          entries.set(key, entry);
        },
      },
    });
    expect(await service.resolve(fromApi)).toMatchObject({
      provenance: "rendered",
      bytes,
    });
    expect(await service.resolve(fromDatabase)).toMatchObject({
      provenance: "cache",
      bytes,
      identity: { key: excerptKey(fromApi), pdf: { size: 100, mtimeMs: 10 } },
    });
    expect(render).toHaveBeenCalledTimes(1);
    // One read misses and stores the bytes; the second reads them and hits.
    expect(cache).toEqual({ reads: 2, hits: 1, writes: 1 });
  });

  it("isolates an identical key in another Library", async () => {
    await using db = await fixture();
    const group = (await excerptRequest({
      annotation: groupRecord,
      source: apiSource,
      reads: db.reads,
      paths,
    }))!;
    const user = (await excerptRequest({
      annotation,
      source: apiSource,
      reads: db.reads,
      paths,
    }))!;
    const bytes = new Uint8Array([1, 2, 3]);
    const entries = new Map<string, ExcerptEntry>();
    const render = vi.fn(async () => ({ bytes, format: PNG_FORMAT }));
    await using service = new ExcerptImageService({
      stamp: async () => ({ size: 100, mtimeMs: 10 }),
      render,
      cache: {
        get: async (key) => entries.get(key),
        put: async (key, entry) => {
          entries.set(key, entry);
        },
      },
    });
    await service.resolve(user);
    expect(await service.resolve(group)).toMatchObject({
      provenance: "rendered",
    });
    expect(render).toHaveBeenCalledTimes(2);
  });

  it("keeps a database with no Server ID on a local identity", async () => {
    await using db = await fixture(null);
    const standalone = {
      annotation,
      source: {
        ...databaseSource,
        database: { ...databaseSource.database, serverID: null },
      },
      reads: db.reads,
      paths,
    };
    const request = await excerptRequest(standalone);
    expect(request).not.toBeNull();
    // No Local API session can be verified against this database, so no API
    // source may claim its pixels.
    expect(
      await excerptRequest({ ...standalone, source: apiSource }),
    ).toBeNull();
    // A copy of the database keeps its own identity through its source scope.
    expect(excerptKey(request!)).not.toBe(
      excerptKey(
        (await excerptRequest({
          ...standalone,
          paths: { ...paths, dataDir: "/copied-zotero" },
        }))!,
      ),
    );
  });

  it("refuses a source that names another database or Library", async () => {
    await using db = await fixture();
    const options = {
      annotation,
      source: databaseSource,
      reads: db.reads,
      paths,
    };
    expect(
      await excerptRequest({
        ...options,
        source: { ...apiSource, serverID: "OTHER1234567" },
      }),
    ).toBeNull();
    for (const database of [
      { ...databaseSource.database, serverID: "OTHER1234567" },
      { ...databaseSource.database, serverID: null },
      { ...databaseSource.database, localUserKey: "OTHER" },
      { ...databaseSource.database, userID: null },
    ])
      expect(
        await excerptRequest({
          ...options,
          source: { ...databaseSource, database },
        }),
      ).toBeNull();
    expect(
      await excerptRequest({
        ...options,
        source: { ...databaseSource, libraryID: 2 },
      }),
    ).toBeNull();
    expect(
      await excerptRequest({
        ...options,
        annotation: { ...annotation, key: "ANNOT001" },
      }),
    ).toBeNull();
  });
});
