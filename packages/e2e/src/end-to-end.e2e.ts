// The End-to-end Run suite — drives the plugin in a real desktop Obsidian
// window against the Fixture, over the official Obsidian CLI. See
// packages/e2e/AGENTS.md and packages/scripts/CONTEXT.md for vocabulary.
//
// Skips cleanly (not fails) in two cases, both decided before test collection
// by the `describe.skipIf` below, so `vitest run` exits 0 with every test
// reported as skipped rather than erroring: when no desktop Obsidian is
// reachable, and when a live Paired Zotero holds the Fixture. The second is
// not a preference — this suite's `obsidian-vault create` rebuilds the
// Fixture, which would replace `zotero.sqlite` under the process holding it
// open. src/paired-run.e2e.ts is the suite that runs in that case.

import { execFile } from "node:child_process";
import { cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  PROTOCOL_VERSION,
  PROTOCOL_VERSION_HEADER,
  SOURCE_ID_HEADER,
} from "@zotlit/protocol";
import {
  ANNOTATIONS,
  ATTACHMENTS,
  COLLECTIONS,
  findScopeCase,
  getFixtureLayout,
  getFixtureRoot,
  ITEMS,
  livePairedZotero,
  LITERATURE_NOTE_PROFILES,
  LIBRARIES,
  LIBRARY_SCOPE_SETTING_KEY,
} from "@zotlit/scripts/fixture";
import type { LibrarySelector } from "@zotlit/scripts/fixture";
import { getWorkspaceRoot } from "@zotlit/scripts/package-roots";

import {
  cli,
  cliCommand,
  obEval,
  obEvalUntil,
  waitFor,
} from "./obsidian-cli.ts";

const workspaceRoot = await getWorkspaceRoot(import.meta.dirname);
const vaultScriptPath = join(
  workspaceRoot,
  "packages",
  "scripts",
  "scripts",
  "obsidian-vault.ts",
);
// Distinct from the per-worktree dev vault (`getDevVaultDir`) and the raw
// Fixture Vault (`getFixtureLayout(...).vaultDir`) — see
// policies/scratch-artifacts.md.
const e2eVaultPath = join(workspaceRoot, "tmp", "e2e-fixture-vault");
const execFileAsync = promisify(execFile);

function runVaultScript(args: string[]) {
  return execFileAsync(process.execPath, [vaultScriptPath, ...args], {
    windowsHide: true,
  });
}

// The one My Library Fixture Item this suite renders and asserts against —
// itemID is unique across every Library, so it names the item without
// needing to filter on libraryID too (key "AAAAAAAA" repeats in library 2).
const targetItem = ITEMS.find((item) => item.itemID === 1)!;
const createTargetItem = ITEMS.find((item) => item.itemID === 2)!;
const defaultProfileTargetItem = ITEMS.find((item) => item.itemID === 6)!;
const booksProfileTargetItem = ITEMS.find((item) => item.itemID === 7)!;
const booksProfile = LITERATURE_NOTE_PROFILES[0]!;
const annotationAttachment = ATTACHMENTS.find(({ key }) => key === "RGRPDF24")!;
const annotationKeys = ANNOTATIONS.filter(
  ({ parentItemID }) => parentItemID === annotationAttachment.itemID,
).map(({ key }) => key);
const annotationKeysByPage = Map.groupBy(
  ANNOTATIONS.filter(
    ({ parentItemID }) => parentItemID === annotationAttachment.itemID,
  ),
  ({ position }) => position.pageIndex,
);

async function isObsidianReachable(): Promise<boolean> {
  const result = await runVaultScript(["status"]).catch(() => undefined);
  return result?.stdout.trim().startsWith("ready ") ?? false;
}

async function availableLoopbackPort(): Promise<number> {
  await using server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (typeof address === "string" || address === null)
    throw new Error("Loopback server did not receive a TCP port");
  return address.port;
}

const reachable = await isObsidianReachable();
// A report naming a process that has exited is not a live Paired Zotero, so a
// developer who closed one still gets this suite.
const pairedZotero = await livePairedZotero(
  getFixtureLayout(getFixtureRoot(workspaceRoot)),
).catch(() => null);
if (reachable && pairedZotero) {
  console.warn(
    `Skipping the End-to-end Run: Paired Zotero (pid ${pairedZotero.pid}) holds the Fixture, and this suite rebuilds it. Close the Paired Run to run it.`,
  );
}
const webWorkbenchEnabled = process.env.WEB_WORKBENCH_ENABLED === "true";
const settingsContent = "app.setting.containerEl";

async function openProfilesSettings(
  vaultId: string,
  pageId: "settings_page_profiles" | "settings_page_advanced",
) {
  await obEval(
    vaultId,
    "app.vault.setConfig('settingsPopoutWindow',false);app.setting.open();true",
  );
  await obEval(vaultId, "app.setting.openTabById('zotlit');true");
  await obEval(
    vaultId,
    `app.setting.navigateToSearchResult({tab:app.setting.activeTab,pagePath:[${JSON.stringify(pageId)}]});true`,
  );
}

/** Shared native editing steps; Help can be inspected after selection and before typing. */
async function changeNativeAnnotationCallout(
  vaultId: string,
  options: {
    view: string;
    vaultPath: string;
    tabLabel: string;
    beforeEdit?: () => Promise<void>;
  },
): Promise<void> {
  const { view, vaultPath, tabLabel } = options;
  expect(
    await obEvalUntil(
      vaultId,
      `(function(){const view=${view};const tab=Array.from(view?.contentEl.querySelectorAll('[role=tab]')??[]).find(element=>element.textContent.trim()===${JSON.stringify(tabLabel)});if(!tab)return false;tab.click();return true;})()`,
      { expected: "true" },
    ),
  ).toBe(true);
  const annotationEditor = `Array.from((${view})?.contentEl.querySelectorAll('.cm-content')??[]).find(element=>element.textContent.includes('[!note]'))?.cmTile?.root?.view`;
  expect(
    await obEvalUntil(
      vaultId,
      `String(!!(${annotationEditor})?.state.doc.toString().includes('[!note]'))`,
      { expected: "true" },
    ),
  ).toBe(true);
  await options.beforeEdit?.();
  const templatePath = await obEval(vaultId, `(${view}).file.path`);
  // CodeMirror's mounted view receives the same transaction as typed text.
  expect(
    await obEval(
      vaultId,
      `(function(){const editor=${annotationEditor};const from=editor.state.doc.toString().indexOf('[!note]');editor.dispatch({changes:{from,to:from+7,insert:'[!quote]'},userEvent:'input.type'});return true;})()`,
    ),
  ).toBe("true");
  expect(
    await waitFor(async () =>
      (await readFile(join(vaultPath, templatePath), "utf-8")).includes(
        "[!quote]",
      ),
    ),
  ).toBe(true);
}

