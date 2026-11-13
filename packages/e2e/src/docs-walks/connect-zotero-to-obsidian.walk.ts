// The walk of /learn Lesson 1, "Connect Zotero to Obsidian and write your
// first literature note": a researcher who has never used ZotLit installs it
// from Obsidian's community plugins, sees it connect to their Zotero library,
// installs ZotLit Companion in Zotero, finds Sandve et al. 2013, reads its
// PDF in Obsidian, writes a first literature note, and adds a thought of
// their own. Each `it` is one step of the lesson, in the lesson's order,
// named after it, and asserts what the lesson says the reader sees. Run it
// with `pnpm --filter @zotlit/e2e docs-walk`; see AGENTS.md.

import { cli, obRun, obRunUntil } from "@e2e/obsidian-cli.ts";
import type { PagePdfView } from "@e2e/page-notes-types.ts";
import { isObsidianReachable } from "@e2e/vault-script.ts";
import { reloadWindow } from "@e2e/window-reload.ts";
import { execFile } from "node:child_process";
import { mkdir, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type {
  FileSystemAdapter,
  FileView,
  MarkdownView,
  WorkspaceLeaf,
} from "obsidian";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getWorkspaceRoot } from "@zotlit/scripts/package-roots";

import type { LibraryView } from "@/views/library/view";

import type { Rect } from "./camera.ts";
import { openDocsBrowser } from "./docs-browser.ts";
import {
  openDocsWalk,
  readNotices,
  recordRequested,
  watchNotices,
} from "./docs-walk.ts";
import type { DocsWalk } from "./docs-walk.ts";
import {
  bringToFront,
  DesktopShotSpoiled,
  menuPoint,
  screenWindows,
  setAppVisible,
  typeKeys,
} from "./macos-desktop.ts";

declare module "../page-helpers.ts" {
  interface PageScratch {
    /** Keeps the Zotero data folder of the setup steps at the reader's default. */
    docsWalkReaderPath?: MutationObserver;
  }
}

const execFileAsync = promisify(execFile);
const root = await getWorkspaceRoot(import.meta.dirname);
const reachable = await isObsidianReachable(root);
const m = await import("@obsidian-messages");

const SLUG = "connect-zotero-to-obsidian";
/** Sandve et al. 2013 in the docs Vault Case: a PDF in Zotero storage, five annotations. */
const PAPER = {
  key: "DCSNDART",
  title: "Ten Simple Rules for Reproducible Computational Research",
  citekey: "sandve2013",
  creators: "Sandve",
  venue: "PLOS Computational Biology",
  annotations: 5,
};
/** Every top-level Item in the docs Vault Case's library. */
const LIBRARY_ITEMS = 5;
/** A few words of the title, as the reader types them. */
const SEARCH = "reproducible computational";
const NOTE = `literatures/${PAPER.citekey}.md`;
const HEADING = "## My thoughts";
const THOUGHTS =
  "Rule 1 is the habit my methods chapter lacks: each figure needs a record of the script and data that made it.";
/**
 * The folder a reader's Zotero data sits in by default. The walk's Fixture
 * lives in the worktree, so the images show this path in its place.
 */
const READER_DATA_DIR = "~/Zotero";
/** ZotLit in Obsidian's community directory. */
const DIRECTORY = { name: "ZotLit", author: "By Aiden Liu" };
/** ZotLit Companion's add-on id in Zotero. */
const COMPANION_ID = "zotlit@aidenlx.site";
/**
 * The docs site the clean browser opens the installation guide on, at the
 * path of the guide's link in the setup steps: the local docs server unless
 * `DOCS_WALK_DOCS_URL` names another.
 */
const DOCS_URL = process.env.DOCS_WALK_DOCS_URL ?? "http://localhost:4833";
/**
 * The Companion route's two macOS shots, Tools › Plugins in the menu bar and
 * the file dialog, take real pointer and key input: `DOCS_WALK_NATIVE=1`
 * records them, in an unattended window with the other apps hidden. Without
 * it, the Zotero shot opens on the Plugins Manager and installs the file the
 * browser downloaded without the dialog.
 */
const NATIVE = process.env.DOCS_WALK_NATIVE === "1";
/**
 * The private parts of those macOS shots, blurred in the encode, in screen
 * points: the menu bar right of `menuBarFrom` (other apps' status items, the
 * clock), and the file dialog's sidebar and toolbar (the computer's
 * folders, the user name, the folder menu), measured from its top-left.
 * The camera keeps them out of view as well.
 */
const PRIVATE = { menuBarFrom: 600, dialogSidebar: 170, dialogToolbar: 64 };
/** The scratch folder the clean browser downloads into, named as a reader's. */
const DOWNLOADS = join(root, ".scratch", "docs-walks", SLUG, "Downloads");
/** Where step 1 keeps the Fixture's plugin folders while the reader installs ZotLit. */
const FIXTURE_PLUGINS = join(
  root,
  ".scratch",
  "docs-walks",
  SLUG,
  "fixture-plugins",
);

type LibraryLeaf = WorkspaceLeaf & { view: LibraryView };
type NoteLeaf = WorkspaceLeaf & { view: MarkdownView };
/** Obsidian's plugin manager, with the calls a walk of the install needs. */
interface ReaderPlugins {
  disablePluginAndSave(id: string): Promise<void>;
  enablePluginAndSave(id: string): Promise<void>;
  enabledPlugins: Set<string>;
  saveConfig(): Promise<void>;
  loadManifests(): Promise<void>;
  setEnable(on: boolean): Promise<void>;
  isEnabled(): boolean;
  plugins: Record<string, unknown>;
}
/** Obsidian's settings modal, with the parts a walk of the install reads. */
interface ReaderSettings {
  open(): void;
  close(): void;
  lastTabId: string;
  modalEl: HTMLElement;
  activeTab: { id: string; containerEl: HTMLElement } | null;
  settingTabs: { id: string; navEl: HTMLElement }[];
  openTab(tab: { id: string }): void;
}

/** One step's calls into the apps can wait on Zotero: up to a minute. */
const STEP = { timeoutMs: 60000 };

