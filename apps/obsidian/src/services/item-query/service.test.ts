import {
  chmod,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { Worker } from "node:worker_threads";
import type { Vault } from "obsidian";
import workerSource from "virtual:item-query-worker";
import { describe, expect, it, vi } from "vitest";

import {
  BULK_LIBRARY,
  openScenarioDatabase,
  seedBulkLibrary,
} from "@zotlit/db/test-scenario";
import type { ScenarioDatabase } from "@zotlit/db/test-scenario";

import type { DatabaseService } from "@/services/database/service";
import { MY_LIBRARY_SCOPE } from "@/services/library-scope/scope";
import type { LibraryScopeService } from "@/services/library-scope/service";

import { ItemQueryService } from "./service";
import type { QueryWorkerFactory } from "./workers";

function setup(
  scenario: ScenarioDatabase,
  createWorker: QueryWorkerFactory = () =>
    new Worker(workerSource, { eval: true }),
) {
  let leases = 0;
  const service = new ItemQueryService({
    db: {
      ready: Promise.resolve(),
      acquireRead: async () => {
        leases++;
        return {
          client: scenario.db,
          uri: scenario.path,
          source: { id: "captured-source", databasePath: scenario.path },
          [Symbol.dispose]: () => {
            leases--;
          },
        };
      },
    } as unknown as DatabaseService,
    libraryScope: {
      ready: Promise.resolve(),
      effective: MY_LIBRARY_SCOPE,
    } as LibraryScopeService,
    vault: {
      getName: () => "Query tests",
      adapter: { getBasePath: () => dirname(scenario.path) },
    } as unknown as Vault,
    createWorker,
  });
  return { service, leases: () => leases };
}
const signal = () => new AbortController().signal;
const bulk = {
  library: `group:${BULK_LIBRARY.groupID}`,
  limit: "all",
  fields: '["title","tags"]',
};

describe("Item Query worker jobs", () => {
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

  it("reports a snapshot that cannot be reopened as an unavailable source", async () => {
    using scenario = openScenarioDatabase({ storage: "temp-directory" });
    const { service, leases } = setup(scenario);
    await using _owned = service;
    await service.ready;
    await rm(scenario.path);
    expect(
      JSON.parse(await service.answer({ limit: "zero" }, signal())),
    ).toMatchObject({ ok: false, diagnostic: { code: "invalid-argument" } });
    expect(JSON.parse(await service.answer({}, signal()))).toMatchObject({
      ok: false,
      diagnostic: { code: "source-unavailable" },
    });
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
      file: { bytes: Buffer.byteLength(text) },
    });
    expect(JSON.parse(text).rows).toHaveLength(6000);
    expect(JSON.parse(text)).toMatchObject({
      ok: true,
      returnedCount: 6000,
      truncated: false,
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
    await vi.waitFor(() => expect(leases()).toBe(3), { interval: 1 });
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

  it("stops an unresponsive process before releasing its read lease", async () => {
    using scenario = openScenarioDatabase({ storage: "temp-directory" });
    const blocked = Promise.withResolvers<void>();
    let leaseAtExit: number | undefined;
    let created = 0;
    const { service, leases } = setup(scenario, () => {
      const source =
        created++ < 2
          ? `${workerSource}
        require('node:worker_threads').parentPort.on('message', text => {
          if (JSON.parse(text).type !== 'query') return;
          require('node:worker_threads').parentPort.postMessage(JSON.stringify({type:'test-blocked'}));
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
        });
      `
          : workerSource;
      const worker = new Worker(source, { eval: true });
      worker.on("message", (text: string) => {
        if (JSON.parse(text).type === "test-blocked") blocked.resolve();
      });
      worker.once("exit", () => {
        leaseAtExit = leases();
      });
      return worker;
    });
    await using _owned = service;
    const cancel = new AbortController();
    const running = service.answer({ limit: "1" }, cancel.signal);
    const rejected = expect(running).rejects.toMatchObject({
      name: "AbortError",
    });
    await blocked.promise;
    cancel.abort();
    await rejected;
    expect(leaseAtExit).toBe(1);
    expect(leases()).toBe(0);
    expect(
      JSON.parse(await service.answer({ limit: "1" }, signal())),
    ).toMatchObject({ ok: true, returnedCount: 1 });
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
    await service[Symbol.asyncDispose]();
    await rejected;
    expect(leases()).toBe(0);
    await expect(service.answer({}, signal())).rejects.toMatchObject({
      name: "AbortError",
    });
  });
});