describe.skipIf(!reachable || pairedZotero !== null)("End-to-end Run", () => {
  let vaultId = "";
  let booksNotePath = "";
  let m: typeof import("@obsidian-messages");
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
    kind: "item-type" | "library" | "collections";
    operator: string;
    value: string;
  }): Promise<boolean> {
    // A kind change replaces the value control and its options on the next render.
    const valueControl =
      kind === "library"
        ? '[data-part="chip-value"]'
        : `${kind === "collections" ? 'input[type="text"]' : "select"}[aria-label=${JSON.stringify(m.settings_profile_match_value())}]`;
    const valueProperty = kind === "library" ? "textContent" : "value";
    return obEvalUntil(
      vaultId,
      `(function(){var editor=${activeWorkbenchContent};var row=editor?.querySelectorAll('[data-condition-row]')[${row}];return String(row?.querySelector('select[aria-label=${JSON.stringify(m.settings_profile_match_condition_kind())}]')?.value===${JSON.stringify(kind)}&&row.querySelector('select[aria-label=${JSON.stringify(m.settings_profile_match_operator())}]')?.value===${JSON.stringify(operator)}&&row.querySelector('${valueControl}')?.${valueProperty}===${JSON.stringify(value)});})()`,
      { expected: "true" },
    );
  }

  async function addLibraryCondition(selector: string): Promise<void> {
    await obEval(
      vaultId,
      `(function(){var editor=${activeWorkbenchContent};Array.from(editor.querySelectorAll('button')).find(button=>button.textContent.trim()===${JSON.stringify(m.settings_profile_match_add_condition())}).click();return true;})()`,
    );
    expect(
      await conditionReady({
        row: 1,
        kind: "item-type",
        operator: "is",
        value: "book",
      }),
    ).toBe(true);
    await obEval(
      vaultId,
      `(function(){var row=Array.from((${activeWorkbenchContent}).querySelectorAll('[data-condition-row]')).at(-1);var kind=row.querySelector('select[aria-label=${JSON.stringify(m.settings_profile_match_condition_kind())}]');kind.value='library';kind.dispatchEvent(new Event('input',{bubbles:true}));return true;})()`,
    );
    expect(
      await conditionReady({
        row: 1,
        kind: "library",
        operator: "is",
        value: "personal",
      }),
    ).toBe(true);
    await obEval(
      vaultId,
      `(function(){var row=Array.from((${activeWorkbenchContent}).querySelectorAll('[data-condition-row]')).at(-1);var value=row.querySelector('input[aria-label=${JSON.stringify(m.settings_profile_match_value())}]');value.value=${JSON.stringify(selector)};value.dispatchEvent(new Event('input',{bubbles:true}));return value.value;})()`,
    );
    await obEval(
      vaultId,
      `(function(){var editor=${activeWorkbenchContent};var row=Array.from(editor.querySelectorAll('[data-condition-row]')).at(-1);row.querySelector('input').dispatchEvent(new editor.ownerDocument.defaultView.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));return true;})()`,
    );
  }

  async function openMatchEditor(): Promise<void> {
    await openProfilesSettings(vaultId, "settings_page_profiles");
    expect(
      await obEvalUntil(
        vaultId,
        `(function(){var settings=${settingsContent};var row=Array.from(settings.querySelectorAll('.setting-item')).find(el=>el.querySelector('.setting-item-name')?.textContent===${JSON.stringify(booksProfile.label)});var button=row&&Array.from(row.querySelectorAll('button')).find(button=>button.getAttribute('aria-label')===${JSON.stringify(m.settings_profile_edit())});if(!button||button.disabled)return false;button.click();return true;})()`,
        { expected: "true" },
      ),
    ).toBe(true);
    expect(
      await obEvalUntil(
        vaultId,
        `(function(){var editor=${activeWorkbenchContent};var tab=Array.from(editor?.querySelectorAll('[role=tab]')??[]).find(tab=>tab.textContent.trim()===${JSON.stringify(m.workbench_tab_match())});tab?.click();return String(!!editor?.querySelector('[data-part=fieldset]')&&!editor?.ownerDocument.querySelector('.modal.mod-settings'));})()`,
        { expected: "true" },
      ),
    ).toBe(true);
    await obEval(
      vaultId,
      `(function(){var editor=${activeWorkbenchContent};if(!editor.querySelector('[data-condition-row]'))Array.from(editor.querySelectorAll('button')).find(button=>button.textContent.trim()===${JSON.stringify(m.settings_profile_match_add_condition())}).click();return true;})()`,
    );
  }

  async function mainSettings() {
    await obEval(
      vaultId,
      "app.vault.setConfig('settingsPopoutWindow',false);app.setting.open();app.setting.openTabById('zotlit');true",
    );
  }

  function clickTemplateCustomize() {
    return obEvalUntil(
      vaultId,
      `(function(){var settings=${settingsContent};var row=Array.from(settings.querySelectorAll('.setting-item')).find(el=>el.querySelector('.setting-item-name')?.textContent===${JSON.stringify(m.settings_profile_document_name())});var button=row&&Array.from(row.querySelectorAll('button')).find(el=>el.getAttribute('aria-label')===${JSON.stringify(m.settings_profile_edit())});if(!button||button.disabled)return false;button.click();return true;})()`,
      { expected: "true" },
    );
  }

  async function saveMatch(match: unknown): Promise<void> {
    expect(
      await obEvalUntil(
        vaultId,
        `String(JSON.stringify(app.plugins.plugins.zotlit.services.profile.profiles.find(p=>p.id===${JSON.stringify(booksProfile.id)})?.match.tree)===${JSON.stringify(JSON.stringify(match))})`,
        { expected: "true" },
      ),
    ).toBe(true);
    await openProfilesSettings(vaultId, "settings_page_profiles");
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
        vaultId,
        `String(JSON.stringify(app.plugins.plugins.zotlit.services.profile.profiles.find(p=>p.id===${JSON.stringify(profile.id)})?.match.tree)===${JSON.stringify(JSON.stringify(match))})`,
        { expected: "true" },
      ),
    ).toBe(true);
  }

  async function quickSwitchCreate(
    item: { title: string },
    targetVaultId = vaultId,
  ) {
    await obEval(
      targetVaultId,
      "app.workspace.detachLeavesOfType('zotlit-template-workbench');true",
    );
    expect(
      await obEvalUntil(
        targetVaultId,
        "(function(){var command=app.commands.commands['zotlit:note-quick-switcher'];if(!command)return false;command.callback();return true;})()",
        { expected: "true" },
      ),
    ).toBe(true);
    expect(
      await obEvalUntil(
        targetVaultId,
        "String(!!activeDocument.querySelector('.prompt input'))",
        { expected: "true" },
      ),
    ).toBe(true);
    await obEval(
      targetVaultId,
      `(function(){var input=activeDocument.querySelector('.prompt input');input.value=${JSON.stringify(item.title)};input.dispatchEvent(new Event('input',{bubbles:true}));return true;})()`,
    );
    await selectSuggestion(targetVaultId, item.title);
    await obEval(
      targetVaultId,
      "activeDocument.querySelector('.prompt input').dispatchEvent(new activeWindow.KeyboardEvent('keydown',{key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true}));true",
    );
  }

  beforeAll(async () => {
    // The dev build generates this facade; unreachable runs never load it.
    m = await import("@obsidian-messages");
    // `create` seeds the target vault from `apps/obsidian/dist-dev`, and falls
    // back to the vault's own plugin folder only when the worktree holds no
    // dev build. Copy the bundle in first, so a run without a dev build still
    // starts from this bundle rather than from nothing.
    const pluginBundleDir = join(workspaceRoot, "apps", "obsidian", "dist-dev");
    const e2ePluginDir = join(e2eVaultPath, ".obsidian", "plugins", "zotlit");
    await mkdir(e2ePluginDir, { recursive: true });
    await cp(pluginBundleDir, e2ePluginDir, { recursive: true });

    // Rebuilds the Fixture (default Scope Case "all"), copies the Fixture
    // Vault to e2eVaultPath, registers + opens it, links its Device Overrides
    // to the Fixture profile and database, and confirms the plugin loaded.
    const created = await runVaultScript(["create", e2eVaultPath]);
    vaultId = created.stdout.trim().split("\n")[0]!.trim();
    // A menu is an OS menu, with no DOM to measure, while Obsidian's "Native
    // menus" setting stands. This vault is the suite's own and is purged in
    // `afterAll`, so the setting is turned off here rather than worked around
    // in the one test that measures a menu.
    await obEval(vaultId, "app.vault.setConfig('nativeMenus',false);true");
    const serverPort = await availableLoopbackPort();
    await obEval(
      vaultId,
      `app.plugins.plugins.zotlit.services.settings.update({'server.enabled':false,'server.port':${serverPort}});true`,
    );
    expect(
      await obEvalUntil(
        vaultId,
        `String(!app.plugins.plugins.zotlit.services.localServer.available&&app.plugins.plugins.zotlit.services.settings.current['server.port']===${serverPort})`,
        { expected: "true" },
      ),
    ).toBe(true);
    await obEval(
      vaultId,
      "app.plugins.plugins.zotlit.services.settings.update({'server.enabled':true});true",
    );
    expect(
      await obEvalUntil(
        vaultId,
        `String(app.plugins.plugins.zotlit.services.localServer.available&&app.plugins.plugins.zotlit.services.settings.current['server.port']===${serverPort})`,
        { expected: "true" },
      ),
    ).toBe(true);
  }, 180000);

  afterAll(async () => {
    // Never let teardown itself throw and mask a test failure, but log a
    // warning on a nonzero exit rather than silently swallowing it.
    try {
      await runVaultScript(["remove", e2eVaultPath, "--purge"]);
    } catch (error) {
      console.warn(
        `obsidian-vault remove --purge failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }, 120000);

  it("shows the same Fixture Annotations in both surfaces with Zotero closed", async () => {
    const layout = await obEval(
      vaultId,
      "JSON.stringify(app.workspace.getLayout())",
    );
    try {
      await obEval(
        vaultId,
        `(async()=>{const file=app.vault.getFileByPath(${JSON.stringify(annotationAttachment.path)});const leaf=app.workspace.getLeaf('tab');await leaf.openFile(file);app.workspace.setActiveLeaf(leaf,{focus:true});app.commands.executeCommandById('zotlit:open-annot-view');app.commands.executeCommandById('zotlit:annot-view-follow-active-tab');return true;})()`,
      );
      const expected = [...annotationKeys].sort();
      const readAnnotations = `(async()=>{const repository=app.plugins.plugins.zotlit.services.annotationRepository;const list=await repository.read(${JSON.stringify(annotationAttachment.key)});return JSON.stringify({source:list?.source.kind??null,keys:(list?.annotations??[]).map(({key})=>key).sort()});})()`;
      expect(
        await obEvalUntil(vaultId, readAnnotations, {
          expected: JSON.stringify({ source: "zotero-db", keys: expected }),
        }),
      ).toBe(true);
      expect(JSON.parse(await obEval(vaultId, readAnnotations))).toEqual({
        source: "zotero-db",
        keys: expected,
      });
      const visibleCards = `JSON.stringify((()=>{const annotationView=app.workspace.getLeavesOfType('zotero-annotation-view')[0]?.view;const cards=Array.from(annotationView?.containerEl.querySelectorAll('.zt-annot-card[data-zotero-annotation-key]')??[],el=>el.getAttribute('data-zotero-annotation-key')).filter(Boolean);return [...new Set(cards)].sort();})())`;
      const cardsReady = await obEvalUntil(vaultId, visibleCards, {
        expected: JSON.stringify(expected),
      });
      if (!cardsReady) {
        const state = await obEval(
          vaultId,
          `JSON.stringify((()=>{const services=app.plugins.plugins.zotlit.services;const leaves=app.workspace.getLeavesOfType('zotero-annotation-view');const active=app.workspace.getActiveFile();const full=active?app.vault.adapter.getFullPath(active.path):null;const session=active?services.pdfAnnotationEditor.sessionForPath(active.path):null;return {count:leaves.length,snapshot:leaves[0]?.view.snapshot??null,active:active?.path??null,session:session?{filePath:session.filePath,target:session.target}:null,resolution:full?services.attachmentResolver.resolve(full):null,fullPath:full,exists:full?require('fs').existsSync(full):false,profileDir:services.zoteroPref.resolvedProfileDir,dataDir:services.zoteroPref.dataDir};})())`,
        );
        throw new Error(`Annotation cards did not render: ${state}`);
      }
      expect(JSON.parse(await obEval(vaultId, visibleCards))).toEqual(expected);
      for (const [pageIndex, annotations] of annotationKeysByPage) {
        const pageKeys = annotations.map(({ key }) => key).sort();
        expect(
          await obEvalUntil(
            vaultId,
            `(function(){const pdfView=app.workspace.getLeavesOfType('pdf').find(({view})=>view.file?.path===${JSON.stringify(annotationAttachment.path)})?.view;const page=pdfView?.containerEl.querySelector('.page[data-page-number="${pageIndex + 1}"]');page?.scrollIntoView({block:'center'});const marks=Array.from(pdfView?.containerEl.querySelectorAll('.zt-pdf-annotation-mark[data-zotero-annotation-key]')??[],el=>el.getAttribute('data-zotero-annotation-key')).filter(key=>${JSON.stringify(pageKeys)}.includes(key));return JSON.stringify([...new Set(marks)].sort());})()`,
            { expected: JSON.stringify(pageKeys) },
          ),
        ).toBe(true);
      }
      expect(
        await obEval(
          vaultId,
          `(function(){const repository=app.plugins.plugins.zotlit.services.annotationRepository;const text=app.workspace.getLeavesOfType('zotero-annotation-view')[0]?.view.contentEl.textContent??'';const labels=['Zotero DB','Local API','database source'];return JSON.stringify({capability:repository.capabilityFor(${JSON.stringify(annotationAttachment.key)}),sourceLabels:labels.some(label=>text.toLowerCase().includes(label.toLowerCase()))});})()`,
        ),
      ).toBe(
        JSON.stringify({
          capability: {
            kind: "read-only",
            reason: "zotero-unavailable",
          },
          sourceLabels: false,
        }),
      );
    } finally {
      await obEval(
        vaultId,
        `(async()=>{await app.workspace.changeLayout(JSON.parse(${JSON.stringify(layout)}));return true;})()`,
      );
    }
  }, 120000);

  it("customizes a first note in a fresh vault, then explicitly updates that note", async () => {
    const annotatedItem = ITEMS.find((item) => item.itemID === 46)!;
    const freshPath = join(workspaceRoot, "tmp", "e2e-first-note-vault");
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await runVaultScript(["remove", freshPath, "--purge"]);
    });
    const created = await runVaultScript([
      "open",
      freshPath,
      "--vault-case",
      "fresh",
    ]);
    const freshId = created.stdout.trim().split("\n")[0]!.trim();
    await obEval(
      freshId,
      "app.saveLocalStorage('zotlit-profile-customization','native');true",
    );
    expect(
      await obEval(
        freshId,
        "String(app.plugins.plugins.zotlit.services.profile.profiles.length)",
      ),
    ).toBe("0");
    await quickSwitchCreate(annotatedItem, freshId);
    expect(
      await obEvalUntil(
        freshId,
        "String(!!app.workspace.getActiveFile()&&app.plugins.plugins.zotlit.services.noteIndex.getNotesByItemKey('RUGIER24').length===1)",
        { expected: "true" },
      ),
    ).toBe(true);
    const note = await indexedNote(freshId, annotatedItem.itemID);
    expect(note.path).not.toBeNull();
    const personal = "\nMy own research question stays here.\n";
    await obEval(
      freshId,
      `(async()=>{const file=app.vault.getFileByPath(${JSON.stringify(note.path)});await app.vault.append(file,${JSON.stringify(personal)});await app.workspace.getLeaf(false).openFile(file);return true;})()`,
    );
    const before = await readFile(join(freshPath, note.path!), "utf-8");
    expect(before).toContain("[!note]");
    expect(before.split("[!note]").length - 1).toBe(annotationKeys.length);
    expect(
      await obEval(
        freshId,
        "app.commands.executeCommandById('zotlit:customize-note-template')",
      ),
    ).toBe("true");
    const editor = `(function(){var leaves=app.workspace.getLeavesOfType('zotlit-template-workbench');return (leaves.find(leaf=>leaf.view.originatingNote?.path===${JSON.stringify(note.path)})??leaves[0])?.view;})()`;
    expect(
      await obEvalUntil(freshId, `String(!!(${editor})?.file)`, {
        expected: "true",
        tries: 80,
      }),
    ).toBe(true);
    expect(
      await obEval(
        freshId,
        `(function(){const view=${editor};return String(view.contentEl.textContent.includes(${JSON.stringify(m.template_workbench_shared_template({ name: "zotlit-profile.default" }))})&&view.store.getState().item?.id==='RUGIER24');})()`,
      ),
    ).toBe("true");
    await changeNativeAnnotationCallout(freshId, {
      view: editor,
      vaultPath: freshPath,
      tabLabel: m.workbench_tab_annotation(),
      beforeEdit: async () => {
        expect(
          await obEvalUntil(
            freshId,
            `(function(){const view=${editor};const help=view.contentEl.querySelector('button[aria-label=${JSON.stringify(m.workbench_help())}]');if(!help)return false;view.leaf.getContainer().focus();help.focus();return String(help===view.contentEl.ownerDocument.activeElement&&help.getAttribute('aria-expanded')==='false');})()`,
            { expected: "true" },
          ),
        ).toBe(true);
        await obEval(
          freshId,
          `(function(){const view=${editor};view.contentEl.querySelector('button[aria-label=${JSON.stringify(m.workbench_help())}]').click();return true;})()`,
        );
        expect(
          await obEvalUntil(
            freshId,
            `(function(){const view=${editor};const guide=view.contentEl.querySelector('section[aria-label=${JSON.stringify(m.workbench_annotation_help_title())}]');const source=Array.from(view.contentEl.querySelectorAll('.cm-content')).find(element=>element.textContent.includes('[!note]'));return String(!!guide&&guide.textContent.includes('[!quote]')&&guide.textContent.includes(${JSON.stringify(m.template_workbench_update_this_note())})&&guide.getBoundingClientRect().height>0&&source.getBoundingClientRect().height>0);})()`,
            { expected: "true" },
          ),
        ).toBe(true);
        await obEval(
          freshId,
          `(function(){const view=${editor};const guide=view.contentEl.querySelector('section[aria-label=${JSON.stringify(m.workbench_annotation_help_title())}]');guide.focus();guide.dispatchEvent(new view.contentEl.ownerDocument.defaultView.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));return true;})()`,
        );
        expect(
          await obEvalUntil(
            freshId,
            `(function(){const view=${editor};const help=view.contentEl.querySelector('button[aria-label=${JSON.stringify(m.workbench_help())}]');return String(help.getAttribute('aria-expanded')==='false'&&help===view.contentEl.ownerDocument.activeElement&&Array.from(view.contentEl.querySelectorAll('.cm-content')).some(element=>element.textContent.includes('[!note]')));})()`,
            { expected: "true" },
          ),
        ).toBe(true);
      },
    });
    // The linked Preview belongs to the editor's native window, which can differ from the CLI window.
    expect(
      await obEvalUntil(
        freshId,
        `(function(){const view=${editor};return String(!!view.contentEl.ownerDocument.querySelector('.callout[data-callout="quote"]'));})()`,
        { expected: "true" },
      ),
    ).toBe(true);
    expect(await readFile(join(freshPath, note.path!), "utf-8")).toBe(before);
    const other = await createFixtureNote(freshId, createTargetItem.itemID);
    expect(other.outcome).toBe("created");
    if (other.outcome !== "created")
      throw new Error("Second note was not created");
    const otherBefore = await readFile(join(freshPath, other.path), "utf-8");
    await obEval(
      freshId,
      `(async()=>{await app.workspace.getLeaf('tab').openFile(app.vault.getFileByPath(${JSON.stringify(other.path)}));app.workspace.rootSplit.focus();return true;})()`,
    );
    await obEval(
      freshId,
      `(async()=>{const view=${editor};await app.workspace.revealLeaf(view.leaf);view.leaf.getContainer().focus();return true;})()`,
    );
    expect(
      await obEvalUntil(
        freshId,
        `String(activeWindow===(${editor}).contentEl.ownerDocument.defaultView)`,
        { expected: "true" },
      ),
    ).toBe(true);
    expect(
      await obEvalUntil(
        freshId,
        `(function(){const view=${editor};const button=Array.from(view.contentEl.querySelectorAll('button')).find(button=>button.textContent.trim()===${JSON.stringify(m.template_workbench_update_this_note())});button.focus();return String(view.contentEl.ownerDocument.activeElement===button&&!button.disabled);})()`,
        { expected: "true" },
      ),
    ).toBe(true);
    await obEval(
      freshId,
      `(function(){const view=${editor};Array.from(view.contentEl.querySelectorAll('button')).find(button=>button.textContent.trim()===${JSON.stringify(m.template_workbench_update_this_note())}).click();return true;})()`,
    );
    expect(
      await obEvalUntil(freshId, `String(!(${editor}).updatingNote)`, {
        expected: "true",
      }),
    ).toBe(true);
    expect(
      await waitFor(
        async () =>
          (await readFile(join(freshPath, note.path!), "utf-8")).split(
            "[!quote]",
          ).length -
            1 ===
          annotationKeys.length,
      ),
    ).toBe(true);
    const after = await readFile(join(freshPath, note.path!), "utf-8");
    expect(noteBody(after).replace(managedRegion(after), "")).toBe(
      noteBody(before).replace(managedRegion(before), ""),
    );
    expect(after).toContain(personal);
    expect(await readFile(join(freshPath, other.path), "utf-8")).toBe(
      otherBefore,
    );
  }, 180000);

  it("keeps one Literature Note when create runs twice for one Item", async () => {
    const noteName =
      createTargetItem.literatureNoteName ?? createTargetItem.key;
    const profile = LITERATURE_NOTE_PROFILES.find(
      ({ id }) => id === createTargetItem.literatureNoteProfile,
    );
    const folder = profile?.bindings["note.literature-folder"] ?? "literatures";
    const notePath = `${folder}/${noteName}.md`;
    await cli([`vault=${vaultId}`, "delete", `path=${notePath}`]);

    const removedFromIndex = await obEvalUntil(
      vaultId,
      `String(app.plugins.plugins.zotlit.services.noteIndex.getNotesByItemKey(${JSON.stringify(createTargetItem.key)}).length)`,
      { expected: "0" },
    );
    expect(removedFromIndex).toBe(true);

    const first = await createFixtureNote(vaultId, createTargetItem.itemID);
    expect(first.outcome).toBe("created");
    if (first.outcome !== "created") {
      throw new Error("The first create did not create a Literature Note");
    }

    const indexed = await obEvalUntil(
      vaultId,
      `String(app.plugins.plugins.zotlit.services.noteIndex.getNotesByItemKey(${JSON.stringify(createTargetItem.key)}).length)`,
      { expected: "1" },
    );
    expect(indexed).toBe(true);

    const second = await createFixtureNote(vaultId, createTargetItem.itemID);
    expect(second).toEqual({
      outcome: "refused",
      diagnostic: {
        code: "literature-note-exists",
        hint: "Open the existing Literature Note instead of creating another.",
        indexedKey: createTargetItem.key,
        paths: [first.path],
      },
    });

    const oneNote = await hasOneIndexedNote(vaultId, createTargetItem.key);
    expect(oneNote).toBe(true);
  });

  it("creates through the citekey command with an explicitly chosen Profile", async () => {
    const defaultResult = await createFixtureNote(
      vaultId,
      defaultProfileTargetItem.itemID,
      "default",
    );
    expect(defaultResult.outcome).toBe("created");
    if (defaultResult.outcome !== "created") {
      throw new Error("The Default scenario did not create a Literature Note");
    }
    booksNotePath = `books/books-${booksProfileTargetItem.citationKey}.md`;
    await obEval(
      vaultId,
      `(async function(){var plugin=app.plugins.plugins.zotlit;plugin.services.settings.update({'citation.pandoc-citations':true,'citation.open-as-links':true});var file=await app.vault.create('Profile flow source.md',${JSON.stringify(`[@${booksProfileTargetItem.citationKey}]\n`)});var leaf=app.workspace.getLeaf(false);await leaf.openFile(file,{state:{mode:'source',source:true}});leaf.view.editor.setCursor({line:0,ch:5});return true;})()`,
    );
    expect(
      await obEvalUntil(
        vaultId,
        "app.commands.executeCommandById('zotlit:open-citekey')",
        { expected: "true" },
      ),
    ).toBe(true);
    // Without an explicit input the picker preselects Default; the Books
    // choice below belongs to this operation alone.
    const preselected = await selectSuggestion(
      vaultId,
      m.modal_profile_preselected(),
    );
    expect(preselected).toContain(m.settings_profile_default_name());
    expect(preselected).toContain(m.modal_profile_preselected());
    expect(preselected).not.toContain(booksProfile.label);
    await obEval(
      vaultId,
      `(function(){var input=activeDocument.querySelector('.prompt input');input.value=${JSON.stringify(booksProfile.label)};input.dispatchEvent(new Event('input',{bubbles:true}));return true;})()`,
    );
    const selected = await selectSuggestion(vaultId, booksNotePath);
    expect(selected).toContain(booksProfile.label);
    expect(selected).not.toContain(m.modal_profile_preselected());
    expect(selected).toContain(booksNotePath);
    await obEval(
      vaultId,
      "activeDocument.querySelector('.prompt input').dispatchEvent(new activeWindow.KeyboardEvent('keydown',{key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true}));true",
    );
    expect(
      await waitFor(async () =>
        (
          await readFile(join(e2eVaultPath, booksNotePath), "utf-8").catch(
            () => "",
          )
        ).includes("%%zt-managed%%"),
      ),
    ).toBe(true);
    expect(defaultResult.path.startsWith("literatures/")).toBe(true);

    const defaultContent = await readFile(
      join(e2eVaultPath, defaultResult.path),
      "utf-8",
    );
    const booksContent = await readFile(
      join(e2eVaultPath, booksNotePath),
      "utf-8",
    );
    expect(defaultContent).not.toContain("zotlit-profile:");
    expect(booksContent).toContain("zotlit-profile: Books (V1StGXR8Z5jd)");
    expect(booksContent).toContain(
      `zotlit-csl: ${booksProfile.bindings["citation.references-style"]}`,
    );
    expect(defaultContent).toContain("# ");
    expect(defaultContent).not.toContain("# Book profile:");
    expect(booksContent).toContain("# Book profile:");
    expect(booksContent).toContain("## Book details");
    expect(booksContent).toContain(
      `fixture-spread-title: ${booksProfileTargetItem.title}`,
    );
    expect(booksContent).toContain("fixture-spread-kind: journalArticle");

    expect(managedRegion(booksContent)).toContain(
      `Citation key: ${booksProfileTargetItem.citationKey}`,
    );
    expect(await hasOneIndexedNote(vaultId, defaultResult.indexedKey)).toBe(
      true,
    );
    const booksIndexedKey = await obEval(
      vaultId,
      `app.metadataCache.getFileCache(app.vault.getAbstractFileByPath(${JSON.stringify(booksNotePath)})).frontmatter['zotero-key']`,
    );
    expect(await hasOneIndexedNote(vaultId, booksIndexedKey)).toBe(true);
  });

  // Covers both the "rendered literature note" and "batch operation"
  // acceptance-criteria bullets together — a deliberate simplification, not
  // an oversight: update-all-notes is itself a batch write of Literature
  // Notes, so exercising it also exercises rendering one.
  it("renders a Literature Note via the update-all-notes batch operation", async () => {
    const noteName = targetItem.literatureNoteName ?? targetItem.key;
    const notePath = join(e2eVaultPath, "literatures", `${noteName}.md`);
    if (booksNotePath === "") {
      throw new Error("The Books Profile note was not created");
    }

    const staleFieldSeeded = await obEvalUntil(
      vaultId,
      `(async function(){var file=app.vault.getAbstractFileByPath(${JSON.stringify(booksNotePath)});if(!file||file.extension!=='md'){return 'missing';}await app.fileManager.processFrontMatter(file,function(frontmatter){frontmatter['fixture-obsolete']='stale';frontmatter['fixture-spread-title']='stale';frontmatter['fixture-spread-kind']='stale';frontmatter['fixture-manual']='mine';});return 'seeded';})()`,
      { expected: "seeded" },
    );
    expect(staleFieldSeeded).toBe(true);

    await using notices = await observeNotices(vaultId);
    const triggered = await obEvalUntil(
      vaultId,
      "app.commands.executeCommandById('zotlit:update-all-notes')",
      { expected: "true", tries: 20 },
    );
    expect(triggered).toBe(true);

    // The Fixture's My Library carries more than one Literature Note, so
    // `runBatchUpdateAll` (apps/obsidian/src/services/note-feature/update-batch.ts)
    // takes its multi-item path: a confirmation `BatchModal`, not an
    // immediate write — the same modal a person clicking the command would
    // see. Confirming it is an ordinary user action, not a bypass; the modal
    // classifies items asynchronously, so this polls for the button first.
    expect(
      await clickModalButton(vaultId, m.batch_update_confirm_button()),
    ).toBe(true);
    expect(
      await obEvalUntil(
        vaultId,
        `String(Array.from(activeDocument.querySelectorAll('.modal button')).some(button=>button.textContent.trim()===${JSON.stringify(m.batch_update_close())}))`,
        { expected: "true" },
      ),
    ).toBe(true);
    // All seeded personal notes now use Default, plus the new group note;
    // the citekey-created note is the one existing Books note. The three
    // remaining group items (8, 9, 10, 79) are created under Default, the batch's
    // fallback: the Books choice made in the citekey picker stayed with that
    // operation.
    const defaultCount =
      ITEMS.filter(({ libraryID }) => libraryID === 1).length + 1;
    const summary = await obEval(
      vaultId,
      "activeDocument.querySelector('.modal').textContent",
    );
    for (const [label, count] of [
      [m.settings_profile_default_name(), defaultCount],
      [booksProfile.label, 1],
    ] as const) {
      const updated = m.batch_profile_updated({ count, label });
      expect(summary).toContain(updated);
      expect((await notices.read()).join("\n")).toContain(updated);
    }
    const created = m.batch_profile_created({
      count: 4,
      label: m.settings_profile_default_name(),
    });
    expect(summary).toContain(created);
    expect((await notices.read()).join("\n")).toContain(created);
    expect(summary).toContain(
      m.batch_profile_group({
        group: m.batch_update_group_update({ count: 1 }),
        profile: booksProfile.label,
      }),
    );
    expect(await clickModalButton(vaultId, m.batch_update_close())).toBe(true);

    // The seed file the Fixture Vault ships already carries the title
    // heading and the `zotero-key`/`citekey` frontmatter, so polling for
    // those alone would pass even if the batch update silently no-oped.
    // `related`/`collections` frontmatter come only from a genuine re-render
    // against the Fixture's Zotero data — `targetItem` (see above) has both,
    // per the Fixture Spec (`relatedKeys: ["EEEE5555"]`, `collectionIDs: [1, 4]`).
    let content = "";
    const rendered = await waitFor(async () => {
      content = await readFile(notePath, "utf-8").catch(() => "");
      return content.includes("related:");
    }, 40);

    expect(rendered).toBe(true);
    expect(content).toContain(`zotero-key: ${targetItem.key}`);
    expect(content).toContain(`citekey: ${targetItem.citationKey}`);
    expect(content).toContain(`# ${targetItem.title}`);
    expect(content).toContain("related:");
    expect(content).toContain("collections:");

    let managedFrontmatter: ManagedFrontmatterReport | undefined;
    const managedFrontmatterApplied = await waitFor(async () => {
      const response = await obEval(
        vaultId,
        `(function(){var file=app.vault.getAbstractFileByPath(${JSON.stringify(booksNotePath)});var frontmatter=file&&app.metadataCache.getFileCache(file)?.frontmatter;return JSON.stringify({title:frontmatter?.['fixture-title'],kind:frontmatter?.['fixture-kind'],spreadTitle:frontmatter?.['fixture-spread-title'],spreadKind:frontmatter?.['fixture-spread-kind'],manual:frontmatter?.['fixture-manual'],obsolete:frontmatter?Object.prototype.hasOwnProperty.call(frontmatter,'fixture-obsolete'):false});})()`,
      ).catch(() => "");
      if (response === "") return false;
      managedFrontmatter = JSON.parse(response) as ManagedFrontmatterReport;
      return (
        managedFrontmatter.title === booksProfileTargetItem.title &&
        managedFrontmatter.kind === "reference/article" &&
        managedFrontmatter.spreadTitle === booksProfileTargetItem.title &&
        managedFrontmatter.spreadKind === "journalArticle" &&
        !managedFrontmatter.obsolete
      );
    }, 40);

    expect(managedFrontmatterApplied).toBe(true);
    expect(managedFrontmatter).toEqual({
      title: booksProfileTargetItem.title,
      kind: "reference/article",
      spreadTitle: booksProfileTargetItem.title,
      spreadKind: "journalArticle",
      manual: "mine",
      obsolete: false,
    });

    expect(await hasOneIndexedNote(vaultId, createTargetItem.key)).toBe(true);
  });

  it("creates under a document match and reports the matched Profile and path", async () => {
    const bookItem = ITEMS.find((item) => item.itemID === 61)!;
    const seededPath = `literatures/${bookItem.literatureNoteName ?? bookItem.key}.md`;
    const notePath = `books/books-${bookItem.citationKey}.md`;
    await cli([`vault=${vaultId}`, "delete", `path=${seededPath}`]);
    expect(await hasIndexedNotes(vaultId, bookItem.key, 0)).toBe(true);
    await openMatchEditor();
    expect(
      await conditionReady({
        kind: "item-type",
        operator: "is",
        value: "book",
      }),
    ).toBe(true);
    await addLibraryCondition("personal");
    await saveMatch(bookMatch);
    const description = m.settings_profile_match_status({ state: "evaluable" });
    expect(
      await obEvalUntil(
        vaultId,
        `String(Array.from((${settingsContent}).querySelectorAll('.setting-item')).some(el=>el.querySelector('.setting-item-name')?.textContent===${JSON.stringify(booksProfile.label)}&&el.querySelector('.setting-item-description')?.textContent?.includes(${JSON.stringify(description)})))`,
        { expected: "true" },
      ),
    ).toBe(true);
    await obEval(vaultId, "app.setting.close();true");
    await using notices = await observeNotices(vaultId);
    await quickSwitchCreate(bookItem);
    expect(
      await waitFor(async () =>
        (
          await readFile(join(e2eVaultPath, notePath), "utf-8").catch(() => "")
        ).includes("%%zt-managed%%"),
      ),
    ).toBe(true);
    expect(
      await obEval(
        vaultId,
        "String(!!activeDocument.querySelector('.prompt'))",
      ),
    ).toBe("false");
    expect(await notices.read()).toContain(
      m.notice_created_note_from_match({
        reason: m.profile_match_selected({ profile: booksProfile.label }),
        path: notePath,
      }),
    );
    expect(await readFile(join(e2eVaultPath, notePath), "utf-8")).toContain(
      `zotlit-profile: Books (${booksProfile.id})`,
    );
    expect(await hasOneIndexedNote(vaultId, bookItem.key)).toBe(true);

    await cli([`vault=${vaultId}`, "delete", `path=${notePath}`]);
    expect(await hasIndexedNotes(vaultId, bookItem.key, 0)).toBe(true);
    await obEval(
      vaultId,
      `(async function(){var plugin=app.plugins.plugins.zotlit;plugin.services.settings.update({'citation.pandoc-citations':true,'citation.open-as-links':true});var file=await app.vault.create('Match flow source.md',${JSON.stringify(`[@${bookItem.citationKey}]\n`)});var leaf=app.workspace.getLeaf(false);await leaf.openFile(file,{state:{mode:'source',source:true}});leaf.view.editor.setCursor({line:0,ch:5});return true;})()`,
    );
    expect(
      await obEvalUntil(
        vaultId,
        "app.commands.executeCommandById('zotlit:open-citekey')",
        { expected: "true" },
      ),
    ).toBe(true);
    expect(
      await waitFor(async () =>
        (
          await readFile(join(e2eVaultPath, notePath), "utf-8").catch(() => "")
        ).includes("%%zt-managed%%"),
      ),
    ).toBe(true);
    expect(
      await obEval(
        vaultId,
        "String(!!activeDocument.querySelector('.prompt'))",
      ),
    ).toBe("false");
    expect(await notices.read()).toContain(
      m.notice_created_note_from_match({
        reason: m.profile_match_selected({ profile: booksProfile.label }),
        path: notePath,
      }),
    );
    expect(await hasOneIndexedNote(vaultId, bookItem.key)).toBe(true);
    await cli([`vault=${vaultId}`, "delete", `path=${notePath}`]);
    expect(await hasIndexedNotes(vaultId, bookItem.key, 0)).toBe(true);
  });

  it("keeps per-Item matches in a mixed-Library batch with one unmatched-or-overlap fallback", async () => {
    const bookItem = ITEMS.find((item) => item.itemID === 61)!;
    const sharedItem = ITEMS.find((item) => item.itemID === 6)!;
    const preprintItem = ITEMS.find((item) => item.itemID === 57)!;
    const labItem = ITEMS.find((item) => item.itemID === 9)!;
    const sharedLibrary = LIBRARIES.find(
      ({ libraryID }) => libraryID === sharedItem.libraryID,
    )!;
    const labLibrary = LIBRARIES.find(
      ({ libraryID }) => libraryID === labItem.libraryID,
    )!;
    const creating = [bookItem, sharedItem, preprintItem, labItem];
    const booksProfileTargetExists =
      (await indexedNote(vaultId, booksProfileTargetItem.itemID)).path !== null;
    for (const item of creating) {
      const note = await indexedNote(vaultId, item.itemID);
      if (note.path)
        await cli([`vault=${vaultId}`, "delete", `path=${note.path}`]);
      expect(await hasIndexedNotes(vaultId, note.indexedKey, 0)).toBe(true);
    }
    const articlesSource = (
      await readFile(
        join(e2eVaultPath, "templates", booksProfile.document),
        "utf-8",
      )
    )
      .replace(`id: ${booksProfile.id}`, `id: ${articlesProfile.id}`)
      .replace("name: Books", "name: Articles")
      .replace("folder: books", "folder: articles")
      .replace("filename: 'books-", "filename: 'articles-");
    await writeFile(
      join(e2eVaultPath, "templates", articlesProfile.document),
      articlesSource,
    );
    const labMatch = `library == "group:${labLibrary.groupID}"`;
    await writeMatch(booksProfile, { or: [bookMatch, labMatch] });
    await writeMatch(articlesProfile, {
      or: [
        {
          and: [
            'itemType == "journalArticle"',
            `library == "group:${sharedLibrary.groupID}"`,
          ],
        },
        labMatch,
      ],
    });
    const server = JSON.parse(
      await obEval(
        vaultId,
        "(function(){var services=app.plugins.plugins.zotlit.services;var settings=services.settings.current;return JSON.stringify({hostname:settings['server.hostname'],port:settings['server.port'],sourceId:services.zoteroPref.sourceId});})()",
      ),
    ) as { hostname: string; port: number; sourceId: string };
    const pushed = await fetch(
      `http://${server.hostname}:${server.port}/literature-notes`,
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          [PROTOCOL_VERSION_HEADER]: String(PROTOCOL_VERSION),
          [SOURCE_ID_HEADER]: server.sourceId,
        },
        body: JSON.stringify({
          items: [...creating, booksProfileTargetItem, targetItem].map(
            ({ itemID }) => itemID,
          ),
        }),
      },
    );
    expect(pushed.status).toBe(204);
    expect(
      await obEvalUntil(
        vaultId,
        `String(Array.from(Array.from(activeDocument.querySelectorAll('.modal')).at(-1)?.querySelectorAll('button')??[]).some(button=>button.textContent.trim()===${JSON.stringify(m.batch_update_confirm_button())}))`,
        { expected: "true" },
      ),
    ).toBe(true);
    const bookPath = `books/books-${bookItem.citationKey}.md`;
    const articlesPath = `articles/articles-${sharedItem.citationKey}.md`;
    const preprintPath = `books/books-${preprintItem.citationKey}.md`;
    const labPath = `books/books-${labItem.citationKey}.md`;
    const confirmation = await obEval(
      vaultId,
      "Array.from(activeDocument.querySelectorAll('.modal')).at(-1).textContent",
    );
    for (const text of [
      bookPath,
      articlesPath,
      m.profile_match_selected({ profile: booksProfile.label }),
      m.profile_match_selected({ profile: articlesProfile.label }),
      m.profile_match_unmatched(),
      m.batch_profile_unresolved_help(),
      m.batch_profile_override_all_help(),
      m.modal_profile_problem_overlap({ profiles: "Articles, Books" }),
    ])
      expect(confirmation).toContain(text);
    for (const scope of ["unresolved", "all-new"])
      expect(
        await obEval(
          vaultId,
          `String(Array.from(activeDocument.querySelectorAll('.modal')).at(-1).querySelectorAll('[data-profile-choice-scope=${scope}]').length)`,
        ),
      ).toBe("1");
    expect(confirmation).not.toContain(m.batch_profile_recovery_help());
    await obEval(
      vaultId,
      "Array.from(activeDocument.querySelectorAll('.modal')).at(-1).querySelector('[data-profile-choice-scope=unresolved] [data-profile-choice]').click();true",
    );
    const candidate = await selectSuggestion(
      vaultId,
      `articles/articles-${preprintItem.citationKey}.md`,
    );
    expect(candidate).toContain(m.modal_profile_match_batch_candidate());
    expect(candidate).not.toContain(m.modal_profile_match_candidate());
    expect(candidate).toContain(articlesProfile.label);
    await obEval(
      vaultId,
      `(function(){var input=Array.from(activeDocument.querySelectorAll('.prompt')).at(-1).querySelector('input');input.value=${JSON.stringify(booksProfile.label)};input.dispatchEvent(new Event('input',{bubbles:true}));return true;})()`,
    );
    await selectSuggestion(vaultId, preprintPath);
    await obEval(
      vaultId,
      "Array.from(activeDocument.querySelectorAll('.prompt')).at(-1).querySelector('input').dispatchEvent(new activeWindow.KeyboardEvent('keydown',{key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true}));true",
    );
    expect(
      await obEvalUntil(
        vaultId,
        `String(Array.from(activeDocument.querySelectorAll('.modal')).at(-1)?.querySelector('[data-profile-choice-scope=unresolved] [data-profile-choice]')?.getAttribute('aria-label')===${JSON.stringify(m.batch_profile_unresolved_destination({ count: 2, label: booksProfile.label }))})`,
        { expected: "true" },
      ),
    ).toBe(true);
    const chosen = await obEval(
      vaultId,
      "Array.from(activeDocument.querySelectorAll('.modal')).at(-1).textContent",
    );
    for (const text of [
      bookPath,
      articlesPath,
      preprintPath,
      labPath,
      m.profile_match_selected({ profile: booksProfile.label }),
      m.profile_match_selected({ profile: articlesProfile.label }),
      m.batch_profile_source_chosen(),
    ])
      expect(chosen).toContain(text);
    await using notices = await observeNotices(vaultId);
    expect(
      await clickModalButton(vaultId, m.batch_update_confirm_button()),
    ).toBe(true);
    expect(
      await obEvalUntil(
        vaultId,
        `String(Array.from(Array.from(activeDocument.querySelectorAll('.modal')).at(-1)?.querySelectorAll('button')??[]).some(button=>button.textContent.trim()===${JSON.stringify(m.batch_update_close())}))`,
        { expected: "true" },
      ),
    ).toBe(true);
    const summary = await obEval(
      vaultId,
      "Array.from(activeDocument.querySelectorAll('.modal')).at(-1).textContent",
    );
    for (const text of [
      m.batch_profile_created({ count: 3, label: booksProfile.label }),
      m.batch_profile_created({
        count: booksProfileTargetExists ? 1 : 2,
        label: articlesProfile.label,
      }),
      ...(booksProfileTargetExists
        ? [m.batch_profile_updated({ count: 1, label: booksProfile.label })]
        : []),
      m.batch_profile_updated({
        count: 1,
        label: m.settings_profile_default_name(),
      }),
    ]) {
      expect(summary).toContain(text);
      expect((await notices.read()).join("\n")).toContain(text);
    }
    expect(await clickModalButton(vaultId, m.batch_update_close())).toBe(true);
    for (const [item, path, label, id] of [
      [bookItem, bookPath, booksProfile.label, booksProfile.id],
      [preprintItem, preprintPath, booksProfile.label, booksProfile.id],
      [labItem, labPath, booksProfile.label, booksProfile.id],
      [sharedItem, articlesPath, articlesProfile.label, articlesProfile.id],
    ] as const) {
      const content = await readFile(join(e2eVaultPath, path), "utf-8");
      expect(content).toContain(`zotlit-profile: ${label} (${id})`);
      const note = await indexedNote(vaultId, item.itemID);
      expect(await hasOneIndexedNote(vaultId, note.indexedKey)).toBe(true);
      await cli([`vault=${vaultId}`, "delete", `path=${path}`]);
      expect(await hasIndexedNotes(vaultId, note.indexedKey, 0)).toBe(true);
    }
    await cli([
      `vault=${vaultId}`,
      "delete",
      `path=templates/${articlesProfile.document}`,
    ]);
    expect(
      await obEvalUntil(
        vaultId,
        `String(!app.plugins.plugins.zotlit.services.profile.profiles.some(p=>p.id===${JSON.stringify(articlesProfile.id)}))`,
        { expected: "true" },
      ),
    ).toBe(true);
    await writeMatch(booksProfile, bookMatch);
  });

  it("matches a Collection path through descendants and keeps direct filing separate", async () => {
    const childItem = ITEMS.find(({ itemID }) => itemID === 11)!;
    const childCollection = COLLECTIONS.find(({ key }) => key === "PERSCHLD")!;
    const parent = COLLECTIONS.find(
      ({ collectionID }) => collectionID === childCollection.parentCollectionID,
    )!;
    expect(childItem.collectionIDs).toEqual([childCollection.collectionID]);
    const seededPath = `literatures/${childItem.literatureNoteName ?? childItem.key}.md`;
    const notePath = `books/books-${childItem.citationKey}.md`;
    await cli([`vault=${vaultId}`, "delete", `path=${seededPath}`]);
    expect(await hasIndexedNotes(vaultId, childItem.key, 0)).toBe(true);
    await writeMatch(
      booksProfile,
      `collections.within(${JSON.stringify(parent.name)})`,
    );
    await quickSwitchCreate(childItem);
    expect(
      await waitFor(async () =>
        (
          await readFile(join(e2eVaultPath, notePath), "utf-8").catch(() => "")
        ).includes("%%zt-managed%%"),
      ),
    ).toBe(true);
    expect(await readFile(join(e2eVaultPath, notePath), "utf-8")).toContain(
      `zotlit-profile: Books (${booksProfile.id})`,
    );
    await cli([`vault=${vaultId}`, "delete", `path=${notePath}`]);
    expect(await hasIndexedNotes(vaultId, childItem.key, 0)).toBe(true);
    await openMatchEditor();
    expect(
      await conditionReady({
        kind: "collections",
        operator: "within",
        value: parent.name,
      }),
    ).toBe(true);
    await obEval(
      vaultId,
      `(function(){var editor=${activeWorkbenchContent};var operator=editor.querySelector('[data-condition-row] select[aria-label=${JSON.stringify(m.settings_profile_match_operator())}]');operator.value='contains';operator.dispatchEvent(new Event('input',{bubbles:true}));return true;})()`,
    );
    expect(
      await conditionReady({
        kind: "collections",
        operator: "contains",
        value: parent.name,
      }),
    ).toBe(true);
    await saveMatch({
      and: [`collections.contains(${JSON.stringify(parent.name)})`],
    });
    await obEval(vaultId, "app.setting.close();true");
    await quickSwitchCreate(childItem);
    const fallback = await selectSuggestion(
      vaultId,
      m.modal_profile_preselected(),
    );
    expect(fallback).toContain(m.settings_profile_default_name());
    expect(fallback).toContain(`literatures/${childItem.citationKey}.md`);
    await obEval(
      vaultId,
      "activeDocument.querySelector('.prompt input').dispatchEvent(new activeWindow.KeyboardEvent('keydown',{key:'Escape',code:'Escape',keyCode:27,which:27,bubbles:true}));true",
    );
    expect(
      await obEvalUntil(
        vaultId,
        "String(!activeDocument.querySelector('.prompt'))",
        {
          expected: "true",
        },
      ),
    ).toBe(true);
    expect(await hasIndexedNotes(vaultId, childItem.key, 0)).toBe(true);
    await writeMatch(booksProfile, bookMatch);
  });

  it("deletes Books into Default and applies Default on the next update", async () => {
    const profilePath = `templates/${booksProfile.document}`;
    const profileSource = await readFile(
      join(e2eVaultPath, profilePath),
      "utf-8",
    );
    const exterior = "My discussion stays outside the managed region.";
    await obEval(
      vaultId,
      `(async function(){app.workspace.detachLeavesOfType('zotlit-template-workbench');app.vault.setConfig('trashOption','local');var file=app.vault.getAbstractFileByPath(${JSON.stringify(booksNotePath)});await app.vault.append(file,${JSON.stringify(`\n${exterior}\n`)});return true;})()`,
    );
    await openProfilesSettings(vaultId, "settings_page_profiles");
    const profileNoteCount = Number(
      await obEval(
        vaultId,
        `String(app.vault.getMarkdownFiles().filter(file=>String(app.metadataCache.getFileCache(file)?.frontmatter?.['zotlit-profile']??'').startsWith(${JSON.stringify(`${booksProfile.label} (`)})).length)`,
      ),
    );
    expect(profileNoteCount).toBeGreaterThan(0);
    const beforeMove = await readFile(
      join(e2eVaultPath, booksNotePath),
      "utf-8",
    );
    // Profile management lives in the row's More actions menu.
    expect(
      await obEvalUntil(
        vaultId,
        `(function(){var settings=${settingsContent};var row=Array.from(settings.querySelectorAll('.setting-item')).find(row=>row.querySelector('.setting-item-name')?.textContent===${JSON.stringify(booksProfile.label)});var button=row&&(Array.from(row.querySelectorAll('button')).find(button=>button.getAttribute('aria-label')===${JSON.stringify(m.workbench_more_actions())})??row.querySelector('.extra-setting-button'));if(!button)return false;button.click();return true;})()`,
        { expected: "true" },
      ),
    ).toBe(true);
    expect(
      await obEvalUntil(
        vaultId,
        `(function(){var doc=(${settingsContent}).ownerDocument;var title=Array.from(doc.querySelectorAll('.menu-item-title')).find(title=>title.textContent.trim()===${JSON.stringify(m.settings_profile_delete())});var item=title?.closest('.menu-item');if(!item)return false;item.click();return true;})()`,
        { expected: "true" },
      ),
    ).toBe(true);
    expect(
      await obEvalUntil(
        vaultId,
        `String(!!(${settingsContent}).ownerDocument.querySelector('input[name="zotlit-delete-profile-target"]:checked'))`,
        { expected: "true" },
      ),
    ).toBe(true);
    const target = await obEval(
      vaultId,
      `(${settingsContent}).ownerDocument.querySelector('input[name="zotlit-delete-profile-target"]:checked').closest('label').textContent`,
    );
    const movedPath = `literatures/${booksNotePath.slice(booksNotePath.lastIndexOf("/") + 1)}`;
    expect(target).toContain(m.settings_profile_default_name());
    expect(target).toContain(movedPath);
    expect(
      await obEval(
        vaultId,
        `(function(){var doc=(${settingsContent}).ownerDocument;var label=Array.from(doc.querySelectorAll('.modal label')).find(label=>label.textContent===${JSON.stringify(m.settings_profile_delete_move_files({ folder: "literatures/" }))});var checkbox=label?.querySelector('input[type=checkbox]');if(!checkbox||checkbox.checked)return false;checkbox.click();return checkbox.checked;})()`,
      ),
    ).toBe("true");
    const deletionDialog = await obEval(
      vaultId,
      `Array.from((${settingsContent}).ownerDocument.querySelectorAll('.modal')).at(-1).textContent`,
    );
    expect(deletionDialog).toContain(
      m.settings_profile_delete_literature_count({ count: profileNoteCount }),
    );
    expect(deletionDialog).toContain(
      m.settings_profile_delete_imported_count({ count: 0 }),
    );
    expect(deletionDialog).toContain(
      m.settings_profile_delete_move_confirm({ count: profileNoteCount }),
    );
    expect(
      await clickModalButton(
        vaultId,
        m.settings_profile_delete_move_confirm({ count: profileNoteCount }),
        `(${settingsContent}).ownerDocument`,
      ),
      deletionDialog,
    ).toBe(true);
    expect(
      await waitFor(async () =>
        readFile(join(e2eVaultPath, movedPath), "utf-8")
          .then((source) => !source.includes("zotlit-profile:"))
          .catch(() => false),
      ),
    ).toBe(true);
    const afterMove = await readFile(join(e2eVaultPath, movedPath), "utf-8");
    expect(
      await readFile(join(e2eVaultPath, booksNotePath), "utf-8").catch(
        () => null,
      ),
    ).toBeNull();
    expect(managedRegion(afterMove)).toBe(managedRegion(beforeMove));
    expect(noteBody(afterMove)).toBe(noteBody(beforeMove));
    expect(afterMove).not.toContain("zotlit-profile:");
    expect(afterMove).toContain(
      `fixture-title: ${booksProfileTargetItem.title}`,
    );
    expect(
      await waitFor(async () =>
        readFile(join(e2eVaultPath, profilePath), "utf-8")
          .then(() => false)
          .catch(() => true),
      ),
    ).toBe(true);
    const trashedPaths = await readdir(join(e2eVaultPath, ".trash"), {
      recursive: true,
    });
    const trashed = await Promise.all(
      trashedPaths
        .filter((path) => path.endsWith(".md"))
        .map((path) => readFile(join(e2eVaultPath, ".trash", path), "utf-8")),
    );
    expect(trashed).toContain(profileSource);
    await obEval(
      vaultId,
      `(async function(){app.setting.close();var file=app.vault.getAbstractFileByPath(${JSON.stringify(movedPath)});await app.fileManager.processFrontMatter(file,frontmatter=>{frontmatter.title='Not the Zotero title';});await app.workspace.getLeaf(false).openFile(file);return true;})()`,
    );
    expect(
      await obEvalUntil(
        vaultId,
        "app.commands.executeCommandById('zotlit:update-note')",
        { expected: "true" },
      ),
    ).toBe(true);
    let updated = "";
    expect(
      await waitFor(async () => {
        updated = await readFile(join(e2eVaultPath, movedPath), "utf-8");
        return (
          updated.includes(`\ntitle: ${booksProfileTargetItem.title}\n`) &&
          !managedRegion(updated).includes("## Book details")
        );
      }),
    ).toBe(true);
    expect(updated).toContain(`\ntitle: ${booksProfileTargetItem.title}\n`);
    expect(updated).toContain(`citekey: ${booksProfileTargetItem.citationKey}`);
    expect(updated).toContain("collections:");
    expect(managedRegion(updated)).toBe("%%zt-managed%%\n\n%%/zt-managed%%");
    expect(noteBody(updated).replace(managedRegion(updated), "")).toBe(
      noteBody(afterMove).replace(managedRegion(afterMove), ""),
    );
    expect(updated).toContain(exterior);

    expect(
      await obEvalUntil(
        vaultId,
        `String(!app.plugins.plugins.zotlit.services.profile.profiles.some(p=>p.id===${JSON.stringify(booksProfile.id)}))`,
        { expected: "true" },
      ),
    ).toBe(true);
    await obEval(vaultId, "app.setting.close();true");
  });

  it.skipIf(webWorkbenchEnabled)(
    "keeps desktop editing and Live Update available while web integration is off",
    async () => {
      await obEval(
        vaultId,
        "app.saveLocalStorage('zotlit-workbench-launch-approved','1');app.saveLocalStorage('zotlit-profile-customization','web');app.plugins.plugins.zotlit.services.settings.update({'server.enabled':true,'server.live-update':true,'server.workbench':true});true",
      );
      expect(
        await obEvalUntil(
          vaultId,
          "String(app.plugins.plugins.zotlit.services.localServer.effectivePort!==null)",
          { expected: "true" },
        ),
      ).toBe(true);
      const server = JSON.parse(
        await obEval(
          vaultId,
          "(function(){var services=app.plugins.plugins.zotlit.services;var settings=services.settings.current;return JSON.stringify({port:services.localServer.effectivePort,sourceId:services.zoteroPref.sourceId,workbench:settings['server.workbench']});})()",
        ),
      ) as { port: number; sourceId: string; workbench: boolean };
      expect(server.workbench).toBe(true);
      const headers = {
        [PROTOCOL_VERSION_HEADER]: String(PROTOCOL_VERSION),
        [SOURCE_ID_HEADER]: server.sourceId,
      };
      const [bridge, liveUpdate] = await Promise.all([
        fetch(`http://127.0.0.1:${server.port}/v1/profile/selected`, {
          headers: { ...headers, Origin: "https://zotlit.aidenlx.site" },
        }),
        fetch(`http://127.0.0.1:${server.port}/literature-notes`, { headers }),
      ]);
      expect(bridge.status).toBe(403);
      expect(await bridge.json()).toMatchObject({
        error: { code: "bridge-disabled" },
      });
      expect(liveUpdate.status).toBe(200);

      await openProfilesSettings(vaultId, "settings_page_advanced");
      expect(
        await obEval(
          vaultId,
          `(function(){var names=Array.from((${settingsContent}).querySelectorAll('.setting-item-name'),el=>el.textContent);return String(names.includes(${JSON.stringify(m.settings_local_server_enabled_name())})&&names.includes(${JSON.stringify(m.settings_live_updates_enabled_name())})&&!names.includes(${JSON.stringify(m.settings_local_server_workbench_name())})&&!names.includes(${JSON.stringify(m.settings_local_server_workbench_confirm_name())})&&!names.includes(${JSON.stringify(m.template_workbench_preference_name())})&&!app.commands.commands['zotlit:open-profile-web-workbench']);})()`,
        ),
      ).toBe("true");

      await mainSettings();
      expect(await clickTemplateCustomize()).toBe(true);
      expect(
        await obEvalUntil(
          vaultId,
          "String(app.workspace.activeLeaf?.view.getViewType()==='zotlit-template-workbench'&&!document.querySelector('input[name=\"zotlit-customize-destination\"]'))",
          { expected: "true" },
        ),
      ).toBe(true);
      await obEval(
        vaultId,
        "app.saveLocalStorage('zotlit-workbench-launch-approved',null);app.saveLocalStorage('zotlit-profile-customization','ask');app.plugins.plugins.zotlit.services.settings.update({'server.workbench':false});true",
      );
    },
  );

  describe.skipIf(!webWorkbenchEnabled)("Local Bridge", () => {
    let port = 0;
    let origin = "";
    let credential = "";
    let source = "";
    let revision = "";
    let defaultPath = "";

    async function request(path: string, body?: unknown) {
      return fetch(`http://127.0.0.1:${port}/v1/${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          Origin: origin,
          "Content-Type": "application/json",
          ...(credential ? { Authorization: `Bearer ${credential}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(10000),
      });
    }

    afterAll(async () => {
      if (!vaultId) return;
      await obEval(
        vaultId,
        "if(window.zotlitE2EOpen){window.open=window.zotlitE2EOpen;delete window.zotlitE2EOpen;}delete window.zotlitE2ELaunch;true",
      ).catch(() => {});
    });

    it("launches from the Template document row and exchanges its Connection code", async () => {
      defaultPath = await obEval(
        vaultId,
        "app.plugins.plugins.zotlit.services.profile.defaultDocumentPath",
      );
      await obEval(
        vaultId,
        `(async function(){var file=app.vault.getFileByPath(${JSON.stringify(defaultPath)});if(file)await app.vault.delete(file);app.saveLocalStorage('zotlit-workbench-launch-approved',null);app.saveLocalStorage('zotlit-profile-customization','ask');app.plugins.plugins.zotlit.services.settings.update({'server.enabled':false,'server.workbench':false});window.zotlitE2EOpen=window.open;window.open=url=>{window.zotlitE2ELaunch=url;return null;};return true;})()`,
      );
      await mainSettings();
      expect(await clickTemplateCustomize()).toBe(true);
      expect(
        await obEvalUntil(
          vaultId,
          `(function(){var radio=document.querySelector('input[name="zotlit-customize-destination"][value="native"]');if(!radio)return false;radio.click();var row=Array.from(document.querySelectorAll('.modal .setting-item')).find(el=>el.querySelector('.setting-item-name')?.textContent===${JSON.stringify(m.modal_workbench_launch_remember())});var toggle=row?.querySelector('.checkbox-container');if(!toggle)return false;toggle.click();return true;})()`,
          { expected: "true" },
        ),
      ).toBe(true);
      expect(
        await clickModalButton(vaultId, m.modal_workbench_launch_open()),
      ).toBe(true);
      expect(
        await obEvalUntil(
          vaultId,
          "String(app.workspace.activeLeaf?.view.getViewType()==='zotlit-template-workbench'&&app.loadLocalStorage('zotlit-profile-customization')==='native')",
          { expected: "true" },
        ),
      ).toBe(true);
      expect(
        await obEval(
          vaultId,
          `String(!!app.vault.getFileByPath(${JSON.stringify(defaultPath)})&&app.workspace.activeLeaf?.view.controller?.readOnly===false&&window.zotlitE2ELaunch===undefined&&!app.plugins.plugins.zotlit.services.settings.current['server.enabled']&&!app.plugins.plugins.zotlit.services.settings.current['server.workbench'])`,
        ),
      ).toBe("true");
      await mainSettings();
      expect(await clickTemplateCustomize()).toBe(true);
      expect(
        await obEvalUntil(
          vaultId,
          `String(app.workspace.activeLeaf?.view.getViewType()==='zotlit-template-workbench'&&!document.querySelector('input[name="zotlit-customize-destination"]'))`,
          { expected: "true" },
        ),
      ).toBe(true);
      expect(
        await obEval(
          vaultId,
          "String(window.zotlitE2ELaunch===undefined&&!app.plugins.plugins.zotlit.services.settings.current['server.enabled'])",
        ),
      ).toBe("true");
      // The web save cases start from the built-in Default again.
      await obEval(
        vaultId,
        "app.plugins.plugins.zotlit.services.profile.restoreDefault();true",
      );
      expect(
        await obEvalUntil(
          vaultId,
          `String(!app.vault.getFileByPath(${JSON.stringify(defaultPath)}))`,
          { expected: "true" },
        ),
      ).toBe(true);
      await obEval(
        vaultId,
        "app.saveLocalStorage('zotlit-profile-customization','ask');true",
      );
      await mainSettings();
      expect(await clickTemplateCustomize()).toBe(true);
      expect(
        await obEvalUntil(
          vaultId,
          `String(Array.from(document.querySelectorAll('.modal-title')).some(el=>el.textContent===${JSON.stringify(m.modal_workbench_launch_title())}))`,
          { expected: "true" },
        ),
      ).toBe(true);
      expect(
        await clickModalButton(vaultId, m.modal_workbench_launch_open()),
      ).toBe(true);
      expect(
        await obEvalUntil(
          vaultId,
          "String(typeof window.zotlitE2ELaunch==='string')",
          { expected: "true" },
        ),
      ).toBe(true);
      // Capture the browser handoff at its outer boundary. The entry action,
      // sheet, minted code, and HTTP exchange all run in the real plugin.
      let launch: URL;
      try {
        launch = new URL(await obEval(vaultId, "window.zotlitE2ELaunch"));
      } catch {
        throw new Error("The Workbench launch URL was unavailable");
      }
      origin = launch.origin;
      port = Number(
        await obEval(
          vaultId,
          "app.plugins.plugins.zotlit.services.localServer.effectivePort",
        ),
      );
      const fragment = new URLSearchParams(launch.hash.slice(1));
      expect(Number(fragment.get("port"))).toBe(port);
      expect(launch.pathname).toBe("/workbench");
      const response = await request("bootstrap/code", {
        code: fragment.get("zotlit-connect"),
      });
      expect(response.status).toBe(200);
      const grant = (await response.json()) as {
        credential: string;
        bridgeVersion: number;
        selectedProfile: { id: string };
      };
      // Assert individual non-secret fields; a failed assertion must not dump
      // a grant, Connection code, or Item Snapshot into the test report.
      expect(grant.bridgeVersion).toBe(2);
      expect(grant.selectedProfile.id).toBe("default");
      expect(
        typeof grant.credential === "string" && grant.credential.length > 0,
      ).toBe(true);
      credential = grant.credential;
      const selected = await request("profile/selected");
      expect(selected.status).toBe(200);
      const profile = (await selected.json()) as {
        source: string;
        document: { state: string };
      };
      expect(profile.document.state).toBe("built-in-absent");
      source = profile.source;
    });

    it("saves Default's document and shows the ejected settings state and Notice", async () => {
      await using notices = await observeNotices(vaultId);
      const response = await request("profile/selected/save", {
        reference: "default",
        expected: { state: "absent" },
        source,
      });
      expect(response.status).toBe(200);
      const saved = (await response.json()) as {
        state: string;
        revision: string;
      };
      expect(saved.state).toBe("saved");
      revision = saved.revision;
      expect(
        (await readFile(join(e2eVaultPath, defaultPath), "utf-8")) === source,
      ).toBe(true);
      expect(
        await waitFor(async () =>
          (await notices.read()).some(
            (text) =>
              text.includes(m.notice_workbench_profile_saved()) &&
              text.includes(m.notice_workbench_profile_saved_action()),
          ),
        ),
      ).toBe(true);
      await mainSettings();
      expect(
        await obEvalUntil(
          vaultId,
          `(function(){var row=Array.from(document.querySelectorAll('.setting-item')).find(el=>el.querySelector('.setting-item-name')?.textContent===${JSON.stringify(m.settings_profile_document_name())});return String(!!row&&row.textContent.includes('zotlit-profile.default.md')&&Array.from(row.querySelectorAll('button')).some(el=>el.getAttribute('aria-label')===${JSON.stringify(m.settings_profile_document_restore())}));})()`,
          { expected: "true" },
        ),
      ).toBe(true);
    });

    it("refuses a Save after the vault document changes", async () => {
      const changed = `${source}\n<!-- external edit -->\n`;
      await obEval(
        vaultId,
        `(async function(){await app.vault.modify(app.vault.getFileByPath(${JSON.stringify(defaultPath)}),${JSON.stringify(changed)});return true;})()`,
      );
      const response = await request("profile/selected/save", {
        reference: "default",
        expected: { state: "revision", revision },
        source,
      });
      expect(response.status).toBe(200);
      const refused = (await response.json()) as {
        state: string;
        reason: string;
      };
      expect(refused.state).toBe("refused");
      expect(refused.reason).toBe("revision-conflict");
      expect(
        (await readFile(join(e2eVaultPath, defaultPath), "utf-8")) === changed,
      ).toBe(true);
    });

    it("disconnects from the settings row and refuses the next request with 401", async () => {
      await openProfilesSettings(vaultId, "settings_page_advanced");
      expect(
        await obEvalUntil(
          vaultId,
          `(function(){var row=Array.from(document.querySelectorAll('.setting-item')).find(el=>el.querySelector('.setting-item-name')?.textContent===${JSON.stringify(m.settings_local_server_workbench_connection_name())});if(!row||!row.textContent.includes(${JSON.stringify(new URL(origin).host)}))return false;var button=Array.from(row.querySelectorAll('button')).find(el=>el.textContent===${JSON.stringify(m.settings_local_server_workbench_disconnect())});if(!button)return false;button.click();return true;})()`,
          { expected: "true" },
        ),
      ).toBe(true);
      const response = await request("profile/selected");
      expect(response.status).toBe(401);
      const refused = (await response.json()) as { error: { code: string } };
      expect(refused.error.code).toBe("session-revoked");
      expect(
        await obEvalUntil(
          vaultId,
          `String(!Array.from(document.querySelectorAll('.setting-item-name')).some(el=>el.textContent===${JSON.stringify(m.settings_local_server_workbench_connection_name())}))`,
          { expected: "true" },
        ),
      ).toBe(true);
    });

    it("keeps an unsupported Profile in Obsidian with one Notice when native is remembered", async () => {
      const javascriptProperty =
        "frontmatter:\n  - key: generated\n    js: zt.title\n    merge: replace\n";
      const javascriptSource = source.includes("frontmatter:\n")
        ? source.replace("frontmatter:\n", javascriptProperty)
        : source.replace(
            "language: liquid\n",
            `language: liquid\n${javascriptProperty}`,
          );
      for (const unsupported of [
        source.replace("language: liquid", "language: eta"),
        javascriptSource,
      ]) {
        expect(unsupported !== source).toBe(true);
        await obEval(
          vaultId,
          `(async function(){app.saveLocalStorage('zotlit-profile-customization','native');await app.vault.modify(app.vault.getFileByPath(${JSON.stringify(defaultPath)}),${JSON.stringify(unsupported)});delete window.zotlitE2ELaunch;return true;})()`,
        );
        expect(
          await obEvalUntil(
            vaultId,
            `(async function(){return String((await app.plugins.plugins.zotlit.services.profile.getSource('default'))===${JSON.stringify(unsupported)});})()`,
            { expected: "true" },
          ),
        ).toBe(true);
        await using notices = await observeNotices(vaultId);
        await mainSettings();
        expect(await clickTemplateCustomize()).toBe(true);
        expect(
          await waitFor(async () =>
            (await notices.read()).some((text) =>
              text.includes(m.notice_workbench_unsupported_profile()),
            ),
          ),
        ).toBe(true);
        expect(
          (await notices.read()).filter(
            (text) =>
              text.includes(m.notice_workbench_unsupported_profile()) ||
              text.includes(m.template_workbench_native_required()),
          ),
        ).toHaveLength(1);
        expect(
          await obEvalUntil(
            vaultId,
            `String(app.workspace.getActiveFile()?.path===${JSON.stringify(defaultPath)}&&app.workspace.activeLeaf?.view.getViewType()==='zotlit-template-workbench')`,
            { expected: "true" },
          ),
        ).toBe(true);
        expect(
          await obEval(vaultId, "String(window.zotlitE2ELaunch===undefined)"),
        ).toBe("true");
        await obEval(vaultId, "app.setting.close();true");
      }
    });
  });

  // A geometry assertion, not a DOM one: the menu this replaced put every entry
  // in the DOM inside a popup collapsed onto its own border, so counting
  // entries passed while the menu read as empty on screen.
  //
  // @see apps/obsidian/docs/adr/0044-menus-and-popovers-are-obsidians-own-primitives.md
  it("renders the Follow Mode entries inside the popup's own box", async () => {
    const trigger = `app.workspace.getLeavesOfType('zotero-annotation-view')[0]?.view.contentEl.querySelector('button[aria-label=${JSON.stringify(m.annot_view_mode_active_tab())}]')`;
    const popup =
      "app.workspace.getLeavesOfType('zotero-annotation-view')[0].view.contentEl.doc.querySelector('.menu')";

    await obEval(
      vaultId,
      "(async function(){var type='zotero-annotation-view';var leaf=app.workspace.getLeavesOfType(type)[0];if(!leaf){leaf=app.workspace.getRightLeaf(false);await leaf.setViewState({type:type,active:true});}app.workspace.revealLeaf(leaf);return true;})()",
    );
    expect(
      await obEvalUntil(vaultId, `String(!!${trigger})`, { expected: "true" }),
    ).toBe(true);
    await obEval(vaultId, `(function(){${trigger}.click();return true;})()`);
    expect(
      await obEvalUntil(vaultId, `String(!!${popup})`, { expected: "true" }),
    ).toBe(true);

    const report = JSON.parse(
      await obEval(
        vaultId,
        `(function(){var popup=${popup};var box=popup.getBoundingClientRect();var anchor=${trigger}.getBoundingClientRect();var items=Array.from(popup.querySelectorAll('.menu-item'));return JSON.stringify({labels:items.map(function(item){return item.textContent.trim();}),covered:items.filter(function(item){var rect=item.getBoundingClientRect();return rect.height>0&&rect.top>=box.top-1&&rect.bottom<=box.bottom+1;}).length,belowTriggerBy:Math.round(box.top-anchor.bottom),overlapsTriggerX:box.left<anchor.right&&box.right>anchor.left});})()`,
      ),
    ) as {
      labels: string[];
      covered: number;
      belowTriggerBy: number;
      overlapsTriggerX: boolean;
    };

    // The two modes lead, always in this order. The pin's row is followed by a
    // reason line whenever this vault has nothing to pin, so what comes after
    // them is asserted by presence rather than by position.
    expect(report.labels.slice(0, 2)).toEqual([
      m.annot_view_mode_active_tab(),
      m.annot_view_mode_zotero_reader(),
    ]);
    expect(report.labels).toContain(m.annot_view_pin_choose_item());
    // The assertion this test exists for: every entry the menu holds sits
    // inside the box the menu draws, so none is clipped out of sight.
    expect(report.covered).toBe(report.labels.length);
    // And it hangs off the button that opened it, rather than off a pointer
    // position the button never supplied. Which of the button's edges it lines
    // up with is Obsidian's call — it right-aligns a menu that would otherwise
    // overflow — so the assertion is that the two overlap at all.
    expect(report.belowTriggerBy).toBe(2);
    expect(report.overlapsTriggerX).toBe(true);

    // A second press closes it. The press is itself what dismisses an open
    // menu, so a trigger that does not check for that reopens the menu it just
    // closed and the menu never appears to shut.
    await obEval(vaultId, `(function(){${trigger}.click();return true;})()`);
    expect(
      await obEvalUntil(vaultId, `String(${popup}===null)`, {
        expected: "true",
      }),
    ).toBe(true);

    await obEval(
      vaultId,
      "(function(){var doc=app.workspace.getLeavesOfType('zotero-annotation-view')[0].view.contentEl.doc;doc.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));app.workspace.detachLeavesOfType('zotero-annotation-view');return true;})()",
    );
  });

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
      vaultId,
      "app.plugins.plugins.zotlit.services.settings.flush().then(()=>true)",
    );

    // Rewrite the e2e vault's own copy — the shared Fixture layout's vault
    // copy was already copied into the e2e vault during `create`; editing
    // that shared source afterward would have no further effect.
    const raw = await readFile(dataPath, "utf-8");
    const data = JSON.parse(raw) as Record<string, unknown>;
    data[LIBRARY_SCOPE_SETTING_KEY] = availableCase.scope;
    await writeFile(dataPath, JSON.stringify(data, null, 2));

    // An ordinary user action (the Community Plugins toggle), not a bypass —
    // it makes the plugin re-read data.json from disk.
    const toggled = await obEvalUntil(
      vaultId,
      "app.plugins.disablePlugin('zotlit').then(function () { return app.plugins.enablePlugin('zotlit'); }).then(function () { return true; })",
      { expected: "true", tries: 20 },
    );
    expect(toggled).toBe(true);

    const reloaded = await obEvalUntil(
      vaultId,
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
        const response = await cliCommand(vaultId, "zotlit:library-scope");
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
    expect(scope.mode).toBe(availableCase.scope.mode);
    if (availableCase.scope.mode === "selected") {
      expect(scope.available).toHaveLength(
        availableCase.scope.libraries.length,
      );
      expect(scope.unavailable ?? []).toHaveLength(0);
      const gotLibraryIDs = (scope.available ?? [])
        .map((entry) => entry.libraryID)
        .toSorted((a, b) => a - b);
      expect(gotLibraryIDs).toEqual(
        expectedLibraryIDs(availableCase.scope.libraries),
      );
    }
  });
});