describe.skipIf(!reachable)(
  "Lesson 1: Connect Zotero to Obsidian and write your first literature note",
  () => {
    let walk: DocsWalk;
    /** The Paired Run's Companion build, for a run that does not record step 3. */
    let companionDir = "";

    beforeAll(async () => {
      walk = await openDocsWalk({
        slug: SLUG,
        collection: `learn/${SLUG}`,
        vaultCase: "docs",
      });
      // The PDF tab's path runs through the Fixture's folders; the images
      // show the file name alone.
      await obRun(walk.vaultId, () => {
        const style = document.head.createEl("style");
        style.textContent =
          '.workspace-leaf-content[data-type="pdf"] .view-header-title-parent{display:none}';
      });
      // The reader installs ZotLit Companion in step 3: the walk takes the
      // Paired Run's Companion out of the Fixture's Zotero profile first.
      const profile = await walk.zotero.json<{ dir: string; profile: string }>(
        `(async () => {
          const { AddonManager } = ChromeUtils.importESModule("resource://gre/modules/AddonManager.sys.mjs");
          const profile = Services.dirsvc.get("ProfD", Ci.nsIFile);
          const proxy = profile.clone();
          proxy.append("extensions");
          proxy.append(${JSON.stringify(COMPANION_ID)});
          const dir = proxy.exists() ? Zotero.File.getContents(proxy).trim() : "";
          const addon = await AddonManager.getAddonByID(${JSON.stringify(COMPANION_ID)});
          if (addon) await addon.uninstall();
          return { dir, profile: profile.path };
        })()`,
      );
      console.log("[walk] Companion removed", JSON.stringify(profile));
      // Only the Fixture's own Zotero profile is touched.
      expect(profile.profile).toContain(
        join(".scratch", "e2e-docs-walk-fixture"),
      );
      companionDir = profile.dir;
    });

    afterAll(async () => {
      await walk?.[Symbol.asyncDispose]();
    });

    it.runIf(recordRequested("step-1"))(
      "step 1, as the reader installs it: Settings, Community plugins, Exit Restricted mode, Browse, search ZotLit, Install, Enable; a tab named Zotero library opens",
      async () => {
        // The reader's install: Settings, Community plugins, Browse, search,
        // the ZotLit card, Install, Enable, from a vault without ZotLit in
        // Restricted mode. It downloads the release build from the
        // community directory, so it runs only when the clip records. The
        // Fixture's builds wait in the scratch folder and come back after.
        const popout = await obRun(
          walk.vaultId,
          async ({ app, page }, { backup, dir }) => {
            const fs = require("node:fs") as typeof import("node:fs");
            const path = require("node:path") as typeof import("node:path");
            const plugins = app.plugins as unknown as ReaderPlugins;
            const leaves: WorkspaceLeaf[] = [];
            app.workspace.iterateAllLeaves((l) => {
              if (/^(zotlit|zotero)-/.test(l.view.getViewType()))
                leaves.push(l);
            });
            for (const l of leaves) l.detach();
            app.workspace.iterateRootLeaves((l) => l.detach());
            await plugins.disablePluginAndSave("zotlit");
            await plugins.disablePluginAndSave("hot-reload");
            const base = (app.vault.adapter as FileSystemAdapter).getBasePath();
            fs.rmSync(backup, { recursive: true, force: true });
            for (const id of ["zotlit", "hot-reload"]) {
              const from = path.join(base, app.vault.configDir, "plugins", id);
              fs.cpSync(from, path.join(backup, id), { recursive: true });
              fs.rmSync(from, { recursive: true, force: true });
            }
            plugins.enabledPlugins.clear();
            await plugins.saveConfig();
            await plugins.loadManifests();
            await plugins.setEnable(false);
            // Obsidian 1.15 opens Settings in a window of its own; the
            // screencast records the vault's window, so Settings opens as a
            // modal in it, as in Obsidian 1.14.
            const before = app.vault.getConfig("settingsPopoutWindow");
            app.vault.setConfig("settingsPopoutWindow", false);
            // Settings opens on its last tab, General by default, which shows
            // the Obsidian account; the clip opens it on Editor.
            (app.setting as unknown as ReaderSettings).lastTabId = "editor";
            // The Zotero data folder in the setup steps shows the reader's
            // default from its first frame.
            const observer = new MutationObserver(() => {
              for (const code of document.querySelectorAll(
                "[data-welcome-step] code",
              ))
                if (code.textContent !== dir) code.textContent = dir;
            });
            observer.observe(document.body, {
              childList: true,
              subtree: true,
              characterData: true,
            });
            page.scratch.docsWalkReaderPath = observer;
            return before;
          },
          { backup: FIXTURE_PLUGINS, dir: READER_DATA_DIR },
          STEP,
        );
        const installed = await walk.record("step-1", () =>
          obRun(
            walk.vaultId,
            async ({ app, page }, { search, card: expected }) => {
              const pointer = page.scratch.docsWalkPointer;
              const wait = (ms: number) =>
                new Promise((r) => setTimeout(r, ms));
              const plugins = app.plugins as unknown as ReaderPlugins;
              const setting = app.setting as unknown as ReaderSettings;
              // Every Settings tab the clip opens, to prove General never shows.
              const tabs: string[] = [];
              const openTab = setting.openTab.bind(setting);
              setting.openTab = (tab) => {
                tabs.push(tab.id);
                openTab(tab);
              };
              const buttonOf = (scope: Element, text: string) =>
                [...scope.querySelectorAll<HTMLButtonElement>("button")].find(
                  (b) => b.textContent === text && b.checkVisibility(),
                );
              try {
                const gear = document
                  .querySelector(
                    ".workspace-drawer-vault-actions .lucide-settings",
                  )
                  ?.closest<HTMLElement>(".clickable-icon");
                await pointer?.point(gear!);
                page.press(gear, "Settings");
                const modal = await page.until(
                  "Settings",
                  () =>
                    setting.modalEl.isConnected &&
                    setting.modalEl.ownerDocument === document &&
                    setting.activeTab &&
                    setting.modalEl,
                  5000,
                );
                tabs.push(setting.activeTab!.id);
                await pointer?.look(modal);
                const nav = setting.settingTabs.find(
                  (t) => t.id === "community-plugins",
                )!.navEl;
                await pointer?.point(nav);
                page.press(nav, "Community plugins");
                const tab = await page.until(
                  "Community plugins",
                  () =>
                    setting.activeTab?.id === "community-plugins" &&
                    setting.activeTab,
                  5000,
                );
                const exit = await page.until(
                  "the Restricted mode button",
                  () =>
                    tab.containerEl.querySelector<HTMLElement>(
                      "button.mod-cta",
                    ),
                  5000,
                );
                const exitLabel = exit.textContent;
                await pointer?.point(exit);
                page.press(exit, exitLabel);
                // The tab draws itself again as Restricted mode ends.
                const browseButton = () =>
                  plugins.isEnabled() &&
                  setting.activeTab &&
                  buttonOf(setting.activeTab.containerEl, "Browse");
                await page.until("Browse", browseButton, 5000);
                await wait(600);
                const browse = await page.until("Browse", browseButton, 5000);
                await pointer?.point(browse);
                page.press(browseButton() || browse, "Browse");
                const store = await page.until(
                  "community plugins",
                  () => {
                    const s = document.querySelector<HTMLElement>(
                      ".mod-community-modal",
                    );
                    return (
                      s && s.querySelectorAll(".community-item").length > 0 && s
                    );
                  },
                  30000,
                );
                const input =
                  store.querySelector<HTMLInputElement>("input[type=search]")!;
                if (pointer) {
                  await pointer.point(input, { inset: 60 });
                  await pointer.type(input, search);
                } else {
                  input.value = search;
                  input.dispatchEvent(new Event("input", { bubbles: true }));
                }
                const card = await page.until(
                  "the ZotLit card",
                  () =>
                    [
                      ...store.querySelectorAll<HTMLElement>(".community-item"),
                    ].find(
                      (i) =>
                        i.querySelector(".community-item-name")?.textContent ===
                          expected.name &&
                        i.querySelector(".community-item-author")
                          ?.textContent === expected.author,
                    ),
                  10000,
                );
                const results = [
                  ...store.querySelectorAll(".community-item"),
                ].map(
                  (i) =>
                    i.querySelector(".community-item-name")?.textContent ?? "",
                );
                await pointer?.point(card);
                page.press(card, "the ZotLit card");
                const details = await page.until(
                  "the ZotLit details",
                  () => {
                    const d = store.querySelector<HTMLElement>(
                      ".community-modal-details",
                    );
                    return d && buttonOf(d, "Install") && d;
                  },
                  10000,
                );
                const install = buttonOf(details, "Install")!;
                if (pointer) {
                  const d = details.getBoundingClientRect();
                  const b = install.getBoundingClientRect();
                  // The plugin's name, version and author above its buttons.
                  await pointer.look({
                    left: d.left + 40,
                    top: d.top + 40,
                    right: d.right - 40,
                    bottom: b.bottom + 16,
                  });
                }
                const version =
                  /Version: (\S+)/.exec(details.innerText)?.[1] ?? "";
                await pointer?.point(install);
                page.press(install, "Install");
                const enable = await page.until(
                  "Enable",
                  () => buttonOf(details, "Enable"),
                  90000,
                );
                await pointer?.point(enable);
                page.press(enable, "Enable");
                const leaf = await page.until(
                  "Zotero library",
                  () =>
                    plugins.plugins.zotlit
                      ? (app.workspace.getLeavesOfType("zotlit-library")[0] as
                          | LibraryLeaf
                          | undefined)
                      : undefined,
                  30000,
                );
                await wait(600);
                // The reader closes the plugin directory, then Settings, when
                // it is still open: closing the directory can close both.
                const closed: string[] = [];
                for (const [scope, what] of [
                  [store, "community plugins"],
                  [setting.modalEl, "Settings"],
                ] as const) {
                  const close = scope.querySelector<HTMLElement>(
                    ":scope > .modal-header-button",
                  );
                  if (!scope.isConnected || !close?.checkVisibility()) continue;
                  closed.push(what);
                  await pointer?.point(close);
                  page.press(close, `close ${what}`);
                  await page.until(
                    `${what} closed`,
                    () => !scope.isConnected,
                    5000,
                  );
                  await wait(300);
                }
                const el = leaf.view.contentEl;
                const rows = () => [
                  ...el.querySelectorAll<HTMLElement>("[data-welcome-step]"),
                ];
                await page.until(
                  "setup steps",
                  () =>
                    rows().length === 4 &&
                    !rows().some((s) => s.dataset.welcomeStep === "checking"),
                  30000,
                );
                const banner =
                  el.querySelector<HTMLElement>("[data-welcome-banner]") ?? el;
                if (pointer) {
                  // The pointer rests at the end of the setup section's last
                  // line, clear of its text and inside the view.
                  const b = banner.getBoundingClientRect();
                  await pointer.park(b.right - 60, b.bottom - 24);
                  await pointer.look(banner);
                }
                return {
                  closed,
                  exitLabel,
                  results,
                  version,
                  tabs,
                  tab: leaf.getDisplayText(),
                  badge:
                    el.querySelector("[data-welcome-badge]")?.textContent ??
                    null,
                  states: rows().map((s) => s.dataset.welcomeStep!),
                  dataDir:
                    el.querySelector("[data-welcome-step] code")?.textContent ??
                    null,
                };
              } finally {
                Reflect.deleteProperty(setting, "openTab");
              }
            },
            { search: DIRECTORY.name, card: DIRECTORY },
            { timeoutMs: 240000 },
          ),
        );
        console.log("[walk] directory install", JSON.stringify(installed));
        // OUTLINE-MISMATCH: the lesson names the button "Turn on community
        // plugins"; Obsidian 1.15.1 labels it "Exit Restricted mode".
        expect(installed.exitLabel).toBe("Exit Restricted mode");
        expect(installed.results).toContain(DIRECTORY.name);
        expect(installed.tabs).not.toContain("about");
        expect(installed.tab).toBe(m.library_view_name());
        expect(installed.badge).toBe(m.welcome_badge());
        expect(installed.states).toEqual(["done", "todo", "done", "todo"]);
        expect(installed.dataDir).toBe(READER_DATA_DIR);
        // The Fixture's builds come back, and the steps below run on them.
        await obRun(
          walk.vaultId,
          async ({ app, page }, { backup, popout }) => {
            const fs = require("node:fs") as typeof import("node:fs");
            const path = require("node:path") as typeof import("node:path");
            page.scratch.docsWalkReaderPath?.disconnect();
            delete page.scratch.docsWalkReaderPath;
            const plugins = app.plugins as unknown as ReaderPlugins;
            await plugins.disablePluginAndSave("zotlit");
            const base = (app.vault.adapter as FileSystemAdapter).getBasePath();
            for (const id of ["zotlit", "hot-reload"]) {
              const to = path.join(base, app.vault.configDir, "plugins", id);
              fs.rmSync(to, { recursive: true, force: true });
              fs.cpSync(path.join(backup, id), to, { recursive: true });
            }
            await plugins.loadManifests();
            await plugins.enablePluginAndSave("hot-reload");
            app.vault.setConfig("settingsPopoutWindow", popout);
          },
          { backup: FIXTURE_PLUGINS, popout },
          STEP,
        );
      },
      420000,
    );

    it("step 1: install and enable ZotLit; a tab named Zotero library opens", async () => {
      // A first launch of the Fixture's build: the Paired Run loaded ZotLit
      // once to point it at the Fixture, which saved its settings, so the
      // walk clears them and turns ZotLit on again, as Enable does.
      await obRun(
        walk.vaultId,
        async ({ app }) => {
          const plugins = app.plugins as unknown as ReaderPlugins;
          await plugins.disablePluginAndSave("zotlit");
          await app.vault.adapter.remove(".obsidian/plugins/zotlit/data.json");
          app.workspace.iterateRootLeaves((l) => l.detach());
          await plugins.enablePluginAndSave("zotlit");
        },
        undefined,
        STEP,
      );
      await watchNotices(walk.vaultId);
      const first = await obRun(
        walk.vaultId,
        async ({ app, page }) => {
          const leaf = await page.until(
            "Library View",
            () =>
              app.workspace.getLeavesOfType("zotlit-library")[0] as
                | LibraryLeaf
                | undefined,
            30000,
          );
          const el = leaf.view.contentEl;
          const rows = () => [
            ...el.querySelectorAll<HTMLElement>("[data-welcome-step]"),
          ];
          await page.until(
            "setup steps",
            () =>
              rows().length > 0 &&
              !rows().some((s) => s.dataset.welcomeStep === "checking"),
            30000,
          );
          const early = rows().map((s) => s.dataset.welcomeStep!);
          // ZotLit re-reads Zotero's add-on list for 15 seconds after start.
          await new Promise((r) => setTimeout(r, 16000));
          return {
            tab: leaf.getDisplayText(),
            tabActive: app.workspace.getMostRecentLeaf() === leaf,
            badge:
              el.querySelector("[data-welcome-badge]")?.textContent ?? null,
            early,
            steps: rows().map((s) => ({
              state: s.dataset.welcomeStep!,
              text: s.innerText.replaceAll(/\s+/g, " ").trim(),
            })),
          };
        },
        undefined,
        { timeoutMs: 90000 },
      );
      console.log("[walk] first launch", JSON.stringify(first));
      // The steps below run on the Fixture's build: it answers its dev-only
      // CLI command, which a release build lacks.
      expect(
        await cli([`vault=${walk.vaultId}`, "zotlit:library-scope"]),
      ).toContain("contractVersion");
      expect(first.tab).toBe(m.library_view_name());
      expect(first.tabActive).toBe(true);
      expect(first.badge).toBe(m.welcome_badge());
      // Fact a: the order and the text of the checklist on a first launch.
      expect(first.steps).toHaveLength(4);
      expect(first.steps[0]!.text).toContain(m.welcome_step_connect_title());
      expect(first.steps[1]!.text).toContain(m.welcome_step_folder_title());
      expect(first.steps[2]!.text).toContain(m.welcome_step_library_title());
      expect(first.steps[3]!.text).toContain(m.welcome_step_companion_title());
      // Connect and Open your library are done; the notes folder waits, and
      // the Companion, which the reader installs in step 3.
      expect(first.steps.map((s) => s.state)).toEqual([
        "done",
        "todo",
        "done",
        "todo",
      ]);
      expect(first.steps[3]!.text).toContain(
        m.welcome_step_companion_recommended(),
      );
      await obRun(
        walk.vaultId,
        ({ app }, { dir }) => {
          const el = (
            app.workspace.getLeavesOfType("zotlit-library")[0] as LibraryLeaf
          ).view.contentEl;
          const code = el.querySelector("[data-welcome-step] code");
          if (code) code.textContent = dir;
        },
        { dir: READER_DATA_DIR },
      );
      await walk.capture("step-1");
      await walk.compose("step-1");
    }, 420000);

    it("step 2: look at the first line of the tab; Connect to Zotero has a green check and your item count", async () => {
      const line = await walk.record("step-2", () =>
        obRun(walk.vaultId, async ({ app, page }) => {
          const pointer = page.scratch.docsWalkPointer;
          const el = (
            app.workspace.getLeavesOfType("zotlit-library")[0] as LibraryLeaf
          ).view.contentEl;
          const row = el.querySelector<HTMLElement>("[data-welcome-step]")!;
          const mark = row.querySelector<HTMLElement>("[data-welcome-mark]")!;
          if (pointer) {
            // The reader reads the first line: its check, its name, the data
            // folder and the item count, the pointer just after them.
            const words = document.createRange();
            words.selectNodeContents(mark.nextElementSibling!);
            const t = words.getBoundingClientRect();
            await pointer.park(t.right + 28, t.top + t.height / 2 + 4);
            await pointer.look([
              mark,
              { left: t.left, top: t.top, right: t.right, bottom: t.bottom },
            ]);
          }
          const probe = document.body.createDiv({ cls: "zt-root" });
          probe.style.color = "var(--color-green)";
          const green = getComputedStyle(probe).color;
          probe.remove();
          const close = el.querySelector<HTMLElement>("[data-welcome-dismiss]");
          return {
            state: row.dataset.welcomeStep!,
            text: row.innerText.replaceAll(/\s+/g, " ").trim(),
            icon: mark.querySelector("svg")?.classList.contains("lucide-check"),
            markColor: getComputedStyle(mark).color,
            green,
            open: !!el.querySelector("[data-welcome-banner]"),
            close: {
              label: close?.getAttribute("aria-label") ?? null,
              icon: close?.querySelector("svg")?.classList.contains("lucide-x"),
            },
          };
        }),
      );
      console.log("[walk] connect line", JSON.stringify(line));
      expect(line.state).toBe("done");
      expect(line.text).toContain(m.welcome_step_connect_title());
      expect(line.text).toContain(
        m.welcome_step_connect_connected({ count: LIBRARY_ITEMS }),
      );
      expect(line.icon).toBe(true);
      expect(line.markColor).toBe(line.green);
      // The setup section stays open for step 3; its × at the top-right
      // corner is named Dismiss.
      expect(line.open).toBe(true);
      expect(line.close.label).toBe(m.welcome_dismiss());
      expect(line.close.icon).toBe(true);
      await walk.capture("step-2");
      await walk.compose("step-2");
    });

    it("step 3: install ZotLit Companion from its installation guide, then close the setup section with its × button; Install ZotLit Companion reads Installed, and then your papers fill the tab", async () => {
      /** The Companion row's guide button, and the address it opens. */
      const openGuide = () =>
        obRun(
          walk.vaultId,
          async ({ app, page }, { title, label }) => {
            const pointer = page.scratch.docsWalkPointer;
            const el = (
              app.workspace.getLeavesOfType("zotlit-library")[0] as LibraryLeaf
            ).view.contentEl;
            const row = [
              ...el.querySelectorAll<HTMLElement>("[data-welcome-step]"),
            ].find((r) => r.innerText.includes(title))!;
            const button = [
              ...row.querySelectorAll<HTMLElement>("button"),
            ].find((b) => b.innerText.trim() === label)!;
            // The guide opens in the reader's browser; the walk keeps the
            // address and opens it in the clean browser.
            let opened = "";
            const open = window.open;
            window.open = (url) => {
              opened = String(url);
              return null;
            };
            try {
              if (pointer) {
                await pointer.look(row);
                await pointer.point(button);
              }
              page.press(button, label);
              await new Promise((r) => setTimeout(r, 400));
            } finally {
              window.open = open;
            }
            return { opened, state: row.dataset.welcomeStep! };
          },
          {
            title: m.welcome_step_companion_title(),
            label: m.welcome_action_install_companion(),
          },
          STEP,
        );
      /** The reader comes back to Obsidian, then closes the setup section. */
      const backInObsidian = () =>
        obRun(
          walk.vaultId,
          async ({ app, page }, { title }) => {
            const pointer = page.scratch.docsWalkPointer;
            const el = (
              app.workspace.getLeavesOfType("zotlit-library")[0] as LibraryLeaf
            ).view.contentEl;
            const row = () =>
              [...el.querySelectorAll<HTMLElement>("[data-welcome-step]")].find(
                (r) => r.innerText.includes(title),
              );
            // Obsidian comes to the front: ZotLit reads Zotero's add-on list.
            window.dispatchEvent(new Event("focus"));
            await page.until(
              "the Companion step done",
              () => row()?.dataset.welcomeStep === "done",
              20000,
            );
            const companion = row()!.innerText.replaceAll(/\s+/g, " ").trim();
            await pointer?.look(row()!);
            await new Promise((r) => setTimeout(r, 900));
            const close = el.querySelector<HTMLElement>(
              "[data-welcome-dismiss]",
            )!;
            await pointer?.point(close);
            page.press(close, "Dismiss");
            await page.until(
              "section closed",
              () => !el.querySelector("[data-welcome-banner]"),
              10000,
            );
            await new Promise((r) => setTimeout(r, 300));
            // The step ends on the papers that now fill the tab.
            await pointer?.look([
              ...el.querySelectorAll("[data-query-item-row]"),
            ]);
            const shell = el
              .querySelector("[data-library-shell]")!
              .getBoundingClientRect();
            return {
              companion,
              banner: !!el.querySelector("[data-welcome-banner]"),
              shell: Math.round(shell.height),
              tab: Math.round(el.getBoundingClientRect().height),
              rows: el.querySelectorAll("[data-query-item-row]").length,
            };
          },
          { title: m.welcome_step_companion_title() },
          STEP,
        );
      /** The Companion Zotero lists, and where it sits. */
      const companion = () =>
        walk.zotero.json<{
          name: string;
          version: string;
          active: boolean;
          file: string;
        } | null>(
          `(async () => {
            const { AddonManager } = ChromeUtils.importESModule("resource://gre/modules/AddonManager.sys.mjs");
            const a = await AddonManager.getAddonByID(${JSON.stringify(COMPANION_ID)});
            return a && { name: a.name, version: a.version, active: a.isActive, file: a.getResourceURI().spec };
          })()`,
        );

      let result: {
        guide: { opened: string; state: string };
        file?: string;
        back: Awaited<ReturnType<typeof backInObsidian>>;
      };
      if (recordRequested("step-3")) {
        await rm(DOWNLOADS, { recursive: true, force: true });
        await mkdir(DOWNLOADS, { recursive: true });
        await using browser = await openDocsBrowser({
          width: 1440,
          height: 860,
          downloads: DOWNLOADS,
        });
        // The guide's heading, its download section and its link show.
        await browser.open(
          `${DOCS_URL}/docs/install-companion`,
          `document.querySelector("h1") && document.getElementById("download-the-xpi-file") && [...document.querySelectorAll('a[href$=".xpi"]')].some((l) => l.checkVisibility())`,
        );
        const pid = await walk.zotero.json<number>(
          "Services.appinfo.processID",
        );
        // Zotero's main window fills the recorded region under the menu bar.
        const tools = await bringToFront(pid).then(() =>
          menuPoint(pid, "Tools"),
        );
        const bar = Math.round(tools.y * 2);
        const region: Rect = { x: 0, y: 0, w: 1456, h: 870 };
        // The menu bar right of Zotero's menus: its status items and clock.
        const menuBarStatus: Rect = {
          x: PRIVATE.menuBarFrom,
          y: 0,
          w: region.w - PRIVATE.menuBarFrom,
          h: bar,
        };
        const below: Rect = {
          x: 0,
          y: bar,
          w: Math.round(((region.h - bar) * region.w) / region.h),
          h: region.h - bar,
        };
        await walk.zotero.json<boolean>(
          `(() => {
            for (const w of Services.wm.getEnumerator("zotero:basicViewer")) w.close();
            const w = Services.wm.getMostRecentWindow("navigator:browser");
            w.moveTo(0, ${bar});
            w.resizeTo(${region.w}, ${region.h - bar});
            return true;
          })()`,
        );
        /** A view of the region's ratio about `r`, inside `within`, `zoom`× at most. */
        const view = (r: Rect, within: Rect, zoom = 2): Rect => {
          const ratio = region.w / region.h;
          const w = Math.min(
            within.w,
            Math.max(region.w / zoom, r.w + 64, (r.h + 64) * ratio),
          );
          const h = w / ratio;
          const x = Math.min(
            Math.max(r.x + r.w / 2 - w / 2, within.x),
            within.x + within.w - w,
          );
          const y = Math.min(
            Math.max(r.y + r.h / 2 - h / 2, within.y),
            within.y + within.h - h,
          );
          return { x, y, w, h };
        };
        /** The Plugins Manager window, and its parts in screen points. */
        const manager = () =>
          walk.zotero.json<{
            window: Rect;
            gear: Rect | null;
            fromFile: Rect | null;
            card: Rect | null;
            title: string;
          } | null>(
            `(() => {
              const w = Services.wm.getMostRecentWindow("zotero:basicViewer");
              if (!w) return null;
              const inner = w.document.querySelector("browser")?.contentWindow;
              const d = inner?.document;
              const at = (el) => {
                if (!el || !el.checkVisibility()) return null;
                const r = el.getBoundingClientRect();
                return { x: inner.mozInnerScreenX + r.left, y: inner.mozInnerScreenY + r.top, w: r.width, h: r.height };
              };
              const card = d && [...d.querySelectorAll("addon-card")].find((c) => c.addon?.id === ${JSON.stringify(COMPANION_ID)});
              return {
                window: { x: w.screenX, y: w.screenY, w: w.outerWidth, h: w.outerHeight },
                gear: at(d?.querySelector('button[title="Tools for all plugins"]')),
                fromFile: at(d?.querySelector('panel-item[action="install-from-file"]')),
                card: at(card),
                title: w.document.title,
              };
            })()`,
          );
        const until = async <T>(
          what: string,
          read: () => Promise<T | null | undefined | false>,
          ms = 15000,
        ) => {
          const end = Temporal.Now.instant().epochMilliseconds + ms;
          for (;;) {
            const value = await read();
            if (value) return value;
            if (Temporal.Now.instant().epochMilliseconds > end)
              throw new Error(`timed out waiting for ${what}`);
            await new Promise((r) => setTimeout(r, 150));
          }
        };
        const centre = (r: Rect) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
        /**
         * Back to the start of the Zotero part: no dialog or menu, no Plugins
         * Manager, no Companion.
         */
        const resetZotero = async () => {
          await bringToFront(pid);
          await typeKeys(pid, [
            { keyCode: 53 },
            { delay: 0.4 },
            { keyCode: 53 },
            { delay: 0.4 },
          ]);
          await until(
            "the file dialog closed",
            async () =>
              !(await screenWindows()).some(
                (w) => w.pid === pid && w.layer > 0 && w.layer < 20,
              ),
          );
          await walk.zotero.json<boolean>(
            `(async () => {
              const { AddonManager } = ChromeUtils.importESModule("resource://gre/modules/AddonManager.sys.mjs");
              const addon = await AddonManager.getAddonByID(${JSON.stringify(COMPANION_ID)});
              if (addon) await addon.uninstall();
              for (const w of Services.wm.getEnumerator("zotero:basicViewer")) w.close();
              return true;
            })()`,
          );
        };

        try {
          result = await walk.recordClip("step-3", async (shots) => {
            // Obsidian: the Companion row and its Open installation guide.
            const guide = await shots.obsidian(openGuide);
            // The guide in the clean browser: its download link.
            const file = await shots.browser(browser, async (page) => {
              const download = await browser.download((name) =>
                name.endsWith(".xpi"),
              );
              await page.eval(`(async () => {
                const p = window.docsWalkPointer;
                await p.look([document.querySelector("h1")]);
                await new Promise((r) => setTimeout(r, 600));
                const section = document.getElementById("download-the-xpi-file");
                section.scrollIntoView({ behavior: "smooth", block: "start" });
                await new Promise((r) => setTimeout(r, 1000));
                const link = [...document.querySelectorAll('a[href$=".xpi"]')].find((l) => l.checkVisibility());
                await p.look([section, link]);
                await p.point(link);
                link.click();
              })()`);
              return download.done;
            });
            // The Downloads folder holds the file alone, as the dialog shows
            // it: files Chrome fetched for itself go.
            for (const other of await readdir(DOWNLOADS))
              if (other !== file)
                await rm(join(DOWNLOADS, other), { force: true });
            if ((await readdir(DOWNLOADS)).join() !== file)
              throw new Error(`the guide downloaded ${file}`);
            // Zotero: Tools › Plugins, the gear, Install Plugin From File….
            // Obsidian, with the computer's other vaults, is hidden behind
            // Zotero meanwhile, so no window of it can come between.
            await setAppVisible("Obsidian", false);
            // The Zotero part is taken again from its start, up to three times,
            // when another app comes to the front during one of its shots.
            for (let attempt = 1; ; attempt++) {
              const mark = shots.mark();
              try {
                await bringToFront(pid);
                if (NATIVE)
                  await shots.desktop(
                    { pid, region, start: below, blur: [menuBarStatus] },
                    async (shot) => {
                      // In to the menu bar's left end, under the bar first, so no
                      // other app's menu bar item shows.
                      const menu: Rect = {
                        x: 0,
                        y: 0,
                        w: 600,
                        h: (600 * region.h) / region.w,
                      };
                      shot.frame({ ...menu, y: bar });
                      await shot.wait(700);
                      shot.frame(menu);
                      await shot.click(tools.x, tools.y);
                      await shot.wait(500);
                      const plugins = await menuPoint(pid, "Tools", "Plugins");
                      await shot.click(plugins.x, plugins.y);
                      const opened = await until(
                        "the Plugins Manager",
                        async () => {
                          const m = await manager();
                          return m?.gear && m;
                        },
                      );
                      await shot.wait(300);
                      shot.frame({ ...menu, y: bar });
                      await shot.wait(600);
                      shot.frame(view(opened.window, below, 1));
                      await shot.wait(1200);
                      const gear = centre(opened.gear!);
                      shot.frame(
                        view(
                          { x: gear.x - 300, y: gear.y - 20, w: 330, h: 220 },
                          below,
                        ),
                      );
                      await shot.click(gear.x, gear.y);
                      const fromFile = await until(
                        "Install Plugin From File…",
                        async () => (await manager())?.fromFile,
                      );
                      await shot.wait(400);
                      const at = centre(fromFile);
                      await shot.click(at.x, at.y);
                      // The dialog opens in the folder it last showed: the shot ends
                      // on the click, before it.
                      shot.end();
                    },
                  );
                else
                  await shots.desktop(
                    { pid, region, start: below, blur: [menuBarStatus] },
                    async (shot) => {
                      // Tools › Plugins, by its command.
                      await walk.zotero.json<boolean>(
                        `(() => { Services.wm.getMostRecentWindow("navigator:browser").document.getElementById("menu_addons").doCommand(); return true; })()`,
                      );
                      const opened = await until(
                        "the Plugins Manager",
                        async () => {
                          const m = await manager();
                          return m?.gear && m;
                        },
                      );
                      shot.frame(view(opened.window, below, 1));
                      await shot.wait(1200);
                    },
                  );
                // Off the clip: the file dialog goes to the Downloads folder and
                // shows its files as icons, so only that folder shows.
                if (NATIVE) {
                  await typeKeys(pid, [
                    { key: "g", modifiers: ["command", "shift"] },
                    { delay: 0.8 },
                    { text: `${DOWNLOADS}/` },
                    { delay: 0.8 },
                    { keyCode: 36 },
                    { delay: 0.8 },
                    // The path field can take a second Return; with no file
                    // selected, Open is off, so a spare Return does nothing.
                    { keyCode: 36 },
                    { delay: 0.8 },
                  ]);
                  const dialog = await until("the file dialog", async () =>
                    (await screenWindows()).find(
                      (w) => w.pid === pid && w.layer > 0 && w.layer < 20,
                    ),
                  );
                  await typeKeys(pid, [
                    { key: "1", modifiers: ["command"] },
                    { delay: 0.8 },
                  ]);
                  // The file list and the buttons under it. The sidebar (the
                  // computer's folders and user name) and the toolbar (the folder
                  // menu) stay out of the view, and are blurred too.
                  const d = dialog.bounds;
                  const sidebar: Rect = {
                    x: d.x,
                    y: d.y,
                    w: PRIVATE.dialogSidebar,
                    h: d.h,
                  };
                  const toolbar: Rect = {
                    x: d.x,
                    y: d.y,
                    w: d.w,
                    h: PRIVATE.dialogToolbar,
                  };
                  // From the file icon's left edge to the dialog's right edge,
                  // down to its bottom: the edge of the sidebar and the
                  // toolbar that come into the view stay blurred.
                  const listW = d.w - PRIVATE.dialogSidebar + 8;
                  const listH = (listW * region.h) / region.w;
                  const list: Rect = {
                    x: d.x + d.w - listW,
                    y: d.y + d.h - listH,
                    w: listW,
                    h: listH,
                  };
                  if (list.y < d.y)
                    throw new Error(
                      `the file dialog is too narrow to frame without its sidebar: ${JSON.stringify(d)}`,
                    );
                  // The dialog's shot ends on the click on Open, and blurs the
                  // sidebar and the toolbar in all of its frames.
                  await shots.desktop(
                    {
                      pid,
                      region,
                      start: list,
                      blur: [menuBarStatus, sidebar, toolbar],
                    },
                    async (shot) => {
                      await shot.wait(500);
                      await shot.click(d.x + 219, d.y + 120);
                      await shot.wait(500);
                      await shot.click(d.x + d.w - 60, d.y + d.h - 32);
                      shot.end();
                    },
                  );
                  await until(
                    "the file dialog closed",
                    async () =>
                      !(await screenWindows()).some(
                        (w) => w.pid === pid && w.layer > 0 && w.layer < 20,
                      ),
                  );
                  const listed = await until(
                    "ZotLit Companion listed",
                    async () => (await manager())?.card,
                  );
                  // macOS fades the dialog out.
                  await new Promise((r) => setTimeout(r, 400));
                  const opened = (await manager())!;
                  await shots.desktop(
                    {
                      pid,
                      region,
                      start: view(opened.window, below, 1),
                      blur: [menuBarStatus],
                    },
                    async (shot) => {
                      shot.frame(
                        view(
                          { ...listed, y: listed.y - 60, h: listed.h + 60 },
                          below,
                          1.6,
                        ),
                      );
                      const card = centre(listed);
                      await shot.move(
                        card.x + listed.w / 2 - 140,
                        card.y + listed.h / 2 + 50,
                      );
                      await shot.wait(1200);
                    },
                  );
                } else {
                  await shots.desktop(
                    { pid, region, start: below, blur: [menuBarStatus] },
                    async (shot) => {
                      await walk.zotero.json<boolean>(
                        `(async () => {
                        const { AddonManager } = ChromeUtils.importESModule("resource://gre/modules/AddonManager.sys.mjs");
                        const file = new FileUtils.File(${JSON.stringify(join(DOWNLOADS, file))});
                        const install = await AddonManager.getInstallForFile(file);
                        await install.install();
                        return true;
                      })()`,
                      );
                      const listed = await until(
                        "ZotLit Companion listed",
                        async () => (await manager())?.card,
                      );
                      const opened = (await manager())!;
                      shot.frame(view(opened.window, below, 1), { cut: true });
                      await shot.wait(500);
                      shot.frame(
                        view(
                          { ...listed, y: listed.y - 60, h: listed.h + 60 },
                          below,
                          1.6,
                        ),
                      );
                      await shot.wait(1200);
                    },
                  );
                }
                break;
              } catch (error) {
                if (!(error instanceof DesktopShotSpoiled) || attempt >= 3)
                  throw error;
                console.log(
                  "[walk] Zotero shot spoiled, again:",
                  error.message,
                );
                await shots.rollback(mark);
                await resetZotero();
              }
            }
            // Back in Obsidian.
            await setAppVisible("Obsidian", true);
            await new Promise((r) => setTimeout(r, 800));
            const back = await shots.obsidian(backInObsidian);
            return { guide, file, back };
          });
        } finally {
          // Obsidian comes back even when a shot fails.
          await setAppVisible("Obsidian", true);
        }
        if (NATIVE) {
          // The clip put the file dialog in icon view; it goes back to the
          // column view it had, a setting Zotero keeps on this computer.
          await bringToFront(pid);
          await walk.zotero.json<boolean>(
            `(() => {
              const w = Services.wm.getMostRecentWindow("navigator:browser");
              const fp = Cc["@mozilla.org/filepicker;1"].createInstance(Ci.nsIFilePicker);
              fp.init(w.browsingContext, "ZotLit", Ci.nsIFilePicker.modeOpen);
              fp.open(() => {});
              return true;
            })()`,
          );
          await until("a file dialog", async () =>
            (await screenWindows()).find(
              (w) => w.pid === pid && w.layer > 0 && w.layer < 20,
            ),
          );
          await typeKeys(pid, [
            { delay: 0.6 },
            { key: "3", modifiers: ["command"] },
            { delay: 0.6 },
            { keyCode: 53 },
          ]);
        }
        const downloaded = await readdir(DOWNLOADS);
        console.log("[walk] downloaded", JSON.stringify(downloaded));
        // The browser saved the release file the guide links to.
        if (!result.file || !downloaded.includes(result.file))
          throw new Error(`the guide downloaded ${String(result.file)}`);
      } else {
        // Without the clip: the guide button, then the Paired Run's own
        // Companion build installed from a file, offline.
        const guide = await openGuide();
        const xpi = join(root, ".scratch", "docs-walks", SLUG, "companion.xpi");
        await rm(xpi, { force: true });
        await execFileAsync("zip", ["-qr", "-X", xpi, "."], {
          cwd: companionDir,
        });
        await walk.zotero.json<boolean>(
          `(async () => {
            const { AddonManager } = ChromeUtils.importESModule("resource://gre/modules/AddonManager.sys.mjs");
            const install = await AddonManager.getInstallForFile(new FileUtils.File(${JSON.stringify(xpi)}));
            await install.install();
            return true;
          })()`,
        );
        result = { guide, back: await backInObsidian() };
      }
      console.log("[walk] companion", JSON.stringify(result));
      expect(result.guide.state).toBe("todo");
      expect(result.guide.opened).toMatch(/\/docs\/install-companion$/);
      const listed = await companion();
      console.log("[walk] Zotero lists", JSON.stringify(listed));
      expect(listed?.active).toBe(true);
      // The add-on is installed into the Fixture's Zotero profile.
      expect(listed?.file).toContain(join(".scratch", "e2e-docs-walk-fixture"));
      expect(result.back.companion).toContain(
        m.welcome_step_companion_installed(),
      );
      expect(result.back.banner).toBe(false);
      // The tree, the list and the empty card fill the whole tab.
      expect(result.back.shell).toBeGreaterThanOrEqual(result.back.tab - 2);
      expect(result.back.rows).toBe(LIBRARY_ITEMS);
      await walk.capture("step-3");
      await walk.compose("step-3");
      // The section stays closed: the setting survives a window reload, and
      // Welcome & help (?) in the tab's header brings it back and closes it.
      const after = await obRun(
        walk.vaultId,
        ({ zotlit }) =>
          zotlit.services.bridge.runSync(zotlit.services.settings.current)[
            "welcome.dismissed"
          ],
      );
      expect(after).toBe(true);
      await reloadWindow(walk.vaultId);
      await watchNotices(walk.vaultId);
      const reloaded = await obRun(
        walk.vaultId,
        async ({ app, page }, { help }) => {
          const leaf = await page.until(
            "Library View",
            () =>
              app.workspace.getLeavesOfType("zotlit-library")[0] as
                | LibraryLeaf
                | undefined,
            30000,
          );
          await app.workspace.revealLeaf(leaf);
          const el = leaf.view.contentEl;
          await page.until(
            "papers",
            () => el.querySelectorAll("[data-query-item-row]").length > 0,
            30000,
          );
          const banner = !!el.querySelector("[data-welcome-banner]");
          const action = [
            ...leaf.view.containerEl.querySelectorAll<HTMLElement>(
              ".view-action",
            ),
          ].find((a) => a.getAttribute("aria-label") === help)!;
          page.press(action, "Welcome & help");
          await page.until(
            "section back",
            () => el.querySelector("[data-welcome-banner]"),
            10000,
          );
          const steps = el.querySelectorAll("[data-welcome-step]").length;
          page.press(action, "Welcome & help");
          await page.until(
            "section closed again",
            () => !el.querySelector("[data-welcome-banner]"),
            10000,
          );
          return { banner, steps };
        },
        { help: m.library_view_help_action() },
        { timeoutMs: 90000 },
      );
      console.log("[walk] after reload", JSON.stringify(reloaded));
      expect(reloaded).toEqual({ banner: false, steps: 4 });
      await obRun(walk.vaultId, () => {
        const style = document.head.createEl("style");
        style.textContent =
          '.workspace-leaf-content[data-type="pdf"] .view-header-title-parent{display:none}';
      });
    }, 1200000);

    it("step 4: type a few words of a title into Search papers and select the paper; a card under the list with the authors, the journal, and the buttons Open PDF and Write literature note", async () => {
      const found = await walk.record("step-4", () =>
        obRun(
          walk.vaultId,
          async ({ app, page }, { search, key }) => {
            const pointer = page.scratch.docsWalkPointer;
            const leaf = app.workspace.getLeavesOfType(
              "zotlit-library",
            )[0] as LibraryLeaf;
            const el = leaf.view.contentEl;
            await leaf.view.query.settled;
            const input = el.querySelector<HTMLInputElement>(
              "[data-library-search] input",
            )!;
            const placeholder = input.placeholder;
            if (pointer) {
              await pointer.point(input, { inset: 60 });
              await pointer.type(input, search);
            } else {
              input.focus();
              input.value = search;
              input.dispatchEvent(new Event("input", { bubbles: true }));
            }
            await leaf.view.searched;
            await leaf.view.query.settled;
            const row = await page.until(
              "paper row",
              () => {
                const r = el.querySelector<HTMLElement>(
                  `[data-query-item-row="${key}"]`,
                );
                return r?.checkVisibility() && r;
              },
              10000,
            );
            await pointer?.point(row, { inset: 40 });
            page.press(row, "paper row");
            const card = await page.until(
              "Reading Card",
              () => {
                const c = el.querySelector<HTMLElement>("[data-library-card]");
                return c?.checkVisibility() && c;
              },
              10000,
            );
            await leaf.view.card.settled;
            const rect = (n: Element | null | undefined) => {
              const r = n?.getBoundingClientRect();
              return r
                ? {
                    x: Math.round(r.x),
                    y: Math.round(r.y),
                    w: Math.round(r.width),
                    h: Math.round(r.height),
                  }
                : null;
            };
            const tab = el.getBoundingClientRect();
            const shown = (b: Element) => {
              const r = b.getBoundingClientRect();
              return r.top >= tab.top && r.bottom <= tab.bottom;
            };
            const actions = [
              ...card.querySelectorAll<HTMLElement>(
                "[data-library-card-action]",
              ),
            ].filter((b) => b.checkVisibility());
            const tree = el.querySelector<HTMLElement>("[data-library-tree]");
            const list = el
              .querySelector("[data-query-item-row]")!
              .getBoundingClientRect();
            // The step ends on the card.
            await pointer?.look(card);
            return {
              placeholder,
              rows: [...el.querySelectorAll("[data-query-item-row]")].map((n) =>
                n.getAttribute("data-query-item-row"),
              ),
              title: card.querySelector("[data-library-card-title]")!
                .textContent,
              creators:
                card.querySelector("[data-library-card-creators]")
                  ?.textContent ?? "",
              venue:
                card.querySelector("[data-library-card-venue]")?.textContent ??
                "",
              buttons: actions.map((b) => ({
                action: b.dataset.libraryCardAction!,
                text: b.innerText.trim(),
                label: b.getAttribute("aria-label"),
                inView: shown(b),
              })),
              // Where the card sits by the list, at the walk's window size.
              layout: {
                window: { w: window.innerWidth, h: window.innerHeight },
                pane: rect(el),
                row: rect(el.querySelector("[data-query-item-row]")),
                card: rect(card),
                under: card.getBoundingClientRect().top >= list.bottom,
                treeShown: tree?.checkVisibility() ?? false,
                tree: rect(tree),
              },
            };
          },
          { search: SEARCH, key: PAPER.key },
          STEP,
        ),
      );
      console.log("[walk] card", JSON.stringify(found));
      expect(found.placeholder).toBe(m.library_view_search_placeholder());
      expect(found.rows).toContain(PAPER.key);
      expect(found.title).toBe(PAPER.title);
      expect(found.creators).toContain(PAPER.creators);
      expect(found.venue).toContain(PAPER.venue);
      expect(found.layout.under).toBe(true);
      // The two labelled buttons, then two icon buttons: More actions and
      // Open in the annotation view.
      expect(found.buttons.filter((b) => b.text).map((b) => b.text)).toEqual([
        m.library_view_menu_open_pdf(),
        m.library_view_menu_write_note(),
      ]);
      // They show without a scroll.
      expect(found.buttons.every((b) => b.inView)).toBe(true);
      await walk.capture("step-4");
      await walk.compose("step-4");
    });

    it("step 5: select Open PDF; the PDF in a new tab, with your highlights in their original colours", async () => {
      // Obsidian's PDF view opens a PDF at the page in its own view history
      // (`pdfjs.history` in localStorage, keyed by the PDF's fingerprint and
      // shared by every vault). The walk removes this PDF's entry, so the PDF
      // opens at page 1, as on a reader's first open.
      const pdfPath = await walk.zotero.json<string>(
        `Zotero.Items.getByLibraryAndKey(1,"DCSNDPDF").getFilePath()`,
      );
      const forgotten = await obRun(
        walk.vaultId,
        async (_, { path, lib: libUrl }) => {
          type PdfJs = {
            GlobalWorkerOptions: { workerSrc: string };
            getDocument(src: { data: Uint8Array }): {
              promise: Promise<{
                fingerprints: string[];
                destroy(): Promise<void>;
              }>;
            };
          };
          const host = window as unknown as { pdfjsLib?: PdfJs };
          // Obsidian's own pdf.js, loaded as its PDF view loads it: a module
          // script that sets `window.pdfjsLib`.
          if (!host.pdfjsLib) {
            const script = document.head.createEl("script", {
              attr: { type: "module", src: libUrl },
            });
            await new Promise((resolve, reject) => {
              script.onload = resolve;
              script.onerror = reject;
            });
          }
          const lib = host.pdfjsLib!;
          if (!lib.GlobalWorkerOptions.workerSrc)
            lib.GlobalWorkerOptions.workerSrc = "/lib/pdfjs/pdf.worker.min.mjs";
          const fs = require("node:fs") as typeof import("node:fs");
          const doc = await lib.getDocument({
            data: new Uint8Array(fs.readFileSync(path)),
          }).promise;
          const fingerprint = doc.fingerprints[0]!;
          await doc.destroy();
          const raw = localStorage.getItem("pdfjs.history");
          if (!raw) return { fingerprint, removed: 0 };
          const history = JSON.parse(raw) as {
            files: { fingerprint: string }[];
          };
          const before = history.files.length;
          history.files = history.files.filter(
            (f) => f.fingerprint !== fingerprint,
          );
          localStorage.setItem("pdfjs.history", JSON.stringify(history));
          return { fingerprint, removed: before - history.files.length };
        },
        { path: pdfPath, lib: "/lib/pdfjs/pdf.min.mjs" },
        STEP,
      );
      console.log("[walk] pdf history", JSON.stringify(forgotten));
      const opened = await walk.record("step-5", async () => {
        await obRun(
          walk.vaultId,
          async ({ app, page }) => {
            const leaf = app.workspace.getLeavesOfType(
              "zotlit-library",
            )[0] as LibraryLeaf;
            const button = leaf.view.contentEl.querySelector<HTMLElement>(
              '[data-library-card] [data-library-card-action="pdf"]',
            )!;
            await page.scratch.docsWalkPointer?.point(button);
            page.press(button, "Open PDF");
          },
          undefined,
          STEP,
        );
        const opened = await obRunUntil(
          walk.vaultId,
          ({ app }) => {
            const leaf = app.workspace.getLeavesOfType(
              "zotlit-library",
            )[0] as LibraryLeaf;
            const pdf = app.workspace.getLeavesOfType("pdf")[0];
            if (!pdf) return null;
            const marks = [
              ...pdf.view.containerEl.querySelectorAll<HTMLElement>(
                ".zt-pdf-annotation-mark",
              ),
            ];
            return {
              file: (pdf.view as FileView).file?.name ?? null,
              active: app.workspace.getMostRecentLeaf() === pdf,
              ownTab:
                pdf !== leaf && leaf.view.getViewType() === "zotlit-library",
              page:
                (pdf.view as PagePdfView).viewer?.child?.pdfViewer?.pdfViewer
                  ?.currentPageNumber ?? null,
              marks: new Set(marks.map((n) => n.dataset.zoteroAnnotationKey))
                .size,
              colours: new Set(
                // Each mark draws in its Zotero colour, as an SVG fill or stroke.
                marks.map((n) => {
                  const painted = n.matches("[fill],[stroke]")
                    ? n
                    : n.querySelector("[fill],[stroke]");
                  return (
                    painted?.getAttribute("fill") ??
                    painted?.getAttribute("stroke") ??
                    null
                  );
                }),
              ).size,
            };
          },
          undefined,
          {
            what: "the PDF and its highlights",
            ready: (value) =>
              value !== null && value.active && value.marks >= 2,
          },
        );
        // The step ends on the highlights and the sidebar that lists them.
        await obRun(walk.vaultId, async ({ app, page }) => {
          const pdf = app.workspace.getLeavesOfType("pdf")[0]!;
          await page.scratch.docsWalkPointer?.look([
            ...pdf.view.containerEl.querySelectorAll(".zt-pdf-annotation-mark"),
            ...app.workspace
              .getLeavesOfType("zotero-annotation-view")
              .flatMap((l) => [
                ...l.view.containerEl.querySelectorAll(".zt-annot-card"),
              ])
              .filter((c) => c.checkVisibility()),
          ]);
        });
        return opened!;
      });
      console.log("[walk] pdf", JSON.stringify(opened));
      expect(opened.file).toContain("Sandve");
      expect(opened.ownTab).toBe(true);
      expect(opened.page).toBe(1);
      expect(opened.marks).toBeGreaterThanOrEqual(2);
      expect(opened.colours).toBe(opened.marks);
      await walk.capture("step-5");
      await walk.compose("step-5");
    });

    it("step 6: go back to the Zotero library tab and select Write literature note; the notice Literature note created. and the note in a new tab", async () => {
      const written = await walk.record(
        "step-6",
        () =>
          obRun(
            walk.vaultId,
            async ({ app, page }, { note }) => {
              const pointer = page.scratch.docsWalkPointer;
              const leaf = app.workspace.getLeavesOfType(
                "zotlit-library",
              )[0] as LibraryLeaf;
              const card = leaf.view.contentEl.querySelector<HTMLElement>(
                "[data-library-card]",
              )!;
              const tab = (leaf as unknown as { tabHeaderEl: HTMLElement })
                .tabHeaderEl;
              await pointer?.point(tab);
              app.workspace.setActiveLeaf(leaf, { focus: true });
              await page.until(
                "library in front",
                () => card.checkVisibility(),
                5000,
              );
              const button = card.querySelector<HTMLElement>(
                '[data-library-card-action="note"]',
              )!;
              const label = button.innerText.trim();
              await pointer?.point(button);
              page.press(button, "Write literature note");
              await page.until(
                "note",
                () => app.workspace.getActiveFile()?.path === note,
                20000,
              );
              const noteLeaf = app.workspace.getMostRecentLeaf()!;
              // The annotation sidebar lists the note's highlights.
              await page.until(
                "the highlights in the annotation sidebar",
                () =>
                  app.workspace
                    .getLeavesOfType("zotero-annotation-view")
                    .some(
                      (l) =>
                        l.view.containerEl.querySelectorAll(".zt-annot-card")
                          .length > 0,
                    ),
                10000,
              );
              if (pointer) {
                // The step ends on the notice and the new note: its title,
                // its links, and its Annotations heading.
                const content = noteLeaf.view.containerEl;
                await pointer.look(
                  [
                    ...document.querySelectorAll(".notice"),
                    content.querySelector(".inline-title"),
                    [...content.querySelectorAll(".cm-line")].find(
                      (l) => l.textContent === "Annotations",
                    ),
                  ].filter((e) => e !== null && e !== undefined),
                );
              }
              return {
                label,
                active: app.workspace.getActiveFile()?.path ?? null,
                ownTab:
                  noteLeaf !== leaf &&
                  !app.workspace.getLeavesOfType("pdf").includes(noteLeaf) &&
                  leaf.view.getViewType() === "zotlit-library",
                prompt: !!document.querySelector(".prompt"),
              };
            },
            { note: NOTE },
            STEP,
          ),
        { notices: true },
      );
      expect(written).toEqual({
        label: m.library_view_menu_write_note(),
        active: NOTE,
        ownTab: true,
        prompt: false,
      });
      expect(await readNotices(walk.vaultId)).toContain(
        m.notice_created_note(),
      );
      await walk.capture("step-6", { notices: true });
      await walk.compose("step-6");
    });

    it("step 7: under the line with the Zotero and PDF links, type a heading and your own thoughts; your text above the Annotations section", async () => {
      const note = await obRunUntil(
        walk.vaultId,
        async ({ app }, { note }) => {
          const leaf = app.workspace
            .getLeavesOfType("markdown")
            .find((l) => (l.view as MarkdownView).file?.path === note) as
            | NoteLeaf
            | undefined;
          if (!leaf) return null;
          return {
            cards: leaf.view.contentEl.querySelectorAll(
              ".zt-annot-card[data-zotero-annotation-key]",
            ).length,
            body: await app.vault.read(leaf.view.file!),
          };
        },
        { note: NOTE },
        {
          what: "the new note",
          ready: (value) => value !== null && value.cards === PAPER.annotations,
        },
      );
      // The body under the Properties: the title, one line with the two
      // links (the paper in Zotero, its PDF), then the Annotations section.
      const body = note!.body.replace(/^---\n[\s\S]*?\n---\n/, "");
      const [links = "", annotations = ""] = body.split("## Annotations");
      expect(annotations).toContain("```zotquery");
      const linkLines = links
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
      expect(linkLines).toHaveLength(2);
      expect(linkLines[0]).toBe(`# ${PAPER.title}`);
      expect(linkLines[1]!.match(/\]\(/g)).toHaveLength(2);
      const typed = await walk.record("step-7", () =>
        obRun(
          walk.vaultId,
          async ({ app, page }, { note, heading, thoughts, last }) => {
            const pointer = page.scratch.docsWalkPointer;
            const leaf = app.workspace
              .getLeavesOfType("markdown")
              .find(
                (l) => (l.view as MarkdownView).file?.path === note,
              ) as NoteLeaf;
            app.workspace.setActiveLeaf(leaf, { focus: true });
            const cm = leaf.view.editor.cm;
            const doc = cm.state.doc.toString();
            // The reader puts the cursor at the end of the links line.
            const at = doc.indexOf(last) + last.length;
            const box = cm.coordsAtPos(at);
            if (pointer && box) {
              await pointer.pointAt(box.right + 6, (box.top + box.bottom) / 2);
              // Then it steps right, off the lines the typing adds below.
              await pointer.park(box.right + 40, (box.top + box.bottom) / 2);
            }
            cm.dispatch({ selection: { anchor: at } });
            const put = (text: string) =>
              cm.dispatch(cm.state.replaceSelection(text), {
                userEvent: "input.type",
              });
            // The long thought types at five times a typist's pace, so the
            // clip stays short.
            for (const [text, speed] of [
              [`\n\n${heading}\n\n`, 1],
              [thoughts, 5],
            ] as const) {
              if (pointer) await pointer.keys(text, put, { speed });
              else put(text);
            }
            await leaf.view.save();
            if (pointer) {
              // The step ends on the new text above the Annotations heading.
              const text = cm.state.doc.toString();
              const from = cm.coordsAtPos(text.indexOf(heading));
              const to = cm.coordsAtPos(text.indexOf("## Annotations"));
              const lines = cm.contentDOM.getBoundingClientRect();
              if (from && to)
                await pointer.look({
                  left: lines.left,
                  right: lines.right,
                  top: from.top,
                  bottom: to.bottom,
                });
            }
            return app.vault.read(leaf.view.file!);
          },
          {
            note: NOTE,
            heading: HEADING,
            thoughts: THOUGHTS,
            last: linkLines[1]!,
          },
          STEP,
        ),
      );
      expect(typed).toContain(`${HEADING}\n\n${THOUGHTS}`);
      expect(typed.indexOf(linkLines[1]!)).toBeLessThan(typed.indexOf(HEADING));
      expect(typed.indexOf(THOUGHTS)).toBeLessThan(
        typed.indexOf("## Annotations"),
      );
      await walk.capture("step-7");
      await walk.compose("step-7");
    });
  },
);
