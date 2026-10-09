import { Effect } from "effect";
import { chmod, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Vault } from "obsidian";
import { describe, expect, it, vi } from "vitest";

import {
  BULK_LIBRARY,
  openScenarioDatabase,
  seedBulkLibrary,
} from "@zotlit/db/test-scenario";
import type { ScenarioDatabase } from "@zotlit/db/test-scenario";

import { MY_LIBRARY_SCOPE } from "@/services/library-scope/scope";
import type { LibraryScopeService } from "@/services/library-scope/service";
import type { ConnectionOpener } from "@/services/zotero-reads/connection";
import {
  inProcessReadsService,
  sharedClientOpener,
} from "@/services/zotero-reads/test-utils";

import { queryCancelledText } from "./contract";
import { QueryService } from "./service";
import type { QueryJob } from "./worker-protocol";

function setup(
  scenario: ScenarioDatabase,
  opener: ConnectionOpener = sharedClientOpener(scenario.db),
) {
  let leases = 0;
  const jobs: QueryJob[] = [];
  const reads = inProcessReadsService(opener, {
    wrap: (client) => ({
      ...client,
      ItemQuery: (payload, options) => {
        jobs.push(payload.job);
        return Effect.acquireUseRelease(
          Effect.sync(() => {
            leases++;
          }),
          () => client.ItemQuery(payload, options),
          () =>
            Effect.sync(() => {
              leases--;
            }),
        );
      },
    }),
  });
  const service = new QueryService({
    pluginVersion: "2.2.0-beta.2",
    reads,
    zoteroPref: {
      sourceId: "captured-source",
      databasePath: scenario.path,
      dataDir: dirname(scenario.path),
      baseAttachmentPath: join(dirname(scenario.path), "linked"),
    },
    libraryScope: {
      ready: Promise.resolve(),
      effective: MY_LIBRARY_SCOPE,
    } as LibraryScopeService,
    vault: {
      getName: () => "Query tests",
      adapter: { getBasePath: () => dirname(scenario.path) },
    } as unknown as Vault,
  });
  const dispose = service[Symbol.asyncDispose].bind(service);
  service[Symbol.asyncDispose] = async () => {
    await dispose();
    await reads[Symbol.asyncDispose]();
  };
  return { service, leases: () => leases, jobs };
}
const signal = () => new AbortController().signal;
const bulk = {
  library: `group:${BULK_LIBRARY.groupID}`,
  limit: "all",
  fields: '["title","tags"]',
};

/** One CLI dataset as the service seam sees it, with its expected wire. */
const DATASETS = [
  {
    dataset: "items",
    command: "zotlit:query",
    schemaCommand: "zotlit:query-schema",
    asset: "query",
    params: { limit: "all", fields: '["title","date","creators"]' },
    returnedCount: 10,
    defaults: {
      fields: ["itemType", "title", "creators", "date", "dateModified"],
      sort: [{ field: "dateModified", direction: "desc" }],
      limit: 100,
      library: { source: "library-scope" },
    },
    customField: { path: 'custom["review.status"]' },
  },
  {
    dataset: "annotations",
    command: "zotlit:query",
    schemaCommand: "zotlit:query-schema",
    asset: "query",
    params: { filter: 'item.indexedKey == "ART2FULL"', limit: "all" },
    returnedCount: 12,
    defaults: {
      fields: [
        "type",
        "text",
        "comment",
        "color",
        "colorName",
        "pageLabel",
        "pageIndex",
        "tags",
        "dateAdded",
        "dateModified",
        "hasExcerptImage",
        "attachment",
        "item.title",
        "item.citationKey",
      ],
      sort: [
        { field: "item.dateModified", direction: "desc" },
        { field: "attachment.indexedKey", direction: "asc" },
        { field: "sortIndex", direction: "asc" },
      ],
      limit: 100,
      library: { source: "library-scope" },
    },
    customField: { path: 'custom["review.status"]' },
  },
] as const;