/** The `zotlit:library-scope` reply shape this suite reads (see
 *  apps/obsidian/src/services/library-scope/cli.ts). */
interface LibraryScopeReport {
  contractVersion: number;
  ok: boolean;
  mode?: "all" | "selected";
  invalid?: boolean;
  available?: { selector: unknown; libraryID: number; name: string | null }[];
  unavailable?: unknown[];
}

describe.skipIf(!reachable || pairedZotero !== null)(
  "Fresh destination flow",
  () => {
    const vaultPath = join(workspaceRoot, "tmp", "e2e-destination-vault");
    let vaultId = "";
    let m: typeof import("@obsidian-messages");

    beforeAll(async () => {
      m = await import("@obsidian-messages");
      const pluginDir = join(vaultPath, ".obsidian", "plugins", "zotlit");
      await mkdir(pluginDir, { recursive: true });
      await cp(join(workspaceRoot, "apps", "obsidian", "dist-dev"), pluginDir, {
        recursive: true,
      });
      const created = await runVaultScript([
        "open",
        vaultPath,
        "--vault-case",
        "fresh",
      ]);
      vaultId = created.stdout.trim().split("\n")[0]!.trim();
      await obEval(
        vaultId,
        "app.plugins.plugins.zotlit.services.settings.update({'server.live-update':false});true",
      );
    }, 180000);

    afterAll(async () => {
      await runVaultScript(["remove", vaultPath, "--purge"]);
    }, 120000);

    it("creates Books from the edited Default appearance after cancelling a destination", async () => {
      const first = await createFixtureNote(vaultId, 46, "default");
      expect(first.outcome, JSON.stringify(first)).toBe("created");
      if (first.outcome !== "created")
        throw new Error("First Literature Note was not created");
      expect(first.path).toBe("literatures/rougierTenSimpleRules2014.md");
      const original = await readFile(join(vaultPath, first.path), "utf-8");
      expect(original).toContain("[!note]");
      await obEval(
        vaultId,
        `(async function(){await app.workspace.getLeaf(false).openFile(app.vault.getFileByPath(${JSON.stringify(first.path)}));return true;})()`,
      );
      expect(
        await obEvalUntil(
          vaultId,
          "app.commands.executeCommandById('zotlit:customize-note-template')",
          { expected: "true" },
        ),
      ).toBe(true);
      const defaultView =
        "app.workspace.getLeavesOfType('zotlit-template-workbench').find(leaf=>leaf.view.file?.path===app.plugins.plugins.zotlit.services.profile.defaultDocumentPath)?.view";
      await changeNativeAnnotationCallout(vaultId, {
        view: defaultView,
        vaultPath,
        tabLabel: m.workbench_tab_annotation(),
      });
      expect(await readFile(join(vaultPath, first.path), "utf-8")).toBe(
        original,
      );

      const openAdd = async () => {
        await obEval(
          vaultId,
          `(async function(){var leaf=app.workspace.getLeavesOfType('markdown').find(leaf=>leaf.view.file?.path===${JSON.stringify(first.path)});await app.workspace.revealLeaf(leaf);leaf.getContainer().focus();return true;})()`,
        );
        await openProfilesSettings(vaultId, "settings_page_profiles");
        expect(
          await obEvalUntil(
            vaultId,
            `(function(){var settings=${settingsContent};var button=Array.from(settings.querySelectorAll('[aria-label],button')).find(el=>el.getAttribute('aria-label')===${JSON.stringify(m.settings_profile_add())}||el.textContent.trim()===${JSON.stringify(m.settings_profile_add())});if(!button||button.disabled)return false;button.click();return true;})()`,
            { expected: "true" },
          ),
        ).toBe(true);
        expect(
          await obEvalUntil(
            vaultId,
            `String(Array.from(document.querySelectorAll('.modal-title')).some(el=>el.textContent===${JSON.stringify(m.settings_profile_add())}))`,
            { expected: "true" },
          ),
        ).toBe(true);
      };
      await openAdd();
      expect(await clickModalButton(vaultId, m.modal_cancel())).toBe(true);
      expect(
        await obEval(
          vaultId,
          "String(app.plugins.plugins.zotlit.services.profile.profiles.length)",
        ),
      ).toBe("0");
      expect(
        (await readdir(vaultPath, { recursive: true })).filter(
          (path) => path.includes("zotlit-profile.") && path.endsWith(".md"),
        ),
      ).toEqual(["templates/zotlit-profile.default.md"]);

      await openAdd();
      // The native label wraps each input, so keyboard focus and its accessible name share the same control.
      expect(
        await obEval(
          vaultId,
          `(function(){var modal=Array.from(document.querySelectorAll('.modal')).at(-1);var labels=Array.from(modal.querySelectorAll('label'));var name=labels.find(el=>el.textContent===${JSON.stringify(m.settings_profile_name_name())})?.querySelector('input');var folder=labels.find(el=>el.textContent===${JSON.stringify(m.settings_profile_folder_name())})?.querySelector('input');return String(!!name&&!!folder&&name.tabIndex===0&&folder.tabIndex===0&&name===name.ownerDocument.activeElement);})()`,
        ),
      ).toBe("true");
      const fill = async (name: string, folder: string) => {
        await obEval(
          vaultId,
          `(function(){var modal=Array.from(document.querySelectorAll('.modal')).at(-1);var values=${JSON.stringify([name, folder])};Array.from(modal.querySelectorAll('input')).forEach((input,i)=>{input.value=values[i];input.dispatchEvent(new Event('input',{bubbles:true}));});return true;})()`,
        );
      };
      await fill("Default", "books");
      expect(
        await obEvalUntil(
          vaultId,
          `(function(){var modal=Array.from(document.querySelectorAll('.modal')).at(-1);var status=modal?.querySelector('[role=status]');var button=Array.from(modal?.querySelectorAll('button')??[]).find(el=>el.textContent===${JSON.stringify(m.settings_profile_add())});return String(status?.textContent===${JSON.stringify(m.settings_profile_name_invalid())}&&status.getBoundingClientRect().height>0&&button?.disabled);})()`,
          { expected: "true" },
        ),
      ).toBe(true);
      await fill("Books", "books");
      expect(await clickModalButton(vaultId, m.settings_profile_add())).toBe(
        true,
      );
      expect(
        await obEvalUntil(
          vaultId,
          "String(app.plugins.plugins.zotlit.services.profile.profiles.some(p=>p.label==='Books'))",
          { expected: "true" },
        ),
      ).toBe(true);
      const books = JSON.parse(
        await obEval(
          vaultId,
          "JSON.stringify(app.plugins.plugins.zotlit.services.profile.profiles.find(p=>p.label==='Books'))",
        ),
      ) as { id: string; path: string };
      const saved = await readFile(join(vaultPath, books.path), "utf-8");
      expect(saved).toContain("[!quote]");
      expect(saved).toContain("folder: books");
      const booksView = `app.workspace.getLeavesOfType('zotlit-template-workbench').find(leaf=>leaf.view.file?.path===${JSON.stringify(books.path)})?.view`;
      expect(
        await obEvalUntil(
          vaultId,
          `(function(){var view=${booksView};return String(view?.contentEl.querySelector('[role=tab][aria-selected=true]')?.textContent.trim()===${JSON.stringify(m.workbench_tab_name_and_folder())}&&Array.from(view.contentEl.querySelectorAll('input')).some(el=>el.value==='books'));})()`,
          { expected: "true" },
        ),
      ).toBe(true);

      await obEval(
        vaultId,
        `(async function(){var leaf=app.workspace.getLeavesOfType('markdown').find(leaf=>leaf.view.file?.path===${JSON.stringify(first.path)});await app.workspace.revealLeaf(leaf);leaf.getContainer().focus();return true;})()`,
      );
      expect(
        await obEvalUntil(vaultId, "String(activeWindow===window)", {
          expected: "true",
        }),
      ).toBe(true);
      await obEval(
        vaultId,
        "app.commands.executeCommandById('zotlit:note-quick-switcher')",
      );
      expect(
        await obEvalUntil(
          vaultId,
          "String(!!activeDocument.querySelector('.prompt input'))",
          { expected: "true" },
        ),
      ).toBe(true);
      await obEval(
        vaultId,
        "(function(){var input=activeDocument.querySelector('.prompt input');input.value='Thinking, fast and slow';input.dispatchEvent(new Event('input',{bubbles:true}));return true;})()",
      );
      await selectSuggestion(vaultId, "Thinking, fast and slow");
      await obEval(
        vaultId,
        "activeDocument.querySelector('.prompt input').dispatchEvent(new activeWindow.KeyboardEvent('keydown',{key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true}));true",
      );
      const choice = await selectSuggestion(vaultId, "books/Kahneman2011.md");
      expect(choice).toContain("Books");
      expect(choice).toContain("books/Kahneman2011.md");
      await obEval(
        vaultId,
        "Array.from(activeDocument.querySelectorAll('.prompt')).at(-1).querySelector('input').dispatchEvent(new activeWindow.KeyboardEvent('keydown',{key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true}));true",
      );
      expect(
        await waitFor(async () =>
          (
            await readFile(
              join(vaultPath, "books/Kahneman2011.md"),
              "utf-8",
            ).catch(() => "")
          ).includes("Thinking, fast and slow"),
        ),
      ).toBe(true);
      const book = await readFile(
        join(vaultPath, "books/Kahneman2011.md"),
        "utf-8",
      );
      expect(book).toContain(`zotlit-profile: Books (${books.id})`);
      expect(await readFile(join(vaultPath, first.path), "utf-8")).toBe(
        original,
      );
      expect(await indexedNote(vaultId, 46)).toEqual({
        indexedKey: first.indexedKey,
        path: first.path,
      });
    }, 180000);
  },
);

