import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prepareRunWindow } from "./background-throttling.ts";
import { reachable, runVaultScript, workspaceRoot } from "./e2e-run-fixture.ts";
import { obRun } from "./obsidian-cli.ts";
import type { RenameListener } from "./page-host.ts";
import { clearVault, e2eVaultDir } from "./vault-script.ts";
import { reloadWindow } from "./window-reload.ts";

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

  it("loads ZotLit in startup order, where its rename handlers run before the metadata cache moves the path", async () => {
    const toggled = await obRun(vaultId, async ({ app, page }) => {
      const listed = () => [...(app.vault._.rename ?? [])];
      const rename = async (from: string, to: string) => {
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
        return cached;
      };
      await app.vault.create("startup-order.md", "# Startup order\\n");
      await app.plugins.disablePlugin("zotlit");
      const unloaded = new Set(listed());
      await app.plugins.enablePlugin("zotlit");
      const added = listed().filter((entry) => !unloaded.has(entry));
      const cached = await rename("startup-order.md", "startup-order-moved.md");
      page.scratch.listenersBeforeReload = new Set(listed());
      return {
        sources: added.map((entry) => String(entry.fn)),
        cached: added.map((entry) => cached.get(entry)),
      };
    });
    expect(toggled.cached.length).toBeGreaterThan(0);
    expect(toggled.cached).not.toContain(false);

    await reloadWindow(vaultId);
    const startup = await obRun(
      vaultId,
      async ({ app, page }, { listenerSources }) => {
        const listed = () => [...(app.vault._.rename ?? [])];
        const rename = async (from: string, to: string) => {
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
              cached.set(
                entry,
                app.metadataCache.getFileCache(target) !== null,
              );
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
          return cached;
        };
        const sources = new Set(listenerSources);
        const cached = await rename(
          "startup-order-moved.md",
          "startup-order.md",
        );
        const before = page.scratch.listenersBeforeReload ?? new Set();
        return listed()
          .filter(
            (entry) => !before.has(entry) && sources.has(String(entry.fn)),
          )
          .map((entry) => cached.get(entry));
      },
      { listenerSources: toggled.sources },
    );
    expect(startup).toContain(false);
  }, 120000);
});
