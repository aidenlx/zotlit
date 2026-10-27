import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { expect } from "vitest";

import type { FixtureItem } from "@zotlit/scripts/fixture";

import { booksProfile, e2eVaultPath } from "./e2e-run-fixture.ts";
import { openProfilesSettings, unreadOf } from "./e2e-run-helpers.ts";
import { run } from "./e2e-run-lifecycle.ts";
import {
  pressPromptKey,
  selectItemSuggestion,
} from "./e2e-run-note-helpers.ts";
import { obRun, obRunUntil } from "./obsidian-cli.ts";

async function wideWindow(cleanup: AsyncDisposableStack): Promise<void> {
  const size = await obRun(
    run.vaultId,
    async (_context) => {
      return JSON.stringify(
        (require("@electron/remote") as typeof import("@electron/remote"))
          .getCurrentWindow()
          .getSize(),
      );
    },
    undefined,
  );
  cleanup.defer(async () => {
    await obRun(
      run.vaultId,
      async (_context, { windowSize }) => {
        (require("@electron/remote") as typeof import("@electron/remote"))
          .getCurrentWindow()
          .setSize(...(windowSize as [number, number]));
        return String(true);
      },
      { windowSize: JSON.parse(size) },
    );
  });
  await obRun(
    run.vaultId,
    async ({ app }) => {
      app.workspace.leftSplit.collapse();
      app.workspace.rightSplit.collapse();
      (require("@electron/remote") as typeof import("@electron/remote"))
        .getCurrentWindow()
        .setSize(1600, 1000);
      return String(true);
    },
    undefined,
  );
  // The renderer lays out at the new width once its window has it and
  // both sidebars have finished collapsing.
  await obRunUntil(
    run.vaultId,
    async ({ app }) => {
      return [
        activeWindow.outerWidth,
        ...[app.workspace.leftSplit, app.workspace.rightSplit].map((split) =>
          Math.round(
            (
              split as import("obsidian").WorkspaceSidedock & {
                containerEl: HTMLElement;
              }
            ).containerEl.getBoundingClientRect().width,
          ),
        ),
      ];
    },
    undefined,
    {
      ready: (value) => isDeepStrictEqual(value, [1600, 0, 0]),
      what: "the window to reach 1600 pixels wide with both sidebars collapsed",
    },
  );
}
/**
 * The Library View heading, as {@link LIBRARY_HEADING} reads it: the
 * selection's name, then the papers it lists, "N of M" where a facet or a
 * tag leaves `shown` of them, and, where some are unread, its unread count.
 */
function libraryHeader(
  selection: string,
  items: readonly FixtureItem[],
  {
    noted,
    shown,
  }: { noted?: (item: FixtureItem) => boolean; shown?: number } = {},
): string {
  const unread = unreadOf(items, noted).length;
  const papers =
    shown === undefined
      ? run.m.library_view_heading_papers({ count: items.length })
      : run.m.library_view_heading_papers_of({
          count: shown,
          total: items.length,
        });
  return unread === 0
    ? `${selection} | ${papers}`
    : `${selection} | ${papers} · ${run.m.library_view_heading_unread({ count: unread })}`;
}
const articlesProfile = {
  id: "Ar7Kd2QpX9Mn",
  label: "Articles",
  document: "zotlit-profile.articles.md",
};
const bookMatch = { and: ['itemType == "book"', 'library == "personal"'] };

function conditionReady({
  row = 0,
  kind,
  operator,
  value,
}: {
  row?: number;
  kind: "item-type" | "library" | "collection";
  operator: string;
  value: string;
}): Promise<boolean> {
  return obRunUntil(
    run.vaultId,
    ({ page }, { row, kind, operator, value, labels }) => {
      const line = page
        .workbench()
        ?.contentEl.querySelectorAll("[data-condition-row]")[row];
      const control = (selector: string, label: string) =>
        line?.querySelector<
          HTMLButtonElement | HTMLSelectElement | HTMLInputElement
        >(`${selector}[aria-label="${CSS.escape(label)}"]`);
      return (
        page.valueOf(control("button", labels.kind)) === kind &&
        page.valueOf(control("select", labels.operator)) === operator &&
        page.valueOf(
          control(kind === "collection" ? "input" : "button", labels.value),
        ) === value
      );
    },
    {
      row,
      kind,
      operator,
      value,
      labels: {
        kind: run.m.workbench_match_condition_kind(),
        operator: run.m.workbench_filter_operator(),
        value: run.m.workbench_filter_value(),
      },
    },
    { what: "condition value" },
  ).then(
    () => true,
    () => false,
  );
}