interface ManagedFrontmatterReport {
  title?: unknown;
  kind?: unknown;
  spreadTitle?: unknown;
  spreadKind?: unknown;
  manual?: unknown;
  obsolete: boolean;
}

type CreateOperationReply =
  | { outcome: "created"; path: string; indexedKey: string }
  | {
      outcome: "refused";
      diagnostic: {
        code: "literature-note-exists" | "duplicate-literature-notes";
        hint: string;
        indexedKey: string;
        paths: string[];
      };
    };

async function createFixtureNote(
  vaultId: string,
  itemID: number,
  profile?: string,
): Promise<CreateOperationReply> {
  const response = await obEval(
    vaultId,
    `(async function(){var services=app.plugins.plugins.zotlit.services;var hits=await services.itemLookup.search('',{limit:100});var hit=hits.find(function(candidate){return candidate.item.itemID===${itemID};});if(!hit){throw new Error('Fixture Item not found');}var result=await services.noteFeature.createNote(hit.item,${JSON.stringify({ profile })});return JSON.stringify(result.outcome==='created'?{outcome:'created',path:result.file.path,indexedKey:hit.item.indexedKey}:{outcome:'refused',diagnostic:result.diagnostic});})()`,
  );
  return JSON.parse(response) as CreateOperationReply;
}

