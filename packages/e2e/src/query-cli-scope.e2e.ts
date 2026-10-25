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
import { cliCommand, obEval, obEvalUntil, waitFor } from "./obsidian-cli.ts";

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
    await obEval(
      run.vaultId,
      "app.plugins.plugins.zotlit.services.bridge.runPromise(app.plugins.plugins.zotlit.services.settings.flush).then(()=>true)",
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
    await obEval(
      run.vaultId,
      "(function(){var Original=window.Worker;var record={spawned:[],Original:Original,terminate:Original.prototype.terminate,ended:new WeakSet()};record.Recording=class extends Original{constructor(url,options){super(url,options);record.spawned.push({worker:this,name:options&&options.name});}};Original.prototype.terminate=function(){record.ended.add(this);return record.terminate.call(this);};window.Worker=record.Recording;window.zotlitE2EWorkers=record;return true;})()",
    );
    const workers = (expression: string) =>
      `(function(){var record=window.zotlitE2EWorkers;return ${expression};})()`;
    await using restoreWorkers = new AsyncDisposableStack();
    restoreWorkers.defer(async () => {
      await obEval(
        run.vaultId,
        workers(
          `(function(){
            if(record.held){
              record.held.worker.postMessage=record.held.post;
              if(!record.ended.has(record.held.worker))
                for(var args of record.held.pending)record.held.post.apply(record.held.worker,args);
            }
            window.Worker=record.Original;
            record.Original.prototype.terminate=record.terminate;
            delete window.zotlitE2EWorkers;
            return true;
          })()`,
        ),
      );
      await obEval(
        run.vaultId,
        "(app.plugins.plugins.zotlit?Promise.resolve():app.plugins.enablePlugin('zotlit')).then(function(){return true;})",
      );
    });
    // An ordinary user action (the Community Plugins toggle), not a bypass —
    // it makes the plugin re-read data.json from disk.
    const toggled = await obEvalUntil(
      run.vaultId,
      "app.plugins.disablePlugin('zotlit').then(function () { return app.plugins.enablePlugin('zotlit'); }).then(function () { return true; })",
      { expected: "true", tries: 20 },
    );
    expect(toggled).toBe(true);

    const reloaded = await obEvalUntil(
      run.vaultId,
      "String('zotlit' in app.plugins.plugins)",
      { expected: "true" },
    );
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
        await obEval(
          run.vaultId,
          workers(
            "String(record.spawned.filter(function(entry){return entry.name==='zotlit-zotero-reads';}).length)",
          ),
        ),
      ).toBe("1");
      expect(
        await obEvalUntil(
          run.vaultId,
          "String(app.plugins.plugins.zotlit.services.zoteroReads.state)",
          { expected: "ready" },
        ),
      ).toBe(true);
      expect(
        await obEvalUntil(
          run.vaultId,
          `app.plugins.plugins.zotlit.services.citationLookup.read({indexedKeys:[${JSON.stringify(targetItem.key)}]}).then(function(answer){return String(answer.citekeyOf(${JSON.stringify(targetItem.key)}));})`,
          { expected: targetItem.citationKey! },
        ),
      ).toBe(true);
      // Termination emits no browser error event: liveness must detect it.
      await obEval(
        run.vaultId,
        workers(
          "(record.spawned.find(function(entry){return entry.name==='zotlit-zotero-reads';}).worker.terminate(),true)",
        ),
      );
      expect(
        await obEvalUntil(
          run.vaultId,
          "String(app.plugins.plugins.zotlit.services.citationLookup.status)",
          { expected: "failed", tries: 160 },
        ),
      ).toBe(true);
      await obEval(
        run.vaultId,
        "app.plugins.plugins.zotlit.services.zoteroReads.refresh().then(function(){return true;})",
      );
      expect(
        await obEvalUntil(
          run.vaultId,
          "String(app.plugins.plugins.zotlit.services.zoteroReads.state)",
          { expected: "ready" },
        ),
      ).toBe(true);
      // SearchItems hydrates its hits from SQLite in the interactive worker.
      const hits = JSON.parse(
        await obEval(
          run.vaultId,
          `app.plugins.plugins.zotlit.services.itemLookup.search(${JSON.stringify(targetItem.title)},{limit:1}).then(JSON.stringify)`,
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
        await obEvalUntil(
          run.vaultId,
          "String(app.plugins.plugins.zotlit.services.citationLookup.status)",
          { expected: "fresh" },
        ),
      ).toBe(true);
      expect(
        await obEvalUntil(
          run.vaultId,
          `app.plugins.plugins.zotlit.services.citationLookup.whenResolved().then(function(){return app.plugins.plugins.zotlit.services.citationLookup.read({indexedKeys:[${JSON.stringify(targetItem.key)}]}).then(function(answer){return String(answer.citekeyOf(${JSON.stringify(targetItem.key)}));});})`,
          { expected: targetItem.citationKey! },
        ),
      ).toBe(true);
      // Hold the lookup request so unload must cancel the pending worker read.
      await obEval(
        run.vaultId,
        workers(`(function(){
          var entry=record.spawned.findLast(function(entry){return entry.name==='zotlit-zotero-reads';});
          var post=entry.worker.postMessage;
          record.held={worker:entry.worker,post:post,pending:[]};
          entry.worker.postMessage=function(...args){
            if(args[0]?.[1]?.tag==='CitationLookup'){
              record.heldSnapshot=true;
              record.held.pending.push(args);return;
            }
            return post.apply(this,args);
          };
          return app.plugins.plugins.zotlit.services.zoteroReads.refresh().then(function(){return true;});
        })()`),
      );
      expect(
        await obEvalUntil(run.vaultId, workers("String(record.heldSnapshot)"), {
          expected: "true",
        }),
      ).toBe(true);
      // Unload ends the recovered worker and its pending citation read.
      await obEval(
        run.vaultId,
        "app.plugins.disablePlugin('zotlit').then(function(){return true;})",
      );
      const ended = await obEvalUntil(
        run.vaultId,
        workers(
          "String(record.spawned.filter(function(entry){return entry.name==='zotlit-zotero-reads';}).every(function(entry){return record.ended.has(entry.worker);}))",
        ),
        { expected: "true", tries: 120 },
      );
      expect(
        ended,
        await obEval(
          run.vaultId,
          workers(
            "JSON.stringify(record.spawned.map(function(entry){return {name:entry.name,ended:record.ended.has(entry.worker)};}))",
          ),
        ),
      ).toBe(true);
    }
  }, 120_000);
});
