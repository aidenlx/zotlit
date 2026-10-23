// One Annotation reached through the Local API and the database must reuse pixels.
import { join } from "node:path";
import { describe, expect, vi } from "vitest";

import { createClient } from "@zotlit/db/client/node";
import { openScenarioDatabase } from "@zotlit/db/test-scenario";
import { createFixtureSchema } from "@zotlit/db/test-utils";

import { Effect } from "@/lib/effect";
import { acquireAsyncDisposable } from "@/lib/effect-scope";
import { it } from "@/lib/effect-vitest";
import type {
  AnnotationRecord,
  AnnotationSource,
} from "@/services/annotation-repository/service";
import { DbUnavailable } from "@/services/zotero-reads/rpc";
import type {
  ZoteroReadsApi,
  ZoteroReadsService,
} from "@/services/zotero-reads/service";
import {
  inProcessReadsService,
  sharedClientOpener,
} from "@/services/zotero-reads/test-utils";
import type { InProcessReadsOptions } from "@/services/zotero-reads/test-utils";

import { answerAnnotationImage } from "./cli-image";
import { PNG_FORMAT } from "./format";
import {
  ExcerptSourceUnavailable,
  excerptRequestForKey,
  savedExcerptRequest,
} from "./request";
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

/** {@link fixture}, held for the case's scope. */
const fixtureDb = (serverID?: string | null) =>
  acquireAsyncDisposable(() => fixture(serverID));

/** An Excerpt Image service over `render` and an in-memory cache. */
const serviceOf = (
  options: ConstructorParameters<typeof ExcerptImageService>[0],
) =>
  acquireAsyncDisposable(() =>
    Promise.resolve(new ExcerptImageService(options)),
  );

describe("Saved excerpt request", () => {
  it.effect("resolves to nothing where the database cannot answer", () =>
    Effect.gen(function* () {
      const closed = createClient(":memory:");
      closed.$client.close();
      const zoteroReads = yield* acquireAsyncDisposable(() =>
        Promise.resolve(inProcessReadsService(sharedClientOpener(closed))),
      );

      expect(
        yield* Effect.promise(() =>
          savedExcerptRequest({
            annotation,
            source: apiSource,
            sourceScope: paths.dataDir,
            zoteroReads,
            paths,
          }),
        ),
      ).toBeNull();
    }),
  );

  it.effect(
    "resolves to nothing where the data directory moves during the read",
    () =>
      Effect.gen(function* () {
        const db = yield* fixtureDb();
        const moving = { ...paths };

        const request = yield* Effect.promise(() =>
          savedExcerptRequest({
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
          }),
        );

        expect(request).toBeNull();
      }),
  );
});

