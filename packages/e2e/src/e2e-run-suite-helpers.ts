import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";

import type { FixtureItem } from "@zotlit/scripts/fixture";

import {
  booksProfile,
  e2eVaultPath,
  settingsContent,
} from "./e2e-run-fixture.ts";
import { openProfilesSettings, unreadOf } from "./e2e-run-helpers.ts";
import { run } from "./e2e-run-lifecycle.ts";
import {
  pressPromptKey,
  selectItemSuggestion,
} from "./e2e-run-note-helpers.ts";
import { obEval, obEvalUntil } from "./obsidian-cli.ts";
import { PAGE } from "./page-gestures.ts";

async function wideWindow(cleanup: AsyncDisposableStack): Promise<void> {
  const size = await obEval(
    run.vaultId,
    "JSON.stringify(require('@electron/remote').getCurrentWindow().getSize())",
  );
  cleanup.defer(async () => {
    await obEval(
      run.vaultId,
      `require('@electron/remote').getCurrentWindow().setSize(...${size});true`,
    );
  });
  await obEval(
    run.vaultId,
    "app.workspace.leftSplit.collapse();app.workspace.rightSplit.collapse();require('@electron/remote').getCurrentWindow().setSize(1600,1000);true",
  );
  // The renderer lays out at the new width once its window has it and
  // both sidebars have finished collapsing.
  expect(
    await obEvalUntil(
      run.vaultId,
      "JSON.stringify([activeWindow.outerWidth,...[app.workspace.leftSplit,app.workspace.rightSplit].map(split=>Math.round(split.containerEl.getBoundingClientRect().width))])",
      { expected: "[1600,0,0]" },
    ),
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
const activeWorkbenchContent =
  "app.workspace.activeLeaf?.view?.getViewType()==='zotlit-template-workbench'?app.workspace.activeLeaf.view.contentEl:null";

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
  // A kind change replaces the value control and its options on the next render.
  const valueControl = `${kind === "collection" ? "input" : "button"}[aria-label=${JSON.stringify(run.m.workbench_filter_value())}]`;
  return obEvalUntil(
    run.vaultId,
    `(function(){${PAGE}var editor=${activeWorkbenchContent};var row=editor?.querySelectorAll('[data-condition-row]')[${row}];return String(valueOf(row?.querySelector('button[aria-label=${JSON.stringify(run.m.workbench_match_condition_kind())}]'))===${JSON.stringify(kind)}&&valueOf(row.querySelector('select[aria-label=${JSON.stringify(run.m.workbench_filter_operator())}]'))===${JSON.stringify(operator)}&&valueOf(row.querySelector('${valueControl}'))===${JSON.stringify(value)});})()`,
    { expected: "true" },
  );
}

/** Turns row `row` into a `kind` condition that is `value`. */
async function shapeCondition(
  row: number,
  kind: "item-type" | "library",
  value: string,
): Promise<void> {
  const control = (label: string) =>
    `Array.from((${activeWorkbenchContent}).querySelectorAll('[data-condition-row]'))[${row}].querySelector(':is(select,button)[aria-label=${JSON.stringify(label)}]')`;
  // A row already of `kind` keeps its value: choosing the kind it holds
  // changes nothing, as in a native select. A changed kind replaces the
  // value control with an empty one.
  expect(
    await obEval(
      run.vaultId,
      `(async()=>{${PAGE}const kind=${control(run.m.workbench_match_condition_kind())};if(valueOf(kind)===${JSON.stringify(kind)})return true;await pick(kind,${JSON.stringify(kind)},'Condition type');await until('the ${kind} value control',()=>valueOf(${control(run.m.workbench_match_condition_kind())})===${JSON.stringify(kind)}&&valueOf(${control(run.m.workbench_filter_value())})==='');return true;})()`,
    ),
  ).toBe("true");
  expect(
    await obEval(
      run.vaultId,
      `(async()=>{${PAGE}await pick(${control(run.m.workbench_filter_value())},${JSON.stringify(value)},'Value');return true;})()`,
    ),
  ).toBe("true");
  expect(await conditionReady({ row, kind, operator: "is", value })).toBe(true);
}

/** "Add condition" adds a placeholder row; it becomes a Library row. */
async function addLibraryCondition(selector: string): Promise<void> {
  await obEval(
    run.vaultId,
    `(function(){${PAGE}var editor=${activeWorkbenchContent};press(Array.from(editor.querySelectorAll('button')).find(button=>button.textContent.trim()===${JSON.stringify(run.m.workbench_match_add_condition())}),'Add condition');return true;})()`,
  );
  await shapeCondition(1, "library", selector);
}

async function openMatchEditor(): Promise<void> {
  await openProfilesSettings(run.vaultId, "settings_page_profiles");
  expect(
    await obEvalUntil(
      run.vaultId,
      `(function(){${PAGE}var settings=${settingsContent};var row=Array.from(settings.querySelectorAll('.setting-item')).find(el=>el.querySelector('.setting-item-name')?.textContent===${JSON.stringify(booksProfile.label)});var button=row&&Array.from(row.querySelectorAll('button')).find(button=>button.getAttribute('aria-label')===${JSON.stringify(run.m.settings_profile_edit())});if(!button||button.disabled)return false;press(button,'Edit profile');return true;})()`,
      { expected: "true" },
    ),
  ).toBe(true);
  expect(
    await obEvalUntil(
      run.vaultId,
      `(function(){${PAGE}var editor=${activeWorkbenchContent};var tab=Array.from(editor?.querySelectorAll('[role=tab]')??[]).find(tab=>tab.textContent.trim()===${JSON.stringify(run.m.workbench_tab_match())});press(tab,'Match tab');return String(!!editor?.querySelector('[data-part=fieldset]')&&!editor?.ownerDocument.querySelector('.modal.mod-settings'));})()`,
      { expected: "true" },
    ),
  ).toBe(true);
}

async function mainSettings() {
  // A researcher's click in the dialog focuses the main window, and a sheet
  // that click opens takes Obsidian's active window; a press moves no
  // emulated focus, so move it from a popout before the dialog opens.
  await obEval(run.vaultId, "window.focus();true");
  await expect
    .poll(
      () =>
        obEval(
          run.vaultId,
          "String(activeWindow===window&&document.hasFocus())",
        ),
      { timeout: 5000 },
    )
    .toBe("true");
  await obEval(
    run.vaultId,
    "app.vault.setConfig('settingsPopoutWindow',false);app.setting.open();app.setting.openTabById('zotlit');true",
  );
}

function clickTemplateCustomize() {
  return obEvalUntil(
    run.vaultId,
    `(function(){${PAGE}var settings=${settingsContent};var row=Array.from(settings.querySelectorAll('.setting-item')).find(el=>el.querySelector('.setting-item-name')?.textContent===${JSON.stringify(run.m.settings_profile_document_name())});var button=row&&Array.from(row.querySelectorAll('button')).find(el=>el.getAttribute('aria-label')===${JSON.stringify(run.m.settings_profile_edit())});if(!button||button.disabled)return false;press(button,'Edit template');return true;})()`,
    { expected: "true" },
  );
}

async function saveMatch(match: unknown): Promise<void> {
  expect(
    await obEvalUntil(
      run.vaultId,
      `String(JSON.stringify(app.plugins.plugins.zotlit.services.bridge.runSync(app.plugins.plugins.zotlit.services.profileService.profiles).find(p=>p.id===${JSON.stringify(booksProfile.id)})?.match.tree)===${JSON.stringify(JSON.stringify(match))})`,
      { expected: "true" },
    ),
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
    await obEvalUntil(
      run.vaultId,
      `String(JSON.stringify(app.plugins.plugins.zotlit.services.bridge.runSync(app.plugins.plugins.zotlit.services.profileService.profiles).find(p=>p.id===${JSON.stringify(profile.id)})?.match.tree)===${JSON.stringify(JSON.stringify(match))})`,
      { expected: "true" },
    ),
  ).toBe(true);
}

async function quickSwitchCreate(
  item: { title: string; key: string },
  targetVaultId = run.vaultId,
) {
  expect(
    await obEval(
      targetVaultId,
      `(async()=>{
          if(app.workspace.getLeavesOfType('zotlit-template-workbench').length){
            using resources=new DisposableStack();
            await new Promise((resolve,reject)=>{
              const ref=app.workspace.on('layout-change',()=>{
                if(!app.workspace.getLeavesOfType('zotlit-template-workbench').length&&app.workspace.activeLeaf&&app.workspace.isAttached(app.workspace.activeLeaf))resolve();
              });
              resources.defer(()=>app.workspace.offref(ref));
              const timer=setTimeout(()=>reject(new Error('Workbench detachment did not complete its layout change')),5000);
              resources.defer(()=>clearTimeout(timer));
              app.workspace.detachLeavesOfType('zotlit-template-workbench');
            });
          }
          window.focus();
          return true;
        })()`,
    ),
  ).toBe("true");
  // Native layout completion can focus a companion leaf in the popout.
  // Transfer emulated focus afterwards, before a modal chooses its document.
  await expect
    .poll(
      () =>
        obEval(
          targetVaultId,
          "String(app.workspace.getLeavesOfType('zotlit-template-workbench').length===0&&activeWindow===window&&document.hasFocus())",
        ),
      { timeout: 5000 },
    )
    .toBe("true");
  expect(
    await obEvalUntil(
      targetVaultId,
      "String(!!app.commands.commands['zotlit:note-quick-switcher'])",
      { expected: "true" },
    ),
  ).toBe(true);
  // The picker and its backdrop stay transparent until the first answer
  // settles, then show with rows, or with a loading row when that answer is
  // slow; no visible frame holds an empty list.
  expect(
    await obEval(
      targetVaultId,
      "(function(){app.commands.commands['zotlit:note-quick-switcher'].callback();var modal=Array.from(activeDocument.querySelectorAll('.modal-container')).at(-1);return activeWindow.getComputedStyle(modal).opacity==='0';})()",
    ),
  ).toBe("true");
  expect(
    await obEvalUntil(
      targetVaultId,
      "(function(){var modal=Array.from(activeDocument.querySelectorAll('.modal-container')).at(-1);return String(activeWindow.getComputedStyle(modal).opacity==='1'&&!!modal.querySelector('.prompt .suggestion-item, .prompt .suggestion-empty'));})()",
      { expected: "true" },
    ),
  ).toBe(true);
  await selectItemSuggestion(targetVaultId, item.title, item.key);
  await pressPromptKey(targetVaultId, "Enter");
}

export {
  wideWindow,
  libraryHeader,
  articlesProfile,
  bookMatch,
  activeWorkbenchContent,
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
