// The End-to-end Run suite — drives the plugin in a real desktop Obsidian
// window against the Fixture, over the official Obsidian CLI. See
// packages/e2e/AGENTS.md and packages/scripts/GLOSSARY.md for vocabulary.
//
// Skips cleanly (not fails) when no desktop Obsidian is reachable, decided
// before test collection by the `describe.skipIf` below, so `vitest run` exits
// 0 with every test reported as skipped rather than erroring.
//
// It builds a Fixture of its own under `.scratch/e2e-fixture`, never the
// developer's `.scratch/acceptance-fixture`, so a Paired Run open there keeps
// its database and this suite starts from the Fixture Spec every time.

import {
  copyFile,
  cp,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import { basename, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
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
  DEMO_ITEMS,
  discardFixture,
  findScopeCase,
  getFixtureLayout,
  ITEMS,
  LITERATURE_NOTE_PROFILES,
  LIBRARIES,
  LIBRARY_SCOPE_SETTING_KEY,
} from "@zotlit/scripts/fixture";
import type { LibrarySelector } from "@zotlit/scripts/fixture";
import { getWorkspaceRoot } from "@zotlit/scripts/package-roots";

import { verifyAnnotationDrag } from "./annotation-drag.ts";
import { verifyAnnotationInsert } from "./annotation-insert.ts";
import { keepRendering } from "./background-throttling.ts";
import {
  verifyMultiPdfExcerptBatch,
  verifyReaderBackedExcerpts,
  verifySavedEditDisplay,
} from "./excerpt-acceptance.ts";
import { verifyExcerptRendering } from "./excerpt-rendering.ts";
import {
  clearNotices,
  cli,
  cliCommand,
  obEval,
  obEvalUntil,
  waitFor,
  WINDOW_DOCUMENTS,
} from "./obsidian-cli.ts";
import {
  clearVault,
  e2eVaultDir,
  isObsidianReachable,
  vaultScript,
} from "./vault-script.ts";

const workspaceRoot = await getWorkspaceRoot(import.meta.dirname);
// Distinct from the per-worktree dev vault (`getDevVaultDir`) and the raw
// Fixture Vault (`getFixtureLayout(...).vaultDir`) — see AGENTS.md → Working files.
const e2eVaultPath = e2eVaultDir(workspaceRoot, "fixture-vault");
/** The suite's own Fixture, which every vault it opens builds and links. */
const e2eFixture = getFixtureLayout(
  join(workspaceRoot, ".scratch", "e2e-fixture"),
);
const runVaultScript = vaultScript(workspaceRoot, e2eFixture.root);

// The one My Library Fixture Item this suite renders and asserts against —
// itemID is unique across every Library, so it names the item without
// needing to filter on libraryID too (key "AAAAAAAA" repeats in library 2).
const targetItem = ITEMS.find((item) => item.itemID === 1)!;
const createTargetItem = ITEMS.find((item) => item.itemID === 2)!;
const defaultProfileTargetItem = ITEMS.find((item) => item.itemID === 6)!;
const booksProfileTargetItem = ITEMS.find((item) => item.itemID === 7)!;
const booksProfile = LITERATURE_NOTE_PROFILES[0]!;
const annotationAttachment = ATTACHMENTS.find(({ key }) => key === "RGRPDF24")!;
/** Every Fixture Annotation hanging off that attachment. */
const attachmentAnnotations = ANNOTATIONS.filter(
  ({ parentItemID }) => parentItemID === annotationAttachment.itemID,
);
const annotationKeys = attachmentAnnotations.map(({ key }) => key);
/** The Annotation Copy citation copies, and the Item it cites. */
const copiedAnnotation = ANNOTATIONS.find(({ key }) => key === "FDRFQ7C2")!;
const annotationItem = ITEMS.find(({ key }) => key === "RUGIER24")!;
const positionDocumentItem = ITEMS.find(({ key }) => key === "SAKIMA22")!;
/** The tag vocabulary those Annotations carry, which is what the tag Chooser lists. */
const attachmentTags = [
  ...new Set(
    attachmentAnnotations.flatMap(
      ({ tags }) => tags?.map(({ name }) => name) ?? [],
    ),
  ),
].sort();
const annotationKeysByPage = Map.groupBy(
  attachmentAnnotations,
  ({ position }) => ("pageIndex" in position ? position.pageIndex : -1),
);

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

const reachable = await isObsidianReachable(workspaceRoot);
// File scope, so it runs after every suite that builds this Fixture is done.
afterAll(() => discardFixture(e2eFixture));
const webWorkbenchEnabled = process.env.WEB_WORKBENCH_ENABLED === "true";
const settingsContent = "app.setting.containerEl";

async function openProfilesSettings(
  vaultId: string,
  pageId:
    | "settings_page_profiles"
    | "settings_page_advanced"
    | "settings_page_zotero",
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

describe.skipIf(!reachable)("End-to-end Run", () => {
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
    await obEval(
      targetVaultId,
      `(function(){var input=activeDocument.querySelector('.prompt input');input.value=${JSON.stringify(item.title)};input.dispatchEvent(new input.ownerDocument.defaultView.Event('input',{bubbles:true}));return true;})()`,
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
    // A run that stopped before `afterAll` leaves its vault registered and its
    // folder in place, and `create` refuses a registered path. Remove both
    // first, so every run starts from a fresh vault with fresh storage.
    await clearVault(runVaultScript, e2eVaultPath);
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
    // The run seldom shows this vault's windows, and a hidden window gets no
    // animation frames. The window closes with the vault in `afterAll`.
    await keepRendering(vaultId);
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
      // Wait for the card's growing excerpt to settle before starting a transition.
      // Seek each transition to its midpoint so a late timer cannot sample its end.
      // Under reduced motion neither property has an intermediate value.
      const selectionEase = `(async()=>{
        const card=app.workspace.getLeavesOfType('zotero-annotation-view')[0].view.containerEl.querySelector('.zt-annot-card:not([data-selected])');
        const read=()=>{const s=getComputedStyle(card);return{fill:s.backgroundColor,ring:s.boxShadow};};
        const sleep=(ms)=>new Promise(resolve=>setTimeout(resolve,ms));
        for(let height=-1,steady=0;steady<300;steady=card.offsetHeight===height?steady+50:0,height=card.offsetHeight)await sleep(50);
        const probe=(on)=>{
          const start=read();
          card.toggleAttribute('data-selected',on);
          read();
          const transitions=card.getAnimations().filter(animation=>['background-color','box-shadow'].includes(animation.transitionProperty));
          for(const animation of transitions){animation.pause();animation.currentTime=animation.effect.getComputedTiming().activeDuration/2;}
          const mid=read();
          for(const animation of transitions)animation.finish();
          const end=read();
          const eases=(name)=>mid[name]!==start[name]&&mid[name]!==end[name];
          return{fill:eases('fill'),ring:eases('ring')};
        };
        const motion=!matchMedia('(prefers-reduced-motion: reduce)').matches;
        const select=probe(true);const deselect=probe(false);
        return JSON.stringify({motion,select,deselect});
      })()`;
      const { motion, ...eased } = JSON.parse(
        await obEval(vaultId, selectionEase),
      ) as { motion: boolean };
      expect(eased).toEqual({
        select: { fill: motion, ring: motion },
        deselect: { fill: motion, ring: motion },
      });
      // The header block is one press target however much it reports, and the
      // pane names its controls with `aria-label` alone. Both are shapes only a
      // rendered view has: the focus stops are what the DOM ended up with, and
      // a `title` anywhere in the view is the hover tooltip Obsidian would draw
      // over its own.
      const headerChrome = `JSON.stringify((()=>{const root=app.workspace.getLeavesOfType('zotero-annotation-view')[0]?.view.containerEl;const block=root?.querySelector('.zt-annot-header')?.parentElement??null;return {focusable:block?block.querySelectorAll('button, [tabindex]:not([tabindex="-1"]), a[href], input').length:-1,titled:root?root.querySelectorAll('[title]').length:-1};})())`;
      expect(await obEval(vaultId, headerChrome)).toBe(
        JSON.stringify({ focusable: 1, titled: 0 }),
      );
      // The tag Chooser hangs in the browser's top layer, placed by CSS anchor
      // positioning — which only a running Obsidian has. A popup that collapsed
      // still holds its rows in the DOM, so what tells is whether its own box
      // is still around them.
      //
      // The tag Chooser is named by the search field it holds, never by DOM
      // order: the filter bar draws the colour Chooser first whenever the
      // palette has a colour, and every Fixture Annotation under this
      // attachment carries one. The search field is the difference between the
      // two — the colour Chooser has none — and the trigger is then the button
      // whose popover target is this popup, rather than whichever trigger comes
      // first.
      const tagPopup = `(()=>{const root=app.workspace.getLeavesOfType('zotero-annotation-view')[0]?.view.containerEl;return Array.from(root?.querySelectorAll('.zt-chooser')??[]).find(p=>p.querySelector('input[role="combobox"]'))??null;})()`;
      await obEval(
        vaultId,
        `(function(){const root=app.workspace.getLeavesOfType('zotero-annotation-view')[0]?.view.containerEl;const popup=${tagPopup};if(!popup)throw new Error('No tag Chooser in the Annotation View');if(!popup.matches(':popover-open'))root.querySelector('[popovertarget="'+popup.id+'"]').click();return true;})()`,
      );
      // `menuChrome` is the computed-style half of the proof. The popup wears no
      // `.menu` class, so its chrome can only come from Obsidian's `--menu-*`
      // variables. A throwaway sibling declares the same seven variables and is
      // measured beside it: equal computed values mean the popup reads them, in
      // whatever units the engine resolved, under whatever theme is loaded. The
      // sibling is also checked against the initial values, because an
      // undefined variable would leave both boxes bare and make equality say
      // nothing.
      //
      // The padding is the one read taken from the list box. The popup keeps
      // none of its own, so the search field runs edge to edge, and the list
      // carries `--menu-padding` as the inset.
      //
      // The shadow is the one read compared by suffix. Tailwind's `shadow-()`
      // utility composes its ring and inset placeholders ahead of the value, so
      // the popup carries four transparent stops in front of the three
      // `--menu-shadow` supplies.
      //
      // #1191 asks for one assertion, and this scenario carries three. The
      // chrome read is kept here rather than left to the development loop
      // because it is the one place ADR 0044's variable contract is held: the
      // popup wears no `.menu` class, so nothing else would notice a theme
      // hook that stopped reading those variables. The closed state below is
      // kept for the same reason — only a running Obsidian has the user-agent
      // rule it depends on. `rows` names the vocabulary, which is what proves
      // the popup under measurement is the tag one.
      const tagChooserBox = `JSON.stringify((()=>{const popup=${tagPopup};if(!popup)return{open:false,rows:[],rowsInsidePopup:false,menuChrome:false};const box=popup.getBoundingClientRect();const rows=Array.from(popup.querySelectorAll('[role="option"]'));const probe=popup.parentElement.appendChild(document.createElement('div'));probe.style.cssText='position:absolute;left:-9999px;visibility:hidden;background-color:var(--menu-background);border:var(--menu-border-width) solid var(--menu-border-color);border-radius:var(--menu-radius);corner-shape:var(--menu-corner-shape);padding:var(--menu-padding);box-shadow:var(--menu-shadow)';const got=getComputedStyle(popup),want=getComputedStyle(probe);const list=popup.querySelector('[role="listbox"]');const reads=['backgroundColor','borderTopWidth','borderTopColor','borderTopLeftRadius','cornerShape'];const chrome=reads.every(name=>got[name]===want[name])&&list!==null&&getComputedStyle(list).paddingTop===want.paddingTop&&got.boxShadow.endsWith(want.boxShadow)&&want.backgroundColor!=='rgba(0, 0, 0, 0)'&&parseFloat(want.borderTopWidth)>0&&parseFloat(want.borderTopLeftRadius)>0&&parseFloat(want.paddingTop)>0&&want.cornerShape!==''&&want.boxShadow!=='none';probe.remove();return{open:popup.matches(':popover-open'),rows:rows.map(row=>row.textContent).sort(),rowsInsidePopup:rows.length>0&&rows.every(row=>{const r=row.getBoundingClientRect();return r.height>0&&r.top>=box.top&&r.bottom<=box.bottom&&r.left>=box.left&&r.right<=box.right;}),menuChrome:chrome};})())`;
      const tagChooserClosed = `JSON.stringify((()=>{const popup=${tagPopup};if(!popup)return{open:false,hidden:false};return{open:popup.matches(':popover-open'),hidden:!popup.checkVisibility()&&popup.getBoundingClientRect().height===0};})())`;
      expect(
        await obEvalUntil(vaultId, tagChooserBox, {
          expected: JSON.stringify({
            open: true,
            rows: attachmentTags,
            rowsInsidePopup: true,
            menuChrome: true,
          }),
        }),
      ).toBe(true);
      await obEval(
        vaultId,
        `(function(){const popup=${tagPopup};popup?.hidePopover();return true;})()`,
      );
      // A closed popover is hidden by the user-agent rule
      // `[popover]:not(:popover-open) { display: none }`, which any
      // unconditional author-origin `display` outranks. The popup then keeps
      // painting after it closes and the view behind draws over it, which
      // reads as a popup that will not close and has lost its background.
      // Only a running Obsidian has that user-agent rule, so this is the one
      // place the closed state can be proven.
      expect(
        await obEvalUntil(vaultId, tagChooserClosed, {
          expected: JSON.stringify({ open: false, hidden: true }),
        }),
      ).toBe(true);
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

  it("renders the deterministic PDF matrix and reuses its cache", async () => {
    await verifyExcerptRendering(vaultId);
  }, 120000);

  // The reader-backed path against the Fixture's own Attachment: its
  // Annotations, its Item's literature note, and Obsidian's PDF reader holding
  // the same file the excerpt resolves from.
  it("crops from an open reader's document, reuses it for a note import, and falls back when it closes", async () => {
    await verifyReaderBackedExcerpts(vaultId);
  }, 180000);

  // The saved-edit case's write only lands in a Paired Run, and this is not one.
  // What every run can show is the subject that case asks about: the repository
  // indexes its verified database sources by Attachment, so an Annotation's own
  // key answers `read-only`/`server-changed` wherever the Attachment it belongs
  // to is writable — the answer the case used to skip on. The capability itself
  // is stubbed here, so the key the case asks with is the whole observation.
  it("asks the Fixture Attachment's Capability, not its Annotation's, before a saved edit", async () => {
    await obEval(
      vaultId,
      `(()=>{
        const repository=app.plugins.plugins.zotlit.services.annotationRepository;
        app.__zotlitCapabilitySubjects=[];
        repository.capabilityFor=key=>{app.__zotlitCapabilitySubjects.push(key);return {kind:'read-only',reason:'stubbed'};};
        return true;
      })()`,
    );
    const skips: string[] = [];
    let asked: string[] = [];
    try {
      await verifySavedEditDisplay(vaultId, {
        skip: (note) => void skips.push(note ?? ""),
      });
      asked = JSON.parse(
        await obEval(vaultId, "JSON.stringify(app.__zotlitCapabilitySubjects)"),
      ) as string[];
    } finally {
      await obEval(
        vaultId,
        `(()=>{
          const repository=app.plugins.plugins.zotlit.services.annotationRepository;
          delete repository.capabilityFor;
          delete app.__zotlitCapabilitySubjects;
          return true;
        })()`,
      );
    }
    expect(
      skips,
      "a non-writable Attachment stops the saved-edit case before its assertions",
    ).toHaveLength(1);
    expect(
      asked,
      "the Capability is the Attachment's: an Annotation's key answers read-only/server-changed for every writable Attachment",
    ).toEqual([annotationAttachment.key]);
  }, 120000);

  // #1184's multi-PDF batch: several of the Fixture's own PDFs, each asked for
  // its own excerpts, cold and then warm. The Node harness behind the
  // measurements record models PDF work; this case is the app's own answer.
  it("measures a multi-PDF excerpt batch cold and warm", async () => {
    const rougier = join(e2eVaultPath, "attachments/rougier-2014.pdf");
    const generated = join(
      e2eVaultPath,
      "attachments/excerpt-acceptance/excerpt-rendering.pdf",
    );
    const researchInterfaces = join(
      e2eFixture.dataDir,
      "storage/CNPDF26A/research-interfaces.pdf",
    );
    const sakimas = join(
      e2eFixture.dataDir,
      "storage/PDFSTR22/sakimas-song.pdf",
    );
    // Four of the Fixture's PDFs, two excerpts each, grouped so the second of
    // each pair is a repeated same-PDF excerpt: what one resident document
    // serves. The rects are inside every page the Fixture ships.
    await verifyMultiPdfExcerptBatch(vaultId, [
      {
        attachmentKey: "RGRPDF24",
        pdfPath: rougier,
        pageIndex: 0,
        rect: [58, 538, 211, 578],
      },
      {
        attachmentKey: "RGRPDF24",
        pdfPath: rougier,
        pageIndex: 0,
        rect: [265.833, 611.202, 374.503, 620.019],
      },
      {
        attachmentKey: "EXCERPT1",
        pdfPath: generated,
        pageIndex: 0,
        rect: [70, 90, 190, 200],
      },
      {
        attachmentKey: "EXCERPT1",
        pdfPath: generated,
        pageIndex: 4,
        rect: [50, 350, 400, 740],
      },
      {
        attachmentKey: "PDFSTR22",
        pdfPath: sakimas,
        pageIndex: 0,
        rect: [80, 80, 280, 200],
      },
      {
        attachmentKey: "PDFSTR22",
        pdfPath: sakimas,
        pageIndex: 1,
        rect: [80, 80, 280, 200],
      },
      {
        attachmentKey: "CNPDF26A",
        pdfPath: researchInterfaces,
        pageIndex: 0,
        rect: [72, 96, 300, 200],
      },
      {
        attachmentKey: "CNPDF26A",
        pdfPath: researchInterfaces,
        pageIndex: 1,
        rect: [72, 96, 300, 200],
      },
    ]);
  }, 180000);

  it.each(["main", "popout"] as const)(
    "inserts a captured annotation safely in a %s editor",
    async (host) => {
      await verifyAnnotationInsert(vaultId, host);
    },
    120000,
  );

  it("closes the annotation sidebar while its worker read is pending", async () => {
    const result = await obEval(
      vaultId,
      `(async()=>{
        await using cleanup=new AsyncDisposableStack();
        const pending=[];
        const started=Promise.withResolvers();
        const post=Worker.prototype.postMessage;
        const release=()=>{
          Worker.prototype.postMessage=post;
          for(const [worker,args] of pending.splice(0))post.apply(worker,args);
        };
        cleanup.defer(release);
        Worker.prototype.postMessage=function(...args){
          const request=args[0]?.[1];
          if(request?.tag==='AnnotViewAttachments'&&request.payload.key===${JSON.stringify(annotationItem.key)}){
            pending.push([this,args]);started.resolve();return;
          }
          return post.apply(this,args);
        };
        const leaf=cleanup.adopt(app.workspace.getRightLeaf(true),leaf=>leaf.detach());
        await leaf.setViewState({type:'zotero-annotation-view',state:{followMode:'pinned',pinnedItemKey:${JSON.stringify(annotationItem.key)}}});
        await started.promise;
        let settled=false;
        const reading=leaf.view.read.then(()=>{settled=true;});
        await Promise.resolve();
        if(settled)throw new Error('View read settled before its attachments loaded');
        leaf.detach();
        const repository=app.plugins.plugins.zotlit.services.annotationRepository;
        const on=repository.on,read=repository.read;
        const afterClose={subscriptions:0,reads:0};
        cleanup.defer(()=>{repository.on=on;repository.read=read;});
        repository.on=function(event,...args){if(event==='annotations-changed')afterClose.subscriptions++;return on.call(this,event,...args);};
        repository.read=function(...args){afterClose.reads++;return read.apply(this,args);};
        release();
        await reading;
        return JSON.stringify(afterClose);
      })()`,
    );
    expect(JSON.parse(result)).toEqual({ subscriptions: 0, reads: 0 });
  });

  it("copies an Annotation's citation after the database read, through Electron when the web clipboard refuses", async () => {
    const citation = `[@${annotationItem.citationKey}, {p. ${copiedAnnotation.pageLabel}}]`;
    const copy = (refuse: boolean) =>
      obEval(
        vaultId,
        `(async()=>{
          await using cleanup=new AsyncDisposableStack();
          const leaf=cleanup.adopt(app.workspace.getRightLeaf(true),leaf=>leaf.detach());
          await leaf.setViewState({type:'zotero-annotation-view',state:{followMode:'pinned',pinnedItemKey:${JSON.stringify(annotationItem.key)}}});
          const view=leaf.view;await view.read;
          let button=null;
          for(let i=0;i<100&&!button;i++){button=view.contentEl.querySelector('.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(copiedAnnotation.key)}] [aria-label=${JSON.stringify(m.annot_view_more_tooltip())}]');if(!button)await new Promise(r=>setTimeout(r,50));}
          if(!button)throw new Error('Annotation card menu missing');
          const clipboard=require('electron').clipboard;
          const saved={text:clipboard.readText(),html:clipboard.readHTML(),rtf:clipboard.readRTF(),image:clipboard.readImage()};
          const bookmark=clipboard.readBookmark();if(bookmark.title)saved.bookmark=bookmark.title;
          cleanup.defer(()=>clipboard.write(saved));
          const write=navigator.clipboard.writeText;
          cleanup.defer(()=>{navigator.clipboard.writeText=write;});
          clipboard.writeText('');
          if(${refuse})navigator.clipboard.writeText=()=>Promise.reject(new Error('Clipboard write refused'));
          button.click();
          let item=null;
          for(let i=0;i<50&&!item;i++){item=Array.from(activeDocument.querySelectorAll('.menu .menu-item')).find(e=>e.textContent.trim()===${JSON.stringify(m.annot_view_menu_copy_citation())});if(!item)await new Promise(r=>setTimeout(r,50));}
          if(!item)throw new Error('Copy citation missing from the card menu');
          item.click();
          let text='';
          for(let i=0;i<50&&text!==${JSON.stringify(citation)};i++){text=clipboard.readText();if(text!==${JSON.stringify(citation)})await new Promise(r=>setTimeout(r,100));}
          return text;
        })()`,
      );
    expect(await copy(false)).toBe(citation);
    expect(await copy(true)).toBe(citation);
  });

  it.each([
    ["main", "main"],
    ["main", "popout"],
    ["popout", "main"],
    ["popout", "popout"],
  ] as const)(
    "drags a captured annotation from a %s view into a %s editor",
    async (sourceHost, targetHost) => {
      await verifyAnnotationDrag(vaultId, sourceHost, targetHost);
    },
    120000,
  );

  it("creates durable image and ink excerpts with PDF readers closed", async () => {
    const path = e2eVaultDir(workspaceRoot, "excerpt-note-vault");
    await clearVault(runVaultScript, path);
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await runVaultScript(["remove", path, "--purge"]);
    });
    const opened = await runVaultScript([
      "open",
      path,
      "--vault-case",
      "fresh",
    ]);
    const id = opened.stdout.trim().split("\n")[0]!.trim();
    await keepRendering(id);
    // No Zotero process runs on this suite's Fixture.
    expect(
      await obEval(
        id,
        "(()=>{for(const leaf of app.workspace.getLeavesOfType('pdf'))leaf.detach();return String(app.workspace.getLeavesOfType('pdf').length);})()",
      ),
    ).toBe("0");
    const result = await createFixtureNote(id, 46);
    expect(result.outcome).toBe("created");
    if (result.outcome !== "created")
      throw new Error("Excerpt note was not created");
    const markdown = await readFile(join(path, result.path), "utf8");
    const files: string[] = JSON.parse(
      await obEval(
        id,
        "JSON.stringify(app.vault.getFiles().filter(f=>f.name.startsWith('zotlit-excerpt-')).map(f=>f.path))",
      ),
    );
    expect(files).toHaveLength(3);
    const targets = new Set(
      markdown
        .split("![[")
        .slice(1)
        .map((part) => part.split("]]")[0]!)
        .filter((target) => target.startsWith("zotlit-excerpt-")),
    );
    expect(targets).toEqual(
      new Set(files.map((file) => file.split("/").at(-1)!)),
    );
    const initialImages = new Map<string, Buffer>();
    for (const file of files) {
      const bytes = await readFile(join(path, file));
      initialImages.set(file, bytes);
      // ADR 0053: a newly generated Excerpt Image is lossless WebP, so the
      // durable asset is a RIFF/WEBP container carrying the VP8L chunk.
      expect(bytes.subarray(0, 4).toString("latin1")).toBe("RIFF");
      expect(bytes.subarray(8, 12).toString("latin1")).toBe("WEBP");
      expect(bytes.includes("VP8L", 12, "latin1")).toBe(true);
      expect(bytes.length).toBeGreaterThan(1000);
    }
    expect(
      JSON.parse(
        await obEval(
          id,
          `(async()=>{const services=app.plugins.plugins.zotlit.services;const file=app.vault.getFileByPath(${JSON.stringify(result.path)});if(!file)throw new Error('Created note missing');const updated=await services.noteFeature.overwriteNote(file,${JSON.stringify(result.indexedKey)});return JSON.stringify({diagnostic:updated.diagnostic??null});})()`,
        ),
      ),
    ).toEqual({ diagnostic: null });
    const overwritten = await readFile(join(path, result.path), "utf8");
    expect(overwritten).toContain("zotlit-excerpt-");
    for (const [file, initial] of initialImages)
      expect(await readFile(join(path, file))).toEqual(initial);

    const frozenImport = JSON.parse(
      await obEval(
        id,
        `(async()=>{const result=await app.plugins.plugins.zotlit.services.batchImport.runBatchImport('note',[13]);return JSON.stringify(result);})()`,
      ),
    ) as { outcome: string; write?: string };
    expect(frozenImport).toMatchObject({ outcome: "single", write: "created" });
    expect(
      await obEvalUntil(
        id,
        "String(app.plugins.plugins.zotlit.services.noteIndex.getImportedNoteByNoteKey('NNNNAAAA').length)",
        { expected: "1" },
      ),
    ).toBe(true);
    const importedPath = await obEval(
      id,
      "app.plugins.plugins.zotlit.services.noteIndex.getImportedNoteByNoteKey('NNNNAAAA')[0].path",
    );
    const frozenMarkdown = await readFile(join(path, importedPath), "utf8");
    expect(frozenMarkdown).toContain("Saved snapshot");
    expect(frozenMarkdown).not.toContain("zotlit-excerpt-");
    const frozenTargets = frozenMarkdown
      .split("![[")
      .slice(1)
      .map((part) => part.split("]]", 1)[0]!);
    expect(frozenTargets).toHaveLength(3);
    const frozenBytes = await Promise.all(
      frozenTargets.map((target) => readFile(join(path, target))),
    );

    const liveImport = JSON.parse(
      await obEval(
        id,
        `(async()=>{const services=app.plugins.plugins.zotlit.services;services.settings.updateDefaultLiteratureNoteProfileBindings({'note.import-annotations-as-template':true});const file=app.vault.getFileByPath(${JSON.stringify(importedPath)});if(!file)throw new Error('Imported Note missing');return JSON.stringify(await services.batchImport.reimportNoteByKey('NNNNAAAA',file));})()`,
      ),
    ) as { outcome: string };
    expect(liveImport).toEqual({ outcome: "overwritten" });
    const liveMarkdown = await readFile(join(path, importedPath), "utf8");
    expect(liveMarkdown).toContain("Saved snapshot");
    expect(liveMarkdown.match(/zotlit-excerpt-/g)).toHaveLength(2);
    const liveTargets = liveMarkdown
      .split("![[")
      .slice(1)
      .map((part) => part.split("]]", 1)[0]!);
    expect(liveTargets).toHaveLength(3);
    const liveBytes = await Promise.all(
      liveTargets.map((target) => readFile(join(path, target))),
    );
    expect(
      liveBytes.some((bytes) =>
        frozenBytes.every((frozen) => !bytes.equals(frozen)),
      ),
    ).toBe(true);

    await obEval(
      id,
      `(()=>{const feature=app.plugins.plugins.zotlit.services.noteFeature;window.__zotlitExcerptReports=[];window.__zotlitExcerptReportOff=feature.on('excerpt-images-reported',summary=>window.__zotlitExcerptReports.push(summary));return true;})()`,
    );
    cleanup.defer(async () => {
      await obEval(
        id,
        `(()=>{window.__zotlitExcerptReportOff?.();delete window.__zotlitExcerptReportOff;delete window.__zotlitExcerptReports;return true;})()`,
      );
    });
    const sourcePdf = join(path, "attachments/rougier-2014.pdf");
    const unavailablePdf = `${sourcePdf}.unavailable`;
    await rename(sourcePdf, unavailablePdf);
    try {
      expect(
        JSON.parse(
          await obEval(
            id,
            `(async()=>{const services=app.plugins.plugins.zotlit.services;const file=app.vault.getFileByPath(${JSON.stringify(importedPath)});return JSON.stringify(await services.batchImport.reimportNoteByKey('NNNNAAAA',file));})()`,
          ),
        ),
      ).toEqual({ outcome: "overwritten" });
    } finally {
      await rename(unavailablePdf, sourcePdf);
    }
    const pooledReports = JSON.parse(
      await obEval(
        id,
        `JSON.stringify((()=>{window.__zotlitExcerptReportOff?.();const reports=window.__zotlitExcerptReports;delete window.__zotlitExcerptReportOff;delete window.__zotlitExcerptReports;return reports;})())`,
      ),
    ) as { zotero: number; unchecked: number; unavailable: number }[];
    expect(pooledReports).toEqual([
      { zotero: 0, unchecked: 2, unavailable: 0 },
    ]);
    expect(
      JSON.parse(
        await obEval(
          id,
          `(async()=>{const services=app.plugins.plugins.zotlit.services;const file=app.vault.getFileByPath(${JSON.stringify(importedPath)});return JSON.stringify(await services.batchImport.reimportNoteByKey('NNNNAAAA',file));})()`,
        ),
      ),
    ).toEqual({ outcome: "overwritten" });

    expect(
      await obEval(id, "String(app.workspace.getLeavesOfType('pdf').length)"),
    ).toBe("0");
  });

  it("customizes a first note in a fresh vault, then explicitly updates that note", async () => {
    const annotatedItem = ITEMS.find((item) => item.itemID === 46)!;
    const freshPath = e2eVaultDir(workspaceRoot, "first-note-vault");
    await clearVault(runVaultScript, freshPath);
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
    await keepRendering(freshId);
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
    // Customize is offered only on a note whose metadata cache names a paper.
    // Obsidian drops a note's cache when a write lands and restores it once
    // the worker has parsed the new content, so the command waits for that
    // `changed` event rather than racing the parse.
    await obEval(
      freshId,
      `(async()=>{const file=app.vault.getFileByPath(${JSON.stringify(note.path)});const indexed=new Promise(resolve=>{const ref=app.metadataCache.on('changed',(changed,data)=>{if(changed!==file||!data.includes(${JSON.stringify(personal)}))return;app.metadataCache.offref(ref);resolve();});});await app.vault.append(file,${JSON.stringify(personal)});await indexed;await app.workspace.getLeaf(false).openFile(file);return true;})()`,
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
        `(function(){const view=${editor};return String(view.contentEl.textContent.includes(${JSON.stringify(m.template_workbench_shared_template({ name: m.settings_profile_default_name() }))})&&view.store.getState().item?.id==='RUGIER24');})()`,
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
      `(async()=>{const view=${editor};await app.workspace.revealLeaf(view.leaf);view.contentEl.ownerDocument.defaultView.focus();app.workspace.setActiveLeaf(view.leaf,{focus:true});return true;})()`,
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
        `(function(){const view=${editor};const button=Array.from(view.contentEl.querySelectorAll('button')).find(button=>button.innerText.trim()===${JSON.stringify(m.template_workbench_update_this_note())});button.focus();return String(view.contentEl.ownerDocument.activeElement===button&&!button.disabled);})()`,
        { expected: "true" },
      ),
    ).toBe(true);
    // The first click after an edit writes the Managed Frontmatter with the
    // body: a managed Property removed now comes back with this one update.
    await obEval(
      freshId,
      `(async()=>{await app.fileManager.processFrontMatter(app.vault.getFileByPath(${JSON.stringify(note.path)}),fm=>{delete fm.collections});return true;})()`,
    );
    await obEval(
      freshId,
      `(function(){const view=${editor};Array.from(view.contentEl.querySelectorAll('button')).find(button=>button.innerText.trim()===${JSON.stringify(m.template_workbench_update_this_note())}).click();return true;})()`,
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
    const updated = m.template_workbench_updated_note({
      name: basename(note.path!, ".md"),
    });
    expect(
      await obEvalUntil(
        freshId,
        `(function(){const view=${editor};return String([view.contentEl.ownerDocument,document].some(doc=>Array.from(doc.querySelectorAll('.notice')).some(notice=>notice.textContent.includes(${JSON.stringify(updated)}))));})()`,
        { expected: "true" },
      ),
    ).toBe(true);
    const after = await readFile(join(freshPath, note.path!), "utf-8");
    expect(after.split("---")[1]).toMatch(/^collections:/m);
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

  it("refuses an update whose open note switched its Profile in unsaved text", async () => {
    const original = await readFile(join(e2eVaultPath, booksNotePath), "utf-8");
    const stampLine = `zotlit-profile: ${booksProfile.label} (${booksProfile.id})\n`;
    expect(original).toContain(stampLine);
    const edited = original.replace(stampLine, "");
    await clearNotices(vaultId);
    // The stamp leaves the editor's text only; the metadata cache still names
    // Books when the update chooses its Profile, a moment later.
    await obEval(
      vaultId,
      `(async function(){var file=app.vault.getAbstractFileByPath(${JSON.stringify(booksNotePath)});var leaf=app.workspace.getLeaf(false);await leaf.openFile(file,{state:{mode:'source',source:true}});leaf.view.editor.setValue(${JSON.stringify(edited)});return app.commands.executeCommandById('zotlit:update-note');})()`,
    );
    expect(
      await obEvalUntil(
        vaultId,
        `String(${WINDOW_DOCUMENTS}.some(doc=>Array.from(doc.querySelectorAll('.notice')).some(notice=>notice.textContent.includes(${JSON.stringify(m.notice_literature_note_profile_changed())}))))`,
        { expected: "true" },
      ),
    ).toBe(true);
    expect(
      await obEval(
        vaultId,
        `String(app.workspace.getActiveFileView()?.getViewData()===${JSON.stringify(edited)})`,
      ),
    ).toBe("true");
    // Put the stamp back, so the scenarios below find the note as it was.
    await obEval(
      vaultId,
      `(async function(){var view=app.workspace.getActiveFileView();view.editor.setValue(${JSON.stringify(original)});await view.save();return true;})()`,
    );
    expect(
      await waitFor(
        async () =>
          (await readFile(join(e2eVaultPath, booksNotePath), "utf-8")) ===
          original,
      ),
    ).toBe(true);
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
    // The batch reads each note's Profile stamp from the metadata cache, and
    // the write above sends the Books note back through the parser. Until the
    // cache holds the rewritten frontmatter, the note reads as unstamped.
    expect(
      await obEvalUntil(
        vaultId,
        `String(app.metadataCache.getFileCache(app.vault.getAbstractFileByPath(${JSON.stringify(booksNotePath)}))?.frontmatter?.['fixture-manual']==='mine')`,
        { expected: "true" },
      ),
    ).toBe(true);

    await using notices = await observeNotices(vaultId);
    await using frames = await recordFrames(vaultId);
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
    // operation. The demo papers have no seeded note, so they are created
    // under Default too.
    const defaultCount =
      ITEMS.filter((item) => item.libraryID === 1 && !DEMO_ITEMS.includes(item))
        .length + 1;
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
      count: 4 + DEMO_ITEMS.length,
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
    // The batch's database reads run in the worker: the window kept painting
    // from the command to the summary.
    const painted = await frames.read();
    console.info("update-all frame gaps", painted);
    expect(painted.frames).toBeGreaterThan(1);
    expect(painted.maxFrameGapMs).toBeLessThan(250);
    expect(painted.longestTaskMs).toBeLessThan(250);

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
    await expect
      .poll(() => notices.read(), { timeout: 5000 })
      .toContain(
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
    await expect
      .poll(() => notices.read(), { timeout: 5000 })
      .toContain(
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
          `(function(){var names=Array.from((${settingsContent}).querySelectorAll('.setting-item-name'),el=>el.textContent);return String(names.includes(${JSON.stringify(m.settings_local_server_enabled_name())})&&!names.includes(${JSON.stringify(m.settings_local_server_workbench_name())})&&!names.includes(${JSON.stringify(m.settings_local_server_workbench_confirm_name())})&&!names.includes(${JSON.stringify(m.template_workbench_preference_name())})&&!app.commands.commands['zotlit:open-profile-web-workbench']);})()`,
        ),
      ).toBe("true");

      // Live updates answer the Companion, so their switch sits on the Zotero
      // page beside it rather than with the server that carries them.
      await openProfilesSettings(vaultId, "settings_page_zotero");
      expect(
        await obEval(
          vaultId,
          `(function(){var names=Array.from((${settingsContent}).querySelectorAll('.setting-item-name'),el=>el.textContent);return String(names.includes(${JSON.stringify(m.settings_live_updates_enabled_name())})&&names.includes(${JSON.stringify(m.settings_advanced_local_server_heading())}));})()`,
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
  it("renders the header menu's Follow Mode entries inside the popup's own box", async () => {
    const trigger =
      "app.workspace.getLeavesOfType('zotero-annotation-view')[0]?.view.contentEl.querySelector('button.zt-annot-header')";
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

    // The two modes lead under their heading, always in this order. The pin's
    // row is followed by a reason line whenever this vault has nothing to pin,
    // so what comes after them is asserted by presence rather than by position.
    expect(report.labels.slice(0, 3)).toEqual([
      m.annot_view_header_menu_label(),
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

  it("answers zotlit:annotation-image with Zotero's PNG and a rendered ink PNG without an open reader", async () => {
    // Other cases rebuild the shared Fixture for disposable vaults. Keep this
    // database's linked PDF paths tied to the vault this case owns.
    const imageFixture = getFixtureLayout(
      join(workspaceRoot, ".scratch", "e2e-annotation-image-fixture"),
    );
    const imageVaultPath = e2eVaultDir(workspaceRoot, "annotation-image-vault");
    const imageVaultScript = vaultScript(workspaceRoot, imageFixture.root);
    await clearVault(imageVaultScript, imageVaultPath);
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await imageVaultScript(["remove", imageVaultPath, "--purge"]);
      await discardFixture(imageFixture);
    });
    const created = await imageVaultScript(["create", imageVaultPath]);
    const imageVaultId = created.stdout.trim().split("\n")[0]!.trim();
    await keepRendering(imageVaultId);
    await obEval(
      imageVaultId,
      "(async()=>{app.workspace.detachLeavesOfType('pdf');app.workspace.detachLeavesOfType('zotero-annotation-view');await app.plugins.plugins.zotlit.services.excerptImage.clear();return true;})()",
    );
    const imageKey = "FDRFQ7C2";
    const inkKey = "TYY6Z6ZF";
    const cacheDirectory = join(imageFixture.dataDir, "cache", "library");
    const imagePath = join(cacheDirectory, `${imageKey}.png`);
    const inkCachePath = join(cacheDirectory, `${inkKey}.png`);
    const pdfPath = join(imageVaultPath, annotationAttachment.path!);
    const answer = async (key: string) =>
      JSON.parse(
        await cliCommand(imageVaultId, "zotlit:annotation-image", {
          args: { key },
          timeoutMs: 60_000,
        }),
      ) as {
        ok: boolean;
        command: string;
        key: string;
        format: string;
        provenance: string;
        path: string;
      };
    // A local PDF missing on this device exercises the service's Zotero fallback.
    await rename(pdfPath, `${pdfPath}.image-test`);
    try {
      const cached = await answer(imageKey);
      expect(cached).toMatchObject({
        ok: true,
        command: "zotlit:annotation-image",
        key: imageKey,
        format: "png",
        provenance: "zotero",
        path: imagePath,
      });
      expect((await readFile(cached.path)).subarray(0, 8)).toEqual(
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      );
    } finally {
      await rename(`${pdfPath}.image-test`, pdfPath);
    }
    await rename(inkCachePath, `${inkCachePath}.image-test`);
    try {
      const rendered = await answer(inkKey);
      expect(rendered, JSON.stringify(rendered)).toMatchObject({
        ok: true,
        key: inkKey,
        format: "png",
        provenance: "rendered",
      });
      expect(rendered.path).toContain("zotlit-excerpts");
      expect((await readFile(rendered.path)).subarray(0, 8)).toEqual(
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      );
      const dimensions = JSON.parse(
        await obEval(
          imageVaultId,
          `(async()=>{const bytes=require('node:fs').readFileSync(${JSON.stringify(rendered.path)});const bitmap=await createImageBitmap(new Blob([bytes],{type:'image/png'}));const result={width:bitmap.width,height:bitmap.height};bitmap.close();return JSON.stringify(result);})()`,
        ),
      ) as { width: number; height: number };
      expect(dimensions.width).toBeGreaterThan(0);
      expect(dimensions.height).toBeGreaterThan(0);
      const reused = await answer(inkKey);
      expect(reused).toMatchObject({
        ok: true,
        provenance: "cache",
        path: rendered.path,
      });
    } finally {
      await rename(`${inkCachePath}.image-test`, inkCachePath);
    }
  }, 120_000);

  describe("ZotLit Query attachments", () => {
    const queryFixture = getFixtureLayout(
      join(workspaceRoot, ".scratch", "e2e-attachment-query-fixture"),
    );
    const queryVaultPath = e2eVaultDir(workspaceRoot, "attachment-query-vault");
    const queryVaultScript = vaultScript(workspaceRoot, queryFixture.root);
    let queryVaultId: string;
    beforeAll(async () => {
      await clearVault(queryVaultScript, queryVaultPath);
      const created = await queryVaultScript(["create", queryVaultPath]);
      queryVaultId = created.stdout.trim().split("\n")[0]!.trim();
      await keepRendering(queryVaultId);
    });
    afterAll(async () => {
      await queryVaultScript(["remove", queryVaultPath, "--purge"]);
      await discardFixture(queryFixture);
    });
    const query = async (args: Record<string, string>) =>
      JSON.parse(
        await cliCommand(queryVaultId, "zotlit:query", {
          args: { from: "attachments", ...args },
        }),
      ) as ItemQueryReport;

    it("projects and sorts keys and groups file types through ZotLit Query", async () => {
      for (const from of ["items", "attachments", "annotations"]) {
        const answer = await query({
          from,
          library: "all",
          fields: "indexedKey,key",
          sort: "indexedKey",
          limit: "all",
        });
        expect(answer).toMatchObject({
          ok: true,
          contractVersion: 3,
          truncated: false,
        });
        expect(answer.returnedCount).toBeGreaterThan(0);
        const keys = answer.rows!.map((row) => row.indexedKey);
        expect(keys).toEqual([...keys].sort());
        for (const row of answer.rows!) {
          expect(row.values.indexedKey).toBe(row.indexedKey);
          expect(row.values.key).toBe(row.indexedKey.slice(0, 8));
        }
      }
      const files = await query({
        library: "personal",
        group: "fileType",
        fields: "fileType",
        limit: "all",
      });
      expect(files).toMatchObject({ ok: true, truncated: false });
      expect(files.groups!.map(({ value, count }) => [value, count])).toEqual([
        ["pdf", 11],
        ["web", 3],
      ]);
      for (const group of files.groups!)
        for (const row of group.rows)
          expect(row.values.fileType).toBe(group.value);
    });

    it("groups files by type with a per-group limit", async () => {
      const answer = await query({
        group: "contentType",
        library: "personal",
        limit: "1",
        fields: "contentType",
      });
      const files = ATTACHMENTS.filter(
        (file) =>
          file.libraryID === 1 &&
          ITEMS.some((item) => item.itemID === file.parentItemID),
      );
      const types = [...new Set(files.map((file) => file.contentType))].sort();
      expect(answer).toMatchObject({
        ok: true,
        totalCount: files.length,
        returnedCount: types.length,
        truncated: true,
      });
      expect(answer).not.toHaveProperty("rows");
      expect(
        answer.groups!.map(({ value, count, rows }) => [
          value,
          count,
          rows.length,
        ]),
      ).toEqual(
        types.map((type) => [
          type,
          files.filter((file) => file.contentType === type).length,
          1,
        ]),
      );
      for (const group of answer.groups!)
        expect(group.rows[0]!.values.contentType).toBe(group.value);
    });

    it("finds broken linked files", async () => {
      // Demo paper files are copied only to the demo Vault Case. Their linked
      // rows remain in the configured Fixture and are also missing here.
      const answer = await query({
        filter: 'linkMode == "linked_file" && !exists',
        fields: "title,path,exists,tags",
        library: "all",
        limit: "all",
      });
      expect(answer).toMatchObject({
        ok: true,
        returnedCount: 3,
        truncated: false,
        rows: [
          {
            indexedKey: "MISSLNK2",
            values: {
              title: "Missing linked PDF",
              path: join(queryFixture.linkedFilesDir, "missing-linked.pdf"),
              exists: false,
              tags: ["repair-file"],
            },
          },
          { indexedKey: "DMRGRPDF", values: { exists: false } },
          { indexedKey: "DMIANPDF", values: { exists: false } },
        ],
      });
    });
    it("lists files of one paper", async () => {
      const paper = ITEMS.find((item) => item.itemID === 46)!;
      const answer = await query({
        filter: `item.citationKey == ${JSON.stringify(paper.citationKey)}`,
        fields: "title,contentType,path",
        limit: "all",
      });
      expect(answer).toMatchObject({
        ok: true,
        returnedCount: 1,
        truncated: false,
        rows: [
          {
            indexedKey: "RGRPDF24",
            itemIndexedKey: paper.key,
            values: {
              title: "Rougier et al. 2014 PDF",
              contentType: "application/pdf",
              path: join(queryVaultPath, "attachments", "rougier-2014.pdf"),
            },
          },
        ],
      });
      for (const filter of [
        'indexedKey == "RGRPDF24"',
        '["RGRPDF24"].contains(indexedKey)',
        `item.indexedKey == ${JSON.stringify(paper.key)}`,
        `[${JSON.stringify(paper.key)}].contains(item.indexedKey)`,
      ]) {
        const selected = await query({
          filter,
          fields: "title,contentType,path",
          limit: "all",
        });
        expect(selected).toMatchObject({
          ok: true,
          rows: answer.rows,
          warnings: [],
        });
      }
      const outsideKey = `RGRPDF24g${LIBRARIES.find((library) => library.groupID !== null)!.groupID}`;
      const scoped = await query({
        library: "personal",
        filter: `indexedKey == "${outsideKey}" || indexedKey == "RGRPDF24"`,
        fields: "title,contentType,path",
      });
      expect(scoped).toMatchObject({
        ok: true,
        libraries: [{ type: "personal" }],
        rows: answer.rows,
        warnings: [{ code: "key-outside-target-libraries", found: outsideKey }],
      });
      const schema = JSON.parse(
        await cliCommand(queryVaultId, "zotlit:query-schema", {
          args: { from: "attachments" },
        }),
      );
      expect(Object.keys(schema.datasets)).toEqual(["attachments"]);
      expect(schema.defaults.attachments.fields).toEqual([
        "title",
        "contentType",
        "linkMode",
        "path",
        "exists",
        "item.title",
        "item.citationKey",
      ]);
    });
    it("projects Library selectors and parent citation keys across all Libraries", async () => {
      const answer = await query({
        library: "all",
        fields: "title,library,item.citationKey",
        limit: "all",
      });
      expect(answer).toMatchObject({
        ok: true,
        returnedCount: 14,
        truncated: false,
      });
      expect(answer.libraries).toHaveLength(LIBRARIES.length);
      // The three image Attachments of a Note are outside the Query Dataset.
      const attachedToItems = ATTACHMENTS.filter((attachment) =>
        ITEMS.some((item) => item.itemID === attachment.parentItemID),
      );
      expect(answer.rows!.map((row) => row.indexedKey).toSorted()).toEqual(
        attachedToItems.map((attachment) => attachment.key).toSorted(),
      );
      for (const attachment of attachedToItems) {
        const library = LIBRARIES.find(
          (library) => library.libraryID === attachment.libraryID,
        )!;
        const parent = ITEMS.find(
          (item) => item.itemID === attachment.parentItemID,
        )!;
        const key =
          library.groupID === null
            ? attachment.key
            : `${attachment.key}g${library.groupID}`;
        expect(
          answer.rows!.find((row) => row.indexedKey === key)?.values,
        ).toEqual({
          title: attachment.title,
          library:
            library.groupID === null ? "personal" : `group:${library.groupID}`,
          "item.citationKey": parent.citationKey,
        });
      }
    });
  });

  describe("ZotLit Query Relation Lists", () => {
    const queryFixture = getFixtureLayout(
      join(workspaceRoot, ".scratch", "e2e-relation-query-fixture"),
    );
    const queryVaultPath = e2eVaultDir(workspaceRoot, "relation-query-vault");
    const queryVaultScript = vaultScript(workspaceRoot, queryFixture.root);
    let queryVaultId: string;
    beforeAll(async () => {
      await clearVault(queryVaultScript, queryVaultPath);
      const created = await queryVaultScript(["create", queryVaultPath]);
      queryVaultId = created.stdout.trim().split("\n")[0]!.trim();
      await keepRendering(queryVaultId);
    });
    afterAll(async () => {
      await queryVaultScript(["remove", queryVaultPath, "--purge"]);
      await discardFixture(queryFixture);
    });
    const query = async (args: Record<string, string>) =>
      JSON.parse(
        await cliCommand(queryVaultId, "zotlit:query", {
          args: { library: "personal", limit: "all", sort: "[]", ...args },
        }),
      ) as ItemQueryReport;
    const papers = '["PREPRNT2", "RUGIER24", "SAKIMA22"].contains(key)';

    it("finds relation candidates through each existence form and nested marks", async () => {
      for (const filter of [
        'annotations.filter(value.tags.contains("methodology")).length > 0',
        'annotations.filter(value.tags.contains("methodology")).length >= 1',
        '!annotations.filter(value.tags.contains("methodology")).isEmpty()',
        'attachments.filter(value.annotations.filter(value.tags.contains("methodology")).length > 0).length > 0',
      ]) {
        const answer = await query({ filter, fields: "title" });
        expect(answer.ok).toBe(true);
        expect(answer.rows!.map((row) => row.indexedKey)).toEqual(["RUGIER24"]);
      }
      const files = await query({
        from: "attachments",
        filter:
          'annotations.filter(value.tags.contains("methodology")).length > 0',
        fields: "title",
      });
      expect(files.ok).toBe(true);
      expect(files.rows!.map((row) => row.indexedKey)).toEqual(["RGRPDF24"]);
    });
    it("finds papers with no usable PDF on this machine", async () => {
      const answer = await query({
        filter: `(${papers} || ["AAAAAAAA", "DMRGRART"].contains(key)) && attachments.filter(value.contentType == "application/pdf" && value.exists).isEmpty()`,
        fields: "title",
      });
      expect(answer.ok).toBe(true);
      expect(answer.rows!.map((row) => row.indexedKey)).toEqual([
        "AAAAAAAA",
        "DMRGRART",
      ]);
    });
    it("finds papers in a Collection with no highlight yet", async () => {
      const answer = await query({
        filter: `${papers} && collections.contains("Shared key") && annotations.filter(value.type == "highlight").isEmpty()`,
        fields: "title",
      });
      expect(answer.ok).toBe(true);
      expect(answer.rows!.map((row) => row.indexedKey)).toEqual(["PREPRNT2"]);
    });
    it("finds papers with more than one PDF", async () => {
      const answer = await query({
        filter: `${papers} && attachments.filter(value.contentType == "application/pdf").length > 1`,
        fields: "title",
      });
      expect(answer.ok).toBe(true);
      expect(answer.rows!.map((row) => row.indexedKey)).toEqual([
        "PREPRNT2",
        "SAKIMA22",
      ]);
    });
    it("lists each file path with nulls in their source positions", async () => {
      const answer = await query({
        filter: 'key == "SAKIMA22"',
        fields: "attachments[].path",
      });
      expect(answer).toMatchObject({
        ok: true,
        returnedCount: 1,
        rows: [
          {
            indexedKey: "SAKIMA22",
            values: {
              "attachments[].path": [
                null,
                join(
                  queryFixture.dataDir,
                  "storage",
                  "HTMLSNAP",
                  "sakimas-song.html",
                ),
                null,
                join(
                  queryFixture.dataDir,
                  "storage",
                  "MISSNG22",
                  "deliberately-missing.pdf",
                ),
                join(queryFixture.linkedFilesDir, "sakimas-song.pdf"),
                join(
                  queryFixture.dataDir,
                  "storage",
                  "PDFSTR22",
                  "sakimas-song.pdf",
                ),
              ],
            },
          },
        ],
      });
    });
    it("reports the number of marks for each paper and file", async () => {
      const answer = await query({
        filter: papers,
        fields: "annotations.length",
      });
      expect(answer.ok).toBe(true);
      expect(
        answer.rows!.map((row) => [
          row.indexedKey,
          row.values["annotations.length"],
        ]),
      ).toEqual([
        ["PREPRNT2", 0],
        ["RUGIER24", attachmentAnnotations.length],
        ["SAKIMA22", 4],
      ]);
      const file = await query({
        from: "attachments",
        filter: 'key == "RGRPDF24"',
        fields: "annotations.length",
      });
      expect(file).toMatchObject({
        ok: true,
        rows: [
          {
            indexedKey: "RGRPDF24",
            values: { "annotations.length": attachmentAnnotations.length },
          },
        ],
      });
    });
  });

  it("projects aligned Relation Lists with [] through zotlit:query", async () => {
    const query = async (fields: string[]) =>
      JSON.parse(
        await cliCommand(vaultId, "zotlit:query", {
          args: { fields: fields.join(","), limit: "all" },
        }),
      ) as ItemQueryReport;
    const source = await query(["citationKey", "creators", "tags"]);
    const projected = await query([
      "citationKey",
      "creators[].fullName",
      "tags[].name",
    ]);
    expect(source.ok).toBe(true);
    expect(projected.ok).toBe(true);
    expect(projected.rows!.length).toBeGreaterThan(0);
    expect(projected.rows!.map((row) => row.indexedKey)).toEqual(
      source.rows!.map((row) => row.indexedKey),
    );
    expect(
      source.rows!.some((row) => (row.values.creators as unknown[]).length > 1),
    ).toBe(true);
    expect(
      source.rows!.some((row) => (row.values.tags as unknown[]).length > 0),
    ).toBe(true);
    for (const [index, row] of projected.rows!.entries()) {
      const values = source.rows![index]!.values;
      expect(row.values).toEqual({
        citationKey: values.citationKey,
        "creators[].fullName": (
          values.creators as { fullName: string | null }[]
        ).map((creator) => creator.fullName),
        "tags[].name": (values.tags as { name: string | null }[]).map(
          (tag) => tag.name,
        ),
      });
    }
  });

  it("projects library selectors through zotlit:query across the Fixture Libraries", async () => {
    const answer = JSON.parse(
      await cliCommand(vaultId, "zotlit:query", {
        args: { library: "all", fields: "citationKey,library" },
      }),
    ) as ItemQueryReport;
    expect(answer.ok).toBe(true);
    expect(answer.returnedCount).toBe(ITEMS.length);
    expect(answer.truncated).toBe(false);
    expect(new Set(answer.rows!.map((row) => row.values.library))).toEqual(
      new Set(
        LIBRARIES.map(({ groupID }) =>
          groupID === null ? "personal" : `group:${groupID}`,
        ),
      ),
    );
    for (const library of LIBRARIES) {
      for (const item of ITEMS.filter(
        (item) => item.libraryID === library.libraryID,
      )) {
        const indexedKey =
          library.groupID === null
            ? item.key
            : `${item.key}g${library.groupID}`;
        expect(
          answer.rows!.find((row) => row.indexedKey === indexedKey)?.values,
        ).toEqual({
          citationKey: item.citationKey,
          library:
            library.groupID === null ? "personal" : `group:${library.groupID}`,
        });
      }
    }
  });

  it("answers zotlit:query over the Library Scope and over named Libraries with the Fixture's Indexed Keys", async () => {
    const [myLibrary, sharedReading] = LIBRARIES;
    const wireOf = (library: (typeof LIBRARIES)[number]) =>
      library.groupID === null
        ? { type: "personal" }
        : { type: "group", groupID: library.groupID, name: library.name };
    const selectorOf = (library: (typeof LIBRARIES)[number]) =>
      library.groupID === null ? "personal" : `group:${library.groupID}`;
    /** The Indexed Keys of the Libraries, most recently modified first. */
    const byModified = (libraries: readonly (typeof LIBRARIES)[number][]) =>
      libraries
        .flatMap((library) =>
          ITEMS.filter((item) => item.libraryID === library.libraryID).map(
            (item) => ({
              dateModified: item.dateModified,
              indexedKey:
                library.groupID === null
                  ? item.key
                  : `${item.key}g${library.groupID}`,
            }),
          ),
        )
        .toSorted(
          (a, b) =>
            b.dateModified.localeCompare(a.dateModified) ||
            (a.indexedKey < b.indexedKey
              ? -1
              : a.indexedKey > b.indexedKey
                ? 1
                : 0),
        )
        .map((item) => item.indexedKey);

    // Dispatched as a registered CLI command with arguments, the way an agent
    // calls it. Without a Library argument, the query reads the available
    // Libraries of the Library Scope, which `zotlit:library-scope` reports.
    const scope = JSON.parse(
      await cliCommand(vaultId, "zotlit:library-scope"),
    ) as LibraryScopeReport;
    const inScope = (scope.available ?? []).map(
      (entry) =>
        LIBRARIES.find((library) => library.libraryID === entry.libraryID)!,
    );
    expect(inScope.length).toBeGreaterThan(1);

    const limited = JSON.parse(
      await cliCommand(vaultId, "zotlit:query", {
        args: {
          fields: "[]",
          limit: "3",
        },
      }),
    ) as ItemQueryReport;

    expect(limited).toMatchObject({
      contractVersion: 3,
      command: "zotlit:query",
      ok: true,
      libraries: inScope.map(wireOf),
      request: {
        from: "items",
        library: inScope.map(selectorOf),
        fields: [],
        limit: 3,
      },
      returnedCount: 3,
      truncated: true,
    });
    expect(limited.rows!.map((row) => row.indexedKey)).toEqual(
      byModified(inScope).slice(0, 3),
    );

    // A named range, in another order than the canonical one.
    const range = JSON.parse(
      await cliCommand(vaultId, "zotlit:query", {
        args: {
          library: [selectorOf(sharedReading!), selectorOf(myLibrary!)].join(
            ",",
          ),
          fields: "[]",
          limit: "all",
        },
      }),
    ) as ItemQueryReport;

    expect(range).toMatchObject({
      ok: true,
      libraries: [wireOf(myLibrary!), wireOf(sharedReading!)],
      request: {
        library: [selectorOf(myLibrary!), selectorOf(sharedReading!)],
        limit: null,
      },
      truncated: false,
    });
    expect(range.rows!.map((row) => row.indexedKey)).toEqual(
      byModified([myLibrary!, sharedReading!]),
    );

    const group = JSON.parse(
      await cliCommand(vaultId, "zotlit:query", {
        args: {
          library: selectorOf(sharedReading!),
          fields: "[]",
          limit: "all",
        },
      }),
    ) as ItemQueryReport;

    expect(group).toMatchObject({
      ok: true,
      libraries: [wireOf(sharedReading!)],
      request: { library: [selectorOf(sharedReading!)], limit: null },
      truncated: false,
    });
    expect(group.rows!.map((row) => row.indexedKey)).toEqual(
      byModified([sharedReading!]),
    );

    // The Bases helpers through the shipped plugin: a regular expression and
    // an element expression over the Creators, each against My Library.
    const personalKeys = (
      predicate: (item: (typeof ITEMS)[number]) => boolean,
    ) => {
      const keys = new Set(
        ITEMS.filter(
          (item) => item.libraryID === myLibrary!.libraryID && predicate(item),
        ).map((item) => item.key),
      );
      return byModified([myLibrary!]).filter((key) => keys.has(key));
    };
    const fullName = (creator: (typeof ITEMS)[number]["creators"][number]) =>
      creator.fieldMode === 1
        ? creator.lastName
        : `${creator.firstName} ${creator.lastName}`.trim();
    for (const [filter, predicate] of [
      [
        "/duplicate/i.matches(title)",
        (item: (typeof ITEMS)[number]) => /duplicate/i.test(item.title),
      ],
      [
        'creators.filter(index > 0).map(value.split(" ")[0]).contains("Michael")',
        (item: (typeof ITEMS)[number]) =>
          item.creators
            .slice(1)
            .some((creator) => fullName(creator).split(" ")[0] === "Michael"),
      ],
    ] as const) {
      const expected = personalKeys(predicate);
      expect(expected.length).toBeGreaterThan(1);
      const helpers = JSON.parse(
        await cliCommand(vaultId, "zotlit:query", {
          args: {
            library: selectorOf(myLibrary!),
            filter,
            fields: "[]",
            limit: "all",
          },
        }),
      ) as ItemQueryReport;
      expect(helpers).toMatchObject({
        ok: true,
        returnedCount: expected.length,
        truncated: false,
      });
      expect(helpers.rows!.map((row) => row.indexedKey)).toEqual(expected);
    }

    // The production command exports the same response and keeps an existing file.
    const exportPath = join(e2eFixture.root, "query-export.json");
    await using exportCleanup = new AsyncDisposableStack();
    exportCleanup.defer(() => rm(exportPath, { force: true }));
    const exportArgs = {
      library: selectorOf(sharedReading!),
      fields: "[]",
      limit: "all",
      output: exportPath,
    };
    const receipt = JSON.parse(
      await cliCommand(vaultId, "zotlit:query", { args: exportArgs }),
    );
    const exportedText = await readFile(exportPath, "utf8");
    expect(receipt).toMatchObject({
      ok: true,
      returnedCount: group.returnedCount,
      file: {
        path: exportPath,
        bytes: Buffer.byteLength(exportedText),
        format: "json",
      },
    });
    expect(receipt).not.toHaveProperty("rows");
    expect(JSON.parse(exportedText)).toEqual(group);
    const repeated = JSON.parse(
      await cliCommand(vaultId, "zotlit:query", { args: exportArgs }),
    );
    expect(repeated).toMatchObject({
      ok: false,
      diagnostic: { code: "output-error" },
    });
    expect(await readFile(exportPath, "utf8")).toBe(exportedText);

    // A held Snapshot leaves new queries free to read a changed source. The
    // new copy carries a numeric field beyond JavaScript's exact integer range.
    const otherDir = join(e2eFixture.root, "query-other-source");
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(() => rm(otherDir, { recursive: true, force: true }));
    cleanup.defer(async () => {
      await obEval(
        vaultId,
        `(async()=>{
        const state=window.__zotlitQuerySource;
        if(!state)return true;
        const services=app.plugins.plugins.zotlit.services;
        services.zoteroPref.setDataDir(state.previous);
        await state.lease?.[Symbol.asyncDispose]();
        delete window.__zotlitQuerySource;
        await services.zoteroReads.refresh();
        return true;
      })()`,
      );
    });
    await mkdir(otherDir, { recursive: true });
    const otherPath = join(otherDir, "zotero.sqlite");
    await copyFile(limited.identity!.source.databasePath, otherPath);
    {
      using sqlite = new DatabaseSync(otherPath);
      sqlite.exec(`
        insert into itemDataValues (value) values (9007199254740993);
        insert or replace into itemData (itemID, fieldID, valueID)
          select ${targetItem.itemID}, fieldID, last_insert_rowid()
          from fieldsCombined where fieldName = 'volume' and custom = 0;
      `);
    }
    await obEval(
      vaultId,
      `(async()=>{
      const services=app.plugins.plugins.zotlit.services;
      const lease=await services.zoteroReads.acquireRead();
      window.__zotlitQuerySource={lease,previous:services.zoteroPref.dataDirOverride};
      services.zoteroPref.setDataDir(${JSON.stringify(otherDir)});
      await services.zoteroReads.refresh();
      return true;
    })()`,
    );
    const integerQuery = {
      library: "personal",
      filter: 'volume == "9007199254740993"',
      fields: "volume",
    };
    for (const filter of [
      integerQuery.filter,
      'volume.lower() == "9007199254740993"',
    ]) {
      const changed = JSON.parse(
        await cliCommand(vaultId, "zotlit:query", {
          args: { ...integerQuery, filter },
        }),
      ) as ItemQueryReport;
      expect(changed).toMatchObject({
        ok: true,
        identity: { source: { databasePath: otherPath } },
        rows: [
          {
            indexedKey: targetItem.key,
            values: { volume: "9007199254740993" },
          },
        ],
      });
    }
  });

  it("groups marks per paper through zotlit:query", async () => {
    const report = JSON.parse(
      await cliCommand(vaultId, "zotlit:query", {
        args: {
          from: "annotations",
          group: "item.citationKey",
          limit: "3",
          sort: "-dateModified",
          library: "personal",
          filter: `item.indexedKey == "${annotationItem.key}"`,
          fields: "dateModified,item.citationKey",
        },
      }),
    ) as ItemQueryReport;
    const parents = ATTACHMENTS.filter(
      (attachment) => attachment.parentItemID === annotationItem.itemID,
    );
    const marks = ANNOTATIONS.filter((annotation) =>
      parents.some((parent) => parent.itemID === annotation.parentItemID),
    );
    expect(marks.length).toBeGreaterThan(3);
    expect(report).toMatchObject({
      ok: true,
      request: { group: "item.citationKey" },
      totalCount: marks.length,
      returnedCount: 3,
      truncated: true,
      groups: [{ value: annotationItem.citationKey, count: marks.length }],
    });
    expect(report).not.toHaveProperty("rows");
    expect(report.groups![0]!.rows.map((row) => row.indexedKey)).toEqual(
      marks
        .toSorted(
          (a, b) =>
            b.dateModified.localeCompare(a.dateModified) ||
            a.sortIndex.localeCompare(b.sortIndex) ||
            a.key.localeCompare(b.key),
        )
        .slice(0, 3)
        .map((mark) => mark.key),
    );
  });

  it("groups papers per year through zotlit:query", async () => {
    const report = JSON.parse(
      await cliCommand(vaultId, "zotlit:query", {
        args: {
          group: "date.year",
          limit: "1",
          library: "personal",
          fields: "title,date.year",
        },
      }),
    ) as ItemQueryReport;
    const papers = ITEMS.filter((item) => item.libraryID === 1);
    const years = [
      ...new Set(papers.map((item) => Number(item.date.slice(0, 4)))),
    ].sort((a, b) => a - b);
    expect(report).toMatchObject({
      ok: true,
      request: { group: "date.year" },
      totalCount: papers.length,
      returnedCount: years.length,
      truncated: true,
    });
    expect(report).not.toHaveProperty("rows");
    expect(
      report.groups!.map(({ value, count, rows }) => [
        value,
        count,
        rows.length,
      ]),
    ).toEqual(
      years.map((year) => [
        year,
        papers.filter((paper) => Number(paper.date.slice(0, 4)) === year)
          .length,
        1,
      ]),
    );
    for (const group of report.groups!)
      expect(group.rows[0]!.values["date.year"]).toBe(group.value);
    const split = JSON.parse(
      await cliCommand(vaultId, "zotlit:query", {
        args: { group: "library", library: "all", limit: "3" },
      }),
    ) as ItemQueryReport;
    expect(split).toMatchObject({ ok: true, totalCount: ITEMS.length });
    expect(split.groups).toHaveLength(LIBRARIES.length);
  });

  it("queries an Item's reading record through zotlit:query from=annotations", async () => {
    // Own the Fixture and vault so earlier cases cannot leave this query's
    // linked Attachment paths pointing at a vault they have removed.
    const queryFixture = getFixtureLayout(
      join(workspaceRoot, ".scratch", "e2e-annotation-query-fixture"),
    );
    const queryVaultPath = e2eVaultDir(workspaceRoot, "annotation-query-vault");
    const queryVaultScript = vaultScript(workspaceRoot, queryFixture.root);
    await clearVault(queryVaultScript, queryVaultPath);
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await queryVaultScript(["remove", queryVaultPath, "--purge"]);
      await discardFixture(queryFixture);
    });
    const created = await queryVaultScript(["create", queryVaultPath]);
    const queryVaultId = created.stdout.trim().split("\n")[0]!.trim();
    await keepRendering(queryVaultId);
    const report = JSON.parse(
      await cliCommand(queryVaultId, "zotlit:query", {
        args: {
          from: "annotations",
          filter: `item.indexedKey == "${annotationItem.key}"`,
          limit: "all",
        },
      }),
    ) as ItemQueryReport;
    expect(report).toMatchObject({
      contractVersion: 3,
      command: "zotlit:query",
      request: { from: "annotations" },
      ok: true,
      truncated: false,
    });
    const parents = ATTACHMENTS.filter(
      (attachment) => attachment.parentItemID === annotationItem.itemID,
    );
    const expected = ANNOTATIONS.filter((annotation) =>
      parents.some((parent) => parent.itemID === annotation.parentItemID),
    );
    expect(report.returnedCount).toBe(expected.length);
    expect(report.rows!.map((row) => row.indexedKey).toSorted()).toEqual(
      expected.map((annotation) => annotation.key).toSorted(),
    );
    expect(report.rows![0]).toMatchObject({
      itemIndexedKey: annotationItem.key,
      attachmentIndexedKey: expect.any(String),
      values: {
        type: expect.any(String),
        colorName: expect.any(String),
        pageIndex: expect.any(Number),
        "item.title": annotationItem.title,
        attachment: { path: expect.any(String), exists: true },
      },
    });
    expect(report.rows![0]!.values).not.toHaveProperty("position");
    const filtered = JSON.parse(
      await cliCommand(queryVaultId, "zotlit:query", {
        args: {
          from: "annotations",
          filter: `item.indexedKey == "${annotationItem.key}" && type == "image" && item.title == ${JSON.stringify(annotationItem.title)}`,
          fields: "type,item.title,item.date",
          sort: "pageIndex",
          limit: "all",
        },
      }),
    ) as ItemQueryReport;
    expect(filtered).toMatchObject({
      ok: true,
      command: "zotlit:query",
    });
    expect(filtered.rows!.map((row) => row.indexedKey).toSorted()).toEqual(
      expected
        .filter((annotation) => annotation.type === 3)
        .map((annotation) => annotation.key)
        .toSorted(),
    );
    const schema = JSON.parse(
      await cliCommand(queryVaultId, "zotlit:query-schema", {
        args: { from: "annotations" },
      }),
    ) as ItemQuerySchemaReport;
    expect(schema).toMatchObject({
      contractVersion: 3,
      command: "zotlit:query-schema",
      ok: true,
      schema: { url: expect.stringContaining("/query.schema.json") },
      defaults: {
        annotations: {
          fields: expect.arrayContaining(["type", "item.title"]),
          limit: 100,
        },
      },
    });
    const catalog = JSON.parse(
      await readFile(
        join(workspaceRoot, "packages/item-query/dist/query.schema.json"),
        "utf8",
      ),
    ) as { datasets: { annotations: { fields: object[] } } };
    expect(catalog.datasets.annotations.fields).toContainEqual({
      path: "item.title",
      type: "string",
      filter: "string",
      projection: true,
      group: true,
      sort: true,
    });
    const invalid = JSON.parse(
      await cliCommand(queryVaultId, "zotlit:query", {
        args: { from: "annotations", filter: "item.title.startsWith(1)" },
      }),
    ) as ItemQueryReport;
    expect(invalid).toMatchObject({
      contractVersion: 3,
      command: "zotlit:query",
      ok: false,
      diagnostic: {
        code: "wrong-argument-type",
        location: { argument: "filter", span: { from: 22, to: 23 } },
      },
    });

    const positions = JSON.parse(
      await cliCommand(queryVaultId, "zotlit:query", {
        args: {
          from: "annotations",
          filter: `${JSON.stringify([annotationItem.key, positionDocumentItem.key])}.contains(item.indexedKey)`,
          fields: "position",
          limit: "all",
        },
      }),
    ) as ItemQueryReport;
    expect(positions).toMatchObject({ ok: true, truncated: false });
    const byKey = Object.fromEntries(
      positions.rows!.map((row) => [row.indexedKey, row.values.position]),
    );
    expect(byKey).toMatchObject({
      HIGHLGHT: { kind: "pdf-rects" },
      EPUBAN22: { kind: "epub-cfi" },
      SNAPAN22: { kind: "snapshot-css" },
    });
  });

  it("runs every zotlit:query-guide example on the Fixture", async () => {
    const guide = await cliCommand(vaultId, "zotlit:query-guide");
    const prefix = "obsidian zotlit:query ";
    const examples = guide
      .split("\n")
      .map((line) => line.trim())
      .filter(
        (line) =>
          line.startsWith(prefix) && !line.slice(prefix.length).startsWith("["),
      );
    expect(examples.length).toBeGreaterThan(10);
    for (const line of examples) {
      // Guide examples quote whole values with single quotes; the unit test
      // verifies that their values contain no single quote themselves.
      const tokens: string[] = [];
      let token = "";
      let quoted = false;
      for (const char of line.slice(prefix.length)) {
        if (char === "'") quoted = !quoted;
        else if (char === " " && !quoted) {
          if (token) tokens.push(token);
          token = "";
        } else token += char;
      }
      if (token) tokens.push(token);
      const result = JSON.parse(
        await cli([`vault=${vaultId}`, "zotlit:query", ...tokens]),
      ) as ItemQueryReport;
      expect(result, line).toMatchObject({
        contractVersion: 3,
        command: "zotlit:query",
        ok: true,
        warnings: [],
      });
    }
    for (const topic of [
      "datasets",
      "filter",
      "fields",
      "sort",
      "group",
      "results",
      "schema",
      "cancel",
    ]) {
      const text = await cliCommand(vaultId, "zotlit:query-guide", {
        args: { topic },
      });
      expect(guide).toContain(text);
      expect(text.length).toBeLessThan(guide.length);
    }
  });

  it("describes ZotLit Query through zotlit:query-schema", async () => {
    const version = await obEval(
      vaultId,
      "app.plugins.plugins.zotlit.manifest.version",
    );
    const answer = JSON.parse(
      await cliCommand(vaultId, "zotlit:query-schema"),
    ) as ItemQuerySchemaReport;

    expect(answer).toMatchObject({
      contractVersion: 3,
      command: "zotlit:query-schema",
      ok: true,
      schema: {
        url: `https://github.com/aidenlx/zotlit/releases/download/res-${version}/query.schema.json`,
        fileName: `zotlit-query-${version}.schema.json`,
      },
      defaults: {
        items: {
          fields: ["itemType", "title", "creators", "date", "dateModified"],
          sort: [{ field: "dateModified", direction: "desc" }],
          limit: 100,
          library: { source: "library-scope" },
        },
      },
    });
    expect(answer.customFields).toEqual(expect.any(Array));
    expect(Object.keys(answer.schema!)).toEqual(["url", "fileName"]);
    // Dev versions have no Resource Release; inspect the same build artifact
    // that release CI stages and verifies at the reported version-pinned URL.
    const catalog = JSON.parse(
      await readFile(
        join(workspaceRoot, "packages/item-query/dist/query.schema.json"),
        "utf8",
      ),
    ) as {
      datasets: Record<string, { fields: object[] }>;
      functions: { name: string }[];
      types: string[];
      methods: object[];
    };
    expect(catalog.datasets.items!.fields).toContainEqual({
      path: "title",
      type: "string",
      filter: "string",
      projection: true,
      group: true,
      sort: true,
    });
    for (const dataset of ["items", "attachments", "annotations"])
      for (const path of ["indexedKey", "key"])
        expect(catalog.datasets[dataset]!.fields).toContainEqual(
          expect.objectContaining({ path, projection: true, sort: true }),
        );
    expect(catalog.datasets.attachments!.fields).toContainEqual(
      expect.objectContaining({
        path: "fileType",
        projection: true,
        filter: "string",
        sort: true,
        group: true,
        valueForms: ["pdf", "epub", "web", "other"],
      }),
    );
    expect(catalog.functions.map(({ name }) => name)).toContain("today");
    expect(catalog.types).toContain("regexp");
    expect(catalog.methods).toContainEqual(
      expect.objectContaining({
        name: "filter",
        on: "list",
        scope: ["value", "index"],
      }),
    );
  });

  it("rejects unavailable datasets and the removed libraries parameter through zotlit:query", async () => {
    const unsupported = JSON.parse(
      await cliCommand(vaultId, "zotlit:query", {
        args: { from: "unknown" },
      }),
    );
    expect(unsupported).toMatchObject({
      ok: false,
      diagnostic: {
        code: "invalid-argument",
        expected: ["items", "attachments", "annotations"],
      },
    });
    const removed = JSON.parse(
      await cliCommand(vaultId, "zotlit:query", { args: { libraries: "all" } }),
    );
    expect(removed).toMatchObject({
      ok: false,
      diagnostic: { hint: expect.stringContaining("Use library=") },
    });
  });

  it("answers an invalid zotlit:query with the code, location, and hint", async () => {
    for (const [name, value] of [
      ["filter", 'title == "no such item"'],
      ["limit", "all"],
    ] as const) {
      const malformed = JSON.parse(
        await cliCommand(vaultId, "zotlit:query", {
          args: { [`--${name}`]: value },
        }),
      ) as ItemQueryReport;
      expect(malformed).toMatchObject({
        ok: false,
        diagnostic: {
          code: "invalid-argument",
          details: { parameter: `--${name}` },
        },
      });
    }
    const answer = JSON.parse(
      await cliCommand(vaultId, "zotlit:query", {
        args: {
          filter: "title.startsWith(1)",
        },
      }),
    ) as ItemQueryReport;

    expect(answer).toMatchObject({
      contractVersion: 3,
      command: "zotlit:query",
      ok: false,
      diagnostic: {
        code: "wrong-argument-type",
        location: { argument: "filter", span: { from: 17, to: 18 } },
        found: "a number",
        expected: ["a string"],
      },
    });
  });

  // Failure modes: CLI serialization must preserve syntax corrections, ranked
  // names, and successful warnings; report boundaries must match legacy fields.
  it("reports zotlit:query syntax, unknown names, and never-true warnings", async () => {
    for (const probe of [
      {
        filter: 'itemType == "book" AND date.year > 2010',
        ok: false,
        code: "invalid-filter",
        at: "AND",
        suggestion: 'itemType == "book" && date.year > 2010',
      },
      {
        filter: "year > 2015",
        ok: false,
        code: "unknown-field",
        at: "year",
        suggestion: "date.year",
      },
      {
        filter: 'tags == "bulk"',
        ok: true,
        code: "never-true",
        at: 'tags == "bulk"',
        suggestion: 'tags.contains("bulk")',
      },
    ]) {
      const answer = JSON.parse(
        await cliCommand(vaultId, "zotlit:query", {
          args: { filter: probe.filter, fields: "[]", limit: "1" },
        }),
      ) as ItemQueryReport;
      expect(answer).toMatchObject({
        contractVersion: 3,
        command: "zotlit:query",
        ok: probe.ok,
      });
      const diagnostic = probe.ok ? answer.warnings?.[0] : answer.diagnostic;
      expect(diagnostic).toMatchObject({
        code: probe.code,
        severity: probe.ok ? "warning" : "error",
        excerpt: { at: probe.at },
      });
      expect(diagnostic!.suggestions[0]).toBe(probe.suggestion);
      expect(diagnostic!.message).not.toBe("");
      expect(diagnostic!.hint).not.toBe("");
      expect(diagnostic!.report[0]).toBe(diagnostic!.message);
      expect(diagnostic!.report.at(-1)).toBe(diagnostic!.hint);
      if (probe.ok) {
        expect(answer.warnings).toHaveLength(1);
        expect(answer).toMatchObject({
          returnedCount: 0,
          rows: [],
          truncated: false,
        });
        expect(Object.keys(answer).indexOf("warnings")).toBeLessThan(
          Object.keys(answer).indexOf("rows"),
        );
      }
    }
  });

  it("reports zotlit:query from=annotations syntax, unknown names, and never-true warnings", async () => {
    for (const probe of [
      {
        filter: 'type == "image" AND item.date.year > 2010',
        ok: false,
        code: "invalid-filter",
        at: "AND",
        suggestion: 'type == "image" && item.date.year > 2010',
      },
      {
        filter: "pageLable == 1",
        ok: false,
        code: "unknown-field",
        at: "pageLable",
        suggestion: "pageLabel",
      },
      {
        filter: 'tags == "bulk"',
        ok: true,
        code: "never-true",
        at: 'tags == "bulk"',
        suggestion: 'tags.contains("bulk")',
      },
    ]) {
      const answer = JSON.parse(
        await cliCommand(vaultId, "zotlit:query", {
          args: {
            from: "annotations",
            filter: probe.filter,
            fields: "[]",
            limit: "1",
          },
        }),
      ) as ItemQueryReport;
      expect(answer).toMatchObject({
        contractVersion: 3,
        command: "zotlit:query",
        ok: probe.ok,
      });
      const diagnostic = probe.ok ? answer.warnings?.[0] : answer.diagnostic;
      expect(diagnostic).toMatchObject({
        code: probe.code,
        severity: probe.ok ? "warning" : "error",
        excerpt: { at: probe.at },
      });
      expect(diagnostic!.suggestions[0]).toBe(probe.suggestion);
      expect(diagnostic!.message).not.toBe("");
      expect(diagnostic!.hint).not.toBe("");
      expect(diagnostic!.report[0]).toBe(diagnostic!.message);
      expect(diagnostic!.report.at(-1)).toBe(diagnostic!.hint);
      if (probe.ok) {
        expect(answer.warnings).toHaveLength(1);
        expect(answer).toMatchObject({
          returnedCount: 0,
          rows: [],
          truncated: false,
        });
        expect(Object.keys(answer).indexOf("warnings")).toBeLessThan(
          Object.keys(answer).indexOf("rows"),
        );
      }
    }
  });

  it("rejects retired ZotLit Query selectors with filter guidance", async () => {
    for (const parameter of ["item", "attachment"]) {
      const result = JSON.parse(
        await cliCommand(vaultId, "zotlit:query", {
          args: {
            from: "annotations",
            [parameter]: "QANITM22",
            library: "personal",
          },
        }),
      ) as ItemQueryReport;
      expect(result).toMatchObject({
        ok: false,
        diagnostic: {
          code: "invalid-argument",
          location: { argument: parameter },
          hint: `Use filter='${parameter}.indexedKey == "<key>"' to select by Indexed Key.`,
        },
      });
      expect(result.diagnostic!.report.at(-1)).toBe(result.diagnostic!.hint);
    }
  });

  it("discovers Collection paths with zotlit:query-values and warns about unknown paths", async () => {
    const listing = JSON.parse(
      await cliCommand(vaultId, "zotlit:query-values", {
        args: { kind: "collections", library: "personal", limit: "all" },
      }),
    ) as {
      ok: boolean;
      contractVersion: number;
      values: { library: string; values: string[]; truncated: boolean }[];
    };
    expect(listing).toMatchObject({
      ok: true,
      contractVersion: 3,
      values: [{ library: "personal", truncated: false }],
    });
    const collection = COLLECTIONS.find(({ key }) => key === "PERSCHLD")!;
    const parent = COLLECTIONS.find(
      ({ collectionID }) => collectionID === collection.parentCollectionID,
    )!;
    const path = listing.values[0]!.values.find(
      (value) => value === `${parent.name}/${collection.name}`,
    );
    expect(path).toBeDefined();
    const found = JSON.parse(
      await cliCommand(vaultId, "zotlit:query", {
        args: {
          library: "personal",
          filter: `collections.within(${JSON.stringify(path)})`,
          fields: "[]",
          limit: "all",
        },
      }),
    ) as ItemQueryReport;
    expect(found.ok).toBe(true);
    expect(found.returnedCount).toBeGreaterThan(0);
    expect(found.warnings).toEqual([]);
    const wrong = path!.toUpperCase();
    expect(wrong).not.toBe(path);
    const unknown = JSON.parse(
      await cliCommand(vaultId, "zotlit:query", {
        args: {
          library: "personal",
          filter: `collections.within(${JSON.stringify(wrong)})`,
          fields: "[]",
        },
      }),
    ) as ItemQueryReport;
    expect(unknown).toMatchObject({
      ok: true,
      rows: [],
      warnings: [
        { code: "unknown-collection", severity: "warning", found: wrong },
      ],
    });
    expect(unknown.warnings![0]!.suggestions[0]).toBe(path);
    expect(unknown.warnings![0]!.hint).toContain(
      "zotlit:query-values kind=collections",
    );
  });

  it("warns for a ZotLit Query Indexed Key outside the Target Libraries", async () => {
    const groupLibrary = LIBRARIES.find((library) => library.groupID !== null)!;
    const groupItem = ITEMS.find(
      (item) => item.libraryID === groupLibrary.libraryID,
    )!;
    const indexedKey = `${groupItem.key}g${groupLibrary.groupID}`;
    const result = JSON.parse(
      await cliCommand(vaultId, "zotlit:query", {
        args: {
          library: "personal",
          filter: `indexedKey == "${indexedKey}"`,
          fields: "[]",
          limit: "all",
        },
      }),
    ) as ItemQueryReport;
    expect(result).toMatchObject({
      ok: true,
      rows: [],
      returnedCount: 0,
      truncated: false,
      libraries: [{ type: "personal" }],
      request: { library: ["personal"] },
      warnings: [
        {
          code: "key-outside-target-libraries",
          severity: "warning",
          found: indexedKey,
          suggestions: [`library=personal,group:${groupLibrary.groupID}`],
        },
      ],
    });
  });

  it("answers a -- token on a required or format parameter with the zotlit decoder's diagnostic", async () => {
    // Obsidian itself checks a required flag and turns a format alias into
    // format=<value>; each token here must still reach the zotlit decoder.
    const resolved = JSON.parse(
      await cliCommand(vaultId, "zotlit:resolve", {
        args: { "--file": "/tmp/a.md" },
      }),
    ) as { errors: { code: string; message: string }[] };
    expect(resolved.errors).toEqual([
      {
        code: "flags-invalid",
        message: expect.stringContaining("use file=<value>"),
      },
    ]);

    const data = JSON.parse(
      await cli([
        `vault=${vaultId}`,
        "zotlit:template-data",
        "root=note",
        "key=ABCD2345",
        "--json",
      ]),
    ) as unknown;
    expect(data).toMatchObject({
      ok: false,
      diagnostic: {
        code: "INVALID_SELECTOR",
        details: { parameter: "--json" },
      },
    });
  });

  it("sorts titles in the pinned ZotLit Query string order", async () => {
    // The order Node gives in the package tests; this run proves that the
    // collator of Obsidian's Electron gives the same.
    const answer = JSON.parse(
      await cliCommand(vaultId, "zotlit:query", {
        args: {
          filter:
            '["Zebra", "apple", "Éclair", "eclair", "10", "9"].contains(title)',
          fields: "title",
          sort: "title",
          limit: "all",
        },
      }),
    ) as ItemQueryReport;

    expect(answer.ok).toBe(true);
    expect(answer.rows!.map((row) => row.values.title)).toEqual([
      "10",
      "9",
      "apple",
      "eclair",
      "Éclair",
      "Zebra",
    ]);
  });
  it("refreshes the database from a Freshness Signal", async () => {
    const services = "app.plugins.plugins.zotlit.services";
    const autoRefresh = await obEval(
      vaultId,
      `String(${services}.settings.current['zotero.auto-refresh'])`,
    );
    await using cleanup = new AsyncDisposableStack();
    // Only the signal may refresh: the file watchers stay unbound.
    await obEval(
      vaultId,
      `${services}.settings.update({'zotero.auto-refresh':false});true`,
    );
    cleanup.defer(async () => {
      await obEval(
        vaultId,
        `${services}.settings.update({'zotero.auto-refresh':${autoRefresh}});true`,
      );
    });
    await obEval(
      vaultId,
      `window.zotlitE2EChanged=0;window.zotlitE2EOffChanged=${services}.zoteroReads.on('changed',function(){window.zotlitE2EChanged++;});true`,
    );
    cleanup.defer(async () => {
      await obEval(
        vaultId,
        "window.zotlitE2EOffChanged();delete window.zotlitE2EOffChanged;delete window.zotlitE2EChanged;true",
      );
    });
    // The annotation sidebar keeps its cards while the refresh reads again.
    cleanup.defer(async () => {
      await obEval(
        vaultId,
        "(async()=>{await window.zotlitE2ESidebar?.cleanup.disposeAsync();delete window.zotlitE2ESidebar;return true;})()",
      );
    });
    expect(
      await obEval(
        vaultId,
        `(async()=>{
          await using cleanup=new AsyncDisposableStack();
          const leaf=cleanup.adopt(app.workspace.getRightLeaf(true),leaf=>leaf.detach());
          await leaf.setViewState({type:'zotero-annotation-view',state:{followMode:'pinned',pinnedItemKey:${JSON.stringify(annotationItem.key)}}});
          const view=leaf.view;await view.read;
          const count=()=>view.contentEl.querySelectorAll('.zt-annot-card').length;
          for(let i=0;i<100&&count()===0;i++)await new Promise(r=>setTimeout(r,50));
          const watch={before:count(),least:count()};
          watch.observer=new MutationObserver(()=>{watch.least=Math.min(watch.least,count());});
          cleanup.defer(()=>watch.observer.disconnect());
          watch.observer.observe(view.contentEl,{childList:true,subtree:true});
          watch.cleanup=cleanup.move();window.zotlitE2ESidebar=watch;
          return String(watch.before);
        })()`,
      ),
    ).toBe(String(attachmentAnnotations.length));
    const signal = () => signalDatabaseUpdated(vaultId);
    // A Zotero edit moves the Item's title and its modification time.
    const edit = (title: string, dateModified: string) => {
      using database = new DatabaseSync(e2eFixture.databasePath);
      database
        .prepare(
          "update itemDataValues set value = ? where valueID = (select itemData.valueID from itemData join fieldsCombined using (fieldID) where itemData.itemID = ? and fieldsCombined.fieldName = 'title')",
        )
        .run(title, targetItem.itemID);
      database
        .prepare("update items set dateModified = ? where itemID = ?")
        .run(dateModified, targetItem.itemID);
    };
    const original = (() => {
      using database = new DatabaseSync(e2eFixture.databasePath);
      return database
        .prepare("select dateModified from items where itemID = ?")
        .get(targetItem.itemID) as { dateModified: string };
    })();
    const finds = (query: string) =>
      obEvalUntil(
        vaultId,
        `(async function(){var hits=await ${services}.itemLookup.search(${JSON.stringify(query)});return String(hits.some(function(hit){return hit.item.itemID===${targetItem.itemID};}));})()`,
        { expected: "true" },
      );

    edit("Freshness signal probe zqxv", "2031-01-01 00:00:00");
    cleanup.defer(async () => {
      edit(targetItem.title, original.dateModified);
      await signal();
      expect(await finds(targetItem.title)).toBe(true);
    });
    await signal();
    expect(
      await obEvalUntil(vaultId, "String(window.zotlitE2EChanged>=1)", {
        expected: "true",
      }),
    ).toBe(true);
    expect(await finds("zqxv")).toBe(true);
    expect(
      await obEval(
        vaultId,
        "JSON.stringify({least:window.zotlitE2ESidebar.least,now:window.zotlitE2ESidebar.observer&&document.querySelectorAll('.workspace-leaf .zt-annot-card').length>0})",
      ),
    ).toBe(JSON.stringify({ least: attachmentAnnotations.length, now: true }));
  });

  it("rebuilds the worker's Item Index off the renderer, then inserts a citation from it", async () => {
    const finds = (query: string, itemID: number) =>
      `(async function(){var hits=await app.plugins.plugins.zotlit.services.itemLookup.search(${JSON.stringify(query)});return String(hits.some(function(hit){return hit.item.itemID===${itemID};}));})()`;
    // An empty index answers fast; it fails the run here, before any timing.
    expect(
      await obEval(vaultId, finds("simple rules", annotationItem.itemID)),
    ).toBe("true");
    await using cleanup = new AsyncDisposableStack();

    // A sync lands a large Library: the worker builds its index while the
    // renderer keeps painting.
    const corpus = syntheticTitles(SYNTHETIC_CORPUS_SIZE);
    const lastTitleQuery = `${SYNTHETIC_MARKER} ${corpus.at(-1)!.split(" ").at(-1)!}`;
    const heapBefore = await rendererHeap(vaultId);
    await using frames = await recordFrames(vaultId);
    const added = addMyLibraryItems(e2eFixture.databasePath, corpus);
    const lastItemID = added.firstItemID + corpus.length - 1;
    cleanup.defer(async () => {
      added[Symbol.dispose]();
      await signalDatabaseUpdated(vaultId);
      expect(
        await obEvalUntil(vaultId, finds(lastTitleQuery, lastItemID), {
          expected: "false",
        }),
      ).toBe(true);
    });
    await signalDatabaseUpdated(vaultId);
    // Until the build completes, the held index answers: a known Item stays
    // found. The new Items show once it completes.
    const rebuild = JSON.parse(
      await obEval(
        vaultId,
        `(async function(){var lookup=app.plugins.plugins.zotlit.services.itemLookup;var has=function(hits,id){return hits.some(function(hit){return hit.item.itemID===id;});};var start=performance.now();var waits=[];var staleMisses=0;while(performance.now()-start<60000){if(has(await lookup.search(${JSON.stringify(lastTitleQuery)}),${lastItemID}))return JSON.stringify({builtMs:Math.round(performance.now()-start),polls:waits.length,staleMisses:staleMisses,waitMedianMs:waits.sort(function(a,b){return a-b;})[waits.length>>1],waitMaxMs:waits.at(-1)});var t0=performance.now();if(!has(await lookup.search('simple rules'),${annotationItem.itemID}))staleMisses++;waits.push(Math.round((performance.now()-t0)*10)/10);await new Promise(function(resolve){setTimeout(resolve,10);});}return JSON.stringify({builtMs:null});})()`,
        90_000,
      ),
    ) as {
      builtMs: number | null;
      polls: number;
      staleMisses: number;
      waitMedianMs: number;
      waitMaxMs: number;
    };
    const painted = await frames.read();
    const heapGrowth = (await rendererHeap(vaultId)) - heapBefore;
    console.info("Item Index rebuild, 10,000 Items", {
      ...rebuild,
      ...painted,
      rendererHeapGrowthMB: Math.round(heapGrowth / 1e5) / 10,
    });
    expect(rebuild.builtMs).not.toBeNull();
    // A search that misses the new Items answered before the build ended, so
    // the held index answered at least once.
    expect(rebuild.polls).toBeGreaterThan(0);
    expect(rebuild.staleMisses).toBe(0);
    expect(painted.frames).toBeGreaterThan(1);
    // The renderer may take a short long task of its own; none blocks it
    // for more than 100 ms while the worker builds.
    expect(painted.longestTaskMs).toBeLessThanOrEqual(100);
    // ADR 0069 measured about 1 MB of index per 1,000 Items; the renderer
    // keeps less than a quarter of that.
    expect(heapGrowth).toBeLessThan((corpus.length * 1000) / 4);

    // Query cost through the shipped adapter, for ADR 0069's Measurements.
    // Each query must find Items, so its time includes the hydration.
    const words = corpus[123]!.split(" ");
    const queries = [
      "k",
      words[2]!,
      `${SYNTHETIC_MARKER} ${words[3]!}`,
      `Synthauthor${added.firstItemID + 12}`,
      lastTitleQuery,
    ];
    const timings = JSON.parse(
      await obEval(
        vaultId,
        `(async function(){var lookup=app.plugins.plugins.zotlit.services.itemLookup;var out={};for(var query of ${JSON.stringify(queries)}){var times=[];var hits=0;for(var i=0;i<21;i++){var t0=performance.now();hits=(await lookup.search(query)).length;times.push(performance.now()-t0);}times.sort(function(a,b){return a-b;});out[query]={hits:hits,medianMs:Math.round(times[10]*10)/10,p95Ms:Math.round(times[19]*10)/10};}return JSON.stringify(out);})()`,
        90_000,
      ),
    ) as Record<string, { hits: number; medianMs: number; p95Ms: number }>;
    console.info("Item Index queries, 10,000 Items", timings);
    for (const query of queries)
      expect(timings[query]!.hits).toBeGreaterThan(0);

    // A large classification bounds renderer request encoding as well as
    // worker replies, while every request uses the same Snapshot (#1351).
    await obEval(
      vaultId,
      `(()=>{const original=Worker.prototype.postMessage;const requests=[];Worker.prototype.postMessage=function(message,...rest){const request=message?.[1];if(request?.tag==='DisplayRefs')requests.push({count:request.payload.itemIDs.length,snapshot:request.payload.snapshot});return original.call(this,message,...rest);};window.zotlitE2EClassifyRequests={requests,restore:()=>{Worker.prototype.postMessage=original;}};return true;})()`,
    );
    try {
      expect(
        await obEval(
          vaultId,
          "app.commands.executeCommandById('zotlit:update-all-notes')",
        ),
      ).toBe("true");
      expect(
        await obEvalUntil(
          vaultId,
          `String(Array.from(activeDocument.querySelectorAll('.modal button')).some(button=>button.textContent.trim()===${JSON.stringify(m.batch_update_confirm_button())}))`,
          { expected: "true" },
        ),
      ).toBe(true);
      const requests = JSON.parse(
        await obEval(
          vaultId,
          "JSON.stringify(window.zotlitE2EClassifyRequests.requests)",
        ),
      ) as { count: number; snapshot: string }[];
      expect(
        requests.reduce((total, request) => total + request.count, 0),
      ).toBeGreaterThanOrEqual(SYNTHETIC_CORPUS_SIZE);
      expect(requests.every(({ count }) => count <= 500)).toBe(true);
      expect(requests[0]?.snapshot).toBeDefined();
      expect(new Set(requests.map(({ snapshot }) => snapshot)).size).toBe(1);
    } finally {
      await clickModalButton(vaultId, m.modal_cancel());
      await obEval(
        vaultId,
        "window.zotlitE2EClassifyRequests.restore();delete window.zotlitE2EClassifyRequests;true",
      );
    }

    // The Citation Suggester over that Library. It comes after the
    // measurement: a rendered citation can start the Pandoc engine, and that
    // start is renderer work of its own.
    const source = "Citation suggester source.md";
    await obEval(
      vaultId,
      `(async function(){var file=await app.vault.create(${JSON.stringify(source)},'');var leaf=app.workspace.getLeaf(true);await leaf.openFile(file,{state:{mode:'source',source:true}});leaf.view.editor.focus();return true;})()`,
    );
    cleanup.defer(async () => {
      await obEval(
        vaultId,
        `(async function(){var file=app.vault.getAbstractFileByPath(${JSON.stringify(source)});for(var leaf of app.workspace.getLeavesOfType('markdown'))if(leaf.view.file===file)leaf.detach();await app.fileManager.trashFile(file);return true;})()`,
      );
    });
    const editor = `app.workspace.getLeavesOfType('markdown').find(function(leaf){return leaf.view.file?.path===${JSON.stringify(source)};}).view.editor`;
    // One key every 70 ms, past Obsidian's 50 ms suggester delay, so each
    // keystroke sends its own search. The popup opens at `[@` and stays
    // open through every answer after it.
    expect(
      await obEval(
        vaultId,
        `(async function(){var cm=${editor}.cm;var watch={opened:false,closed:false};var observer=new MutationObserver(function(records){for(var record of records)for(var node of record.removedNodes)if(node.classList?.contains('suggestion-container'))watch.closed=true;});try{for(var ch of ${JSON.stringify("[@ten simple")}){cm.dispatch(cm.state.replaceSelection(ch),{userEvent:'input.type'});await new Promise(function(resolve){setTimeout(resolve,70);});if(!watch.opened&&activeDocument.querySelector('.suggestion-container')){watch.opened=true;observer.observe(activeDocument.body,{childList:true,subtree:true});}}}finally{observer.disconnect();}return JSON.stringify(watch);})()`,
      ),
    ).toBe(JSON.stringify({ opened: true, closed: false }));
    const popup =
      "Array.from(activeDocument.querySelectorAll('.suggestion-container')).at(-1)";
    // The list matches the final query: its Item comes first.
    expect(
      await obEvalUntil(
        vaultId,
        `String(!!${popup}?.querySelector('.suggestion-item')?.textContent.includes(${JSON.stringify(annotationItem.title)}))`,
        { expected: "true" },
      ),
    ).toBe(true);
    await obEval(
      vaultId,
      `(function(){var row=${popup}.querySelector('.suggestion-item');row.dispatchEvent(new activeWindow.MouseEvent('mousemove',{bubbles:true}));row.dispatchEvent(new activeWindow.MouseEvent('click',{bubbles:true}));return true;})()`,
    );
    expect(
      await obEvalUntil(vaultId, `${editor}.getValue()`, {
        expected: `[@${annotationItem.citationKey}]`,
      }),
    ).toBe(true);
  }, 180_000);

  it("finds a word inside a Chinese title once the Chinese Segmenter is installed, with no reload", async () => {
    const services = "app.plugins.plugins.zotlit.services";
    const segmenter = `${services}.chineseSegmenter`;
    await using cleanup = new AsyncDisposableStack();
    // The binary cache is device-wide: copy it now and put the copy back at
    // the end, whatever happens between.
    await obEval(
      vaultId,
      `(async function(){var saved=[];try{var dir=await (await (await navigator.storage.getDirectory()).getDirectoryHandle('zotlit')).getDirectoryHandle(${JSON.stringify(SEGMENTER_CACHE_DIR)});for await(var [name,handle] of dir.entries())if(handle.kind==='file')saved.push({name:name,bytes:new Uint8Array(await (await handle.getFile()).arrayBuffer())});}catch(error){if(error.name!=='NotFoundError')throw error;}window.zotlitE2ESegmenterCache=saved;return true;})()`,
    );
    cleanup.defer(async () => {
      await obEval(
        vaultId,
        `(async function(){var root=await (await navigator.storage.getDirectory()).getDirectoryHandle('zotlit',{create:true});await root.removeEntry(${JSON.stringify(SEGMENTER_CACHE_DIR)},{recursive:true}).catch(function(error){if(error.name!=='NotFoundError')throw error;});var saved=window.zotlitE2ESegmenterCache;if(saved.length>0){var dir=await root.getDirectoryHandle(${JSON.stringify(SEGMENTER_CACHE_DIR)},{create:true});for(var entry of saved){var writable=await (await dir.getFileHandle(entry.name,{create:true})).createWritable();await writable.write(entry.bytes);await writable.close();}}delete window.zotlitE2ESegmenterCache;return true;})()`,
      );
    });
    // Start from no binary, as a user who has not installed it yet.
    await obEval(
      vaultId,
      `${segmenter}.uninstall().then(function(){return true;})`,
    );
    const added = addMyLibraryItems(e2eFixture.databasePath, [
      "长江流域的城市化研究",
    ]);
    cleanup.defer(async () => {
      added[Symbol.dispose]();
      await signalDatabaseUpdated(vaultId);
    });
    await signalDatabaseUpdated(vaultId);
    const finds = (query: string) =>
      `(async function(){var hits=await ${services}.itemLookup.search(${JSON.stringify(query)});return String(hits.some(function(hit){return hit.item.itemID===${added.firstItemID};}));})()`;
    expect(
      await obEvalUntil(vaultId, finds("长江流域"), { expected: "true" }),
    ).toBe(true);
    // `Intl.Segmenter` keeps `长江流域` one word, so the word inside misses.
    expect(await obEval(vaultId, finds("流域"))).toBe("false");

    await obEval(
      vaultId,
      "window.zotlitE2EPlugin=app.plugins.plugins.zotlit;true",
    );
    cleanup.defer(async () => {
      await obEval(vaultId, "delete window.zotlitE2EPlugin;true");
    });
    expect(
      await obEval(
        vaultId,
        `${segmenter}.install().then(function(){return ${segmenter}.getStatus().kind;})`,
        120_000,
      ),
    ).toBe("installed");
    expect(
      await obEvalUntil(vaultId, finds("流域"), { expected: "true" }),
    ).toBe(true);

    await obEval(
      vaultId,
      `${segmenter}.uninstall().then(function(){return true;})`,
    );
    expect(
      await obEvalUntil(vaultId, finds("流域"), { expected: "false" }),
    ).toBe(true);
    expect(await obEval(vaultId, finds("长江流域"))).toBe("true");
    expect(
      await obEval(
        vaultId,
        "String(window.zotlitE2EPlugin===app.plugins.plugins.zotlit)",
      ),
    ).toBe("true");
  }, 180_000);

  it("writes the database worker's log records to the plugin's log file at the configured level", async () => {
    const services = "app.plugins.plugins.zotlit.services";
    const logPath =
      "app.plugins.plugins.zotlit.manifest.dir+'/zotlit.log.jsonl'";
    /** Note where the log file ends, then refresh the database. */
    const refresh = `(async function(){window.zotlitE2ELogStart=(await app.vault.adapter.read(${logPath})).length;await ${services}.zoteroReads.refresh();return true;})()`;
    /**
     * Once the refresh's `Opened Zotero database` record is in the file, the
     * count of `DEBUG` records the refresh added under categories only the
     * database worker logs to; `pending` before.
     */
    const workerDebugRecords = `(async function(){var added=(await app.vault.adapter.read(${logPath})).slice(window.zotlitE2ELogStart).split('\\n').filter(Boolean).map(function(line){return JSON.parse(line);});if(!added.some(function(record){return record.message==='Opened Zotero database';}))return 'pending';return String(added.filter(function(record){return record.level==='DEBUG'&&/^zotlit\\.(db|item-lookup|obsidian\\.database)\\./.test(record.logger);}).length);})()`;
    /** Refresh, and count its worker `DEBUG` records once they are written. */
    const workerDebugRecordsOfARefresh = async () => {
      await obEval(vaultId, refresh);
      let count = "pending";
      await waitFor(async () => {
        count = await obEval(vaultId, workerDebugRecords);
        return count !== "pending";
      });
      return count;
    };
    const previous = await obEval(
      vaultId,
      `JSON.stringify({'log.level':${services}.settings.current['log.level'],'log.to-file':${services}.settings.current['log.to-file']})`,
    );
    try {
      await obEval(
        vaultId,
        `${services}.settings.update({'log.level':'debug','log.to-file':true});true`,
      );
      expect(
        await obEvalUntil(
          vaultId,
          `app.vault.adapter.exists(${logPath}).then(String)`,
          { expected: "true" },
        ),
      ).toBe(true);
      // At `debug`, the worker's read snapshot and Item Index records reach the file.
      expect(
        await waitFor(
          async () => Number(await workerDebugRecordsOfARefresh()) > 0,
          10,
        ),
      ).toBe(true);
      // At `info`, the worker forwards its `Opened Zotero database` record and
      // none of them. The level reaches the worker after the settings change,
      // so a refresh repeats until it does.
      await obEval(
        vaultId,
        `${services}.settings.update({'log.level':'info'});true`,
      );
      expect(
        await waitFor(
          async () => (await workerDebugRecordsOfARefresh()) === "0",
          10,
        ),
      ).toBe(true);
    } finally {
      await obEval(vaultId, `${services}.settings.update(${previous});true`);
    }
  }, 180_000);

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

    // The plugin toggle is also the Zotero database worker's whole life:
    // record every worker spawned and every worker ended across it.
    await obEval(
      vaultId,
      "(function(){var Original=window.Worker;var record={spawned:[],Original:Original,terminate:Original.prototype.terminate,ended:new WeakSet()};record.Recording=class extends Original{constructor(url,options){super(url,options);record.spawned.push({worker:this,name:options&&options.name});}};Original.prototype.terminate=function(){record.ended.add(this);return record.terminate.call(this);};window.Worker=record.Recording;window.zotlitE2EWorkers=record;return true;})()",
    );
    const workers = (expression: string) =>
      `(function(){var record=window.zotlitE2EWorkers;return ${expression};})()`;
    await using restoreWorkers = new AsyncDisposableStack();
    restoreWorkers.defer(async () => {
      await obEval(
        vaultId,
        workers(
          "(window.Worker=record.Original,record.Original.prototype.terminate=record.terminate,delete window.zotlitE2EWorkers,true)",
        ),
      );
      await obEval(
        vaultId,
        "(app.plugins.plugins.zotlit?Promise.resolve():app.plugins.enablePlugin('zotlit')).then(function(){return true;})",
      );
    });
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

    {
      // The load spawned one database worker, and it serves.
      expect(
        await obEval(
          vaultId,
          workers(
            "String(record.spawned.filter(function(entry){return entry.name==='zotlit-zotero-reads';}).length)",
          ),
        ),
      ).toBe("1");
      expect(
        await obEvalUntil(
          vaultId,
          "String(app.plugins.plugins.zotlit.services.zoteroReads.state)",
          { expected: "ready" },
        ),
      ).toBe(true);
      // Unload ends it.
      await obEval(
        vaultId,
        "app.plugins.disablePlugin('zotlit').then(function(){return true;})",
      );
      expect(
        await obEvalUntil(
          vaultId,
          workers(
            "String(record.ended.has(record.spawned.find(function(entry){return entry.name==='zotlit-zotero-reads';}).worker))",
          ),
          { expected: "true" },
        ),
      ).toBe(true);
    }
  });
});

/** The `zotlit:query` reply shape this suite reads (see
 *  apps/obsidian/src/services/item-query/contract.ts and answer.ts). */
interface ItemQueryReport {
  contractVersion: number;
  command: string;
  ok: boolean;
  identity?: { source: { id: string | null; databasePath: string } };
  libraries?: (
    | { type: "personal" }
    | { type: "group"; groupID: number; name: string }
  )[];
  request?: {
    from: "items" | "attachments" | "annotations";
    library: string[];
    fields: string[];
    limit: number | null;
  };
  returnedCount?: number;
  totalCount?: number;
  groups?: {
    value: string | number | boolean | null;
    count: number;
    rows: { indexedKey: string; values: Record<string, unknown> }[];
  }[];
  truncated?: boolean;
  rows?: { indexedKey: string; values: Record<string, unknown> }[];
  diagnostic?: ItemQueryDiagnostic;
  warnings?: ItemQueryDiagnostic[];
}

interface ItemQueryDiagnostic {
  code: string;
  message: string;
  hint: string;
  report: string[];
  suggestions: string[];
  severity: "error" | "warning";
  excerpt?: { before: string; at: string; after: string };
  location?: { argument: string; span?: { from: number; to: number } };
}

/** The `zotlit:query-schema` reply shape this suite reads (see
 *  apps/obsidian/src/services/item-query/contract.ts and answer.ts). */
interface ItemQuerySchemaReport {
  contractVersion: number;
  command: string;
  ok: boolean;
  schema?: { url: string; fileName: string };
  customFields?: { name: string; path: string; bareName: boolean }[];
  defaults?: object;
}

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

describe.skipIf(!reachable)("Fresh destination flow", () => {
  const vaultPath = e2eVaultDir(workspaceRoot, "destination-vault");
  let vaultId = "";
  let m: typeof import("@obsidian-messages");

  beforeAll(async () => {
    m = await import("@obsidian-messages");
    await clearVault(runVaultScript, vaultPath);
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
    await keepRendering(vaultId);
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
    expect(await readFile(join(vaultPath, first.path), "utf-8")).toBe(original);

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
      (await readdir(vaultPath, { recursive: true }))
        .filter(
          (path) => path.includes("zotlit-profile.") && path.endsWith(".md"),
        )
        .map((path) => path.replaceAll("\\", "/")),
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
    expect(await readFile(join(vaultPath, first.path), "utf-8")).toBe(original);
    expect(await indexedNote(vaultId, 46)).toEqual({
      indexedKey: first.indexedKey,
      path: first.path,
    });
  }, 180000);
});

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

/**
 * Watch the window's frames from now on: the longest gap between two
 * animation frames, and the long tasks the renderer reported.
 */
async function recordFrames(vaultId: string): Promise<
  AsyncDisposable & {
    read(): Promise<{
      frames: number;
      maxFrameGapMs: number;
      longTasks: number;
      longestTaskMs: number;
    }>;
  }
> {
  await obEval(
    vaultId,
    "(function(){var record={frames:0,maxFrameGapMs:0,longTasks:0,longestTaskMs:0,live:true};var previous=performance.now();var tick=function(now){record.frames++;record.maxFrameGapMs=Math.max(record.maxFrameGapMs,now-previous);previous=now;if(record.live)requestAnimationFrame(tick);};requestAnimationFrame(tick);record.observer=new PerformanceObserver(function(list){for(var entry of list.getEntries()){record.longTasks++;record.longestTaskMs=Math.max(record.longestTaskMs,entry.duration);}});record.observer.observe({type:'longtask'});window.zotlitE2EFrames=record;return true;})()",
  );
  return {
    async read() {
      return JSON.parse(
        await obEval(
          vaultId,
          "(function(){var r=window.zotlitE2EFrames;return JSON.stringify({frames:r.frames,maxFrameGapMs:Math.round(r.maxFrameGapMs),longTasks:r.longTasks,longestTaskMs:Math.round(r.longestTaskMs)});})()",
        ),
      ) as {
        frames: number;
        maxFrameGapMs: number;
        longTasks: number;
        longestTaskMs: number;
      };
    },
    async [Symbol.asyncDispose]() {
      await obEval(
        vaultId,
        "(function(){var r=window.zotlitE2EFrames;r.live=false;r.observer.disconnect();delete window.zotlitE2EFrames;return true;})()",
      );
    },
  };
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

/** Captures notices across the vault's open documents, including a window
 * whose closure moves the next notice to the main window. */
async function observeNotices(vaultId: string) {
  await obEval(
    vaultId,
    `(()=>{
      using observers=new DisposableStack();
      const values=new Map();
      const documents=new Set([...${WINDOW_DOCUMENTS},activeDocument]);
      for(const doc of documents){
        const previous=new Set(doc.querySelectorAll('.notice'));
        const observer=observers.adopt(new doc.defaultView.MutationObserver(()=>{
          for(const element of doc.querySelectorAll('.notice'))
            if(!previous.has(element))values.set(element,element.textContent);
        }),value=>value.disconnect());
        observer.observe(doc.body,{childList:true,subtree:true});
      }
      window.zotlitE2ENotices={observers:observers.move(),values};return true;
    })()`,
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
        "window.zotlitE2ENotices.observers[Symbol.dispose]();delete window.zotlitE2ENotices;true",
      );
    },
  };
}

/** The Chinese Segmenter's device-wide cache directory under OPFS `zotlit/`. */
const SEGMENTER_CACHE_DIR = "chinese-segmenter";

/** Items a synthetic sync adds: the scale ADR 0069 measured at. */
const SYNTHETIC_CORPUS_SIZE = 10_000;
/** A word only synthetic Items carry. */
const SYNTHETIC_MARKER = "zqsynth";

/**
 * Deterministic synthetic titles, each with {@link SYNTHETIC_MARKER} and a
 * last word no other title has.
 */
function syntheticTitles(count: number): string[] {
  let seed = 42;
  const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648);
  const syllables = "ka ri mo ne lu ta si po ve ga ro mi da ze nu fo".split(
    " ",
  );
  const vocabulary = Array.from({ length: 600 }, () =>
    Array.from(
      { length: 2 + (random() % 3) },
      () => syllables[random() % syllables.length],
    ).join(""),
  );
  return Array.from({ length: count }, (_, index) =>
    [
      SYNTHETIC_MARKER,
      ...Array.from(
        { length: 6 + (random() % 8) },
        () => vocabulary[random() % vocabulary.length],
      ),
      `v${index}`,
    ].join(" "),
  );
}

/**
 * Writes journal articles into the Fixture's My Library the way Zotero stores
 * them: a title, a journal, and one to three authors each. Disposing deletes
 * every row it wrote.
 */
function addMyLibraryItems(
  databasePath: string,
  titles: readonly string[],
): Disposable & { firstItemID: number } {
  using database = new DatabaseSync(databasePath);
  const id = (sql: string, ...params: string[]) =>
    Number(Object.values(database.prepare(sql).get(...params)!)[0]);
  const itemTypeID = id(
    "select itemTypeID from itemTypes where typeName = 'journalArticle'",
  );
  const field = (name: string) =>
    id("select fieldID from fieldsCombined where fieldName = ?", name);
  const titleField = field("title");
  const journalField = field("publicationTitle");
  const authorTypeID = id(
    "select creatorTypeID from creatorTypes where creatorType = 'author'",
  );
  const firstItemID = id("select max(itemID) + 1 from items");
  const firstValueID = id("select max(valueID) + 1 from itemDataValues");
  const firstCreatorID = id(
    "select coalesce(max(creatorID), 0) + 1 from creators",
  );
  const libraryID = LIBRARIES.find(
    ({ groupID }) => groupID === null,
  )!.libraryID;

  // One transaction: a failed write leaves no row behind.
  database.exec("begin");
  using rollback = new DisposableStack();
  rollback.defer(() => database.exec("rollback"));
  const value = database.prepare(
    "insert into itemDataValues (valueID, value) values (?, ?)",
  );
  // Names carry the first new itemID, so a second call writes new rows too.
  const journals = Array.from({ length: 40 }, (_, index) => {
    value.run(
      firstValueID + index,
      `${SYNTHETIC_MARKER} journal ${firstItemID + index}`,
    );
    return firstValueID + index;
  });
  const creator = database.prepare(
    "insert into creators (creatorID, firstName, lastName, fieldMode) values (?, ?, ?, 0)",
  );
  const creators = Array.from({ length: 400 }, (_, index) => {
    creator.run(
      firstCreatorID + index,
      "A.",
      `Synthauthor${firstItemID + index}`,
    );
    return firstCreatorID + index;
  });
  const item = database.prepare(
    "insert into items (itemID, itemTypeID, libraryID, key, dateAdded, dateModified, clientDateModified) values (?, ?, ?, ?, '2030-01-01 00:00:00', '2030-01-01 00:00:00', '2030-01-01 00:00:00')",
  );
  const data = database.prepare(
    "insert into itemData (itemID, fieldID, valueID) values (?, ?, ?)",
  );
  const author = database.prepare(
    "insert into itemCreators (itemID, creatorID, creatorTypeID, orderIndex) values (?, ?, ?, ?)",
  );
  const titleValueID = firstValueID + journals.length;
  titles.forEach((title, index) => {
    const itemID = firstItemID + index;
    item.run(itemID, itemTypeID, libraryID, zoteroKey(itemID));
    value.run(titleValueID + index, title);
    data.run(itemID, titleField, titleValueID + index);
    data.run(itemID, journalField, journals[index % journals.length]!);
    for (let order = 0; order <= index % 3; order++) {
      author.run(
        itemID,
        creators[(index * 7 + order) % creators.length]!,
        authorTypeID,
        order,
      );
    }
  });
  database.exec("commit");
  rollback.move();

  const lastItemID = firstItemID + titles.length - 1;
  return {
    firstItemID,
    [Symbol.dispose]() {
      using database = new DatabaseSync(databasePath);
      database.exec("begin");
      for (const table of ["itemCreators", "itemData", "items"])
        database
          .prepare(`delete from ${table} where itemID between ? and ?`)
          .run(firstItemID, lastItemID);
      database
        .prepare("delete from itemDataValues where valueID between ? and ?")
        .run(firstValueID, titleValueID + titles.length - 1);
      database
        .prepare("delete from creators where creatorID between ? and ?")
        .run(firstCreatorID, firstCreatorID + creators.length - 1);
      database.exec("commit");
    },
  };
}

/** A Zotero Item key, `ZQ` and six more of Zotero's key characters, one per `itemID`. */
function zoteroKey(itemID: number): string {
  const alphabet = "23456789ABCDEFGHIJKLMNPQRSTUVWXYZ";
  let key = "";
  for (let rest = itemID, place = 0; place < 6; place++) {
    key = alphabet[rest % alphabet.length] + key;
    rest = Math.floor(rest / alphabet.length);
  }
  return `ZQ${key}`;
}

/** Tells the plugin the Zotero database changed, as the Companion's Freshness Signal does. */
async function signalDatabaseUpdated(vaultId: string): Promise<void> {
  const server = JSON.parse(
    await obEval(
      vaultId,
      "(function(){var services=app.plugins.plugins.zotlit.services;var settings=services.settings.current;return JSON.stringify({hostname:settings['server.hostname'],port:settings['server.port'],sourceId:services.zoteroPref.sourceId});})()",
    ),
  ) as { hostname: string; port: number; sourceId: string };
  const response = await fetch(
    `http://${server.hostname}:${server.port}/notify`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [PROTOCOL_VERSION_HEADER]: String(PROTOCOL_VERSION),
        [SOURCE_ID_HEADER]: server.sourceId,
      },
      body: JSON.stringify({ event: "db/updated" }),
    },
  );
  expect(response.status).toBe(204);
}

/**
 * The renderer's used JavaScript heap, in bytes, after a full garbage
 * collection. A Web Worker's heap is its own and stays out of this figure.
 */
async function rendererHeap(vaultId: string): Promise<number> {
  return Number(
    await obEval(
      vaultId,
      "(function(){require('v8').setFlagsFromString('--expose-gc');var gc=require('vm').runInNewContext('gc');gc();gc();return String(process.memoryUsage().heapUsed);})()",
    ),
  );
}
