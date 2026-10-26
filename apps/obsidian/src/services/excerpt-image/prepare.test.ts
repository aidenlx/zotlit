// Excerpt preparation reads the database before the vault, through ZoteroReads.
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import { it } from "@effect/vitest";
import { Context, Effect, Layer } from "effect";
import { expect } from "vitest";

import { getAnnotationsByKey } from "@zotlit/db";
import { createClient } from "@zotlit/db/client/node";
import { createFixtureSchema } from "@zotlit/db/test-utils";

import { layerHost } from "@/lib/__fixtures__/obsidian-host-app";
import { MemoryVault } from "@/lib/__fixtures__/obsidian-vault";
import { stubService } from "@/lib/__fixtures__/service-stub";
import { defaults } from "@/services/settings/schema";
import { ZoteroPref } from "@/services/zotero-pref/service";
import type { ZoteroPrefSnapshot } from "@/services/zotero-pref/service";
import type { ZoteroReadsApi } from "@/services/zotero-reads/service";
import {
  inProcessReadsService,
  sharedClientOpener,
} from "@/services/zotero-reads/test-utils";

import type { ExcerptRequest } from "./contract";
import { ExcerptImages } from "./layer";
import { ExcerptPreparation, layerExcerptPreparation } from "./prepare";

const SEED = `
  insert into version (schema, version) values ('userdata', 129);
  insert into libraries (libraryID, type, version, clientVersion) values (1, 'user', 0, 12);
  insert into settings (setting, key, value) values
    ('account', 'userID', 42),
    ('account', 'localUserKey', 'LOCALKEY'),
    ('localAPI', 'serverID', 'SERVER000001');
  insert into items (itemID, itemTypeID, dateAdded, dateModified, libraryID, key) values
    (1, 1, '2025-01-01 00:00:00', '2025-01-01 00:00:00', 1, 'RUGIER24'),
    (2, 2, '2025-01-01 00:00:00', '2025-01-01 00:00:00', 1, 'RGRPDF24'),
    (3, 4, '2025-01-01 00:00:00', '2025-01-01 00:00:00', 1, 'FDRFQ7C2');
  insert into itemAttachments (itemID, parentItemID, linkMode, contentType, path)
    values (2, 1, 0, 'application/pdf', 'storage:paper.pdf');
  insert into itemAnnotations (itemID, parentItemID, type, color, pageLabel, position)
    values (3, 2, 3, '#ffd400', '1', '{"pageIndex":0,"rects":[[0,0,10,10]]}');
`;

const READ_OPERATIONS = [
  "AttachmentsByKeys",
  "DatabaseIdentity",
  "Libraries",
] as const;

it.effect("reads every database input before it reads the previous note", () =>
  Effect.gen(function* () {
    const client = yield* Effect.acquireRelease(
      Effect.sync(() => createClient(":memory:")),
      (db) => Effect.sync(() => db.$client.close()),
    );
    createFixtureSchema(client.$client);
    client.$client.exec(SEED);
    const service = yield* Effect.acquireDisposable(
      Effect.sync(() => inProcessReadsService(sharedClientOpener(client))),
    );
    const { reads } = yield* Effect.promise(() => service.ready);
    const log: string[] = [];
    const logged: ZoteroReadsApi = new Proxy(
      stubService<ZoteroReadsApi>("ZoteroReadsApi", {}),
      {
        get(_target, key) {
          const value = Reflect.get(reads, key, reads);
          if (
            typeof value !== "function" ||
            !READ_OPERATIONS.includes(key as (typeof READ_OPERATIONS)[number])
          )
            return typeof value === "function" ? value.bind(reads) : value;
          return (...args: unknown[]) => {
            log.push(String(key));
            return Reflect.apply(value, reads, args);
          };
        },
      },
    );
    const requests: ExcerptRequest[] = [];
    const vault = MemoryVault.with({
      cachedRead: async () => {
        log.push("vault");
        return "";
      },
    });
    const previousNote = vault.add("Note.md");
    const preparation = Context.get(
      yield* Layer.build(
        layerExcerptPreparation.pipe(
          Layer.provide(
            Layer.mergeAll(
              layerHost({ vault }),
              NodeFileSystem.layer,
              Layer.mock(ZoteroPref, {
                current: Effect.succeed(
                  stubService<ZoteroPrefSnapshot>("ZoteroPrefSnapshot", {
                    dataDir: "/zotero",
                    baseAttachmentPath: null,
                  }),
                ),
              }),
              Layer.succeed(
                ExcerptImages,
                stubService<ExcerptImages["Service"]>("ExcerptImages", {
                  operation: () => ({
                    resolve: async (request: ExcerptRequest) => {
                      requests.push(request);
                      return { kind: "unavailable" as const };
                    },
                    [Symbol.asyncDispose]: async () => {},
                  }),
                }),
              ),
            ),
          ),
        ),
      ),
      ExcerptPreparation,
    );
    const prepared = yield* preparation.forNote({
      reads: logged,
      notePath: "Note.md",
      settings: { ...defaults, "attachment.import": true },
      previousNote,
    });
    const [annotation] = getAnnotationsByKey(client, ["FDRFQ7C2"], 1);
    prepared.annotationImageLink(annotation!);

    yield* prepared.prepare;

    expect(log.at(-1)).toBe("vault");
    expect(log.slice(0, -1).toSorted()).toEqual([...READ_OPERATIONS]);
    expect(requests).toMatchObject([
      {
        attachmentKey: "RGRPDF24",
        libraryID: 1,
        pdfPath: "/zotero/storage/RGRPDF24/paper.pdf",
        source: {
          kind: "zotero-db",
          database: {
            userID: 42,
            localUserKey: "LOCALKEY",
            serverID: "SERVER000001",
          },
          libraryID: 1,
          libraryRevision: 12,
        },
      },
    ]);
  }).pipe(Effect.scoped),
);
