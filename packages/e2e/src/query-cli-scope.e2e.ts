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
        return await zotlit.services.bridge
          .runPromise(zotlit.services.settings.flush)
          .then(() => true);
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
      },
      undefined,
    );

    await using restoreWorkers = new AsyncDisposableStack();
    restoreWorkers.defer(async () => {
      await obRun(
        run.vaultId,
        async ({ page: pageHelpers }) => {
          var record = pageHelpers.scratch.zotlitE2EWorkers;
          return (function () {
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
          })();
        },
        undefined,
      );
      await obRun(
        run.vaultId,
        async ({ app }) => {
          return await (
            app.plugins.plugins.zotlit
              ? Promise.resolve()
              : app.plugins.enablePlugin("zotlit")
          ).then(function () {
            return true;
          });
        },
        undefined,
      );
    });
    // An ordinary user action (the Community Plugins toggle), not a bypass —
    // it makes the plugin re-read data.json from disk.
    await obRunUntil(
      run.vaultId,
      async ({ app }) => {
        return await app.plugins
          .disablePlugin("zotlit")
          .then(function () {
            return app.plugins.enablePlugin("zotlit");
          })
          .then(function () {
            return true;
          });
      },
      undefined,
      {
        tries: 20,
        what: "the zotlit plugin to be disabled and enabled again from Community Plugins",
      },
    );

    await obRunUntil(
      run.vaultId,
      async ({ app }) => {
        return "zotlit" in app.plugins.plugins;
      },
      undefined,
      { what: "the zotlit plugin to be loaded into the plugin registry" },
    );

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
            return record!.spawned.filter(function (entry) {
              return entry.name === "zotlit-zotero-reads";
            }).length;
          },
          undefined,
        ),
      ).toBe(1);
      await obRunUntil(
        run.vaultId,
        async ({ zotlit }) => {
          return zotlit.services.bridge.runSync(
            zotlit.services.zoteroReads.current,
          ).state;
        },
        undefined,
        {
          ready: (value) => value === "ready",
          what: "the zoteroReads status to read ready",
        },
      );
      await obRunUntil(
        run.vaultId,
        async ({ zotlit }, { targetItemKey }) => {
          return await zotlit.services.bridge
            .runPromise(
              zotlit.services.citationLookup.read({
                indexedKeys: [targetItemKey],
              }),
            )
            .then(function (answer) {
              return String(answer.citekeyOf(targetItemKey));
            });
        },
        { targetItemKey: targetItem.key },
        {
          ready: (value) => value === targetItem.citationKey!,
          what: "the target item citation key to resolve from the citation lookup",
        },
      );
      // Termination emits no browser error event: liveness must detect it.
      await obRun(
        run.vaultId,
        async ({ page: pageHelpers }) => {
          var record = pageHelpers.scratch.zotlitE2EWorkers;
          return (
            record!.spawned
              .find(function (entry) {
                return entry.name === "zotlit-zotero-reads";
              })!
              .worker.terminate(),
            true
          );
        },
        undefined,
      );
      await obRunUntil(
        run.vaultId,
        async ({ zotlit }) => {
          return zotlit.services.bridge.runSync(
            zotlit.services.citationLookup.current,
          ).status;
        },
        undefined,
        {
          ready: (value) => value === "failed",
          tries: 160,
          what: "the citation lookup status to become failed",
        },
      );
      await obRun(
        run.vaultId,
        async ({ zotlit }) => {
          return await zotlit.services.bridge
            .runPromise(zotlit.services.zoteroReads.refresh)
            .then(function () {
              return true;
            });
        },
        undefined,
      );
      await obRunUntil(
        run.vaultId,
        async ({ zotlit }) => {
          return zotlit.services.bridge.runSync(
            zotlit.services.zoteroReads.current,
          ).state;
        },
        undefined,
        {
          ready: (value) => value === "ready",
          what: "the zoteroReads status to read ready again",
        },
      );
      // SearchItems hydrates its hits from SQLite in the interactive worker.
      const hits = JSON.parse(
        await obRun(
          run.vaultId,
          async ({ zotlit }, { targetItemTitle }) => {
            return await zotlit.services.itemLookup
              .search(targetItemTitle, { limit: 1 })
              .then(JSON.stringify);
          },
          { targetItemTitle: targetItem.title },
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
      await obRunUntil(
        run.vaultId,
        async ({ zotlit }) => {
          return zotlit.services.bridge.runSync(
            zotlit.services.citationLookup.current,
          ).status;
        },
        undefined,
        {
          ready: (value) => value === "fresh",
          what: "the citation lookup status to become fresh",
        },
      );
      await obRunUntil(
        run.vaultId,
        async ({ zotlit }, { targetItemKey }) => {
          return await zotlit.services.bridge
            .runPromise(zotlit.services.citationLookup.whenResolved)
            .then(function () {
              return zotlit.services.bridge
                .runPromise(
                  zotlit.services.citationLookup.read({
                    indexedKeys: [targetItemKey],
                  }),
                )
                .then(function (answer) {
                  return String(answer.citekeyOf(targetItemKey));
                });
            });
        },
        { targetItemKey: targetItem.key },
        {
          ready: (value) => value === targetItem.citationKey!,
          what: "the target item citation key to resolve after the citation lookup settles",
        },
      );
      // Hold the lookup request so unload must cancel the pending worker read.
      await obRun(
        run.vaultId,
        async ({ zotlit, page: pageHelpers }) => {
          var record = pageHelpers.scratch.zotlitE2EWorkers;
          return await (function () {
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
            return zotlit.services.bridge
              .runPromise(zotlit.services.zoteroReads.refresh)
              .then(function () {
                return true;
              });
          })();
        },
        undefined,
      );
      await obRunUntil(
        run.vaultId,
        async ({ page: pageHelpers }) => {
          var record = pageHelpers.scratch.zotlitE2EWorkers;
          return record!.heldSnapshot;
        },
        undefined,
        { what: "the held worker snapshot to be recorded in the page scratch" },
      );
      // Unload ends the recovered worker and its pending citation read.
      await obRun(
        run.vaultId,
        async ({ app }) => {
          return await app.plugins.disablePlugin("zotlit").then(function () {
            return true;
          });
        },
        undefined,
      );
      try {
        await obRunUntil(
          run.vaultId,
          async ({ page: pageHelpers }) => {
            var record = pageHelpers.scratch.zotlitE2EWorkers;
            return record!.spawned
              .filter(function (entry) {
                return entry.name === "zotlit-zotero-reads";
              })
              .every(function (entry) {
                return record!.ended.has(entry.worker);
              });
          },
          undefined,
          {
            tries: 120,
            what: "every zotlit-zotero-reads worker to end after the Scope Case switch",
          },
        );
      } catch (error) {
        const workers = await obRun(
          run.vaultId,
          async ({ page: pageHelpers }) => {
            var record = pageHelpers.scratch.zotlitE2EWorkers;
            return JSON.stringify(
              record!.spawned.map(function (entry) {
                return {
                  name: entry.name,
                  ended: record!.ended.has(entry.worker),
                };
              }),
            );
          },
          undefined,
        );
        throw new Error(
          `The Scope Case switch left workers running: ${workers}`,
          {
            cause: error,
          },
        );
      }
    }
  }, 120_000);
});
