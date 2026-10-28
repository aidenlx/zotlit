import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prepareRunWindow } from "./background-throttling.ts";
import { reachable, runVaultScript, workspaceRoot } from "./e2e-run-fixture.ts";
import { obRun } from "./obsidian-cli.ts";
import type { ObsidianContext } from "./page-context.ts";
import type { RenameListener } from "./page-host.ts";
import { clearVault, e2eVaultDir } from "./vault-script.ts";
import { reloadWindow } from "./window-reload.ts";

/** Records the same rename listeners before and after a whole-window reload. */
const recordRename = async (
  { app, page }: ObsidianContext,
  { listenerSources }: { listenerSources: string[] | null },
) => {
  const listed = () => [...(app.vault._.rename ?? [])];
  let selected: RenameListener[];
  let from: string;
  let to: string;
  if (listenerSources === null) {
    await app.vault.create("startup-order.md", "# Startup order\n");
    await app.plugins.disablePlugin("zotlit");
    const unloaded = new Set(listed());
    await app.plugins.enablePlugin("zotlit");
    selected = listed().filter((entry) => !unloaded.has(entry));
    from = "startup-order.md";
    to = "startup-order-moved.md";
  } else {
    const sources = new Set(listenerSources);
    const before = page.scratch.listenersBeforeReload ?? new Set();
    selected = listed().filter(
      (entry) => !before.has(entry) && sources.has(String(entry.fn)),
    );
    from = "startup-order-moved.md";
    to = "startup-order.md";
  }
  const file = app.vault.getFileByPath(from)!;
  await page.until(
    `cache of ${from}`,
    () => app.metadataCache.getFileCache(file),
    10000,
  );
  const entries = listed();
  const fns = entries.map((entry) => entry.fn);
  const cached = new Map<RenameListener, boolean>();
  entries.forEach((entry, i) => {
    entry.fn = function (this: unknown, target, ...rest) {
      cached.set(entry, app.metadataCache.getFileCache(target) !== null);
      return fns[i]!.call(this, target, ...rest);
    };
  });
  try {
    await app.vault.rename(file, to);
    await page.until(
      "rename dispatch",
      () => cached.size === entries.length,
      10000,
    );
  } finally {
    entries.forEach((entry, i) => {
      entry.fn = fns[i]!;
    });
  }
  if (listenerSources === null)
    page.scratch.listenersBeforeReload = new Set(listed());
  return {
    sources: selected.map((entry) => String(entry.fn)),
    cached: selected.map((entry) => cached.get(entry)),
  };
};

describe.skipIf(!reachable)("Window reload", () => {
  const vaultPath = e2eVaultDir(workspaceRoot, "window-reload-vault");
  let vaultId = "";

  beforeAll(async () => {
    await clearVault(runVaultScript, vaultPath);
    const created = await runVaultScript(["create", vaultPath]);
    vaultId = created.stdout.trim().split("\n")[0]!.trim();
    await prepareRunWindow(vaultId);
  }, 180000);

  afterAll(async () => {
    await runVaultScript(["remove", vaultPath, "--purge"]);
  }, 120000);

  it("reads the current services after a plugin restart in one callback (#1848)", async () => {
    expect(
      await obRun(vaultId, async ({ app, zotlit }) => {
        const before = zotlit.services;
        await app.plugins.disablePlugin("zotlit");
        await app.plugins.enablePlugin("zotlit");
        return zotlit.services !== before;
      }),
    ).toBe(true);
  });

  it("reloads when ZotLit is disabled only in memory (#1848)", async () => {
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await obRun(vaultId, async ({ app }) => {
        if (!app.plugins.plugins.zotlit)
          await app.plugins.enablePlugin("zotlit");
      });
    });
    expect(
      await obRun(vaultId, async ({ app }) => {
        await app.plugins.disablePlugin("zotlit");
        return app.plugins.plugins.zotlit === undefined;
      }),
    ).toBe(true);
    await reloadWindow(vaultId);
    expect(
      await obRun(vaultId, ({ app, page }) => ({
        loaded: app.plugins.plugins.zotlit?._loaded === true,
        reloaded: page.scratch.windowBeforeReload === undefined,
      })),
    ).toEqual({ loaded: true, reloaded: true });
  });

  it("loads ZotLit in startup order, where its rename handlers run before the metadata cache moves the path", async () => {
    const toggled = await obRun(vaultId, recordRename, {
      listenerSources: null,
    });
    expect(toggled.cached.length).toBeGreaterThan(0);
    expect(toggled.cached).not.toContain(false);

    await reloadWindow(vaultId);
    const startup = await obRun(vaultId, recordRename, {
      listenerSources: toggled.sources,
    });
    expect(startup.cached).toContain(false);
  }, 120000);

  it("uses page helpers after reload and on popout elements without helper setup (#1849)", async () => {
    await reloadWindow(vaultId);
    const proof = await obRun(vaultId, async ({ app, page }) => {
      await using cleanup = new AsyncDisposableStack();
      const leaf = cleanup.adopt(app.workspace.getLeaf("tab"), (leaf) =>
        leaf.detach(),
      );
      app.workspace.moveLeafToPopout(leaf);
      const popout = await page.until(
        "leaf in the popout",
        () => {
          const doc = leaf.view.containerEl.ownerDocument;
          return doc !== document && doc.defaultView;
        },
        10000,
      );
      // prepareRunWindow replaces focus with background focus emulation.
      popout.focus();
      await page.until(
        "popout focused",
        () => popout.document.hasFocus() && activeWindow === popout,
        5000,
      );
      const button = popout.document.createElement("button");
      button.textContent = "Test page helper";
      button.style.cssText = "position:fixed;top:40px;left:40px;z-index:10000";
      popout.document.body.append(button);
      cleanup.defer(() => button.remove());
      let clicks = 0;
      button.addEventListener("click", () => {
        clicks++;
      });
      await page.stands(button, "helper test button");
      page.press(button, "helper test button");
      return {
        reloaded: page.scratch.windowBeforeReload === undefined,
        popoutDocument: page.windowDocuments().includes(popout.document),
        clicked: clicks,
        // CLI eval stays in the main window even with a popout active.
        evalInMainWindow: window !== popout,
        popoutActive: activeWindow === popout,
      };
    });
    expect(proof).toEqual({
      reloaded: true,
      popoutDocument: true,
      clicked: 1,
      evalInMainWindow: true,
      popoutActive: true,
    });
  }, 120000);
});