describe.each(DATASETS)("$dataset CLI dataset through the service", (cli) => {
  const { dataset, command, schemaCommand } = cli;
  const annotated = () =>
    openScenarioDatabase({ storage: "temp-directory", annotations: true });

  it("answers the pretty versioned envelope of the source and keeps the id out of the request", async () => {
    using scenario = annotated();
    const { service, leases, jobs } = setup(scenario);
    await using _owned = service;

    const text = await service.query(
      { from: dataset, ...cli.params, id: "envelope" },
      signal(),
    );

    const answer = JSON.parse(text);
    expect(text).toBe(JSON.stringify(answer, null, 2));
    expect(Object.keys(answer)).toEqual([
      "contractVersion",
      "command",
      "ok",
      "identity",
      "libraries",
      "request",
      "returnedCount",
      "truncated",
      "warnings",
      "rows",
    ]);
    expect(answer).toMatchObject({
      contractVersion: 3,
      command,
      ok: true,
      identity: {
        vault: { name: "Query tests" },
        source: { id: "captured-source", databasePath: scenario.path },
      },
      returnedCount: cli.returnedCount,
    });
    expect(answer.request).not.toHaveProperty("id");
    expect(jobs).toEqual([
      expect.objectContaining({ schema: false, dataset, command }),
    ]);
    expect(jobs[0]?.attachmentPaths).toEqual({
      dataDir: dirname(scenario.path),
      baseAttachmentPath: join(dirname(scenario.path), "linked"),
    });
    expect(leases()).toBe(0);
  });

  it("answers query-id-in-use for an id that a query of either dataset holds", async () => {
    using scenario = annotated();
    const { service } = setup(scenario);
    await using _owned = service;
    const other = DATASETS.find((entry) => entry.dataset !== dataset)!;
    const first = service.query(
      { from: dataset, ...cli.params, id: "job" },
      signal(),
    );

    for (const { dataset: second, command: answered } of [cli, other]) {
      expect(
        JSON.parse(await service.query({ from: second, id: "job" }, signal())),
      ).toEqual({
        contractVersion: 3,
        command: answered,
        ok: false,
        diagnostic: expect.objectContaining({
          code: "query-id-in-use",
          details: { parameter: "id" },
        }),
      });
    }
    expect(JSON.parse(await first)).toMatchObject({ command, ok: true });
    expect(service.cancel("job")).toBe(false);
  });

  it("exports the inline envelope to a new file, answers its receipt, and keeps an existing file", async () => {
    using scenario = annotated();
    const { service, leases } = setup(scenario);
    await using _owned = service;
    const inline = await service.query(
      { from: dataset, ...cli.params },
      signal(),
    );
    const output = join(dirname(scenario.path), `${dataset}.json`);

    const receipt = JSON.parse(
      await service.query({ from: dataset, ...cli.params, output }, signal()),
    );

    expect(receipt).toMatchObject({
      command,
      ok: true,
      returnedCount: cli.returnedCount,
      file: { path: output, bytes: Buffer.byteLength(inline), format: "json" },
    });
    expect(receipt).not.toHaveProperty("rows");
    expect(await readFile(output, "utf8")).toBe(inline);
    await writeFile(output, "keep this content");
    expect(
      JSON.parse(
        await service.query({ from: dataset, ...cli.params, output }, signal()),
      ),
    ).toMatchObject({
      command,
      ok: false,
      diagnostic: { code: "output-error" },
    });
    expect(await readFile(output, "utf8")).toBe("keep this content");
    expect(leases()).toBe(0);
    expect(
      (await readdir(dirname(output))).filter((name) => name.endsWith(".tmp")),
    ).toEqual([]);
  });

  it("cancels a named export by its id and frees the id", async () => {
    using scenario = annotated();
    const { service, leases } = setup(scenario);
    await using _owned = service;
    await service.ready;
    const output = join(dirname(scenario.path), `cancelled-${dataset}.json`);
    const running = service.query(
      { from: dataset, ...cli.params, id: "shared", output },
      signal(),
    );
    const cancelled = expect(running).rejects.toMatchObject({
      name: "AbortError",
      message: queryCancelledText("shared"),
    });

    expect(service.cancel("shared")).toBe(true);
    await cancelled;

    expect(service.cancel("shared")).toBe(false);
    expect(service.runningJobs).toBe(0);
    expect(leases()).toBe(0);
    const files = await readdir(dirname(output));
    expect(files).not.toContain(`cancelled-${dataset}.json`);
    expect(files.filter((name) => name.endsWith(".tmp"))).toEqual([]);
    expect(
      JSON.parse(
        await service.query(
          { from: dataset, ...cli.params, id: "shared" },
          signal(),
        ),
      ),
    ).toMatchObject({ command, ok: true });
  });

  it("answers the schema download, source custom fields and CLI defaults", async () => {
    using scenario = annotated();
    const { service, leases, jobs } = setup(scenario);
    await using _owned = service;

    const text = await service.schema({ from: dataset }, signal());

    const answer = JSON.parse(text);
    expect(text).toBe(JSON.stringify(answer, null, 2));
    expect(Object.keys(answer)).toEqual([
      "contractVersion",
      "command",
      "ok",
      "identity",
      "schema",
      "customFields",
      "datasets",
      "defaults",
    ]);
    expect(answer).toMatchObject({
      contractVersion: 3,
      command: schemaCommand,
      ok: true,
      identity: { source: { id: "captured-source" } },
      schema: {
        url: `https://github.com/aidenlx/zotlit/releases/download/res-2.2.0-beta.2/${cli.asset}.schema.json`,
        fileName: `zotlit-${cli.asset}-2.2.0-beta.2.schema.json`,
      },
      customFields: expect.arrayContaining([
        expect.objectContaining(cli.customField),
      ]),
    });
    expect(Object.keys(answer.schema)).toEqual(["url", "fileName"]);
    expect(answer.defaults).toEqual({ [dataset]: cli.defaults });
    expect(jobs).toEqual([
      expect.objectContaining({
        schema: true,
        dataset,
        command: schemaCommand,
      }),
    ]);
    // The renderer rejects a parameter, without a lease.
    expect(
      JSON.parse(
        await service.schema({ from: dataset, library: "personal" }, signal()),
      ),
    ).toMatchObject({
      contractVersion: 3,
      command: schemaCommand,
      ok: false,
      diagnostic: {
        code: "invalid-argument",
        details: { parameter: "library" },
      },
    });
    expect(jobs).toHaveLength(1);
    expect(leases()).toBe(0);
  });

  it("answers a failure with its command: an unknown field, and an unavailable source", async () => {
    using scenario = annotated();
    const available = setup(scenario);
    await using _available = available.service;
    expect(
      JSON.parse(
        await available.service.query(
          { from: dataset, ...cli.params, fields: '["notAField"]' },
          signal(),
        ),
      ),
    ).toMatchObject({
      contractVersion: 3,
      command,
      ok: false,
      diagnostic: { code: "unknown-field" },
    });
    const unavailable = setup(scenario, () => {
      throw new Error("source closed");
    });
    await using _unavailable = unavailable.service;
    for (const [answered, answer] of [
      [command, await unavailable.service.query({ from: dataset }, signal())],
      [
        schemaCommand,
        await unavailable.service.schema({ from: dataset }, signal()),
      ],
    ] as const)
      expect(JSON.parse(answer)).toMatchObject({
        command: answered,
        ok: false,
        diagnostic: { code: "source-unavailable" },
      });
    expect(unavailable.leases()).toBe(0);
  });
});

