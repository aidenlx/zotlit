import { Effect, Fiber, Layer } from "effect";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import type { Attachment } from "@zotlit/db";
import {
  BULK_LIBRARY,
  openScenarioDatabase,
  seedBulkLibrary,
} from "@zotlit/db/test-scenario";
import type { ScenarioDatabase } from "@zotlit/db/test-scenario";

import { makeAttachmentFileResolver } from "@/services/item-query/attachment-files";
import { decodeItemQuery } from "@/services/item-query/decode";
import type { DecodedQuery } from "@/services/item-query/decode";
import type { QueryJob } from "@/services/item-query/worker-protocol";
import { MY_LIBRARY_SCOPE } from "@/services/library-scope/scope";

import { Connection, layerRcRef } from "./connection";
import { inProcessClient, sharedClientOpener } from "./test-utils";

const IDENTITY = {
  vault: { name: "Research", path: "/vaults/research" },
  source: { id: "source-1", databasePath: "/zotero/zotero.sqlite" },
};

const BULK = {
  library: `group:${BULK_LIBRARY.groupID}`,
  limit: "all",
  fields: '["title","tags"]',
};

const ATTACHMENT_PATHS = {
  dataDir: "/zotero",
  baseAttachmentPath: null,
};

function attachment(
  itemID: number,
  overrides: Pick<Attachment, "key" | "path" | "linkMode">,
): Attachment {
  return {
    itemID,
    libraryID: 1,
    groupID: null,
    indexedKey: overrides.key,
    parentItemID: 1,
    contentType: "application/pdf",
    dateAdded: Temporal.Instant.from("2024-01-01T00:00:00Z"),
    dateModified: Temporal.Instant.from("2024-01-01T00:00:00Z"),
    ...overrides,
  };
}

function jobOf(
  id: string,
  params: Record<string, string>,
  stagePath?: string,
): QueryJob {
  const query = decodeItemQuery(params);
  if (query.kind === "invalid")
    throw new Error(`Malformed test query: ${query.message}`);
  return {
    schema: false,
    dataset: "items",
    command: "zotlit:item-query",
    query: JSON.parse(JSON.stringify(query.value)) as DecodedQuery,
    id,
    ...IDENTITY,
    scope: MY_LIBRARY_SCOPE,
    attachmentPaths: ATTACHMENT_PATHS,
    ...(stagePath === undefined ? {} : { stagePath }),
  };
}

/** An export of the bulk Library to the directory of the scenario. */
function bulkExport(scenario: ScenarioDatabase, id: string): QueryJob {
  const directory = dirname(scenario.path);
  return jobOf(
    id,
    { ...BULK, output: join(directory, `${id}.json`) },
    join(directory, `.zotlit-query-${id}.tmp`),
  );
}

/**
 * The in-process client over the scenario, with a count of the connection
 * borrows that are open.
 */
function clientOf(scenario: ScenarioDatabase) {
  let borrows = 0;
  const counted = Layer.effect(Connection)(
    Effect.gen(function* () {
      const connection = yield* Connection;
      return Connection.of({
        ...connection,
        borrow: Effect.acquireRelease(
          Effect.sync(() => {
            borrows++;
          }),
          () =>
            Effect.sync(() => {
              borrows--;
            }),
        ).pipe(Effect.andThen(connection.borrow)),
      });
    }),
  ).pipe(Layer.provide(layerRcRef(sharedClientOpener(scenario.db))));
  return { client: inProcessClient(counted), borrows: () => borrows };
}

/** The job writes its staging file. */
const writing = (job: QueryJob) =>
  Effect.promise(() =>
    vi.waitFor(
      async () => {
        expect(
          (await readFile(job.stagePath!, "utf8").catch(() => "")).length,
        ).toBeGreaterThan(0);
      },
      { timeout: 15000, interval: 1 },
    ),
  );