function hasOneIndexedNote(
  vaultId: string,
  indexedKey: string,
): Promise<boolean> {
  return hasIndexedNotes(vaultId, indexedKey, 1);
}

function hasIndexedNotes(
  vaultId: string,
  indexedKey: string,
  count: number,
): Promise<boolean> {
  return obEvalUntil(
    vaultId,
    `String(app.plugins.plugins.zotlit.services.noteIndex.getNotesByItemKey(${JSON.stringify(indexedKey)}).length)`,
    { expected: String(count) },
  );
}

/** A Fixture Item's Indexed Key and its current Literature Note, if any. */
async function indexedNote(
  vaultId: string,
  itemID: number,
): Promise<{ indexedKey: string; path: string | null }> {
  const response = await obEval(
    vaultId,
    `(async function(){var services=app.plugins.plugins.zotlit.services;var hits=await services.itemLookup.search('',{limit:100});var hit=hits.find(function(candidate){return candidate.item.itemID===${itemID};});if(!hit){throw new Error('Fixture Item not found');}var notes=services.noteIndex.getNotesByItemKey(hit.item.indexedKey);return JSON.stringify({indexedKey:hit.item.indexedKey,path:notes[0]?notes[0].path:null});})()`,
  );
  return JSON.parse(response) as { indexedKey: string; path: string | null };
}