describe("Item Query worker jobs", () => {
  it("reports invalid paths and write failures, and leaves no file on a query failure", async () => {
    using scenario = openScenarioDatabase({ storage: "temp-directory" });
    const { service, leases } = setup(scenario);
    await using _owned = service;
    expect(
      JSON.parse(
        await service.query(
          { from: "items", output: "relative.json" },
          signal(),
        ),
      ),
    ).toMatchObject({ diagnostic: { code: "invalid-argument" } });
    const output = join(dirname(scenario.path), "missing", "items.json");
    expect(
      JSON.parse(await service.query({ from: "items", output }, signal())),
    ).toMatchObject({ diagnostic: { code: "output-error" } });
    expect(
      JSON.parse(
        await service.query(
          { from: "items", output, fields: '["notAField"]' },
          signal(),
        ),
      ),
    ).toMatchObject({ diagnostic: { code: "unknown-field" } });
    const denied = join(dirname(scenario.path), "denied");
    await mkdir(denied, { mode: 0o000 });
    try {
      expect(
        JSON.parse(
          await service.query(
            { from: "items", output: join(denied, "items.json") },
            signal(),
          ),
        ),
      ).toMatchObject({ diagnostic: { code: "output-error" } });
    } finally {
      await chmod(denied, 0o700);
    }
    expect(leases()).toBe(0);
  });

  it("bounds inline replies and exports every row of a large result", async () => {
    using scenario = openScenarioDatabase({ storage: "temp-directory" });
    seedBulkLibrary(scenario.sqlite, 6000);
    const { service } = setup(scenario);
    await using _owned = service;
    expect(
      JSON.parse(await service.query({ from: "items", ...bulk }, signal())),
    ).toMatchObject({
      diagnostic: { code: "result-too-large" },
    });
    const output = join(dirname(scenario.path), "large.json");
    const receipt = JSON.parse(
      await service.query({ from: "items", ...bulk, output }, signal()),
    );
    const text = await readFile(output, "utf8");
    expect(receipt).toMatchObject({
      ok: true,
      returnedCount: 6000,
      warnings: [],
      file: { bytes: Buffer.byteLength(text) },
    });
    expect(JSON.parse(text).rows).toHaveLength(6000);
    expect(JSON.parse(text)).toMatchObject({
      ok: true,
      returnedCount: 6000,
      truncated: false,
      warnings: [],
    });
  });

  it("cancels an export and a queued job, lets another query finish, and recovers a worker", async () => {
    using scenario = openScenarioDatabase({ storage: "temp-directory" });
    seedBulkLibrary(scenario.sqlite, 20000);
    const { service, leases } = setup(scenario);
    await using _owned = service;
    await service.ready;
    const output = join(dirname(scenario.path), "cancelled.json");
    const cancel = new AbortController();
    const queued = new AbortController();
    const running = service.query(
      { from: "items", ...bulk, output },
      cancel.signal,
    );
    const rejected = expect(running).rejects.toMatchObject({
      name: "AbortError",
    });
    const other = service.query(
      { from: "items", ...bulk, fields: "[]", limit: "100" },
      signal(),
    );
    const waiting = service.query({ from: "items", limit: "1" }, queued.signal);
    const rejectedQueue = expect(waiting).rejects.toMatchObject({
      name: "AbortError",
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    queued.abort();
    await rejectedQueue;
    await vi.waitFor(
      async () => {
        expect(
          (await readdir(dirname(output))).some((name) =>
            name.endsWith(".tmp"),
          ),
        ).toBe(true);
      },
      { timeout: 15000, interval: 1 },
    );
    cancel.abort();
    await rejected;
    expect(JSON.parse(await other).ok).toBe(true);
    expect(leases()).toBe(0);
    const files = await readdir(dirname(output));
    expect(files).not.toContain("cancelled.json");
    expect(files.filter((name) => name.endsWith(".tmp"))).toEqual([]);
    expect(
      JSON.parse(await service.query({ from: "items", limit: "1" }, signal())),
    ).toMatchObject({ ok: true, returnedCount: 1 });
  });

  it("cancels a named export while it writes rows, and leaves other queries running", async () => {
    using scenario = openScenarioDatabase({ storage: "temp-directory" });
    seedBulkLibrary(scenario.sqlite, 20000);
    const { service, leases } = setup(scenario);
    await using _owned = service;
    await service.ready;
    const output = join(dirname(scenario.path), "named.json");
    const running = service.query(
      { from: "items", ...bulk, id: "export", output },
      signal(),
    );
    const rejected = expect(running).rejects.toMatchObject({
      name: "AbortError",
      message: queryCancelledText("export"),
    });
    const other = service.query(
      { from: "items", ...bulk, id: "other", limit: "100" },
      signal(),
    );
    const unnamed = service.query(
      { from: "items", ...bulk, limit: "100" },
      signal(),
    );
    // The private file exists from the first row the export writes.
    await vi.waitFor(
      async () => {
        expect(
          (await readdir(dirname(output))).some((name) =>
            name.endsWith(".tmp"),
          ),
        ).toBe(true);
      },
      { timeout: 15000, interval: 1 },
    );

    expect(service.cancel("export")).toBe(true);
    await rejected;

    expect(JSON.parse(await other)).toMatchObject({ ok: true });
    expect(JSON.parse(await unnamed)).toMatchObject({ ok: true });
    expect(leases()).toBe(0);
    const files = await readdir(dirname(output));
    expect(files).not.toContain("named.json");
    expect(files.filter((name) => name.endsWith(".tmp"))).toEqual([]);
    // Each ID is free once its query settles.
    expect(service.cancel("export")).toBe(false);
    expect(service.cancel("other")).toBe(false);
    expect(service.runningJobs).toBe(0);
    expect(
      JSON.parse(
        await service.query(
          { from: "items", id: "export", limit: "1" },
          signal(),
        ),
      ),
    ).toMatchObject({ ok: true, returnedCount: 1 });
  });

  it("frees the ID of a query that fails, and of a request that is invalid", async () => {
    using scenario = openScenarioDatabase({ storage: "temp-directory" });
    const { service, leases } = setup(scenario);
    await using _owned = service;
    expect(
      JSON.parse(
        await service.query(
          { from: "items", id: "job", fields: '["notAField"]' },
          signal(),
        ),
      ),
    ).toMatchObject({ diagnostic: { code: "unknown-field" } });
    expect(
      JSON.parse(
        await service.query({ from: "items", id: "job", limit: "0" }, signal()),
      ),
    ).toMatchObject({ diagnostic: { code: "invalid-argument" } });
    const missing = join(dirname(scenario.path), "missing", "items.json");
    expect(
      JSON.parse(
        await service.query(
          { from: "items", id: "job", output: missing },
          signal(),
        ),
      ),
    ).toMatchObject({ diagnostic: { code: "output-error" } });
    expect(service.cancel("job")).toBe(false);
    expect(service.runningJobs).toBe(0);
    expect(
      JSON.parse(
        await service.query({ from: "items", id: "job", limit: "1" }, signal()),
      ),
    ).toMatchObject({ ok: true });
    expect(leases()).toBe(0);
  });

  it("settles each race of completion and cancel with one outcome and a free ID", async () => {
    using scenario = openScenarioDatabase({ storage: "temp-directory" });
    const { service, leases } = setup(scenario);
    await using _owned = service;
    await service.ready;
    const outcomes = new Set<string>();
    // Cancel after a growing number of timer turns, from before the lease
    // until completion wins.
    for (const turns of [0, 1, 2, 4, 8, 16, 32, 64, 128, 256]) {
      if (outcomes.has("answered")) break;
      const output = join(dirname(scenario.path), `race-${turns}.json`);
      const running = service
        .query({ from: "items", id: "race", limit: "all", output }, signal())
        .then(
          (answer) => ({ answer: JSON.parse(answer) as { ok: boolean } }),
          (error: unknown) => ({ error }),
        );
      for (let turn = 0; turn < turns; turn++) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      const requested = service.cancel("race");
      const settled = await running;
      expect(service.cancel("race")).toBe(false);
      expect(service.runningJobs).toBe(0);
      expect(leases()).toBe(0);
      const files = await readdir(dirname(output));
      expect(files.filter((name) => name.endsWith(".tmp"))).toEqual([]);
      if ("answer" in settled) {
        // Completion won: the export is published, also after a cancel request.
        expect(settled.answer.ok).toBe(true);
        expect(files).toContain(`race-${turns}.json`);
        outcomes.add("answered");
      } else {
        expect(requested).toBe(true);
        expect(settled.error).toMatchObject({ name: "AbortError" });
        expect(files).not.toContain(`race-${turns}.json`);
        outcomes.add("cancelled");
      }
    }
    expect([...outcomes].toSorted()).toEqual(["answered", "cancelled"]);
  });

  it("keeps the query of another vault with the same ID running", async () => {
    using scenario = openScenarioDatabase({ storage: "temp-directory" });
    seedBulkLibrary(scenario.sqlite, 6000);
    const first = setup(scenario);
    const second = setup(scenario);
    await using _first = first.service;
    await using _second = second.service;
    await Promise.all([first.service.ready, second.service.ready]);
    const output = join(dirname(scenario.path), "second.json");
    const cancelled = first.service.query(
      { from: "items", ...bulk, id: "job" },
      signal(),
    );
    const rejected = expect(cancelled).rejects.toMatchObject({
      name: "AbortError",
    });
    const kept = second.service.query(
      { from: "items", ...bulk, id: "job", output },
      signal(),
    );

    expect(first.service.cancel("job")).toBe(true);
    await rejected;

    expect(JSON.parse(await kept)).toMatchObject({
      ok: true,
      returnedCount: 6000,
    });
  });

  it("cancels every named query on unload and frees their IDs", async () => {
    using scenario = openScenarioDatabase({ storage: "temp-directory" });
    seedBulkLibrary(scenario.sqlite, 2000);
    const { service, leases } = setup(scenario);
    await service.ready;
    const runs = ["a", "b", "c"].map((id) =>
      expect(
        service.query({ from: "items", ...bulk, id }, signal()),
      ).rejects.toMatchObject({
        name: "AbortError",
      }),
    );
    await service[Symbol.asyncDispose]();
    await Promise.all(runs);
    expect(leases()).toBe(0);
    for (const id of ["a", "b", "c"]) expect(service.cancel(id)).toBe(false);
  });

  it("unloads after active jobs release their connections and leases", async () => {
    using scenario = openScenarioDatabase({ storage: "temp-directory" });
    seedBulkLibrary(scenario.sqlite, 2000);
    const { service, leases } = setup(scenario);
    await service.ready;
    const running = service.query({ from: "items", ...bulk }, signal());
    const rejected = expect(running).rejects.toMatchObject({
      name: "AbortError",
    });
    // Unload closes the scope of the jobs: it interrupts each job and waits.
    await service[Symbol.asyncDispose]();
    await rejected;
    expect(leases()).toBe(0);
    expect(service.runningJobs).toBe(0);
    await expect(
      service.query({ from: "items" }, signal()),
    ).rejects.toMatchObject({
      name: "AbortError",
    });
  });

  it("rejects each query and schema request with the startup failure", async () => {
    using scenario = openScenarioDatabase();
    await using reads = inProcessReadsService(sharedClientOpener(scenario.db));
    const startup = new Error("the Library Scope did not load");
    const failed: Promise<void> = Promise.reject(startup);
    failed.catch(() => {});
    const service = new QueryService({
      pluginVersion: "2.2.0-beta.2",
      reads,
      zoteroPref: {
        sourceId: "captured-source",
        databasePath: scenario.path,
        dataDir: dirname(scenario.path),
        baseAttachmentPath: null,
      },
      libraryScope: {
        ready: failed,
        effective: MY_LIBRARY_SCOPE,
      } as LibraryScopeService,
      vault: {
        getName: () => "Query tests",
        adapter: { getBasePath: () => dirname(scenario.path) },
      } as unknown as Vault,
    });
    await using _owned = service;
    // One request starts before startup fails, the others after it.
    const early = service.query({ from: "items", id: "early" }, signal());

    await expect(early).rejects.toBe(startup);
    await expect(service.ready).rejects.toBe(startup);
    await expect(service.query({ from: "items" }, signal())).rejects.toBe(
      startup,
    );
    await expect(service.schema({ from: "items" }, signal())).rejects.toBe(
      startup,
    );
  });
});

it("resolves the file of each Attachment that an Annotation Query projects", async () => {
  using scenario = openScenarioDatabase({
    storage: "temp-directory",
    annotations: true,
  });
  const { service, leases } = setup(scenario);
  await using _owned = service;
  const directory = join(dirname(scenario.path), "storage", "PDF2LIVE");
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "exact.pdf"), "fixture");
  const result = JSON.parse(
    await service.query(
      {
        from: "annotations",
        filter: 'item.indexedKey == "ART2FULL"',
        limit: "all",
      },
      signal(),
    ),
  );
  expect(
    result.rows.find(
      (row: { indexedKey: string }) => row.indexedKey === "ANN2HGHT",
    ).values.attachment,
  ).toMatchObject({ path: join(directory, "exact.pdf"), exists: true });
  expect(leases()).toBe(0);
});

