import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
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
      return String(
        JSON.stringify(
          (require("@electron/remote") as typeof import("@electron/remote"))
            .getCurrentWindow()
            .getSize(),
        ),
      );
    },
    undefined,
  );
  cleanup.defer(async () => {
    await obRun(
      run.vaultId,
      async (_context, { __typedArg0 }) => {
        (require("@electron/remote") as typeof import("@electron/remote"))
          .getCurrentWindow()
          .setSize(...(__typedArg0 as [number, number]));
        return String(true);
      },
      { __typedArg0: JSON.parse(size) },
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
  expect(
    await ((options: { expected: string; tries?: number }) =>
      obRunUntil(
        run.vaultId,
        async ({ app }) => {
          return String(
            JSON.stringify([
              activeWindow.outerWidth,
              ...[app.workspace.leftSplit, app.workspace.rightSplit].map(
                (split) =>
                  Math.round(
                    (
                      split as import("obsidian").WorkspaceSidedock & {
                        containerEl: HTMLElement;
                      }
                    ).containerEl.getBoundingClientRect().width,
                  ),
              ),
            ]),
          );
        },
        undefined,
        {
          ready: (value) => value === options.expected,
          tries: options.tries,
          what: "suite.ts:39",
        },
      ).then(
        () => true,
        () => false,
      ))({ expected: "[1600,0,0]" }),
  ).toBe(true);
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
    async ({ page }, { __typedArg0 }) => {
      const { press } = page;
      var editor = page.workbench()?.contentEl;
      press(
        Array.from(editor!.querySelectorAll("button")).find(
          (button) => button.textContent.trim() === __typedArg0,
        ),
        "Add condition",
      );
      return String(true);
    },
    { __typedArg0: run.m.workbench_match_add_condition() },
  );
  await shapeCondition(1, "library", selector);
}

async function openMatchEditor(): Promise<void> {
  await openProfilesSettings(run.vaultId, "settings_page_profiles");
  expect(
    await ((options: { expected: string; tries?: number }) =>
      obRunUntil(
        run.vaultId,
        async ({ app, page }, { __typedArg0, __typedArg1 }) => {
          const { press } = page;
          var settings = app.setting.containerEl;
          var row = Array.from(settings.querySelectorAll(".setting-item")).find(
            (el) =>
              el.querySelector(".setting-item-name")?.textContent ===
              __typedArg0,
          );
          var button =
            row &&
            Array.from(row.querySelectorAll("button")).find(
              (button) => button.getAttribute("aria-label") === __typedArg1,
            );
          if (!button || button.disabled) return String(false);
          press(button, "Edit profile");
          return String(true);
        },
        {
          __typedArg0: booksProfile.label,
          __typedArg1: run.m.settings_profile_edit(),
        },
        {
          ready: (value) => value === options.expected,
          tries: options.tries,
          what: "suite.ts:138",
        },
      ).then(
        () => true,
        () => false,
      ))({ expected: "true" }),
  ).toBe(true);
  expect(
    await ((options: { expected: string; tries?: number }) =>
      obRunUntil(
        run.vaultId,
        async ({ page }, { __typedArg0 }) => {
          const { press } = page;
          var editor = page.workbench()?.contentEl;
          var tab = Array.from(
            editor?.querySelectorAll<HTMLElement>("[role=tab]") ?? [],
          ).find((tab) => tab.textContent.trim() === __typedArg0);
          press(tab, "Match tab");
          return String(
            String(
              !!editor?.querySelector("[data-part=fieldset]") &&
                !editor?.ownerDocument.querySelector(".modal.mod-settings"),
            ),
          );
        },
        { __typedArg0: run.m.workbench_tab_match() },
        {
          ready: (value) => value === options.expected,
          tries: options.tries,
          what: "suite.ts:145",
        },
      ).then(
        () => true,
        () => false,
      ))({ expected: "true" }),
  ).toBe(true);
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
            return String(
              String(activeWindow === window && document.hasFocus()),
            );
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
  return ((options: { expected: string; tries?: number }) =>
    obRunUntil(
      run.vaultId,
      async ({ app, page }, { __typedArg0, __typedArg1 }) => {
        const { press } = page;
        var settings = app.setting.containerEl;
        var row = Array.from(settings.querySelectorAll(".setting-item")).find(
          (el) =>
            el.querySelector(".setting-item-name")?.textContent === __typedArg0,
        );
        var button =
          row &&
          Array.from(row.querySelectorAll("button")).find(
            (el) => el.getAttribute("aria-label") === __typedArg1,
          );
        if (!button || button.disabled) return String(false);
        press(button, "Edit template");
        return String(true);
      },
      {
        __typedArg0: run.m.settings_profile_document_name(),
        __typedArg1: run.m.settings_profile_edit(),
      },
      {
        ready: (value) => value === options.expected,
        tries: options.tries,
        what: "suite.ts:175",
      },
    ).then(
      () => true,
      () => false,
    ))({ expected: "true" });
}

async function saveMatch(match: unknown): Promise<void> {
  expect(
    await ((options: { expected: string; tries?: number }) =>
      obRunUntil(
        run.vaultId,
        async ({ zotlit }, { __typedArg0, __typedArg1 }) => {
          return String(
            String(
              JSON.stringify(
                (() => {
                  const match = zotlit.services.bridge
                    .runSync(zotlit.services.profileService.profiles)
                    .find((p) => p.id === __typedArg0)?.match;
                  return match && "tree" in match ? match.tree : undefined;
                })(),
              ) === __typedArg1,
            ),
          );
        },
        { __typedArg0: booksProfile.id, __typedArg1: JSON.stringify(match) },
        {
          ready: (value) => value === options.expected,
          tries: options.tries,
          what: "suite.ts:184",
        },
      ).then(
        () => true,
        () => false,
      ))({ expected: "true" }),
  ).toBe(true);
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
  expect(
    await ((options: { expected: string; tries?: number }) =>
      obRunUntil(
        run.vaultId,
        async ({ zotlit }, { __typedArg0, __typedArg1 }) => {
          return String(
            String(
              JSON.stringify(
                (() => {
                  const match = zotlit.services.bridge
                    .runSync(zotlit.services.profileService.profiles)
                    .find((p) => p.id === __typedArg0)?.match;
                  return match && "tree" in match ? match.tree : undefined;
                })(),
              ) === __typedArg1,
            ),
          );
        },
        { __typedArg0: profile.id, __typedArg1: JSON.stringify(match) },
        {
          ready: (value) => value === options.expected,
          tries: options.tries,
          what: "suite.ts:211",
        },
      ).then(
        () => true,
        () => false,
      ))({ expected: "true" }),
  ).toBe(true);
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
              String(
                app.workspace.getLeavesOfType("zotlit-template-workbench")
                  .length === 0 &&
                  activeWindow === window &&
                  document.hasFocus(),
              ),
            );
          },
          undefined,
        ),
      { timeout: 5000 },
    )
    .toBe("true");
  expect(
    await ((options: { expected: string; tries?: number }) =>
      obRunUntil(
        targetVaultId,
        async ({ app }) => {
          return String(
            String(!!app.commands.commands["zotlit:note-quick-switcher"]),
          );
        },
        undefined,
        {
          ready: (value) => value === options.expected,
          tries: options.tries,
          what: "suite.ts:257",
        },
      ).then(
        () => true,
        () => false,
      ))({ expected: "true" }),
  ).toBe(true);
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
  expect(
    await ((options: { expected: string; tries?: number }) =>
      obRunUntil(
        targetVaultId,
        async (_context) => {
          var modal = Array.from(
            activeDocument.querySelectorAll(".modal-container"),
          ).at(-1)!;
          return String(
            String(
              activeWindow.getComputedStyle(modal).opacity === "1" &&
                !!modal.querySelector(
                  ".prompt .suggestion-item, .prompt .suggestion-empty",
                ),
            ),
          );
        },
        undefined,
        {
          ready: (value) => value === options.expected,
          tries: options.tries,
          what: "suite.ts:273",
        },
      ).then(
        () => true,
        () => false,
      ))({ expected: "true" }),
  ).toBe(true);
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
