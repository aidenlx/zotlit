import { cp, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, expect } from "vitest";

import { prepareRunWindow } from "./background-throttling.ts";
import { assertDevBundleFresh } from "./bundle-freshness.ts";
import {
  e2eVaultPath,
  runVaultScript,
  workspaceRoot,
} from "./e2e-run-fixture.ts";
import { availableLoopbackPort } from "./e2e-run-helpers.ts";
import { obRun, obRunUntil } from "./obsidian-cli.ts";
import { clearVault } from "./vault-script.ts";

/** Shared End-to-end Run vault state for every area file. */
export const run = {
  vaultId: "",
  m: undefined as unknown as typeof import("@obsidian-messages"),
  booksNotePath: "",
};

let initPromise: Promise<void> | null = null;
let refCount = 0;

async function bootstrap(): Promise<void> {
  run.m = await import("@obsidian-messages");
  await assertDevBundleFresh(workspaceRoot);
  await clearVault(runVaultScript, e2eVaultPath);
  const pluginBundleDir = join(workspaceRoot, "apps", "obsidian", "dist-dev");
  const e2ePluginDir = join(e2eVaultPath, ".obsidian", "plugins", "zotlit");
  await mkdir(e2ePluginDir, { recursive: true });
  await cp(pluginBundleDir, e2ePluginDir, { recursive: true });
  const created = await runVaultScript(["open", e2eVaultPath]);
  run.vaultId = created.stdout.trim().split("\n")[0]!.trim();
  await obRun(
    run.vaultId,
    async ({ app }) => {
      app.vault.setConfig("nativeMenus", false);
    },
    undefined,
  );
  await prepareRunWindow(run.vaultId);
  const serverPort = await availableLoopbackPort();
  await obRun(
    run.vaultId,
    async ({ zotlit }, { serverPort }) => {
      zotlit.services.bridge.runSync(
        zotlit.services.settings.update({
          "server.enabled": false,
          "server.port": serverPort,
        }),
      );
    },
    { serverPort },
  );
  await obRunUntil(
    run.vaultId,
    async ({ zotlit }, { serverPort }) => {
      return (
        !zotlit.services.bridge.runSync(
          zotlit.services.localServer.available,
        ) &&
        zotlit.services.bridge.runSync(zotlit.services.settings.current)[
          "server.port"
        ] === serverPort
      );
    },
    { serverPort },
    {
      what: "the local server to stop and the server port setting to match serverPort",
    },
  );
  await obRun(
    run.vaultId,
    async ({ zotlit }) => {
      zotlit.services.bridge.runSync(
        zotlit.services.settings.update({ "server.enabled": true }),
      );
    },
    undefined,
  );
  await obRunUntil(
    run.vaultId,
    async ({ zotlit }, { serverPort }) => {
      return (
        zotlit.services.bridge.runSync(zotlit.services.localServer.available) &&
        zotlit.services.bridge.runSync(zotlit.services.settings.current)[
          "server.port"
        ] === serverPort
      );
    },
    { serverPort },
    {
      what: "the local server to start and the server port setting to match serverPort",
    },
  );
}

async function teardown(): Promise<void> {
  try {
    await runVaultScript(["remove", e2eVaultPath, "--purge"]);
  } catch (error) {
    console.warn(
      `obsidian-vault remove --purge failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/** One vault per run: area files share bootstrap and teardown. */
export function registerEndToEndRunHooks(): void {
  beforeAll(async () => {
    refCount++;
    if (!initPromise) initPromise = bootstrap();
    await initPromise;
  }, 180000);

  afterAll(async () => {
    refCount--;
    if (refCount === 0 && initPromise) {
      await teardown();
      initPromise = null;
    }
  }, 120000);

  // A case leaves no menu, dialog or popover open, and its notices go with
  // it: a notice stays 4 s at the top right, over the toolbar the next case
  // presses ("PDF Saved" after an export).
  afterEach(async () => {
    const left = await obRun(
      run.vaultId,
      async ({ app, page }) => {
        const { until } = page;
        const docs = () => [
          document,
          ...(
            app.workspace as import("obsidian").Workspace & {
              floatingSplit: { children: { win: Window }[] };
            }
          ).floatingSplit.children.map((split) => split.win.document),
        ];
        const notices = () =>
          docs().flatMap((doc) => [
            ...doc.querySelectorAll<HTMLElement>(".notice"),
          ]);
        for (const notice of notices()) notice.click();
        await until("notices hide", () => notices().length === 0, 2000);
        const open = () =>
          docs().flatMap((doc) => [
            ...doc.querySelectorAll<HTMLElement>(
              ".menu, .modal-container, :popover-open",
            ),
          ]);
        const left = open().map(
          (el) =>
            `${
              el.matches(":popover-open")
                ? "popover"
                : el.classList.contains("menu")
                  ? "menu"
                  : "dialog"
            }: ${el.textContent.trim().slice(0, 60)}`,
        );
        for (const el of open())
          if (el.matches(":popover-open")) el.hidePopover();
        await until(
          "menus and dialogs close",
          async () => {
            if (open().length === 0) return true;
            await page.menuReady();
            activeDocument.body.dispatchEvent(
              new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
            );
            return false;
          },
          5000,
        );
        return left;
      },
      undefined,
    );
    expect(left, "menus, dialogs and popovers the case left open").toEqual([]);
  });
}
