import { readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { CliData } from "obsidian";
import { describe, expect, vi } from "vitest";

import {
  BULK_LIBRARY,
  openScenarioDatabase,
  seedBulkLibrary,
} from "@zotlit/db/test-scenario";
import type { ScenarioDatabase } from "@zotlit/db/test-scenario";
import { ItemQuerySliceObserver } from "@zotlit/item-query";

import { Deferred, Effect, Fiber } from "@/lib/effect";
import { it } from "@/lib/effect-vitest";
import { MY_LIBRARY_SCOPE } from "@/services/library-scope/scope";

import { workerQuery } from "./__fixtures__/worker-query";
import { makeAttachmentFileResolver } from "./attachment-files";
import { QUERY_COMMAND } from "./contract";
import { runQueryJob } from "./job";
import type { QueryJob } from "./worker-protocol";

/** The next close of a file that `open` gives fails with this error. */
const closeFailure = vi.hoisted(() => ({
  next: undefined as Error | undefined,
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs/promises")>();
  const open: typeof fs.open = async (...args) => {
    const handle = await fs.open(...args);
    const close = handle.close.bind(handle);
    handle.close = async () => {
      await close();
      const failure = closeFailure.next;
      closeFailure.next = undefined;
      if (failure) throw failure;
    };
    return handle;
  };
  return { ...fs, open, default: { ...fs, open } };
});

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

function jobOf(params: CliData, stagePath?: string): QueryJob {
  return {
    schema: false,
    dataset: "items",
    command: QUERY_COMMAND,
    query: workerQuery(params),
    id: "job-1",
    ...IDENTITY,
    scope: MY_LIBRARY_SCOPE,
    attachmentPaths: ATTACHMENT_PATHS,
    ...(stagePath === undefined ? {} : { stagePath }),
  };
}

const run = (scenario: ScenarioDatabase, job: QueryJob) =>
  runQueryJob(job, {
    client: scenario.db,
    identity: IDENTITY,
    attachmentFiles: makeAttachmentFileResolver(job.attachmentPaths),
  });

/** The scenario database, held for the case's scope. */
const scenarioOf = (options?: Parameters<typeof openScenarioDatabase>[0]) =>
  Effect.acquireDisposable(Effect.sync(() => openScenarioDatabase(options)));

/** The text of the file at `path`. */
const textOf = (path: string) => Effect.promise(() => readFile(path, "utf8"));

/** The paths of an export from a scenario in a temporary directory. */
function exportPaths(scenario: ScenarioDatabase) {
  const directory = dirname(scenario.path);
  return {
    output: join(directory, "items.json"),
    stagePath: join(directory, ".zotlit-query-job-1.tmp"),
  };
}

describe("Query Job", () => {
  it.effect("answers inline with the pretty JSON of its envelope", () =>
    Effect.gen(function* () {
      const scenario = yield* scenarioOf();

      const answer = yield* run(
        scenario,
        jobOf({ limit: "all", fields: '["title","creators"]' }),
      );

      expect(answer.receipt).toEqual({ kind: "inline" });
      expect(answer.answer).toBe(
        JSON.stringify(JSON.parse(answer.answer), null, 2),
      );
      expect(JSON.parse(answer.answer)).toMatchObject({
        ok: true,
        returnedCount: 10,
      });
    }),
  );

  it.effect.each([undefined, 'tags != "absent"'])(
    "writes an export and warnings to the staging file and receipt: %s",
    (filter) =>
      Effect.gen(function* () {
        const scenario = yield* scenarioOf({ storage: "temp-directory" });
        seedBulkLibrary(scenario.sqlite, 600);
        const { output, stagePath } = exportPaths(scenario);
        const params = { ...BULK, ...(filter ? { filter } : {}) };
        const inline = yield* run(scenario, jobOf(params));

        const answer = yield* run(
          scenario,
          jobOf({ ...params, output }, stagePath),
        );
        const warnings = JSON.parse(inline.answer).warnings;
        expect(warnings).toHaveLength(filter ? 1 : 0);
        expect(JSON.parse(answer.answer).warnings).toEqual(warnings);

        const bytes = Buffer.byteLength(inline.answer);
        expect(answer.receipt).toEqual({ kind: "file", path: output, bytes });
        expect(JSON.parse(answer.answer)).toMatchObject({
          ok: true,
          returnedCount: 600,
          file: { path: output, bytes, format: "json" },
        });
        expect(JSON.parse(answer.answer)).not.toHaveProperty("rows");
        expect(yield* textOf(stagePath)).toBe(inline.answer);
        // The renderer publishes the staging file.
        expect(
          yield* Effect.promise(() => readdir(dirname(output))),
        ).not.toContain("items.json");
      }),
  );

  it.effect(
    "answers result-too-large for an inline result above the limit",
    () =>
      Effect.gen(function* () {
        const scenario = yield* scenarioOf();
        seedBulkLibrary(scenario.sqlite, 6000);

        const answer = yield* run(scenario, jobOf(BULK));

        expect(answer.receipt).toEqual({ kind: "inline" });
        expect(JSON.parse(answer.answer)).toMatchObject({
          ok: false,
          diagnostic: { code: "result-too-large" },
        });
      }),
  );

  it.effect(
    "answers output-error with no file receipt when the staging file does not close",
    () =>
      Effect.gen(function* () {
        const scenario = yield* scenarioOf({ storage: "temp-directory" });
        const { output, stagePath } = exportPaths(scenario);
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            closeFailure.next = undefined;
          }),
        );
        closeFailure.next = Object.assign(new Error("EIO: i/o error, close"), {
          code: "EIO",
        });

        const answer = yield* run(
          scenario,
          jobOf({ output, filter: 'tags != "absent"' }, stagePath),
        );

        expect(closeFailure.next).toBeUndefined();
        expect(answer.receipt).toEqual({ kind: "inline" });
        expect(JSON.parse(answer.answer)).toMatchObject({
          ok: false,
          diagnostic: {
            code: "output-error",
            message: "EIO: i/o error, close",
          },
        });
        expect(JSON.parse(answer.answer)).not.toHaveProperty("warnings");
        // The staging file is not a complete export: no receipt publishes it.
        expect(yield* textOf(stagePath)).not.toBe("");
      }),
  );

  it.effect(
    "answers output-error when the staging file cannot be opened, and keeps the file there",
    () =>
      Effect.gen(function* () {
        const scenario = yield* scenarioOf({ storage: "temp-directory" });
        const { output, stagePath } = exportPaths(scenario);
        yield* Effect.promise(() => writeFile(stagePath, "keep this content"));

        const answer = yield* run(scenario, jobOf({ output }, stagePath));

        expect(answer.receipt).toEqual({ kind: "inline" });
        expect(JSON.parse(answer.answer)).toMatchObject({
          ok: false,
          diagnostic: { code: "output-error" },
        });
        expect(yield* textOf(stagePath)).toBe("keep this content");
      }),
  );

  // Live: the subject is a real timer task racing the job's scheduler pause.
  it.live(
    "gives another effect a turn at a pause of a bulk query on the job fiber",
    () =>
      Effect.gen(function* () {
        const scenario = yield* scenarioOf({ storage: "temp-directory" });
        seedBulkLibrary(scenario.sqlite, 20000);
        const { output, stagePath } = exportPaths(scenario);
        const events: string[] = [];
        const firstPause = yield* Deferred.make<void>();

        const job = yield* Effect.forkChild(
          runQueryJob(jobOf({ ...BULK, output }, stagePath), {
            client: scenario.db,
            identity: IDENTITY,
            attachmentFiles: makeAttachmentFileResolver(ATTACHMENT_PATHS),
          }).pipe(
            Effect.provideService(ItemQuerySliceObserver, {
              paused: () => {
                events.push("pause");
                Deferred.doneUnsafe(firstPause, Effect.void);
              },
              resumed: () => events.push("resume"),
            }),
          ),
        );
        // A stand-in for a ZoteroReads request on the default scheduler,
        // such as Ping: a timer task, set once the job is mid-query so it
        // lands at a later pause rather than before the first slice.
        yield* Deferred.await(firstPause);
        yield* Effect.sleep("1 millis");
        events.push("other");
        const answer = yield* Fiber.join(job);

        // The time-budget scheduler of the job ended a slice, and the other
        // effect ran before the job resumed.
        const other = events.indexOf("other");
        expect(events[other - 1]).toBe("pause");
        expect(events.slice(other)).toContain("resume");
        expect(JSON.parse(answer.answer)).toMatchObject({
          returnedCount: 20000,
        });
      }),
  );
});
