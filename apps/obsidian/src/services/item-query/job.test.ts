import { Cause, Effect, Exit, Fiber, Scheduler } from "effect";
import type { Scope } from "effect";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { CliData } from "obsidian";
import { describe, expect, it, vi } from "vitest";

import { ItemQueryDatabase } from "@zotlit/db/item-query";
import {
  BULK_LIBRARY,
  openScenarioDatabase,
  seedBulkLibrary,
} from "@zotlit/db/test-scenario";
import type { ScenarioDatabase } from "@zotlit/db/test-scenario";
import { ItemQueryScheduler, ItemQuerySliceObserver } from "@zotlit/item-query";

import { MY_LIBRARY_SCOPE } from "@/services/library-scope/scope";

import { answerItemQuery, ItemQueryOutputError } from "./cli";
import type { QueryWriter } from "./cli";
import { diagnostic } from "./contract";
import { decodeItemQuery } from "./decode";
import type { DecodedQuery } from "./decode";
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

/** The query that the renderer decodes from `params`, as plain JSON. */
function decoded(params: CliData): DecodedQuery {
  const query = decodeItemQuery(params);
  if (query.kind === "invalid")
    throw new Error(`Malformed test query: ${query.message}`);
  return JSON.parse(JSON.stringify(query.value)) as DecodedQuery;
}

function jobOf(params: CliData, stagePath?: string): QueryJob {
  return {
    schema: false,
    query: decoded(params),
    id: "job-1",
    ...IDENTITY,
    scope: MY_LIBRARY_SCOPE,
    ...(stagePath === undefined ? {} : { stagePath }),
  };
}

const run = (scenario: ScenarioDatabase, job: QueryJob) =>
  Effect.runPromise(
    runQueryJob(job, { client: scenario.db, identity: IDENTITY }),
  );

/** The paths of an export from a scenario in a temporary directory. */
function exportPaths(scenario: ScenarioDatabase) {
  const directory = dirname(scenario.path);
  return {
    output: join(directory, "items.json"),
    stagePath: join(directory, ".zotlit-query-job-1.tmp"),
  };
}

