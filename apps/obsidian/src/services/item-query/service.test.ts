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
import { ItemQueryService } from "./service";

function setup(
  scenario: ScenarioDatabase,
  opener: ConnectionOpener = sharedClientOpener(scenario.db),
) {
  let leases = 0;
  const reads = inProcessReadsService(opener, {
    wrap: (client) => ({
      ...client,
      ItemQuery: (payload, options) =>
        Effect.acquireUseRelease(
          Effect.sync(() => {
            leases++;
          }),
          () => client.ItemQuery(payload, options),
          () =>
            Effect.sync(() => {
              leases--;
            }),
        ),
    }),
  });
  const service = new ItemQueryService({
    pluginVersion: "2.2.0-beta.2",
    reads,
    zoteroPref: { sourceId: "captured-source", databasePath: scenario.path },
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
  return { service, leases: () => leases };
}
const signal = () => new AbortController().signal;
const bulk = {
  library: `group:${BULK_LIBRARY.groupID}`,
  limit: "all",
  fields: '["title","tags"]',
};

describe("Item Query worker jobs", () => {
  it("answers the schema through the worker and maps an unavailable connection for both commands", async () => {
    using scenario = openScenarioDatabase({ storage: "temp-directory" });
    const available = setup(scenario);
    await using _available = available.service;
    expect(
      JSON.parse(await available.service.schema({}, signal())),
    ).toMatchObject({
      command: "zotlit:item-query-schema",
      ok: true,
      schema: {
        url: "https://github.com/aidenlx/zotlit/releases/download/res-2.2.0-beta.2/item-query.schema.json",
        fileName: "zotlit-item-query-2.2.0-beta.2.schema.json",
      },
    });
    const unavailable = setup(scenario, () => {
      throw new Error("source closed");
    });
    await using _unavailable = unavailable.service;
    for (const answer of [
      await unavailable.service.answer({}, signal()),
      await unavailable.service.schema({}, signal()),
    ])
      expect(JSON.parse(answer)).toMatchObject({
        ok: false,
        diagnostic: { code: "source-unavailable" },
      });
    expect(unavailable.leases()).toBe(0);
  });

  it("answers the schema envelope for a parameter, without a lease", async () => {
    using scenario = openScenarioDatabase({ storage: "temp-directory" });
    const { service, leases } = setup(scenario);
    await using _owned = service;

    const answer = await service.schema({ library: "personal" }, signal());

    expect(JSON.parse(answer)).toMatchObject({
      contractVersion: 2,
      command: "zotlit:item-query-schema",
      ok: false,
      diagnostic: {
        code: "invalid-argument",
        details: { parameter: "library" },
      },
    });
    expect(leases()).toBe(0);
  });

  it("exports the same envelope as inline, preserves existing files, and releases each lease", async () => {
    using scenario = openScenarioDatabase({ storage: "temp-directory" });
    const { service, leases } = setup(scenario);
    await using _owned = service;
    const query = { limit: "all", fields: '["title","date","creators"]' };
    const inline = await service.answer(query, signal());
    const output = join(dirname(scenario.path), "items.json");
    const receipt = JSON.parse(
      await service.answer({ ...query, output }, signal()),
    );
    expect(receipt).toMatchObject({
      ok: true,
      returnedCount: 10,
      file: { path: output, bytes: Buffer.byteLength(inline), format: "json" },
    });
    expect(receipt).not.toHaveProperty("rows");
    expect(await readFile(output, "utf8")).toBe(inline);
    expect(JSON.parse(inline).identity.source.id).toBe("captured-source");
    await writeFile(output, "keep this content");
    expect(
      JSON.parse(await service.answer({ ...query, output }, signal())),
    ).toMatchObject({ ok: false, diagnostic: { code: "output-error" } });
    expect(await readFile(output, "utf8")).toBe("keep this content");
    expect(leases()).toBe(0);
    expect(
      (await readdir(dirname(output))).filter((name) => name.endsWith(".tmp")),
    ).toEqual([]);
  });

  it("reports invalid paths and write failures, and leaves no file on a query failure", async () => {
    using scenario = openScenarioDatabase({ storage: "temp-directory" });
    const { service, leases } = setup(scenario);
    await using _owned = service;
    expect(
      JSON.parse(await service.answer({ output: "relative.json" }, signal())),
    ).toMatchObject({ diagnostic: { code: "invalid-argument" } });
    const output = join(dirname(scenario.path), "missing", "items.json");
    expect(
      JSON.parse(await service.answer({ output }, signal())),
    ).toMatchObject({ diagnostic: { code: "output-error" } });
    expect(
      JSON.parse(
        await service.answer({ output, fields: '["notAField"]' }, signal()),
      ),
    ).toMatchObject({ diagnostic: { code: "unknown-field" } });
    const denied = join(dirname(scenario.path), "denied");
    await mkdir(denied, { mode: 0o000 });
    try {
      expect(
        JSON.parse(
          await service.answer(
            { output: join(denied, "items.json") },
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
    expect(JSON.parse(await service.answer(bulk, signal()))).toMatchObject({
      diagnostic: { code: "result-too-large" },
    });
    const output = join(dirname(scenario.path), "large.json");
    const receipt = JSON.parse(
      await service.answer({ ...bulk, output }, signal()),
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
    const running = service.answer({ ...bulk, output }, cancel.signal);
    const rejected = expect(running).rejects.toMatchObject({
      name: "AbortError",
    });
    const other = service.answer(
      { ...bulk, fields: "[]", limit: "100" },
      signal(),
    );
    const waiting = service.answer({ limit: "1" }, queued.signal);
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
      JSON.parse(await service.answer({ limit: "1" }, signal())),
    ).toMatchObject({ ok: true, returnedCount: 1 });
  });

  it("cancels a named export while it writes rows, and leaves other queries running", async () => {
    using scenario = openScenarioDatabase({ storage: "temp-directory" });
    seedBulkLibrary(scenario.sqlite, 20000);
    const { service, leases } = setup(scenario);
    await using _owned = service;
    await service.ready;
    const output = join(dirname(scenario.path), "named.json");
    const running = service.answer({ ...bulk, id: "export", output }, signal());
    const rejected = expect(running).rejects.toMatchObject({
      name: "AbortError",
      message: queryCancelledText("export"),
    });
    const other = service.answer(
      { ...bulk, id: "other", limit: "100" },
      signal(),
    );
    const unnamed = service.answer({ ...bulk, limit: "100" }, signal());
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
      JSON.parse(await service.answer({ id: "export", limit: "1" }, signal())),
    ).toMatchObject({ ok: true, returnedCount: 1 });
  });

  it("answers query-id-in-use for an active ID and leaves the running query alone", async () => {
    using scenario = openScenarioDatabase({ storage: "temp-directory" });
    seedBulkLibrary(scenario.sqlite, 6000);
    const { service } = setup(scenario);
    await using _owned = service;
    await service.ready;
    const output = join(dirname(scenario.path), "first.json");
    const first = service.answer({ ...bulk, id: "job", output }, signal());

    const duplicate = JSON.parse(
      await service.answer({ ...bulk, id: "job" }, signal()),
    );

    expect(duplicate).toMatchObject({
      contractVersion: 2,
      command: "zotlit:item-query",
      ok: false,
      diagnostic: {
        code: "query-id-in-use",
        details: { parameter: "id" },
      },
    });
    expect(JSON.parse(await first)).toMatchObject({
      ok: true,
      returnedCount: 6000,
    });
    expect(service.cancel("job")).toBe(false);
  });

  it("frees the ID of a query that fails, and of a request that is invalid", async () => {
    using scenario = openScenarioDatabase({ storage: "temp-directory" });
    const { service, leases } = setup(scenario);
    await using _owned = service;
    expect(
      JSON.parse(
        await service.answer({ id: "job", fields: '["notAField"]' }, signal()),
      ),
    ).toMatchObject({ diagnostic: { code: "unknown-field" } });
    expect(
      JSON.parse(await service.answer({ id: "job", limit: "0" }, signal())),
    ).toMatchObject({ diagnostic: { code: "invalid-argument" } });
    const missing = join(dirname(scenario.path), "missing", "items.json");
    expect(
      JSON.parse(
        await service.answer({ id: "job", output: missing }, signal()),
      ),
    ).toMatchObject({ diagnostic: { code: "output-error" } });
    expect(service.cancel("job")).toBe(false);
    expect(service.runningJobs).toBe(0);
    expect(
      JSON.parse(await service.answer({ id: "job", limit: "1" }, signal())),
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
        .answer({ id: "race", limit: "all", output }, signal())
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
    const cancelled = first.service.answer({ ...bulk, id: "job" }, signal());
    const rejected = expect(cancelled).rejects.toMatchObject({
      name: "AbortError",
    });
    const kept = second.service.answer(
      { ...bulk, id: "job", output },
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
      expect(service.answer({ ...bulk, id }, signal())).rejects.toMatchObject({
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
    const running = service.answer(bulk, signal());
    const rejected = expect(running).rejects.toMatchObject({
      name: "AbortError",
    });
    // Unload closes the scope of the jobs: it interrupts each job and waits.
    await service[Symbol.asyncDispose]();
    await rejected;
    expect(leases()).toBe(0);
    expect(service.runningJobs).toBe(0);
    await expect(service.answer({}, signal())).rejects.toMatchObject({
      name: "AbortError",
    });
  });

  it("rejects each query and schema request with the startup failure", async () => {
    using scenario = openScenarioDatabase();
    await using reads = inProcessReadsService(sharedClientOpener(scenario.db));
    const startup = new Error("the Library Scope did not load");
    const failed: Promise<void> = Promise.reject(startup);
    failed.catch(() => {});
    const service = new ItemQueryService({
      pluginVersion: "2.2.0-beta.2",
      reads,
      zoteroPref: { sourceId: "captured-source", databasePath: scenario.path },
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
    const early = service.answer({ id: "early" }, signal());

    await expect(early).rejects.toBe(startup);
    await expect(service.ready).rejects.toBe(startup);
    await expect(service.answer({}, signal())).rejects.toBe(startup);
    await expect(service.schema({}, signal())).rejects.toBe(startup);
  });
});
