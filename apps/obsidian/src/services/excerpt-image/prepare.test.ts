// Excerpt preparation reads the database before the vault, through ZoteroReads.
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import { it } from "@effect/vitest";
import { Cause, Context, Effect, Exit, Fiber, Layer } from "effect";
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

const settings = { ...defaults, "attachment.import": true };

type Images = Partial<Pick<ExcerptImages["Service"], "operation" | "resolve">>;

/** The seeded database's reads and its image annotation, closed with the case's Scope. */
const seeded = Effect.gen(function* () {
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
  const [annotation] = getAnnotationsByKey(client, ["FDRFQ7C2"], 1);
  return { reads, annotation: annotation! };
});

/**
 * The real preparation over `vault` and a stub of `images`, at the Zotero data
 * directory `/zotero`, built in the case's Scope.
 */
const preparationOver = (vault: MemoryVault, images: Images) =>
  Effect.map(
    Layer.build(
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
              stubService<ExcerptImages["Service"]>("ExcerptImages", images),
            ),
          ),
        ),
      ),
    ),
    (context) => Context.get(context, ExcerptPreparation),
  );

/** A resolve that settles only when its signal aborts, and gives that signal. */
function pendingResolve() {
  const started = Promise.withResolvers<AbortSignal | undefined>();
  const resolve = (_request: ExcerptRequest, signal?: AbortSignal) => {
    started.resolve(signal);
    return new Promise<never>((_resolve, reject) => {
      signal?.addEventListener("abort", () => reject(signal.reason));
    });
  };
  return { started: started.promise, resolve };
}

it.effect("reads every database input before it reads the previous note", () =>
  Effect.gen(function* () {
    const { reads, annotation } = yield* seeded;
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
    const preparation = yield* preparationOver(vault, {
      operation: () => ({
        resolve: async (request: ExcerptRequest) => {
          requests.push(request);
          return { kind: "unavailable" as const };
        },
        [Symbol.asyncDispose]: async () => {},
      }),
    });
    const prepared = yield* preparation.forNote({
      reads: logged,
      notePath: "Note.md",
      settings,
      previousNote,
    });
    prepared.annotationImageLink(annotation);

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

it.effect(
  "fails with the vault's typed error when the previous note cannot be read",
  () =>
    Effect.gen(function* () {
      const { reads, annotation } = yield* seeded;
      const vault = MemoryVault.with({
        cachedRead: async () => {
          throw new Error("note unreadable");
        },
      });
      const previousNote = vault.add("Note.md");
      const preparation = yield* preparationOver(vault, {
        operation: () => ({
          resolve: async () => ({ kind: "unavailable" as const }),
          [Symbol.asyncDispose]: async () => {},
        }),
      });
      const prepared = yield* preparation.forNote({
        reads,
        notePath: "Note.md",
        settings,
        previousNote,
      });
      prepared.annotationImageLink(annotation);

      const error = yield* Effect.flip(prepared.prepare);

      expect(error).toMatchObject({
        _tag: "VaultError",
        operation: "cachedRead",
        path: "Note.md",
      });
    }).pipe(Effect.scoped),
);

it.effect(
  "aborts the resolution in progress when the note write is interrupted",
  () =>
    Effect.gen(function* () {
      const { reads, annotation } = yield* seeded;
      const pending = pendingResolve();
      const preparation = yield* preparationOver(new MemoryVault(), {
        operation: () => ({
          resolve: pending.resolve,
          [Symbol.asyncDispose]: async () => {},
        }),
      });
      const prepared = yield* preparation.forNote({
        reads,
        notePath: "Note.md",
        settings,
      });
      prepared.annotationImageLink(annotation);
      const write = yield* prepared.prepare.pipe(
        Effect.forkChild({ startImmediately: true }),
      );
      const signal = yield* Effect.promise(() => pending.started);

      yield* Fiber.interrupt(write);

      expect(signal?.aborted).toBe(true);
    }).pipe(Effect.scoped),
);

it.effect(
  "aborts the resolution in progress when the card insert is interrupted",
  () =>
    Effect.gen(function* () {
      const pending = pendingResolve();
      const preparation = yield* preparationOver(new MemoryVault(), {
        resolve: pending.resolve,
      });
      const annotation: ExcerptRequest["annotation"] = {
        key: "FDRFQ7C2",
        parentKey: "RGRPDF24",
        type: "image",
        color: null,
        text: null,
        comment: null,
        pageLabel: "1",
        sortIndex: "00000|000000|00000",
        tags: [],
        version: 1,
        lock: null,
        position: { kind: "pdf-rects", pageIndex: 0, rects: [[0, 0, 10, 10]] },
      };
      const insert = yield* preparation
        .forCard({
          annotation,
          request: {
            annotation,
            source: {
              kind: "zotero-db",
              database: { userID: 1, localUserKey: "LOCAL", serverID: "S" },
              libraryID: 1,
              libraryRevision: 1,
            },
            sourceScope: "/zotero",
            attachmentKey: "RGRPDF24",
            libraryID: 1,
            pdfPath: "/zotero/storage/RGRPDF24/paper.pdf",
            zoteroPngPath: null,
          },
          settings,
          notePath: "Note.md",
          sourceLink: "[Zotero](zotero://open)",
          valid: Effect.succeed(true),
        })
        .pipe(Effect.forkChild({ startImmediately: true }));
      const signal = yield* Effect.promise(() => pending.started);

      yield* Fiber.interrupt(insert);

      expect(signal?.aborted).toBe(true);
    }).pipe(Effect.scoped),
);

it.effect(
  "ends the note write with a defect when the excerpt teardown rejects",
  () =>
    Effect.gen(function* () {
      const { reads, annotation } = yield* seeded;
      const teardown = new Error("renderer release failed");
      const preparation = yield* preparationOver(new MemoryVault(), {
        operation: () => ({
          resolve: async () => ({ kind: "unavailable" as const }),
          [Symbol.asyncDispose]: async () => {
            throw teardown;
          },
        }),
      });
      const prepared = yield* preparation.forNote({
        reads,
        notePath: "Note.md",
        settings,
      });
      prepared.annotationImageLink(annotation);

      const exit = yield* Effect.exit(prepared.prepare);

      expect(Exit.isFailure(exit) && Cause.hasDies(exit.cause)).toBe(true);
      expect(Exit.isFailure(exit) && Cause.squash(exit.cause)).toBe(teardown);
    }).pipe(Effect.scoped),
);