describe.skipIf(!reachable)("Plugin start-up", () => {
  const vaultPath = e2eVaultDir(workspaceRoot, "plugin-startup-vault");
  let vaultId = "";

  beforeAll(async () => {
    await clearVault(runVaultScript, vaultPath);
    const created = await runVaultScript(["create", vaultPath]);
    vaultId = created.stdout.trim().split("\n")[0]!.trim();
    await prepareRunWindow(vaultId);
  }, 180000);

  afterAll(async () => {
    await runVaultScript(["remove", vaultPath, "--purge"]);
  }, 120000);

  it("releases a start-up that a disable interrupts, so the next enable starts (#1786)", async () => {
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await obRun(vaultId, async ({ app }) => {
        if (!app.plugins.plugins.zotlit)
          await app.plugins.enablePlugin("zotlit");
      });
    });
    const proof = await obRun(vaultId, async ({ app, zotlit, page }) => {
      const { bridge, localServer } = zotlit.services;
      // The cancelled start-up binds the port the running instance frees.
      const port = bridge.runSync(localServer.effectivePort);
      // The database workers made from here on that nothing has terminated.
      const NativeWorker = window.Worker;
      const databaseWorkers = new Set<Worker>();
      window.Worker = class extends NativeWorker {
        constructor(url: string | URL, options?: WorkerOptions) {
          super(url, options);
          if (options?.name === "zotlit-zotero-reads")
            databaseWorkers.add(this);
        }
        override terminate() {
          databaseWorkers.delete(this);
          super.terminate();
        }
      };
      try {
        const registered = () => ({
          commands: Object.keys(app.commands.commands).filter((id) =>
            id.startsWith("zotlit:"),
          ).length,
          cli: [...app.cli.handlers.keys()].filter((name) =>
            name.startsWith("zotlit:"),
          ).length,
          protocol: [...app.workspace.protocolHandler.handlers.keys()].filter(
            (action) => action.startsWith("zotlit"),
          ).length,
          views: Object.keys(app.viewRegistry.viewByType).filter((type) =>
            type.startsWith("zotlit"),
          ).length,
          // ZotLit's Live Updates listener: a Node server on its port.
          liveUpdates: process._getActiveHandles().filter((handle) => {
            const server = handle as {
              listening?: boolean;
              address?: () => { port: number } | string | null;
            };
            const address = server.listening ? server.address?.() : null;
            return typeof address === "object" && address?.port === port;
          }).length,
          databaseWorkers: databaseWorkers.size,
        });
        const started = () => {
          try {
            return app.plugins.plugins.zotlit?.services !== undefined;
          } catch {
            return false;
          }
        };
        await app.plugins.disablePlugin("zotlit");
        const enabling = app.plugins.enablePlugin("zotlit");
        // Loaded but not started: onload still waits for its services.
        await page.until(
          "onload in progress",
          () => app.plugins.plugins.zotlit?._loaded === true && !started(),
          10000,
        );
        await app.plugins.disablePlugin("zotlit");
        await enabling;
        const afterInterruptedStart = registered();
        await app.plugins.enablePlugin("zotlit");
        return {
          port: typeof port === "number",
          afterInterruptedStart,
          restarted: started(),
          afterRestart: registered(),
        };
      } finally {
        window.Worker = NativeWorker;
      }
    });
    expect(proof).toMatchObject({
      port: true,
      afterInterruptedStart: {
        commands: 0,
        cli: 0,
        protocol: 0,
        views: 0,
        liveUpdates: 0,
        databaseWorkers: 0,
      },
      restarted: true,
      // The counts see what a start-up leaves when it runs.
      afterRestart: { liveUpdates: 1, databaseWorkers: 1 },
    });
  }, 120000);
});