it.each([
  ['type == "image" AND hasExcerptImage', "invalid-filter", "AND"],
  ['pageLable == "1"', "unknown-field", "pageLable"],
  ['item.Title == "paper"', "unknown-field", "item.Title"],
  ['item.creators.lastName == "Hopper"', "unknown-property", "lastName"],
  ["text.contains(1)", "wrong-argument-type", "1"],
  [
    'item.custom["reviewStatus"] == "done"',
    "unknown-field",
    'item.custom["reviewStatus"]',
  ],
] as const)(
  "renders Annotation filter faults through the worker: %s",
  async (filter, code, at) => {
    using scenario = openScenarioDatabase({ annotations: true });
    const { service } = setup(scenario);
    await using _owned = service;
    const result = JSON.parse(
      await service.query(
        { from: "annotations", filter },
        new AbortController().signal,
      ),
    );
    expect(result).toMatchObject({
      contractVersion: 3,
      command: "zotlit:query",
      ok: false,
      diagnostic: {
        code,
        severity: "error",
        location: { argument: "filter" },
        excerpt: { at },
      },
    });
    expect(result.diagnostic.report[0]).toBe(result.diagnostic.message);
    expect(result.diagnostic.report.at(-1)).toBe(result.diagnostic.hint);
  },
);

it("writes Annotation warnings before rows in inline and exported results", async () => {
  using scenario = openScenarioDatabase({
    storage: "temp-directory",
    annotations: true,
  });
  const { service } = setup(scenario);
  await using _owned = service;
  const params = { filter: 'item.date.year == "2014"' };
  const inline = await service.query(
    { from: "annotations", ...params },
    new AbortController().signal,
  );
  const result = JSON.parse(inline);
  expect(result).toMatchObject({
    warnings: [{ code: "never-true", suggestions: ["item.date.year == 2014"] }],
    returnedCount: 0,
    rows: [],
  });
  expect(inline.indexOf('"warnings"')).toBeLessThan(inline.indexOf('"rows"'));
  const output = join(dirname(scenario.path), "warning-annotations.json");
  await service.query(
    { from: "annotations", ...params, output },
    new AbortController().signal,
  );
  expect(await readFile(output, "utf8")).toBe(inline);
});