/** Turns row `row` into a `kind` condition that is `value`. */
async function shapeCondition(
  row: number,
  kind: "item-type" | "library",
  value: string,
): Promise<void> {
  const labels = {
    kind: run.m.workbench_match_condition_kind(),
    value: run.m.workbench_filter_value(),
  };
  await obRun(
    run.vaultId,
    async ({ page }, { row, kind, labels }) => {
      const control = (label: string) =>
        page
          .workbench()!
          .contentEl.querySelectorAll("[data-condition-row]")
          [row]!.querySelector<HTMLButtonElement | HTMLSelectElement>(
            `:is(select,button)[aria-label="${CSS.escape(label)}"]`,
          );
      const type = control(labels.kind);
      if (page.valueOf(type) === kind) return;
      await page.pick(type, kind, "Condition type");
      await page.until(
        `the ${kind} value control`,
        () =>
          page.valueOf(control(labels.kind)) === kind &&
          page.valueOf(control(labels.value)) === "",
      );
    },
    { row, kind, labels },
  );
  await obRun(
    run.vaultId,
    async ({ page }, { row, value, labels }) => {
      await page.pick(
        page
          .workbench()!
          .contentEl.querySelectorAll("[data-condition-row]")
          [row]!.querySelector<HTMLButtonElement | HTMLSelectElement>(
            `:is(select,button)[aria-label="${CSS.escape(labels.value)}"]`,
          ),
        value,
        "Value",
      );
    },
    { row, value, labels },
  );
  expect(await conditionReady({ row, kind, operator: "is", value })).toBe(true);
}

/** "Add condition" adds a placeholder row; it becomes a Library row. */
async function addLibraryCondition(selector: string): Promise<void> {
  await obRun(
    run.vaultId,
    async ({ page }, { addConditionLabel }) => {
      const { press } = page;
      var editor = page.workbench()?.contentEl;
      press(
        Array.from(editor!.querySelectorAll("button")).find(
          (button) => button.textContent.trim() === addConditionLabel,
        ),
        "Add condition",
      );
      return String(true);
    },
    { addConditionLabel: run.m.workbench_match_add_condition() },
  );
  await shapeCondition(1, "library", selector);
}

async function openMatchEditor(): Promise<void> {
  await openProfilesSettings(run.vaultId, "settings_page_profiles");
  await obRunUntil(
    run.vaultId,
    async ({ app, page }, { booksProfileLabel, editButtonLabel }) => {
      const { press } = page;
      var settings = app.setting.containerEl;
      var row = Array.from(settings.querySelectorAll(".setting-item")).find(
        (el) =>
          el.querySelector(".setting-item-name")?.textContent ===
          booksProfileLabel,
      );
      var button =
        row &&
        Array.from(row.querySelectorAll("button")).find(
          (button) => button.getAttribute("aria-label") === editButtonLabel,
        );
      if (!button || button.disabled) return false;
      press(button, "Edit profile");
      return true;
    },
    {
      booksProfileLabel: booksProfile.label,
      editButtonLabel: run.m.settings_profile_edit(),
    },
    {
      what: "the Edit profile button for the books profile in the settings tab",
    },
  );
  await obRunUntil(
    run.vaultId,
    async ({ page }, { tabLabel }) => {
      const { press } = page;
      var editor = page.workbench()?.contentEl;
      var tab = Array.from(
        editor?.querySelectorAll<HTMLElement>("[role=tab]") ?? [],
      ).find((tab) => tab.textContent.trim() === tabLabel);
      press(tab, "Match tab");
      return (
        !!editor?.querySelector("[data-part=fieldset]") &&
        !editor?.ownerDocument.querySelector(".modal.mod-settings")
      );
    },
    { tabLabel: run.m.workbench_tab_match() },
    { what: "the workbench fieldset to open after pressing the match tab" },
  );
}

async function mainSettings() {
  // A researcher's click in the dialog focuses the main window, and a sheet
  // that click opens takes Obsidian's active window; a press moves no
  // emulated focus, so move it from a popout before the dialog opens.
  await obRun(
    run.vaultId,
    async (_context) => {
      window.focus();
      return String(true);
    },
    undefined,
  );
  await expect
    .poll(
      () =>
        obRun(
          run.vaultId,
          async (_context) => {
            return String(activeWindow === window && document.hasFocus());
          },
          undefined,
        ),
      { timeout: 5000 },
    )
    .toBe("true");
  await obRun(
    run.vaultId,
    async ({ app }) => {
      app.vault.setConfig("settingsPopoutWindow", false);
      app.setting.open();
      app.setting.openTabById("zotlit");
      return String(true);
    },
    undefined,
  );
}

function clickTemplateCustomize() {
  return obRunUntil(
    run.vaultId,
    async ({ app, page }, { settingName, editButtonLabel }) => {
      const { press } = page;
      var settings = app.setting.containerEl;
      var row = Array.from(settings.querySelectorAll(".setting-item")).find(
        (el) =>
          el.querySelector(".setting-item-name")?.textContent === settingName,
      );
      var button =
        row &&
        Array.from(row.querySelectorAll("button")).find(
          (el) => el.getAttribute("aria-label") === editButtonLabel,
        );
      if (!button || button.disabled) return false;
      press(button, "Edit template");
      return true;
    },
    {
      settingName: run.m.settings_profile_document_name(),
      editButtonLabel: run.m.settings_profile_edit(),
    },
    { what: "the enabled Edit button on the setting row in the settings tab" },
  ).then(
    () => true,
    () => false,
  );
}

