import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  LIBRARY_SCOPE_SETTING_KEY,
  findScopeCase,
} from "@zotlit/scripts/fixture";

import { reachable } from "./e2e-run-fixture.ts";
import { e2eVaultPath, targetItem } from "./e2e-run-fixture.ts";
import { registerEndToEndRunHooks, run } from "./e2e-run-lifecycle.ts";
import { expectedLibraryIDs } from "./e2e-run-note-helpers.ts";
import type { LibraryScopeReport } from "./e2e-run-query-types.ts";
import { obRun } from "./obsidian-cli.ts";
import { obRunUntil } from "./obsidian-cli.ts";
import { cliCommand, waitFor } from "./obsidian-cli.ts";
import type { QueryWorkerRecord } from "./page-query-types.ts";

describe.skipIf(!reachable)("End-to-end Run", () => {
  registerEndToEndRunHooks();

  it("reflects a Scope Case switch through zotlit:library-scope", async () => {
    const availableCase = findScopeCase("available");
    const dataPath = join(
      e2eVaultPath,
      ".obsidian",
      "plugins",
      "zotlit",
      "data.json",
    );

    // Settle any pending settings write before editing its disk file; plugin
    // unload also flushes pending settings.
    await obRun(
      run.vaultId,
      async ({ zotlit }) => {
        return String(
          await zotlit.services.bridge
            .runPromise(zotlit.services.settings.flush)
            .then(() => true),
        );
      },
      undefined,
    );

    // Rewrite the e2e vault's own copy — the shared Fixture layout's vault
    // copy was already copied into the e2e vault during `create`; editing
    // that shared source afterward would have no further effect.
    const raw = await readFile(dataPath, "utf-8");
    const data = JSON.parse(raw) as Record<string, unknown>;
    data[LIBRARY_SCOPE_SETTING_KEY] = availableCase.scope;
    await writeFile(dataPath, JSON.stringify(data, null, 2));

    // The plugin toggle is also the Zotero database worker's whole life:
    // record every worker spawned and every worker ended across it.
    await obRun(
      run.vaultId,
      async ({ page: pageHelpers }) => {
        var Original = window.Worker;
        var record: QueryWorkerRecord = {
          spawned: [],
          Original: Original,
          terminate: Original.prototype.terminate,
          ended: new WeakSet(),
        };
        window.Worker = new Proxy(Original, {
          construct(Target, args) {
            const [url, options] = args;
            const worker = new Target(url, options);
            record.spawned.push({ worker, name: options?.name });
            return worker;
          },
        });
        Original.prototype.terminate = new Proxy(record.terminate, {
          apply(target, receiver, args) {
            record.ended.add(receiver);
            return Reflect.apply(target, receiver, args);
          },
        });
        pageHelpers.scratch.zotlitE2EWorkers = record;
        return String(true);
      },
      undefined,
    );

    await using restoreWorkers = new AsyncDisposableStack();
    restoreWorkers.defer(async () => {
      await obRun(
        run.vaultId,
        async ({ page: pageHelpers }) => {
          var record = pageHelpers.scratch.zotlitE2EWorkers;
          return String(
            (function () {
              if (record!.held) {
                record!.held.worker.postMessage = record!.held.post;
                if (!record!.ended.has(record!.held.worker))
                  for (var args of record!.held.pending)
                    record!.held.post.apply(record!.held.worker, args);
              }
              window.Worker = record!.Original;
              record!.Original.prototype.terminate = record!.terminate;
              delete pageHelpers.scratch.zotlitE2EWorkers;
              return true;
            })(),
          );
        },
        undefined,
      );
      await obRun(
        run.vaultId,
        async ({ app }) => {
          return String(
            await (
              app.plugins.plugins.zotlit
                ? Promise.resolve()
                : app.plugins.enablePlugin("zotlit")
            ).then(function () {
              return true;
            }),
          );
        },
        undefined,
      );
    });
    // An ordinary user action (the Community Plugins toggle), not a bypass —
    // it makes the plugin re-read data.json from disk.
    const toggled = await ((options: { expected: string; tries?: number }) =>
      obRunUntil(
        run.vaultId,
        async ({ app }) => {
          return String(
            await app.plugins
              .disablePlugin("zotlit")
              .then(function () {
                return app.plugins.enablePlugin("zotlit");
              })
              .then(function () {
                return true;
              }),
          );
        },
        undefined,
        {
          ready: (value) => value === options.expected,
          tries: options.tries,
          what: "query-cli-scope.e2e.ts:78",
        },
      ).then(
        () => true,
        () => false,
      ))({ expected: "true", tries: 20 });
    expect(toggled).toBe(true);

    const reloaded = await ((options: { expected: string; tries?: number }) =>
      obRunUntil(
        run.vaultId,
        async ({ app }) => {
          return String(String("zotlit" in app.plugins.plugins));
        },
        undefined,
        {
          ready: (value) => value === options.expected,
          tries: options.tries,
          what: "query-cli-scope.e2e.ts:85",
        },
      ).then(
        () => true,
        () => false,
      ))({ expected: "true" });
    expect(reloaded).toBe(true);

    // Dispatched as a registered CLI command, not `eval` — the way a real
    // caller would invoke it. Retried a few times: a window fresh off a
    // reload can still answer stray noise ahead of a well-formed reply.
    let scope: LibraryScopeReport | undefined;
    await waitFor(async () => {
      try {
        const response = await cliCommand(run.vaultId, "zotlit:library-scope");
        scope = JSON.parse(response) as LibraryScopeReport;
        return true;
      } catch {
        return false;
      }
    }, 10);
    if (!scope) {
      throw new Error("zotlit:library-scope never returned a parseable reply");
    }

    expect(scope.ok).toBe(true);
    expect(scope.mode).toBe("selected");
    const availableScope = availableCase.scope;
    if (availableScope.mode !== "selected") {
      throw new Error(
        `Scope Case "available" must select Libraries, got mode "${availableScope.mode}"`,
      );
    }
    expect(scope.available).toHaveLength(availableScope.libraries.length);
    expect(scope.unavailable ?? []).toHaveLength(0);
    const gotLibraryIDs = (scope.available ?? [])
      .map((entry) => entry.libraryID)
      .toSorted((a, b) => a - b);
    expect(gotLibraryIDs).toEqual(expectedLibraryIDs(availableScope.libraries));

    {
      // The load spawned one database worker, and it serves.
      expect(
        await obRun(
          run.vaultId,
          async ({ page: pageHelpers }) => {
            var record = pageHelpers.scratch.zotlitE2EWorkers;
            return String(
              String(
                record!.spawned.filter(function (entry) {
                  return entry.name === "zotlit-zotero-reads";
                }).length,
              ),
            );
          },
          undefined,
        ),
      ).toBe("1");
      expect(
        await ((options: { expected: string; tries?: number }) =>
          obRunUntil(
            run.vaultId,
            async ({ zotlit }) => {
              return String(String(zotlit.services.zoteroReads.state));
            },
            undefined,
            {
              ready: (value) => value === options.expected,
              tries: options.tries,
              what: "query-cli-scope.e2e.ts:135",
            },
          ).then(
            () => true,
            () => false,
          ))({ expected: "ready" }),
      ).toBe(true);
      expect(
        await ((options: { expected: string; tries?: number }) =>
          obRunUntil(
            run.vaultId,
            async ({ zotlit }, { __typedArg0, __typedArg1 }) => {
              return String(
                await zotlit.services.citationLookup
                  .read({ indexedKeys: [__typedArg0] })
                  .then(function (answer) {
                    return String(answer.citekeyOf(__typedArg1));
                  }),
              );
            },
            { __typedArg0: targetItem.key, __typedArg1: targetItem.key },
            {
              ready: (value) => value === options.expected,
              tries: options.tries,
              what: "query-cli-scope.e2e.ts:142",
            },
          ).then(
            () => true,
            () => false,
          ))({ expected: targetItem.citationKey! }),
      ).toBe(true);
      // Termination emits no browser error event: liveness must detect it.
      await obRun(
        run.vaultId,
        async ({ page: pageHelpers }) => {
          var record = pageHelpers.scratch.zotlitE2EWorkers;
          return String(
            (record!.spawned
              .find(function (entry) {
                return entry.name === "zotlit-zotero-reads";
              })!
              .worker.terminate(),
            true),
          );
        },
        undefined,
      );
      expect(
        await ((options: { expected: string; tries?: number }) =>
          obRunUntil(
            run.vaultId,
            async ({ zotlit }) => {
              return String(String(zotlit.services.citationLookup.status));
            },
            undefined,
            {
              ready: (value) => value === options.expected,
              tries: options.tries,
              what: "query-cli-scope.e2e.ts:156",
            },
          ).then(
            () => true,
            () => false,
          ))({ expected: "failed", tries: 160 }),
      ).toBe(true);
      await obRun(
        run.vaultId,
        async ({ zotlit }) => {
          return String(
            await zotlit.services.zoteroReads.refresh().then(function () {
              return true;
            }),
          );
        },
        undefined,
      );
      expect(
        await ((options: { expected: string; tries?: number }) =>
          obRunUntil(
            run.vaultId,
            async ({ zotlit }) => {
              return String(String(zotlit.services.zoteroReads.state));
            },
            undefined,
            {
              ready: (value) => value === options.expected,
              tries: options.tries,
              what: "query-cli-scope.e2e.ts:167",
            },
          ).then(
            () => true,
            () => false,
          ))({ expected: "ready" }),
      ).toBe(true);
      // SearchItems hydrates its hits from SQLite in the interactive worker.
      const hits = JSON.parse(
        await obRun(
          run.vaultId,
          async ({ zotlit }, { __typedArg0 }) => {
            return String(
              await zotlit.services.itemLookup
                .search(__typedArg0, { limit: 1 })
                .then(JSON.stringify),
            );
          },
          { __typedArg0: targetItem.title },
        ),
      ) as { item: { itemID: number; fields: { title: string } } }[];
      expect(hits).toMatchObject([
        {
          item: {
            itemID: targetItem.itemID,
            fields: { title: targetItem.title },
          },
        },
      ]);
      expect(
        await ((options: { expected: string; tries?: number }) =>
          obRunUntil(
            run.vaultId,
            async ({ zotlit }) => {
              return String(String(zotlit.services.citationLookup.status));
            },
            undefined,
            {
              ready: (value) => value === options.expected,
              tries: options.tries,
              what: "query-cli-scope.e2e.ts:189",
            },
          ).then(
            () => true,
            () => false,
          ))({ expected: "fresh" }),
      ).toBe(true);
      expect(
        await ((options: { expected: string; tries?: number }) =>
          obRunUntil(
            run.vaultId,
            async ({ zotlit }, { __typedArg0, __typedArg1 }) => {
              return String(
                await zotlit.services.citationLookup
                  .whenResolved()
                  .then(function () {
                    return zotlit.services.citationLookup
                      .read({ indexedKeys: [__typedArg0] })
                      .then(function (answer) {
                        return String(answer.citekeyOf(__typedArg1));
                      });
                  }),
              );
            },
            { __typedArg0: targetItem.key, __typedArg1: targetItem.key },
            {
              ready: (value) => value === options.expected,
              tries: options.tries,
              what: "query-cli-scope.e2e.ts:196",
            },
          ).then(
            () => true,
            () => false,
          ))({ expected: targetItem.citationKey! }),
      ).toBe(true);
      // Hold the lookup request so unload must cancel the pending worker read.
      await obRun(
        run.vaultId,
        async ({ zotlit, page: pageHelpers }) => {
          var record = pageHelpers.scratch.zotlitE2EWorkers;
          return String(
            await (function () {
              var entry = record!.spawned.findLast(function (entry) {
                return entry.name === "zotlit-zotero-reads";
              });
              var post = entry!.worker.postMessage;
              record!.held = { worker: entry!.worker, post: post, pending: [] };
              entry!.worker.postMessage = new Proxy(post, {
                apply(target, receiver, args) {
                  if (args[0]?.[1]?.tag === "CitationLookup") {
                    record!.heldSnapshot = true;
                    record!.held!.pending.push(
                      args as [unknown, StructuredSerializeOptions?],
                    );
                    return;
                  }
                  return Reflect.apply(target, receiver, args);
                },
              });
              return zotlit.services.zoteroReads.refresh().then(function () {
                return true;
              });
            })(),
          );
        },
        undefined,
      );
      expect(
        await ((options: { expected: string; tries?: number }) =>
          obRunUntil(
            run.vaultId,
            async ({ page: pageHelpers }) => {
              var record = pageHelpers.scratch.zotlitE2EWorkers;
              return String(String(record!.heldSnapshot));
            },
            undefined,
            {
              ready: (value) => value === options.expected,
              tries: options.tries,
              what: "query-cli-scope.e2e.ts:220",
            },
          ).then(
            () => true,
            () => false,
          ))({
          expected: "true",
        }),
      ).toBe(true);
      // Unload ends the recovered worker and its pending citation read.
      await obRun(
        run.vaultId,
        async ({ app }) => {
          return String(
            await app.plugins.disablePlugin("zotlit").then(function () {
              return true;
            }),
          );
        },
        undefined,
      );
      const ended = await ((options: { expected: string; tries?: number }) =>
        obRunUntil(
          run.vaultId,
          async ({ page: pageHelpers }) => {
            var record = pageHelpers.scratch.zotlitE2EWorkers;
            return String(
              String(
                record!.spawned
                  .filter(function (entry) {
                    return entry.name === "zotlit-zotero-reads";
                  })
                  .every(function (entry) {
                    return record!.ended.has(entry.worker);
                  }),
              ),
            );
          },
          undefined,
          {
            ready: (value) => value === options.expected,
            tries: options.tries,
            what: "query-cli-scope.e2e.ts:229",
          },
        ).then(
          () => true,
          () => false,
        ))({ expected: "true", tries: 120 });
      expect(
        ended,
        await obRun(
          run.vaultId,
          async ({ page: pageHelpers }) => {
            var record = pageHelpers.scratch.zotlitE2EWorkers;
            return String(
              JSON.stringify(
                record!.spawned.map(function (entry) {
                  return {
                    name: entry.name,
                    ended: record!.ended.has(entry.worker),
                  };
                }),
              ),
            );
          },
          undefined,
        ),
      ).toBe(true);
    }
  }, 120_000);
});