describe("Excerpt request verification", () => {
  it.effect(
    "gives one identity to the API and database representations of an Annotation",
    () =>
      Effect.gen(function* () {
        const db = yield* fixtureDb();
        const fromDatabase = yield* excerptRequest({
          annotation,
          source: databaseSource,
          reads: db.reads,
          paths,
        });
        const fromApi = yield* excerptRequest({
          annotation,
          source: apiSource,
          reads: db.reads,
          paths,
        });
        expect(fromApi).not.toBeNull();
        expect(excerptKey(fromApi!)).toBe(excerptKey(fromDatabase!));
        expect(fromApi!.pdfPath).toBe(fromDatabase!.pdfPath);
        expect(fromApi!.attachmentKey).toBe(ATTACHMENT);
      }),
  );

  it.effect(
    "reuses one render for an API request followed by a database request",
    () =>
      Effect.gen(function* () {
        const db = yield* fixtureDb();
        const fromApi = (yield* excerptRequest({
          annotation,
          source: apiSource,
          reads: db.reads,
          paths,
        }))!;
        const fromDatabase = (yield* excerptRequest({
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
        const service = yield* serviceOf({
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
        expect(
          yield* Effect.promise(() => service.resolve(fromApi)),
        ).toMatchObject({
          provenance: "rendered",
          bytes,
        });
        expect(
          yield* Effect.promise(() => service.resolve(fromDatabase)),
        ).toMatchObject({
          provenance: "cache",
          bytes,
          identity: {
            key: excerptKey(fromApi),
            pdf: { size: 100, mtimeMs: 10 },
          },
        });
        expect(render).toHaveBeenCalledTimes(1);
        // One read misses and stores the bytes; the second reads them and hits.
        expect(cache).toEqual({ reads: 2, hits: 1, writes: 1 });
      }),
  );

  it.effect("isolates an identical key in another Library", () =>
    Effect.gen(function* () {
      const db = yield* fixtureDb();
      const group = (yield* excerptRequest({
        annotation: groupRecord,
        source: apiSource,
        reads: db.reads,
        paths,
      }))!;
      const user = (yield* excerptRequest({
        annotation,
        source: apiSource,
        reads: db.reads,
        paths,
      }))!;
      const bytes = new Uint8Array([1, 2, 3]);
      const entries = new Map<string, ExcerptEntry>();
      const render = vi.fn(async () => ({ bytes, format: PNG_FORMAT }));
      const service = yield* serviceOf({
        stamp: async () => ({ size: 100, mtimeMs: 10 }),
        render,
        cache: {
          get: async (key) => entries.get(key),
          put: async (key, entry) => {
            entries.set(key, entry);
          },
        },
      });
      yield* Effect.promise(() => service.resolve(user));
      expect(yield* Effect.promise(() => service.resolve(group))).toMatchObject(
        {
          provenance: "rendered",
        },
      );
      expect(render).toHaveBeenCalledTimes(2);
    }),
  );

  it.effect("keeps a database with no Server ID on a local identity", () =>
    Effect.gen(function* () {
      const db = yield* fixtureDb(null);
      const standalone = {
        annotation,
        source: {
          ...databaseSource,
          database: { ...databaseSource.database, serverID: null },
        },
        reads: db.reads,
        paths,
      };
      const request = yield* excerptRequest(standalone);
      expect(request).not.toBeNull();
      // No Local API session can be verified against this database, so no API
      // source may claim its pixels.
      expect(
        yield* excerptRequest({ ...standalone, source: apiSource }),
      ).toBeNull();
      // A copy of the database keeps its own identity through its source scope.
      expect(excerptKey(request!)).not.toBe(
        excerptKey(
          (yield* excerptRequest({
            ...standalone,
            paths: { ...paths, dataDir: "/copied-zotero" },
          }))!,
        ),
      );
    }),
  );

  it.effect("refuses a source that names another database or Library", () =>
    Effect.gen(function* () {
      const db = yield* fixtureDb();
      const options = {
        annotation,
        source: databaseSource,
        reads: db.reads,
        paths,
      };
      expect(
        yield* excerptRequest({
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
          yield* excerptRequest({
            ...options,
            source: { ...databaseSource, database },
          }),
        ).toBeNull();
      expect(
        yield* excerptRequest({
          ...options,
          source: { ...databaseSource, libraryID: 2 },
        }),
      ).toBeNull();
      expect(
        yield* excerptRequest({
          ...options,
          annotation: { ...annotation, key: "ANNOT001" },
        }),
      ).toBeNull();
    }),
  );
});

describe("Excerpt request for an Indexed Key", () => {
  const dataDir = "/zotero";
  const keyPaths = { dataDir, baseAttachmentPath: "/linked" };

  /** Snapshot-bound reads of the scenario database, held for the case's scope. */
  const scenarioReads = (wrap?: InProcessReadsOptions["wrap"]) =>
    acquireAsyncDisposable(async () => {
      await using stack = new AsyncDisposableStack();
      const scenario = stack.use(openScenarioDatabase({ annotations: true }));
      const zoteroReads = stack.use(
        inProcessReadsService(sharedClientOpener(scenario.db), { wrap }),
      );
      const lease = stack.use(await zoteroReads.acquireRead());
      return Object.assign(stack.move(), { reads: lease.reads });
    });

  it.effect(
    "builds the request of an image Annotation from its row and Attachment",
    () =>
      Effect.gen(function* () {
        const db = yield* scenarioReads();

        const request = yield* excerptRequestForKey({
          reads: db.reads,
          key: "ANN2IMAG",
          paths: keyPaths,
        });

        expect(request).toMatchObject({
          annotation: {
            key: "ANN2IMAG",
            parentKey: "PDF2LIVE",
            type: "image",
            color: "#ffd400",
            pageLabel: "iv",
            sortIndex: "00000|000003|00000",
            lock: null,
          },
          source: { kind: "zotero-db", libraryID: 1 },
          sourceScope: dataDir,
          attachmentKey: "PDF2LIVE",
          libraryID: 1,
          pdfPath: join(dataDir, "storage", "PDF2LIVE", "exact.pdf"),
          zoteroPngPath: join(dataDir, "cache", "library", "ANN2IMAG.png"),
        });
      }),
  );

  it.effect(
    "builds the request of a non-image Annotation, which the image command rejects",
    () =>
      Effect.gen(function* () {
        const db = yield* scenarioReads();

        const request = yield* excerptRequestForKey({
          reads: db.reads,
          key: "ANN2HGHT",
          paths: keyPaths,
        });

        expect(request).toMatchObject({
          annotation: { key: "ANN2HGHT", type: "highlight" },
          zoteroPngPath: null,
        });
        const answer = JSON.parse(
          yield* answerAnnotationImage(
            { key: "ANN2HGHT" },
            {
              read: (key) =>
                excerptRequestForKey({ reads: db.reads, key, paths: keyPaths }),
              resolve: () => {
                throw new Error("A non-image Annotation is never resolved");
              },
              publish: () => {
                throw new Error("A non-image Annotation is never published");
              },
              exists: async () => false,
            },
          ),
        );
        expect(answer).toMatchObject({
          ok: false,
          diagnostic: { code: "not-an-image-annotation" },
        });
      }),
  );

  it.effect.each([
    ["no Annotation has the key", "ZZZZZZZZ"],
    ["the source holds no Library of the key", "ANN2IMAGg9999"],
  ] as const)("resolves to nothing where %s", ([, key]) =>
    Effect.gen(function* () {
      const db = yield* scenarioReads();

      expect(
        yield* excerptRequestForKey({ reads: db.reads, key, paths: keyPaths }),
      ).toBeNull();
    }),
  );

  it.effect("fails with the reader's own message where a read fails", () =>
    Effect.gen(function* () {
      const db = yield* scenarioReads((client) => ({
        ...client,
        AnnotationSources: (() =>
          Effect.fail(
            new DbUnavailable({ message: "database disk is locked" }),
          )) as typeof client.AnnotationSources,
      }));

      const failure = yield* Effect.flip(
        excerptRequestForKey({
          reads: db.reads,
          key: "ANN2IMAG",
          paths: keyPaths,
        }),
      );

      expect(failure).toBeInstanceOf(ExcerptSourceUnavailable);
      expect(failure).toMatchObject({ message: "database disk is locked" });
    }),
  );
});