async function saveMatch(match: unknown): Promise<void> {
  await obRunUntil(
    run.vaultId,
    async ({ zotlit }, { booksProfileId, expectedMatchJson }) => {
      return (
        JSON.stringify(
          (() => {
            const match = zotlit.services.profile.profiles.find(
              (p) => p.id === booksProfileId,
            )?.match;
            return match && "tree" in match ? match.tree : undefined;
          })(),
        ) === expectedMatchJson
      );
    },
    {
      booksProfileId: booksProfile.id,
      expectedMatchJson: JSON.stringify(match),
    },
    { what: "the Books profile match tree to equal the expected tree" },
  );
  await openProfilesSettings(run.vaultId, "settings_page_profiles");
}

/** Hand-written Match trees exercise the same document boundary as external editors. */
async function writeMatch(
  profile: { id: string; document: string },
  match: unknown,
) {
  const path = join(e2eVaultPath, "templates", profile.document);
  const source = await readFile(path, "utf-8");
  const headerEnd = source.indexOf("\n---\n", 4);
  const header = source
    .slice(0, headerEnd)
    .split("\n")
    .filter((line) => !line.startsWith("match:"))
    .join("\n");
  await writeFile(
    path,
    `${header}\nmatch: ${JSON.stringify(match)}${source.slice(headerEnd)}`,
  );
  await obRunUntil(
    run.vaultId,
    async ({ zotlit }, { profileId, expectedMatchJson }) => {
      return (
        JSON.stringify(
          (() => {
            const match = zotlit.services.profile.profiles.find(
              (p) => p.id === profileId,
            )?.match;
            return match && "tree" in match ? match.tree : undefined;
          })(),
        ) === expectedMatchJson
      );
    },
    { profileId: profile.id, expectedMatchJson: JSON.stringify(match) },
    { what: "the profile match tree to equal the expected tree" },
  );
}

async function quickSwitchCreate(
  item: { title: string; key: string },
  targetVaultId = run.vaultId,
) {
  expect(
    await obRun(
      targetVaultId,
      async ({ app }) => {
        if (app.workspace.getLeavesOfType("zotlit-template-workbench").length) {
          using resources = new DisposableStack();
          await new Promise<void>((resolve, reject) => {
            const ref = app.workspace.on("layout-change", () => {
              if (
                !app.workspace.getLeavesOfType("zotlit-template-workbench")
                  .length &&
                app.workspace.activeLeaf &&
                app.workspace.isAttached(app.workspace.activeLeaf)
              )
                resolve();
            });
            resources.defer(() => app.workspace.offref(ref));
            const timer = setTimeout(
              () =>
                reject(
                  new Error(
                    "Workbench detachment did not complete its layout change",
                  ),
                ),
              5000,
            );
            resources.defer(() => clearTimeout(timer));
            app.workspace.detachLeavesOfType("zotlit-template-workbench");
          });
        }
        window.focus();
        return String(true);
      },
      undefined,
    ),
  ).toBe("true");
  // Native layout completion can focus a companion leaf in the popout.
  // Transfer emulated focus afterwards, before a modal chooses its document.
  await expect
    .poll(
      () =>
        obRun(
          targetVaultId,
          async ({ app }) => {
            return String(
              app.workspace.getLeavesOfType("zotlit-template-workbench")
                .length === 0 &&
                activeWindow === window &&
                document.hasFocus(),
            );
          },
          undefined,
        ),
      { timeout: 5000 },
    )
    .toBe("true");
  await obRunUntil(
    targetVaultId,
    async ({ app }) => {
      return !!app.commands.commands["zotlit:note-quick-switcher"];
    },
    undefined,
    { what: "the zotlit:note-quick-switcher command to be registered" },
  );
  // The picker and its backdrop stay transparent until the first answer
  // settles, then show with rows, or with a loading row when that answer is
  // slow; no visible frame holds an empty list.
  expect(
    await obRun(
      targetVaultId,
      async ({ app }) => {
        app.commands.commands["zotlit:note-quick-switcher"]!.callback!();
        var modal = Array.from(
          activeDocument.querySelectorAll(".modal-container"),
        ).at(-1)!;
        return String(activeWindow.getComputedStyle(modal).opacity === "0");
      },
      undefined,
    ),
  ).toBe("true");
  await obRunUntil(
    targetVaultId,
    async (_context) => {
      var modal = Array.from(
        activeDocument.querySelectorAll(".modal-container"),
      ).at(-1)!;
      return (
        activeWindow.getComputedStyle(modal).opacity === "1" &&
        !!modal.querySelector(
          ".prompt .suggestion-item, .prompt .suggestion-empty",
        )
      );
    },
    undefined,
    { what: "the last modal to fade in with a prompt suggestion row" },
  );
  await selectItemSuggestion(targetVaultId, item.title, item.key);
  await pressPromptKey(targetVaultId, "Enter");
}

export {
  wideWindow,
  libraryHeader,
  articlesProfile,
  bookMatch,
  conditionReady,
  shapeCondition,
  addLibraryCondition,
  openMatchEditor,
  mainSettings,
  clickTemplateCustomize,
  saveMatch,
  writeMatch,
  quickSwitchCreate,
};