/** Maps the Scope Case's stable selectors to the Fixture's libraryIDs. */
function expectedLibraryIDs(selectors: readonly LibrarySelector[]): number[] {
  return selectors
    .map((selector) => {
      const library =
        selector.type === "personal"
          ? LIBRARIES.find((candidate) => candidate.groupID === null)
          : LIBRARIES.find(
              (candidate) => candidate.groupID === selector.groupID,
            );
      if (!library) {
        throw new Error(
          `no Fixture Library for selector ${JSON.stringify(selector)}`,
        );
      }
      return library.libraryID;
    })
    .toSorted((a, b) => a - b);
}

/** Reads the user-visible Managed Region, including its boundary markers. */
function managedRegion(source: string): string {
  const start = source.indexOf("%%zt-managed%%");
  const end = source.indexOf("%%/zt-managed%%", start);
  if (start < 0 || end < 0) throw new Error("Missing Managed Region");
  return source.slice(start, end + "%%/zt-managed%%".length);
}

function noteBody(source: string): string {
  const end = source.indexOf("\n---", 3);
  if (!source.startsWith("---\n") || end < 0)
    throw new Error("Missing frontmatter");
  return source.slice(end + 4);
}

/**
 * Moves the open prompt's selection onto the suggestion whose text includes
 * `needle` and returns that row's text. The chooser selects on hover, and a
 * physical cursor resting over the prompt re-selects the row under it after
 * every re-render, so the wanted row is hovered explicitly instead of waited
 * for.
 */