describe("ZoteroReads ItemQuery", () => {
  it("answers the envelope of a job with its receipt", async () => {
    using scenario = openScenarioDatabase();
    const { client, borrows } = clientOf(scenario);

    const answer = await Effect.runPromise(
      Effect.scoped(
        Effect.flatMap(client, (reads) =>
          reads.ItemQuery({ job: jobOf("plain", { limit: "3" }) }),
        ),
      ),
    );

    expect(answer).toMatchObject({ receipt: { kind: "inline" } });
    expect(answer).not.toHaveProperty("cancelled");
    expect(JSON.parse(answer.answer)).toMatchObject({
      ok: true,
      identity: IDENTITY,
      returnedCount: 3,
    });
    expect(borrows()).toBe(0);
  });

  it("cancels a job while it waits for a slot, and then the running jobs", async () => {
    using scenario = openScenarioDatabase({ storage: "temp-directory" });
    seedBulkLibrary(scenario.sqlite, 20000);
    const { client, borrows } = clientOf(scenario);
    const first = bulkExport(scenario, "first");

    const answers = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const reads = yield* client;
          const running = yield* Effect.forkChild(
            Effect.all(
              [first, bulkExport(scenario, "second")].map((job) =>
                reads.ItemQuery({ job }),
              ),
              { concurrency: "unbounded" },
            ),
          );
          yield* writing(first);
          const waiting = yield* Effect.forkChild(
            reads.ItemQuery({ job: jobOf("waiting", { limit: "1" }) }),
          );
          yield* Effect.sleep("10 millis");
          // Two jobs hold the two slots: the third waits for one.
          expect(borrows()).toBe(2);
          yield* reads.CancelItemQuery({ id: "waiting" });
          const cancelled = yield* Fiber.join(waiting);
          const stillRunning = running.pollUnsafe() === undefined;
          yield* reads.CancelItemQuery({ id: "first" });
          yield* reads.CancelItemQuery({ id: "second" });
          return {
            cancelled,
            stillRunning,
            running: yield* Fiber.join(running),
          };
        }),
      ),
    );

    expect(answers.cancelled).toEqual({
      command: "zotlit:item-query",
      answer: "",
      receipt: { kind: "inline" },
      cancelled: true,
    });
    expect(answers.stillRunning).toBe(true);
    for (const answer of answers.running)
      expect(answer).toMatchObject({ cancelled: true });
    expect(borrows()).toBe(0);
  });

  it("ends the job of a request that the client interrupts, and releases its borrow", async () => {
    using scenario = openScenarioDatabase({ storage: "temp-directory" });
    seedBulkLibrary(scenario.sqlite, 20000);
    const { client, borrows } = clientOf(scenario);
    const job = bulkExport(scenario, "abandoned");

    const next = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const reads = yield* client;
          const request = yield* Effect.forkChild(reads.ItemQuery({ job }));
          yield* writing(job);
          // The client settles when it sends the interrupt.
          yield* Fiber.interrupt(request);
          yield* Effect.promise(() =>
            vi.waitFor(() => expect(borrows()).toBe(0), {
              timeout: 15000,
              interval: 1,
            }),
          );
          return yield* reads.ItemQuery({ job: jobOf("next", { limit: "1" }) });
        }),
      ),
    );

    // The job stopped inside its rows: the staging file holds no envelope.
    const staged = await readFile(job.stagePath!, "utf8");
    expect(() => JSON.parse(staged) as unknown).toThrow();
    expect(await readdir(dirname(job.stagePath!))).not.toContain(
      "abandoned.json",
    );
    expect(JSON.parse(next.answer)).toMatchObject({ ok: true });
  });
});

describe("ZoteroReads Attachment files", () => {
  it("resolves and probes each Attachment once within one query", async () => {
    using scenario = openScenarioDatabase({ storage: "temp-directory" });
    const dataDir = dirname(scenario.path);
    const baseAttachmentPath = join(dataDir, "linked");
    const importedPath = join(dataDir, "storage", "IMPRT223", "paper.pdf");
    const linkedPath = join(baseAttachmentPath, "papers", "linked.pdf");
    await mkdir(dirname(importedPath), { recursive: true });
    await mkdir(dirname(linkedPath), { recursive: true });
    await Promise.all([
      writeFile(importedPath, "imported"),
      writeFile(linkedPath, "linked"),
    ]);
    const probe = vi.fn(stat);
    const resolve = makeAttachmentFileResolver(
      { dataDir, baseAttachmentPath },
      { stat: probe },
    );
    const imported = attachment(10, {
      key: "IMPRT223",
      path: "storage:paper.pdf",
      linkMode: 0,
    });
    const linked = attachment(11, {
      key: "LINKD223",
      path: "attachments:papers/linked.pdf",
      linkMode: 2,
    });
    const missing = attachment(12, {
      key: "MISSI223",
      path: "storage:missing.pdf",
      linkMode: 0,
    });
    const linkedUrl = attachment(13, {
      key: "LINKU223",
      path: "https://example.com/paper.pdf",
      linkMode: 3,
    });

    const resolved = await Effect.runPromise(
      Effect.all(
        [
          resolve(imported),
          resolve({ ...imported }),
          resolve(linked),
          resolve(missing),
          resolve(linkedUrl),
        ],
        { concurrency: "unbounded" },
      ),
    );

    expect(resolved).toEqual([
      { path: importedPath, exists: true },
      { path: importedPath, exists: true },
      { path: linkedPath, exists: true },
      {
        path: join(dataDir, "storage", "MISSI223", "missing.pdf"),
        exists: false,
      },
      { path: null, exists: false },
    ]);
    expect(probe.mock.calls.map(([path]) => path)).toEqual([
      importedPath,
      linkedPath,
      join(dataDir, "storage", "MISSI223", "missing.pdf"),
    ]);
  });

  it("does not probe a linked file when its base directory is unset", async () => {
    const probe = vi.fn(stat);
    const resolve = makeAttachmentFileResolver(
      { dataDir: "/zotero", baseAttachmentPath: null },
      { stat: probe },
    );

    await expect(
      Effect.runPromise(
        resolve(
          attachment(20, {
            key: "LINKD456",
            path: "attachments:papers/linked.pdf",
            linkMode: 2,
          }),
        ),
      ),
    ).resolves.toEqual({ path: null, exists: false });
    expect(probe).not.toHaveBeenCalled();
  });
});