it.each([
  [{ fields: '["pageLable"]' }, "fields[0]", "fields='[\"pageLabel\"]'"],
  [{ fields: '["item.Title"]' }, "fields[0]", "fields='[\"item.title\"]'"],
  [
    { fields: JSON.stringify(['item.custom["Review.Status"]']) },
    "fields[0]",
    'fields=\'["item.custom[\\"review.status\\"]"]\'',
  ],
  [
    { sort: '[{"field":"pageIndx","direction":"asc"}]' },
    "sort[0].field",
    'sort=\'[{"field":"pageIndex","direction":"asc"}]\'',
  ],
] as const)(
  "corrects Annotation request names in their JSON arguments: %j",
  async (params, path, suggestion) => {
    using scenario = openScenarioDatabase({ annotations: true });
    const { service } = setup(scenario);
    await using _owned = service;
    const result = JSON.parse(
      await service.query(
        { from: "annotations", ...params },
        new AbortController().signal,
      ),
    );
    expect(result).toMatchObject({
      ok: false,
      diagnostic: { location: { path }, suggestions: [suggestion] },
    });
  },
);

it("describes all three Query Datasets once when from is omitted", async () => {
  using scenario = openScenarioDatabase({
    storage: "temp-directory",
    annotations: true,
  });
  const { service } = setup(scenario);
  await using _owned = service;
  const result = JSON.parse(await service.schema({}, signal()));
  expect(result).toMatchObject({
    contractVersion: 3,
    command: "zotlit:query-schema",
    ok: true,
  });
  expect(Object.keys(result.defaults)).toEqual([
    "items",
    "attachments",
    "annotations",
  ]);
  expect(Object.keys(result.datasets)).toEqual([
    "items",
    "attachments",
    "annotations",
  ]);
  expect(
    result.customFields.filter(
      (field: { name: string }) => field.name === "review.status",
    ),
  ).toHaveLength(1);
  const selected = JSON.parse(
    await service.schema({ from: "annotations" }, signal()),
  );
  expect(Object.keys(selected.defaults)).toEqual(["annotations"]);
  expect(Object.keys(selected.datasets)).toEqual(["annotations"]);
  expect(selected.datasets.annotations.fields).toContain("item.title");
});