async function selectSuggestion(
  vaultId: string,
  needle: string,
): Promise<string> {
  expect(
    await obEvalUntil(
      vaultId,
      `(function(){var prompt=Array.from(activeDocument.querySelectorAll('.prompt')).at(-1);var row=Array.from(prompt?.querySelectorAll('.suggestion-item')??[]).find(el=>el.textContent.includes(${JSON.stringify(needle)}));if(!row)return false;row.dispatchEvent(new activeWindow.MouseEvent('mousemove',{bubbles:true}));return row.classList.contains('is-selected');})()`,
      { expected: "true" },
    ),
  ).toBe(true);
  return obEval(
    vaultId,
    "Array.from(activeDocument.querySelectorAll('.prompt')).at(-1).querySelector('.is-selected').textContent",
  );
}

function clickModalButton(
  vaultId: string,
  label: string,
  documentExpression = "activeDocument",
): Promise<boolean> {
  return obEvalUntil(
    vaultId,
    `(function(){var doc=${documentExpression};var modal=Array.from(doc.querySelectorAll('.modal')).at(-1);var button=modal&&Array.from(modal.querySelectorAll('button')).find(button=>button.textContent.trim()===${JSON.stringify(label)});if(!button||button.disabled)return false;button.click();return true;})()`,
    { expected: "true" },
  );
}

/** Captures transient UI notices without replacing the plugin's notifier. */
async function observeNotices(vaultId: string) {
  await obEval(
    vaultId,
    "(function(){var doc=activeDocument;var previous=new Set(doc.querySelectorAll('.notice'));var values=new Map();var observer=new MutationObserver(()=>{for(var element of doc.querySelectorAll('.notice'))if(!previous.has(element))values.set(element,element.textContent);});observer.observe(doc.body,{childList:true,subtree:true});window.zotlitE2ENotices={observer,values};return true;})()",
  );
  return {
    async read(): Promise<string[]> {
      return JSON.parse(
        await obEval(
          vaultId,
          "JSON.stringify([...window.zotlitE2ENotices.values.values()])",
        ),
      ) as string[];
    },
    async [Symbol.asyncDispose]() {
      await obEval(
        vaultId,
        "window.zotlitE2ENotices.observer.disconnect();delete window.zotlitE2ENotices;true",
      );
    },
  };
}