describe("Query Job", () => {
  it("answers inline with the pretty JSON of its envelope", async () => {
    using scenario = openScenarioDatabase();

    const answer = await run(
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
  });

  it("writes an export to the staging file and answers a file receipt", async () => {
    using scenario = openScenarioDatabase({ storage: "temp-directory" });
    seedBulkLibrary(scenario.sqlite, 600);
    const { output, stagePath } = exportPaths(scenario);
    const inline = await run(scenario, jobOf(BULK));

    const answer = await run(scenario, jobOf({ ...BULK, output }, stagePath));

    const bytes = Buffer.byteLength(inline.answer);
    expect(answer.receipt).toEqual({ kind: "file", path: output, bytes });
    expect(JSON.parse(answer.answer)).toMatchObject({
      ok: true,
      returnedCount: 600,
      file: { path: output, bytes, format: "json" },
    });
    expect(JSON.parse(answer.answer)).not.toHaveProperty("rows");
    expect(await readFile(stagePath, "utf8")).toBe(inline.answer);
    // The renderer publishes the staging file.
    expect(await readdir(dirname(output))).not.toContain("items.json");
  });

  it("answers result-too-large for an inline result above the limit", async () => {
    using scenario = openScenarioDatabase();
    seedBulkLibrary(scenario.sqlite, 6000);

    const answer = await run(scenario, jobOf(BULK));

    expect(answer.receipt).toEqual({ kind: "inline" });
    expect(JSON.parse(answer.answer)).toMatchObject({
      ok: false,
      diagnostic: { code: "result-too-large" },
    });
  });

  it("answers output-error with no file receipt when the staging file does not close", async () => {
    using scenario = openScenarioDatabase({ storage: "temp-directory" });
    const { output, stagePath } = exportPaths(scenario);
    closeFailure.next = Object.assign(new Error("EIO: i/o error, close"), {
      code: "EIO",
    });

    try {
      const answer = await run(scenario, jobOf({ output }, stagePath));

      expect(closeFailure.next).toBeUndefined();
      expect(answer.receipt).toEqual({ kind: "inline" });
      expect(JSON.parse(answer.answer)).toMatchObject({
        ok: false,
        diagnostic: {
          code: "output-error",
          message: "EIO: i/o error, close",
        },
      });
      // The staging file is not a complete export: no receipt publishes it.
      expect(await readFile(stagePath, "utf8")).not.toBe("");
    } finally {
      closeFailure.next = undefined;
    }
  });

  it("answers output-error when the staging file cannot be opened, and keeps the file there", async () => {
    using scenario = openScenarioDatabase({ storage: "temp-directory" });
    const { output, stagePath } = exportPaths(scenario);
    await writeFile(stagePath, "keep this content");

    const answer = await run(scenario, jobOf({ output }, stagePath));

    expect(answer.receipt).toEqual({ kind: "inline" });
    expect(JSON.parse(answer.answer)).toMatchObject({
      ok: false,
      diagnostic: { code: "output-error" },
    });
    expect(await readFile(stagePath, "utf8")).toBe("keep this content");
  });

  it("gives another effect a turn at a pause of a bulk query on the job fiber", async () => {
    using scenario = openScenarioDatabase({ storage: "temp-directory" });
    seedBulkLibrary(scenario.sqlite, 20000);
    const { output, stagePath } = exportPaths(scenario);
    const events: string[] = [];

    const answer = await Effect.runPromise(
      Effect.gen(function* () {
        const job = yield* Effect.forkChild(
          runQueryJob(jobOf({ ...BULK, output }, stagePath), {
            client: scenario.db,
            identity: IDENTITY,
          }).pipe(
            Effect.provideService(ItemQuerySliceObserver, {
              paused: () => events.push("pause"),
              resumed: () => events.push("resume"),
            }),
          ),
        );
        // A stand-in for a ZoteroReads request on the default scheduler,
        // such as Ping: a timer task.
        yield* Effect.sleep("1 millis");
        events.push("other");
        return yield* Fiber.join(job);
      }),
    );

    // The time-budget scheduler of the job ended a slice, and the other
    // effect ran before the job resumed.
    const other = events.indexOf("other");
    expect(events[other - 1]).toBe("pause");
    expect(events.slice(other)).toContain("resume");
    expect(JSON.parse(answer.answer)).toMatchObject({ returnedCount: 20000 });
  });
});

describe("Query Job output", () => {
  /**
   * The export of the bulk Library in the scope of a job, on its scheduler, to
   * an in-memory writer. `events` records the life of the writer and the end of
   * the scope.
   */
  function memoryExport(
    scenario: ScenarioDatabase,
    write: (count: number) => Effect.Effect<void, ItemQueryOutputError>,
  ) {
    const events: string[] = [];
    let writes = 0;
    const openOutput = (): Effect.Effect<QueryWriter, never, Scope.Scope> =>
      Effect.acquireRelease(
        Effect.sync(() => events.push("open")),
        () => Effect.sync(() => events.push("close")),
      ).pipe(
        Effect.as({
          write: () =>
            Effect.suspend(() => {
              events.push("write");
              return write(++writes);
            }),
        }),
      );
    const answer = answerItemQuery(
      { identity: IDENTITY, scope: MY_LIBRARY_SCOPE, openOutput },
      decoded({ ...BULK, output: "/exports/items.json" }),
    ).pipe(
      Effect.scoped,
      Effect.onExit(() => Effect.sync(() => events.push("scope-ended"))),
      Effect.provideService(ItemQueryDatabase, { client: scenario.db }),
      Effect.provideService(Scheduler.Scheduler, new ItemQueryScheduler()),
    );
    return { events, answer };
  }

  it("ends interrupted between two chunks and closes the writer before the scope ends", async () => {
    using scenario = openScenarioDatabase();
    seedBulkLibrary(scenario.sqlite, 600);
    const controller = new AbortController();
    // The head, then the first chunk of rows: the interrupt comes there.
    const { events, answer } = memoryExport(scenario, (count) =>
      Effect.sync(() => {
        if (count === 2) controller.abort();
      }),
    );

    // The run starts in a later task, after Effect listens to the signal.
    const exit = await Effect.runPromiseExit(
      Effect.andThen(Effect.yieldNow, answer),
      { signal: controller.signal },
    );

    expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(
      true,
    );
    expect(events).toEqual(["open", "write", "write", "close", "scope-ended"]);
  });

  it("answers output-error for a failed write and closes the writer before the scope ends", async () => {
    using scenario = openScenarioDatabase();
    seedBulkLibrary(scenario.sqlite, 600);
    const { events, answer } = memoryExport(scenario, (count) =>
      count === 2
        ? Effect.fail(
            new ItemQueryOutputError({
              diagnostic: diagnostic("output-error", "The disk is full."),
            }),
          )
        : Effect.void,
    );

    const reply = await Effect.runPromise(answer);

    expect(reply.receipt).toEqual({ kind: "inline" });
    expect(JSON.parse(reply.answer)).toMatchObject({
      ok: false,
      diagnostic: { code: "output-error", message: "The disk is full." },
    });
    expect(events).toEqual(["open", "write", "write", "close", "scope-ended"]);
  });
});