it("returns Attachment rows and narrows the live schema to Attachments", async () => {
  using scenario = openScenarioDatabase({
    storage: "temp-directory",
    annotations: true,
  });
  const { service } = setup(scenario);
  await using _owned = service;
  const answer = JSON.parse(
    await service.query(
      {
        from: "attachments",
        filter: 'linkMode == "linked_file" && !exists',
        fields: "title,library,item.title",
      },
      signal(),
    ),
  );
  expect(answer).toMatchObject({
    ok: true,
    request: { from: "attachments" },
    returnedCount: 1,
    rows: [
      {
        indexedKey: "PDF2LINK",
        itemIndexedKey: "ART2FULL",
        values: {
          title: "linkedAttachment",
          library: "personal",
          "item.title": "Exact Matching in Literature Review",
        },
      },
    ],
  });
  const schema = JSON.parse(
    await service.schema({ from: "attachments" }, signal()),
  );
  expect(Object.keys(schema.datasets)).toEqual(["attachments"]);
  expect(Object.keys(schema.defaults)).toEqual(["attachments"]);
  expect(schema.datasets.attachments).toMatchObject({ customPrefix: "item." });
  expect(schema.defaults.attachments.fields).toEqual([
    "title",
    "contentType",
    "linkMode",
    "path",
    "exists",
    "item.title",
    "item.citationKey",
  ]);
});
