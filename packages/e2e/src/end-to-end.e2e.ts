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
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  PROTOCOL_VERSION,
  PROTOCOL_VERSION_HEADER,
  SOURCE_ID_HEADER,
} from "@zotlit/protocol";
import {
  ANNOTATIONS,
  ATTACHMENTS,
  COLLECTIONS,
  DEMO_ATTACHMENTS,
  DEMO_ITEMS,
  discardFixture,
  findScopeCase,
  getFixtureLayout,
  ITEMS,
  LITERATURE_NOTE_PROFILES,
  LIBRARIES,
  LIBRARY_SCOPE_SETTING_KEY,
  NOTES,
} from "@zotlit/scripts/fixture";
import type { FixtureItem, LibrarySelector } from "@zotlit/scripts/fixture";
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
import { useListingProfile } from "./listing-profile.ts";
import {
  clearNotices,
  cli,
  cliCommand,
  obEval,
  obEvalUntil,
  obJson,
  obReadUntil,
  readUntil,
  waitFor,
  WINDOW_DOCUMENTS,
} from "./obsidian-cli.ts";
import { MENU_READY, PAGE, pickQueryView } from "./page-gestures.ts";
import { raiseWindow } from "./reader-gestures.ts";
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

/** A Library View Document on My Library as Papers, newest change first, as stored in plugin data. */
const MY_LIBRARY_DOCUMENT = {
  node: { kind: "library", library: { type: "personal" } },
  facets: [],
  search: "",
  sort: [{ property: "dateModified", direction: "DESC" }],
};
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
/** The byte order mark that starts a CSV file. */
const BYTE_ORDER_MARK = String.fromCharCode(0xfeff);

/**
 * A page expression for the Library View heading under `el`: its title, then
 * the counts under it, `|` between them; `null` with no heading.
 */
const LIBRARY_HEADING = `(h=>h?['[data-library-header]','[data-library-header-count]'].map(s=>h.querySelector(s)?.textContent??'').filter(t=>t!=='').join(' | '):null)(el.querySelector('[data-library-heading]'))`;

/**
 * The Reading State of a Fixture Item, from the seed: its Annotations, the
 * Literature Note the Fixture Vault holds for every Item but the demo papers,
 * and a PDF the build writes to this device. The build writes a file for
 * each Attachment with a source, except the demo papers' linked PDFs, which
 * only the demo vault holds.
 */
const readingState = {
  annotated: (item: FixtureItem) => {
    const ids = new Set(
      ATTACHMENTS.filter(
        ({ parentItemID }) => parentItemID === item.itemID,
      ).map(({ itemID }) => itemID),
    );
    return ANNOTATIONS.some(({ parentItemID }) => ids.has(parentItemID));
  },
  noted: (item: FixtureItem) => !DEMO_ITEMS.includes(item),
  pdf: (item: FixtureItem) =>
    ATTACHMENTS.some(
      (attachment) =>
        attachment.parentItemID === item.itemID &&
        attachment.contentType === "application/pdf" &&
        attachment.linkMode !== "linked_url" &&
        attachment.sourceAsset !== null &&
        !DEMO_ATTACHMENTS.includes(attachment),
    ),
};

/** The Items of `items` with no Annotation and no Literature Note. */
function unreadOf(
  items: readonly FixtureItem[],
  noted: (item: FixtureItem) => boolean = readingState.noted,
): FixtureItem[] {
  return items.filter((item) => !readingState.annotated(item) && !noted(item));
}

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
      `(function(){${PAGE}const view=${view};const tab=Array.from(view?.contentEl.querySelectorAll('[role=tab]')??[]).find(element=>element.textContent.trim()===${JSON.stringify(tabLabel)});if(!tab)return false;press(tab,${JSON.stringify(tabLabel)});return true;})()`,
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

/** The active tab: its view type, its file, and the file's Zotero key. */
interface ActiveTab {
  type: string | null;
  path: string | null;
  key: string | null;
  /**
   * Whether the tab is still opening its file. Obsidian drops an open into
   * a tab whose open is under way, so a step that opens something there
   * waits for this to clear.
   */
  opening: boolean;
}

/** The active tab of the vault's window, as {@link ActiveTab} reads it. */
async function activeTab(vaultId: string): Promise<ActiveTab> {
  return JSON.parse(
    await obEval(
      vaultId,
      "(()=>{const view=app.workspace.activeLeaf?.view;const file=view?.file??null;return JSON.stringify({type:view?.getViewType()??null,path:file?.path??null,key:file?app.metadataCache.getFileCache(file)?.frontmatter?.['zotero-key']??null:null,opening:!!app.workspace.activeLeaf?.working});})()",
    ),
  ) as ActiveTab;
}

/**
 * Wait until the active tab is Obsidian's PDF view of `path` with its first
 * page loaded. The tab is active as the open starts, before the document
 * loads; once it loads, the open makes the tab active again, and once its
 * first page loads, it focuses the viewer. Either takes the keys and the
 * active tab from a view a later step drives. The document alone comes
 * before that focus; pdf.js draws the page views in the same callback that
 * settles the first page, just before Obsidian's focus runs, so an eval that
 * sees a page sees the focus done.
 */
function pdfOpened(vaultId: string, path: string): Promise<boolean> {
  return obEvalUntil(
    vaultId,
    `(()=>{const view=app.workspace.activeLeaf?.view;return String(view?.getViewType()==='pdf'&&view.file?.path===${JSON.stringify(path)}&&(view.viewer?.child?.pdfViewer?.pdfViewer?.pagesCount??0)>0);})()`,
    { expected: "true", tries: 120 },
  );
}

describe.skipIf(!reachable)("End-to-end Run", () => {
  let vaultId = "";
  const offlineZotero = createServer((socket) => socket.destroy());
  let booksNotePath = "";
  let m: typeof import("@obsidian-messages");

  /**
   * Open the window at 1600 by 1000 with both sidebars collapsed, a wide
   * desktop; `cleanup` puts the window's size back.
   */
  async function wideWindow(cleanup: AsyncDisposableStack): Promise<void> {
    const size = await obEval(
      vaultId,
      "JSON.stringify(require('@electron/remote').getCurrentWindow().getSize())",
    );
    cleanup.defer(async () => {
      await obEval(
        vaultId,
        `require('@electron/remote').getCurrentWindow().setSize(...${size});true`,
      );
    });
    await obEval(
      vaultId,
      "app.workspace.leftSplit.collapse();app.workspace.rightSplit.collapse();require('@electron/remote').getCurrentWindow().setSize(1600,1000);true",
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
        ? m.library_view_heading_papers({ count: items.length })
        : m.library_view_heading_papers_of({
            count: shown,
            total: items.length,
          });
    return unread === 0
      ? `${selection} | ${papers}`
      : `${selection} | ${papers} · ${m.library_view_heading_unread({ count: unread })}`;
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
    const valueControl = `${kind === "collection" ? "input" : "button"}[aria-label=${JSON.stringify(m.workbench_filter_value())}]`;
    return obEvalUntil(
      vaultId,
      `(function(){${PAGE}var editor=${activeWorkbenchContent};var row=editor?.querySelectorAll('[data-condition-row]')[${row}];return String(valueOf(row?.querySelector('button[aria-label=${JSON.stringify(m.workbench_match_condition_kind())}]'))===${JSON.stringify(kind)}&&valueOf(row.querySelector('select[aria-label=${JSON.stringify(m.workbench_filter_operator())}]'))===${JSON.stringify(operator)}&&valueOf(row.querySelector('${valueControl}'))===${JSON.stringify(value)});})()`,
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
        vaultId,
        `(async()=>{${PAGE}const kind=${control(m.workbench_match_condition_kind())};if(valueOf(kind)===${JSON.stringify(kind)})return true;await pick(kind,${JSON.stringify(kind)},'Condition type');await until('the ${kind} value control',()=>valueOf(${control(m.workbench_match_condition_kind())})===${JSON.stringify(kind)}&&valueOf(${control(m.workbench_filter_value())})==='');return true;})()`,
      ),
    ).toBe("true");
    expect(
      await obEval(
        vaultId,
        `(async()=>{${PAGE}await pick(${control(m.workbench_filter_value())},${JSON.stringify(value)},'Value');return true;})()`,
      ),
    ).toBe("true");
    expect(await conditionReady({ row, kind, operator: "is", value })).toBe(
      true,
    );
  }

  /** "Add condition" adds a placeholder row; it becomes a Library row. */
  async function addLibraryCondition(selector: string): Promise<void> {
    await obEval(
      vaultId,
      `(function(){${PAGE}var editor=${activeWorkbenchContent};press(Array.from(editor.querySelectorAll('button')).find(button=>button.textContent.trim()===${JSON.stringify(m.workbench_match_add_condition())}),'Add condition');return true;})()`,
    );
    await shapeCondition(1, "library", selector);
  }

  async function openMatchEditor(): Promise<void> {
    await openProfilesSettings(vaultId, "settings_page_profiles");
    expect(
      await obEvalUntil(
        vaultId,
        `(function(){${PAGE}var settings=${settingsContent};var row=Array.from(settings.querySelectorAll('.setting-item')).find(el=>el.querySelector('.setting-item-name')?.textContent===${JSON.stringify(booksProfile.label)});var button=row&&Array.from(row.querySelectorAll('button')).find(button=>button.getAttribute('aria-label')===${JSON.stringify(m.settings_profile_edit())});if(!button||button.disabled)return false;press(button,'Edit profile');return true;})()`,
        { expected: "true" },
      ),
    ).toBe(true);
    expect(
      await obEvalUntil(
        vaultId,
        `(function(){${PAGE}var editor=${activeWorkbenchContent};var tab=Array.from(editor?.querySelectorAll('[role=tab]')??[]).find(tab=>tab.textContent.trim()===${JSON.stringify(m.workbench_tab_match())});press(tab,'Match tab');return String(!!editor?.querySelector('[data-part=fieldset]')&&!editor?.ownerDocument.querySelector('.modal.mod-settings'));})()`,
        { expected: "true" },
      ),
    ).toBe(true);
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
      `(function(){${PAGE}var settings=${settingsContent};var row=Array.from(settings.querySelectorAll('.setting-item')).find(el=>el.querySelector('.setting-item-name')?.textContent===${JSON.stringify(m.settings_profile_document_name())});var button=row&&Array.from(row.querySelectorAll('button')).find(el=>el.getAttribute('aria-label')===${JSON.stringify(m.settings_profile_edit())});if(!button||button.disabled)return false;press(button,'Edit template');return true;})()`,
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
    // Hold a private endpoint that cannot serve Zotero's API. The developer's
    // Zotero may be running on its normal port while this offline case runs.
    await new Promise<void>((resolve, reject) => {
      offlineZotero.once("error", reject);
      offlineZotero.listen(0, "127.0.0.1", resolve);
    });
    const address = offlineZotero.address();
    if (address === null || typeof address === "string")
      throw new Error("Offline Zotero endpoint did not receive a TCP port");
    const created = await runVaultScript([
      "open",
      e2eVaultPath,
      `--zotero-http-port=${address.port}`,
    ]);
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
    await using _offlineZotero = offlineZotero;
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

  // A menu, dialog or popover a case leaves open covers what the next case
  // presses. The case that leaves one fails here, and the next one starts
  // with none: Escape closes a menu once it binds its keys, a timer after it
  // shows, and the dialog on top.
  afterEach(async () => {
    const left = await obEval(
      vaultId,
      `(async()=>{${PAGE}const docs=()=>[document,...app.workspace.floatingSplit.children.map(split=>split.win.document)];const open=()=>docs().flatMap(doc=>[...doc.querySelectorAll('.menu, .modal-container, :popover-open')]);const left=open().map(el=>(el.matches(':popover-open')?'popover':el.classList.contains('menu')?'menu':'dialog')+': '+el.textContent.trim().slice(0,60));for(const el of open())if(el.matches(':popover-open'))el.hidePopover();await until('menus and dialogs close',async()=>{if(open().length===0)return true;await ${MENU_READY};activeDocument.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));return false;},5000);return JSON.stringify(left);})()`,
    );
    expect(
      JSON.parse(left),
      "menus, dialogs and popovers the case left open",
    ).toEqual([]);
  });

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
      // A height unchanged for 300 ms counts as settled.
      // Seek each transition to its midpoint so a late timer cannot sample its end.
      // Under reduced motion neither property has an intermediate value.
      const selectionEase = `(async()=>{${PAGE}
        const card=app.workspace.getLeavesOfType('zotero-annotation-view')[0].view.containerEl.querySelector('.zt-annot-card:not([data-selected])');
        const read=()=>{const s=getComputedStyle(card);return{fill:s.backgroundColor,ring:s.boxShadow};};
        let height=-1,since=0;
        await until('excerpt height settles',()=>{if(card.offsetHeight!==height){height=card.offsetHeight;since=Date.now();}return Date.now()-since>=300;},10000);
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
      // The header block is one press target however much it reports (the
      // view's own More options beside it is not part of it), and the pane
      // names its controls with `aria-label` alone. Both are shapes only a
      // rendered view has: the focus stops are what the DOM ended up with, and
      // a `title` anywhere in the view is the hover tooltip Obsidian would draw
      // over its own.
      const headerChrome = `JSON.stringify((()=>{const root=app.workspace.getLeavesOfType('zotero-annotation-view')[0]?.view.containerEl;const block=root?.querySelector('.zt-annot-header')?.parentElement??null;return {focusable:block?[...block.querySelectorAll('button, [tabindex]:not([tabindex="-1"]), a[href], input')].filter(el=>!el.closest('[data-annot-view-more-options]')).length:-1,titled:root?root.querySelectorAll('[title]').length:-1};})())`;
      expect(await obEval(vaultId, headerChrome)).toBe(
        JSON.stringify({ focusable: 1, titled: 0 }),
      );
      // The tag Chooser hangs in the browser's top layer, placed by CSS anchor
      // positioning — which only a running Obsidian has. A popup that collapsed
      // still holds its rows in the DOM, so what tells is whether its own box
      // is still around them.
      //
      // The tag Chooser is named by its trigger's label, never by DOM order:
      // the filter bar draws the colour Chooser first whenever the palette has
      // a colour, and every Fixture Annotation under this attachment carries
      // one. The popup is then the popover target of that trigger. A closed
      // popup holds no rows or search field, so neither can name it.
      const tagPopup = `(()=>{const root=app.workspace.getLeavesOfType('zotero-annotation-view')[0]?.view.containerEl;const trigger=Array.from(root?.querySelectorAll('button[popovertarget]')??[]).find(b=>{const label=b.getAttribute('aria-label')??'';return label===${JSON.stringify(m.annot_view_filter_tag_trigger())}||label.startsWith(${JSON.stringify(m.annot_view_filter_tag_trigger_active({ tags: "" }))});});return trigger?root.ownerDocument.getElementById(trigger.getAttribute('popovertarget')):null;})()`;
      await obEval(
        vaultId,
        `(function(){${PAGE}const root=app.workspace.getLeavesOfType('zotero-annotation-view')[0]?.view.containerEl;const popup=${tagPopup};if(!popup)throw new Error('No tag Chooser in the Annotation View');if(!popup.matches(':popover-open'))press(root.querySelector('[popovertarget="'+popup.id+'"]'),'tag Chooser');return true;})()`,
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

  it("groups the sidebar Annotation View by colour from More options", async () => {
    const layout = await obEval(
      vaultId,
      "JSON.stringify(app.workspace.getLayout())",
    );
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await obEval(
        vaultId,
        `(async()=>{await app.workspace.changeLayout(JSON.parse(${JSON.stringify(layout)}));return true;})()`,
      );
    });
    await obEval(
      vaultId,
      `(async()=>{const file=app.vault.getFileByPath(${JSON.stringify(annotationAttachment.path)});const leaf=app.workspace.getLeaf('tab');await leaf.openFile(file);app.workspace.setActiveLeaf(leaf,{focus:true});app.commands.executeCommandById('zotlit:open-annot-view');app.commands.executeCommandById('zotlit:annot-view-follow-active-tab');return true;})()`,
    );
    const sidebar =
      "app.workspace.getLeavesOfType('zotero-annotation-view')[0]?.view";
    /** The sidebar's cards in screen order, each under the group heading above it. */
    const readSidebar = `(async()=>{const view=${sidebar};if(!view)return 'null';await view.read;const grid=view.contentEl.querySelector('[role="grid"]');let group=null;const cards=[];for(const node of grid?.querySelectorAll('[data-query-group], .zt-annot-card[data-zotero-annotation-key]')??[]){if(node.hasAttribute('data-query-group')){group=node.getAttribute('data-query-group');continue;}cards.push({key:node.getAttribute('data-zotero-annotation-key'),color:node.getAttribute('data-annot-color'),group});}return JSON.stringify({cards,query:view.getState().query??null});})()`;
    interface Sidebar {
      cards: { key: string; color: string; group: string | null }[];
      query: string | null;
    }
    const sidebarWhen = async (
      ready: (state: Sidebar) => boolean,
    ): Promise<Sidebar> => {
      let state: Sidebar | null = null;
      await expect
        .poll(
          async () => {
            const text = await obEval(vaultId, readSidebar);
            state = text === "null" ? null : (JSON.parse(text) as Sidebar);
            return state !== null && ready(state);
          },
          { timeout: 30_000, interval: 250 },
        )
        .toBe(true);
      return state!;
    };
    const expected = [...annotationKeys].sort();
    const before = await sidebarWhen(
      ({ cards }) =>
        JSON.stringify(cards.map(({ key }) => key).sort()) ===
        JSON.stringify(expected),
    );
    // A plain sidebar stands under no heading.
    expect(before.cards.every(({ group }) => group === null)).toBe(true);
    const colors = new Set(before.cards.map(({ color }) => color));
    expect(colors.size).toBeGreaterThan(1);

    // More options → Group by → Color, through Obsidian's own menu. A side
    // dock hides the view header, so the reader presses the header row's own
    // "More options".
    await obEval(
      vaultId,
      `(function(){${PAGE}press(${sidebar}.contentEl.querySelector('[data-annot-view-more-options]'),'More options');return true;})()`,
    );
    const menuItem = (title: string) =>
      `Array.from(document.querySelectorAll('.menu .menu-item')).find(item=>item.querySelector('.menu-item-title')?.textContent===${JSON.stringify(title)})`;
    expect(
      await obEvalUntil(
        vaultId,
        `String(!!${menuItem(m.annot_view_group_by())})`,
        {
          expected: "true",
        },
      ),
    ).toBe(true);
    await obEval(
      vaultId,
      `(function(){${PAGE}const item=${menuItem(m.annot_view_group_by())};item.dispatchEvent(new MouseEvent('mouseover',{bubbles:true}));press(item,'Group by');return true;})()`,
    );
    expect(
      await obEvalUntil(
        vaultId,
        `String(!!${menuItem(m.query_view_property_color())})`,
        { expected: "true" },
      ),
    ).toBe(true);
    await obEval(
      vaultId,
      `(function(){${PAGE}press(${menuItem(m.query_view_property_color())},'Color');return true;})()`,
    );

    const grouped = await sidebarWhen(({ cards }) =>
      cards.some(({ group }) => group !== null),
    );
    // The same cards, one group for each colour, each colour under one heading.
    expect(grouped.cards.map(({ key }) => key).sort()).toEqual(expected);
    const headings = new Map<string, string>();
    for (const { color, group } of grouped.cards) {
      expect(group).not.toBeNull();
      expect(headings.get(color) ?? group).toBe(group);
      headings.set(color, group!);
    }
    expect(new Set(headings.values()).size).toBe(colors.size);
    // The grouping is the sidebar's Query File, which its state keeps.
    expect(grouped.query).toContain("attachment == this.attachment");
    expect(grouped.query).toContain("colorName");

    // "Filter…" opens the Match editor of the sidebar's one view, without the
    // filter that names the followed Attachment. A side dock hides the view
    // header, so the reader presses the header row's own "More options".
    expect(
      await obEval(
        vaultId,
        `(function(){${PAGE}press(${sidebar}.contentEl.querySelector('[data-annot-view-more-options]'),'More options');return 'true';})()`,
      ),
    ).toBe("true");
    expect(
      await obEvalUntil(
        vaultId,
        `String(!!${menuItem(m.annot_view_filter())})`,
        { expected: "true" },
      ),
    ).toBe(true);
    await obEval(
      vaultId,
      `(function(){${PAGE}press(${menuItem(m.annot_view_filter())},'Filter');return true;})()`,
    );
    const filterModal = `(function(){const modal=document.querySelector('.modal.zt-annot-filter-modal');return JSON.stringify(modal?{title:modal.querySelector('.modal-title')?.textContent??null,sections:Array.from(modal.querySelectorAll('[data-filter-section]'),el=>el.getAttribute('data-filter-section')),text:modal.textContent.includes('this.attachment')}:null);})()`;
    expect(
      await obEvalUntil(vaultId, filterModal, {
        expected: JSON.stringify({
          title: m.annot_view_filter_title(),
          sections: ["view"],
          text: false,
        }),
      }),
    ).toBe(true);
    await obEval(
      vaultId,
      "(function(){const target=document.activeElement??document.body;target.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',bubbles:true}));return true;})()",
    );
    // No menu or dialog stays over the window for the cases after this one.
    expect(
      await obEvalUntil(
        vaultId,
        "String(document.querySelectorAll('.menu, .modal-container').length)",
        { expected: "0" },
      ),
    ).toBe(true);
  }, 120000);

  it("saves the sidebar filtered by one colour as a Query File, and a Literature Note that embeds it shows its Annotations of that colour", async () => {
    const savedPath = "query-files/Saved colour.zotquery";
    const notePath = `literatures/${annotationItem.literatureNoteName ?? annotationItem.key}.md`;
    const layout = await obEval(
      vaultId,
      "JSON.stringify(app.workspace.getLayout())",
    );
    const noteText = await obEval(
      vaultId,
      `app.vault.read(app.vault.getFileByPath(${JSON.stringify(notePath)}))`,
    );
    const sidebar =
      "app.workspace.getLeavesOfType('zotero-annotation-view')[0]?.view";
    /**
     * Opens the colour Chooser, ticks the row of `color` (or "Clear selected
     * colors" for `null`), and closes the Chooser.
     */
    const pickColor = (color: string | null) =>
      `(async()=>{${PAGE}const el=${sidebar}?.containerEl;const trigger=Array.from(el?.querySelectorAll('button[aria-label]')??[]).find(b=>b.getAttribute('aria-label')===${JSON.stringify(m.annot_view_filter_color_trigger())}||b.getAttribute('aria-label').startsWith(${JSON.stringify(m.annot_view_filter_color_trigger_active({ colors: "" }))}));if(!trigger)return 'no chooser';press(trigger,'colour Chooser');const list=await until('colour list opens',()=>{const list=Array.from(document.querySelectorAll('[role="listbox"]')).find(list=>document.getElementById(list.getAttribute('aria-labelledby'))?.textContent===${JSON.stringify(m.annot_view_filter_color_list())});return list?.checkVisibility()?list:null;});const row=Array.from(list?.querySelectorAll('[role="option"]')??[]).find(option=>${color === null ? `option.textContent===${JSON.stringify(m.annot_view_filter_color_clear())}` : `option.querySelector('[style*="--zt-swatch-color"]')?.style.getPropertyValue('--zt-swatch-color').trim().toLowerCase()===${JSON.stringify(color.toLowerCase())}`});if(row){press(row,'colour row');await until('colour filter applies',()=>${color === null ? `trigger.getAttribute('aria-label')===${JSON.stringify(m.annot_view_filter_color_trigger())}` : `row.getAttribute('aria-selected')==='true'`});}(document.activeElement??document.body).dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));return row?'picked':'no row';})()`;
    let picked = false;
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      // The colour filter is saved for the Item; clearing it takes it back.
      if (picked) await obEval(vaultId, pickColor(null));
      await obEval(
        vaultId,
        `(async()=>{await app.workspace.changeLayout(JSON.parse(${JSON.stringify(layout)}));await app.vault.modify(app.vault.getFileByPath(${JSON.stringify(notePath)}),${JSON.stringify(noteText)});const saved=app.vault.getFileByPath(${JSON.stringify(savedPath)});if(saved)await app.vault.delete(saved);return true;})()`,
      );
    });
    await obEval(
      vaultId,
      `(async()=>{const file=app.vault.getFileByPath(${JSON.stringify(annotationAttachment.path)});const leaf=app.workspace.getLeaf('tab');await leaf.openFile(file);app.workspace.setActiveLeaf(leaf,{focus:true});app.commands.executeCommandById('zotlit:open-annot-view');app.commands.executeCommandById('zotlit:annot-view-follow-active-tab');return true;})()`,
    );
    const readCards = `(async()=>{const view=${sidebar};if(!view)return 'null';await view.read;return JSON.stringify([...view.contentEl.querySelectorAll('.zt-annot-card[data-zotero-annotation-key]')].map(n=>n.getAttribute('data-zotero-annotation-key')).sort());})()`;
    const expected = [...annotationKeys].sort();
    expect(
      await obEvalUntil(vaultId, readCards, {
        expected: JSON.stringify(expected),
        tries: 120,
      }),
    ).toBe(true);

    // Filter the sidebar by the colour of the Fixture's first Annotation.
    const color = attachmentAnnotations[0]!.color;
    const ofColor = attachmentAnnotations
      .filter((annotation) => annotation.color === color)
      .map(({ key }) => key)
      .sort();
    expect(ofColor.length).toBeGreaterThan(0);
    expect(ofColor.length).toBeLessThan(expected.length);
    expect(await obEval(vaultId, pickColor(color))).toBe("picked");
    picked = true;
    expect(
      await obEvalUntil(vaultId, readCards, {
        expected: JSON.stringify(ofColor),
        tries: 80,
      }),
    ).toBe(true);

    // More options → "Save as query file…", through Obsidian's own menu. A
    // side dock hides the view header, so the reader presses the header
    // row's own "More options".
    expect(
      JSON.parse(
        await obEval(
          vaultId,
          `(function(){${PAGE}const button=press(${sidebar}.contentEl.querySelector('[data-annot-view-more-options]'),'More options');return JSON.stringify({label:button.getAttribute('aria-label')});})()`,
        ),
      ),
    ).toEqual({ label: m.annot_view_more_tooltip() });
    const menuItem = `Array.from(document.querySelectorAll('.menu .menu-item')).find(item=>item.querySelector('.menu-item-title')?.textContent===${JSON.stringify(m.annot_view_save_as_query_file())})`;
    expect(
      await obEvalUntil(vaultId, `String(!!${menuItem})`, {
        expected: "true",
      }),
    ).toBe(true);
    await obEval(
      vaultId,
      `(function(){${PAGE}press(${menuItem},'Save as query file');return true;})()`,
    );

    // The dialog asks the name, the folder, and which records the file shows.
    const modal = "document.querySelector('.modal.zt-save-query-file-modal')";
    const dialog = JSON.parse(
      await obEval(
        vaultId,
        `(function(){const modal=${modal};return JSON.stringify(modal?{title:modal.querySelector('.modal-title')?.textContent??null,fields:[...modal.querySelectorAll('[data-save-field]')].map(n=>n.getAttribute('data-save-field')),records:[...modal.querySelectorAll('[data-save-records]')].map(n=>({value:n.getAttribute('data-save-records'),label:n.closest('label').textContent,checked:n.checked}))}:null);})()`,
      ),
    ) as {
      title: string;
      fields: string[];
      records: { value: string; label: string; checked: boolean }[];
    } | null;
    expect(dialog).toMatchObject({
      title: m.annot_view_save_title(),
      fields: ["name", "folder"],
      records: [
        {
          value: "this-item",
          label: m.annot_view_save_records_this_item(),
          checked: true,
        },
        {
          value: "note-item",
          label: expect.stringContaining(m.annot_view_save_records_note_item()),
          checked: false,
        },
      ],
    });
    await obEval(
      vaultId,
      `(function(){${PAGE}const modal=${modal};const set=(field,value)=>{const input=modal.querySelector('[data-save-field="'+field+'"]');input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));};set('name','Saved colour');set('folder','query-files');press(modal.querySelector('[data-save-records="note-item"]').closest('label'),'note-item records');press(modal.querySelector('.modal-button-container button.mod-cta'),'Save');return true;})()`,
    );

    // The file opens in a tab, where `this` has no value.
    const readTab = `(async()=>{const view=app.workspace.getMostRecentLeaf()?.view;if(view?.getViewType()!=='zotlit-query-file'||view.file?.path!==${JSON.stringify(savedPath)})return 'null';await view.query.settled;return JSON.stringify({diagnostic:view.contentEl.querySelector('[data-query-diagnostic]')?.getAttribute('data-query-diagnostic')??null,cards:view.contentEl.querySelectorAll('.zt-annot-card').length});})()`;
    expect(
      await obEvalUntil(vaultId, readTab, {
        expected: JSON.stringify({ diagnostic: "unbound-context", cards: 0 }),
        tries: 120,
      }),
    ).toBe(true);
    const saved = await obEval(
      vaultId,
      `app.vault.read(app.vault.getFileByPath(${JSON.stringify(savedPath)}))`,
    );
    expect(saved).toMatch(/^filters: item == this\.item$/m);
    expect(saved).toMatch(/^ {4}filters: color/m);

    // Embedded in the Item's Literature Note, it shows that note's
    // Annotations of the colour.
    await obEval(
      vaultId,
      `(async()=>{const file=app.vault.getFileByPath(${JSON.stringify(notePath)});await app.vault.modify(file,${JSON.stringify(noteText.replace(/^(---\n[\s\S]*?\n---\n)/, "$1\n![[Saved colour.zotquery]]\n\n"))});const leaf=app.workspace.getLeaf('tab');await leaf.openFile(file,{state:{mode:'preview'}});app.workspace.setActiveLeaf(leaf,{focus:true});return true;})()`,
    );
    // The embed stands at the top of the note, where Reading view draws it
    // without a scroll.
    const readEmbed = `(async()=>{const view=app.workspace.getMostRecentLeaf()?.view;if(view?.file?.path!==${JSON.stringify(notePath)})return JSON.stringify({file:view?.file?.path??null});const el=[...view.containerEl.querySelectorAll('.internal-embed')].find(el=>el.zotlitQueryView&&el.isShown());if(!el)return JSON.stringify({embed:null});await el.zotlitQueryView.settled;return JSON.stringify({cards:[...el.querySelectorAll('.zt-annot-card[data-zotero-annotation-key]')].map(n=>n.getAttribute('data-zotero-annotation-key')).sort(),diagnostic:el.querySelector('[data-query-diagnostic]')?.getAttribute('data-query-diagnostic')??null});})()`;
    let embed: unknown = null;
    const shown = await waitFor(async () => {
      embed = JSON.parse(await obEval(vaultId, readEmbed));
      return (
        JSON.stringify((embed as { cards?: string[] }).cards) ===
        JSON.stringify(ofColor)
      );
    }, 120);
    if (!shown) throw new Error(`Query File embed: ${JSON.stringify(embed)}`);
  }, 180000);

  it("opens a Query File in a tab with cards grouped by Item, with Zotero closed", async () => {
    const layout = await obEval(
      vaultId,
      "JSON.stringify(app.workspace.getLayout())",
    );
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await obEval(
        vaultId,
        `(async()=>{await app.workspace.changeLayout(JSON.parse(${JSON.stringify(layout)}));return true;})()`,
      );
    });
    const scratchFiles: string[] = [];
    cleanup.defer(async () => {
      await obEval(
        vaultId,
        `(async()=>{for(const path of ${JSON.stringify(scratchFiles)}){const file=app.vault.getFileByPath(path);if(file)await app.vault.delete(file);}return true;})()`,
      );
    });
    /** What the active Query File tab shows, once its query settled. */
    const readTab = `(async()=>{const view=app.workspace.getMostRecentLeaf().view;if(view.getViewType()!=='zotlit-query-file')return 'null';await view.query.settled;const el=view.contentEl;const cards=[...el.querySelectorAll('.zt-annot-card')].map(n=>n.getAttribute('data-zotero-annotation-key'));const headings=[...el.querySelectorAll('[data-query-group]')].map(n=>n.textContent);const rows=[...el.querySelectorAll('tr[data-query-table-row="item"]')].map(n=>n.getAttribute('data-query-key'));const columns=[...el.querySelectorAll('th[data-query-column]')].map(n=>({path:n.getAttribute('data-query-column'),label:n.textContent}));return JSON.stringify({file:view.file?.path,view:el.querySelector('[data-query-view-menu]')?.textContent??null,rows,columns,count:el.querySelector('[data-query-count]')?.getAttribute('data-query-count')??null,cards,headings,diagnostic:el.querySelector('[data-query-diagnostic]')?.getAttribute('data-query-diagnostic')??null,problems:el.querySelector('[data-query-problems]')?.textContent??null,unresolved:el.querySelector('[data-query-unresolved]')?.textContent??null});})()`;
    interface Tab {
      file: string;
      view: string | null;
      count: string | null;
      cards: string[];
      headings: string[];
      /** The Indexed Key of each Item row of the Table. */
      rows: string[];
      /** The Table's columns: each property path and its header text. */
      columns: { path: string; label: string }[];
      diagnostic: string | null;
      problems: string | null;
      unresolved: string | null;
    }
    const tabWhen = async (ready: (tab: Tab) => boolean): Promise<Tab> => {
      let tab: Tab | null = null;
      const settled = await waitFor(async () => {
        tab = JSON.parse(await obEval(vaultId, readTab)) as Tab | null;
        return tab !== null && ready(tab);
      }, 120);
      if (!settled) throw new Error(`Query File tab: ${JSON.stringify(tab)}`);
      return tab!;
    };
    /** The rows ZotLit Query gives for a view, through the CLI. */
    const queryRows = async (filter?: string) => {
      const report = JSON.parse(
        await cliCommand(vaultId, "zotlit:query", {
          args: {
            from: "annotations",
            fields: "item.title",
            limit: "100",
            ...(filter === undefined ? {} : { filter }),
          },
        }),
      ) as ItemQueryReport;
      expect(report.ok).toBe(true);
      return report.rows!;
    };

    // "New query file" from the command palette writes a Table of the
    // library's Items, newest first, and opens it in a tab.
    const before = JSON.parse(
      await obEval(
        vaultId,
        "JSON.stringify(app.vault.getFiles().map(f=>f.path))",
      ),
    ) as string[];
    await obEval(
      vaultId,
      "app.commands.executeCommandById('zotlit:new-query-file');true",
    );
    const created = await tabWhen((tab) => tab.rows.length > 0);
    expect(before).not.toContain(created.file);
    scratchFiles.push(created.file);
    expect(created.file).toMatch(/\.zotquery$/);
    // The Items of the Libraries of the Library Scope, from the seed.
    const scope = JSON.parse(
      await cliCommand(vaultId, "zotlit:library-scope"),
    ) as LibraryScopeReport;
    const newest = itemsByModified(
      (scope.available ?? []).map(
        (entry) =>
          LIBRARIES.find((library) => library.libraryID === entry.libraryID)!,
      ),
    ).slice(0, 100);
    expect(newest.length).toBeGreaterThan(1);
    expect(created).toMatchObject({
      view: m.query_file_items_view_name(),
      count: String(newest.length),
      rows: newest,
      columns: [
        // Zotero's own label for the title field.
        { path: "title", label: expect.stringContaining("Title") },
        {
          path: "creators",
          label: expect.stringContaining(m.query_view_property_creators()),
        },
        {
          path: "date.year",
          label: expect.stringContaining(m.query_view_property_year()),
        },
        {
          path: "vault.literatureNote",
          label: expect.stringContaining(m.query_view_table_literature_note()),
        },
      ],
      diagnostic: null,
      problems: null,
      unresolved: null,
    });

    // Its second view is the Annotations of the whole library: the cards
    // come grouped by Item under its title, in query order inside a group,
    // and the count is the query's own. No Zotero answers this vault.
    const annotationsView = m.query_file_annotations_view_name();
    await obEval(
      vaultId,
      `(async()=>{${PAGE}${pickQueryView("app.workspace.getMostRecentLeaf().view", annotationsView)}return true;})()`,
    );
    const all = await queryRows();
    expect(all.length).toBeGreaterThan(0);
    const annotations = await tabWhen(
      (tab) => tab.view === annotationsView && tab.count !== null,
    );
    expect(annotations).toMatchObject({
      file: created.file,
      count: String(all.length),
      ...byItem(all),
      diagnostic: null,
      problems: null,
      unresolved: null,
    });

    // The view menu of the Fixture's Query File lists its views and switches.
    await obEval(
      vaultId,
      `(async()=>{const leaf=app.workspace.getLeaf('tab');await leaf.openFile(app.vault.getFileByPath('query-files/Reading annotations.zotquery'));app.workspace.setActiveLeaf(leaf,{focus:true});return true;})()`,
    );
    await tabWhen(
      (tab) => tab.view === "All annotations" && tab.count !== null,
    );
    const menu = JSON.parse(
      await obEval(
        vaultId,
        `(async()=>{${PAGE}const view=app.workspace.getMostRecentLeaf().view;press(view.contentEl.querySelector('[data-query-view-menu]'),'View menu');const rows=await until('view menu rows',()=>{const found=[...view.contentEl.querySelectorAll('[data-query-view-list]:popover-open [data-query-view-row]')];return found.length>0&&found;});const titles=rows.map(n=>n.getAttribute('data-query-view-row'));press(rows.find(n=>n.getAttribute('data-query-view-row')==='Figures'),'Figures');return JSON.stringify(titles);})()`,
      ),
    ) as string[];
    expect(menu).toEqual(["All annotations", "Figures"]);
    const figureRows = await queryRows('tags.contains("figure")');
    expect(figureRows.length).toBeGreaterThan(0);
    const figures = await tabWhen((tab) => tab.view === "Figures");
    expect(figures).toMatchObject({
      count: String(figureRows.length),
      ...byItem(figureRows),
    });
    expect(
      await obEval(
        vaultId,
        "app.workspace.getMostRecentLeaf().getViewState().state.view",
      ),
    ).toBe("Figures");

    // A filter that reads `this` shows the diagnostic: a tab has no Query
    // Context. A bad expression and an unknown field open and say so too.
    for (const [name, filter, code] of [
      ["this", "item == this.item", "unbound-context"],
      ["bad", "colorName ==", "invalid-filter"],
      ["unknown", "nosuchfield == 1", "unknown-field"],
    ] as const) {
      const path = `query-files/${name}.zotquery`;
      scratchFiles.push(path);
      await obEval(
        vaultId,
        `(async()=>{const file=await app.vault.create(${JSON.stringify(path)},${JSON.stringify(`views:\n  - type: annotations\n    name: Broken\n    from: annotations\n    filters: ${filter}\n`)});const leaf=app.workspace.getLeaf('tab');await leaf.openFile(file);app.workspace.setActiveLeaf(leaf,{focus:true});return true;})()`,
      );
      const broken = await tabWhen(
        (tab) => tab.file === path && tab.diagnostic !== null,
      );
      expect(broken).toMatchObject({
        diagnostic: code,
        cards: [],
        count: null,
      });
    }

    // "New query file" stands in a folder's menu in the file explorer.
    const folderMenu = JSON.parse(
      await obEval(
        vaultId,
        `(async()=>{${PAGE}app.workspace.leftSplit.expand();const explorer=app.workspace.getLeavesOfType('file-explorer')[0];await app.workspace.revealLeaf(explorer);const title=explorer.view.containerEl.querySelector('.nav-folder-title[data-path="query-files"]');title.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:10,clientY:10}));await until('folder menu opens',()=>activeDocument.querySelector('.menu .menu-item-title'));const titles=[...activeDocument.querySelectorAll('.menu .menu-item-title')].map(n=>n.textContent);await ${MENU_READY};activeDocument.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await until('folder menu closes',()=>!activeDocument.querySelector('.menu'));return JSON.stringify(titles);})()`,
      ),
    ) as string[];
    expect(folderMenu).toContain(m.query_file_new());
  }, 180000);

  // The pill patches Obsidian's internal empty view and copies its pills'
  // markup, so an Obsidian upgrade that moves either shows up here.
  it("shows New Zotero query table with its hotkey after Obsidian's New pills on a new tab, and creates a Query File there ready to rename", async () => {
    const command = "zotlit:new-query-file";
    const layout = await obEval(
      vaultId,
      "JSON.stringify(app.workspace.getLayout())",
    );
    const hotkeys = await obEval(
      vaultId,
      `JSON.stringify(app.hotkeyManager.getHotkeys(${JSON.stringify(command)})??null)`,
    );
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await obEval(
        vaultId,
        `(async()=>{const id=${JSON.stringify(command)};const saved=${hotkeys};if(saved)app.hotkeyManager.setHotkeys(id,saved);else app.hotkeyManager.removeHotkeys(id);await app.hotkeyManager.save();return true;})()`,
      );
    });
    cleanup.defer(async () => {
      await obEval(
        vaultId,
        `(async()=>{await app.workspace.changeLayout(JSON.parse(${JSON.stringify(layout)}));return true;})()`,
      );
    });
    const scratchFiles: string[] = [];
    cleanup.defer(async () => {
      await obEval(
        vaultId,
        `(async()=>{for(const path of ${JSON.stringify(scratchFiles)}){const file=app.vault.getFileByPath(path);if(file)await app.vault.delete(file);}return true;})()`,
      );
    });

    const printed = await obEval(
      vaultId,
      `(()=>{const id=${JSON.stringify(command)};app.hotkeyManager.setHotkeys(id,[{modifiers:['Mod','Shift'],key:'Q'}]);return app.hotkeyManager.printHotkeyForCommand(id);})()`,
    );
    expect(printed).not.toBe("");
    await obEval(
      vaultId,
      "app.commands.executeCommandById('workspace:new-tab');true",
    );
    /** Each pill of the active empty tab: its icon, label, hotkey and classes. */
    const readPills = `(()=>{const view=app.workspace.getMostRecentLeaf().view;if(view.getViewType()!=='empty')return 'null';return JSON.stringify([...view.actionListEl.children].map(b=>({icon:[...b.querySelector('.text-button-icon svg')?.classList??[]].find(c=>c.startsWith('lucide-'))??null,label:b.querySelector('.text-button-label')?.textContent??null,hotkey:b.querySelector('.empty-state-hotkey')?.textContent??null,classes:[...b.classList].filter(c=>c!=='zt-empty-state-new-query').sort(),ours:b.classList.contains('zt-empty-state-new-query')})));})()`;
    interface Pill {
      icon: string | null;
      label: string | null;
      hotkey: string | null;
      classes: string[];
      ours: boolean;
    }
    let pills: Pill[] = [];
    const shown = await waitFor(async () => {
      pills = (JSON.parse(await obEval(vaultId, readPills)) ?? []) as Pill[];
      return pills.some((pill) => pill.ours);
    });
    expect(shown, JSON.stringify(pills)).toBe(true);
    // Right after New note, New base and New canvas, before Go to file.
    expect(pills.map((pill) => pill.icon)).toEqual([
      "lucide-square-pen",
      "lucide-layout-list",
      "lucide-layout-dashboard",
      "lucide-list-filter",
      "lucide-search",
    ]);
    const ours = pills.find((pill) => pill.ours)!;
    const newNote = pills[0]!;
    expect(ours).toMatchObject({
      label: m.empty_state_new_query(),
      // Printed the way Obsidian prints New note's own hotkey.
      hotkey: ` ${printed}`,
      classes: newNote.classes,
    });
    expect(newNote.hotkey).toMatch(/^ \S/);

    // A click opens a new Query File in this tab, its title selected to rename.
    const opened = await obEval(
      vaultId,
      `(async()=>{${PAGE}const leaf=app.workspace.getMostRecentLeaf();press(leaf.view.actionListEl.querySelector('.zt-empty-state-new-query'),'New Zotero query table');await until('Query File opens',()=>leaf.view.getViewType()==='zotlit-query-file'&&leaf.view.file,10000);const view=leaf.view;const title=view.titleEl;const selection=title.win.getSelection();return JSON.stringify({sameTab:app.workspace.getMostRecentLeaf()===leaf,file:view.file.path,title:title.textContent,focused:title.doc.activeElement===title,selected:title.contains(selection.anchorNode)?selection.toString():null});})()`,
    );
    const created = JSON.parse(opened) as {
      sameTab: boolean;
      file: string;
      title: string;
      focused: boolean;
      selected: string | null;
    };
    scratchFiles.push(created.file);
    expect(created.file).toMatch(/\.zotquery$/);
    expect(created).toMatchObject({
      sameTab: true,
      title: created.file.replace(/^.*\//, "").replace(/\.zotquery$/, ""),
      focused: true,
      selected: created.title,
    });
  }, 120000);

  it("opens the Library View from the ribbon and the command, lists My Library newest first, and keeps a sort change across a plugin reload, with Zotero closed", async () => {
    const layout = await obEval(
      vaultId,
      "JSON.stringify(app.workspace.getLayout())",
    );
    const stored = await obEval(
      vaultId,
      "JSON.stringify(app.plugins.plugins.zotlit.services.settings.current['library.document'])",
    );
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await obEval(
        vaultId,
        `(async()=>{const settings=app.plugins.plugins.zotlit.services.settings;settings.update({'library.document':${stored}});await settings.flush();await app.workspace.changeLayout(JSON.parse(${JSON.stringify(layout)}));return true;})()`,
      );
    });
    // The view opens on My Library; a new view's Recent has a case of its own.
    await obEval(
      vaultId,
      `(async()=>{app.workspace.getLeavesOfType('zotlit-library').forEach(leaf=>leaf.detach());const settings=app.plugins.plugins.zotlit.services.settings;settings.update({'library.document':${JSON.stringify(MY_LIBRARY_DOCUMENT)}});await settings.flush();return true;})()`,
    );

    /** What the Library View shows once its query settled, or `null` while no tab holds it. */
    const readLibrary = `(async()=>{const leaves=app.workspace.getLeavesOfType('zotlit-library');const view=leaves[0]?.view;if(!view?.query)return 'null';await view.query.settled;const el=view.contentEl;const state=view.query.state.getState();return JSON.stringify({leaves:leaves.length,active:app.workspace.getMostRecentLeaf()?.view.getViewType()??null,title:view.getDisplayText(),phase:state.phase,failure:state.failure?.diagnostic.code??null,count:el.querySelector('[data-query-count]')?.getAttribute('data-query-count')??null,rows:[...el.querySelectorAll('tr[data-query-table-row="item"], [data-query-papers-row]')].map(n=>n.getAttribute('data-query-key')??n.getAttribute('data-query-papers-row'))});})()`;
    interface Library {
      leaves: number;
      active: string | null;
      title: string;
      phase: string;
      failure: string | null;
      count: string | null;
      rows: string[];
    }
    const libraryWhen = (ready: (library: Library) => boolean) =>
      obReadUntil<Library>(vaultId, readLibrary, {
        ready,
        what: "Library View",
        tries: 120,
      });

    // The seed's My Library Items. Items modified at the same moment may
    // come in either order, so the rows are checked by key set and by the
    // modification time at each place.
    const personal = ITEMS.filter(
      ({ libraryID }) =>
        libraryID === LIBRARIES.find(({ type }) => type === "user")!.libraryID,
    );
    const modified = new Map(
      personal.map(({ key, dateModified }) => [key, dateModified]),
    );
    const times = (direction: 1 | -1) =>
      personal
        .map(({ dateModified }) => dateModified)
        .toSorted((a, b) => direction * a.localeCompare(b));
    const expectSeedOrder = (library: Library, direction: 1 | -1) => {
      expect(library.count).toBe(String(personal.length));
      expect(library.rows.toSorted()).toEqual(
        personal.map(({ key }) => key).toSorted(),
      );
      expect(library.rows.map((key) => modified.get(key))).toEqual(
        times(direction),
      );
    };

    // The ribbon icon opens the view in a main-area tab, on My Library as
    // Papers, newest change first. No Zotero answers this vault.
    await obEval(
      vaultId,
      `(()=>{${PAGE}press(document.querySelector(${JSON.stringify(`.side-dock-ribbon-action[aria-label="${m.command_open_library_view_name()}"]`)}),'Library View ribbon icon');return true;})()`,
    );
    /** Whether the Layout drew every row the count names. */
    const drawn = (library: Library) =>
      library.phase === "ready" &&
      library.count !== null &&
      library.rows.length === Number(library.count);
    const opened = await libraryWhen(drawn);
    expect(opened).toMatchObject({
      leaves: 1,
      active: "zotlit-library",
      title: m.library_view_name(),
      failure: null,
    });
    expectSeedOrder(opened, -1);

    // With another tab in front, the command and the ribbon icon each bring
    // the one Library View tab back.
    for (const invoke of [
      "app.commands.executeCommandById('zotlit:open-library-view')",
      `(()=>{${PAGE}press(document.querySelector(${JSON.stringify(`.side-dock-ribbon-action[aria-label="${m.command_open_library_view_name()}"]`)}),'Library View ribbon icon')})()`,
    ]) {
      await obEval(
        vaultId,
        "(async()=>{await app.workspace.getLeaf('tab').openFile(app.vault.getMarkdownFiles()[0]);return true;})()",
      );
      expect(
        (await libraryWhen((library) => library.active !== "zotlit-library"))
          .leaves,
      ).toBe(1);
      await obEval(vaultId, `${invoke};true`);
      expect(
        await libraryWhen((library) => library.active === "zotlit-library"),
      ).toMatchObject({ leaves: 1 });
    }

    // The Sort popover turns the order to oldest change first, and plugin
    // data keeps it as the Library View Document's sort.
    const inLibrary = (script: string) =>
      obEval(
        vaultId,
        `(async()=>{${PAGE}const el=app.workspace.getLeavesOfType('zotlit-library')[0].view.contentEl;${script};return true;})()`,
      );
    await inLibrary(
      "press(el.querySelector('[data-query-toolbar=\"sort\"]'),'Sort');await pick(await until('sort direction',()=>el.querySelector('[data-query-popover=\"sort\"] [data-sort-direction]')),'ASC','sort direction')",
    );
    expectSeedOrder(
      await libraryWhen(
        (library) => drawn(library) && library.rows[0] !== opened.rows[0],
      ),
      1,
    );
    expect(
      await obEvalUntil(
        vaultId,
        "JSON.stringify(app.plugins.plugins.zotlit.services.settings.current['library.document']?.sort)",
        {
          expected: JSON.stringify([
            { property: "dateModified", direction: "ASC" },
          ]),
        },
      ),
    ).toBe(true);

    // A plugin reload brings the tab back with the sort it kept.
    expect(
      await obEvalUntil(
        vaultId,
        "app.plugins.disablePlugin('zotlit').then(function () { return app.plugins.enablePlugin('zotlit'); }).then(function () { return true; })",
        { expected: "true", tries: 20 },
      ),
    ).toBe(true);
    const reloaded = await libraryWhen(drawn);
    expect(reloaded).toMatchObject({ leaves: 1, failure: null });
    expectSeedOrder(reloaded, 1);
  });

  it("opens a new Library View on Recent, lists the Library Scope newest change first in rows of two lines at most, keeps the tree toggle beside the search box on a narrow pane, sorts that way again when Recent is selected again, and leaves Recent's own sort behind on a Collection", async () => {
    const services = "app.plugins.plugins.zotlit.services";
    const snapshot = await obEval(
      vaultId,
      `JSON.stringify({layout:app.workspace.getLayout(),document:${services}.settings.current['library.document']??null,scope:${services}.settings.current[${JSON.stringify(LIBRARY_SCOPE_SETTING_KEY)}]??null})`,
    );
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await obEval(
        vaultId,
        `(async()=>{const saved=JSON.parse(${JSON.stringify(snapshot)});const settings=${services}.settings;settings.update({'library.document':saved.document,${JSON.stringify(LIBRARY_SCOPE_SETTING_KEY)}:saved.scope});await settings.flush();await app.workspace.changeLayout(saved.layout);return true;})()`,
      );
    });
    // No Library View Document yet; the Library Scope holds My Library and
    // one group.
    const library = (type: "user" | number) =>
      LIBRARIES.find((entry) =>
        type === "user" ? entry.type === "user" : entry.groupID === type,
      )!;
    const personal = library("user");
    const shared = library(4200309);
    const scope = (libraries: readonly (typeof personal)[]) =>
      JSON.stringify({
        mode: "selected",
        libraries: libraries.map(({ groupID }) =>
          groupID === null ? { type: "personal" } : { type: "group", groupID },
        ),
      });
    await obEval(
      vaultId,
      `(async()=>{app.workspace.getLeavesOfType('zotlit-library').forEach(leaf=>leaf.detach());const settings=${services}.settings;settings.update({'library.document':null,${JSON.stringify(LIBRARY_SCOPE_SETTING_KEY)}:${scope([personal, shared])}});await settings.flush();return true;})()`,
    );

    // The seed's oracle: the Items of the Libraries in scope, by Indexed
    // Key. Items modified at the same moment may come in either order, so
    // the rows are checked by key set and by the modification time at each
    // place.
    const indexedKey = (item: FixtureItem) => {
      const { groupID } = LIBRARIES.find(
        (entry) => entry.libraryID === item.libraryID,
      )!;
      return groupID === null ? item.key : `${item.key}g${groupID}`;
    };
    const modified = new Map(
      ITEMS.map((item) => [indexedKey(item), item.dateModified]),
    );
    const expectRecent = (
      shown: Shown,
      libraries: readonly (typeof personal)[],
      direction: 1 | -1,
    ) => {
      const items = ITEMS.filter((item) =>
        libraries.some(({ libraryID }) => libraryID === item.libraryID),
      );
      expect(shown.rows.toSorted()).toEqual(items.map(indexedKey).toSorted());
      expect(shown.rows.map((key) => modified.get(key))).toEqual(
        items
          .map(({ dateModified }) => dateModified)
          .toSorted((a, b) => direction * a.localeCompare(b)),
      );
      // A row holds two lines at most: the title, then creators, year and
      // Venue. It has no reading-state line.
      expect(shown.lines.every((lines) => lines <= 2)).toBe(true);
    };

    interface Shown {
      phase: string;
      header: string | null;
      recent: boolean;
      count: string | null;
      rows: string[];
      /** The lines of each row's text. */
      lines: number[];
      /** The Sort button: whether it shows a sort as set, and its text. */
      sort: { set: boolean; text: string | null };
    }
    const readShown = `(async()=>{const view=app.workspace.getLeavesOfType('zotlit-library')[0]?.view;if(!view?.tree)return 'null';await view.query.settled;await view.tree.settled;const el=view.contentEl;const rows=[...el.querySelectorAll('[data-query-papers-row]')];const sort=el.querySelector('[data-query-toolbar="sort"]');return JSON.stringify({sort:{set:sort?.hasAttribute('data-active')??false,text:sort?.textContent??null},phase:view.query.state.getState().phase,header:${LIBRARY_HEADING},recent:[...el.querySelectorAll('[data-library-node]')].some(n=>JSON.parse(n.getAttribute('data-library-node'))[0]==='recent'&&n.getAttribute('aria-selected')==='true'),count:el.querySelector('[data-query-count]')?.getAttribute('data-query-count')??null,rows:rows.map(n=>n.getAttribute('data-query-papers-row')),lines:rows.map(n=>n.querySelector('[data-query-papers-title]').parentElement.childElementCount)});})()`;
    const shownWhen = (ready: (shown: Shown) => boolean) =>
      obReadUntil<Shown>(vaultId, readShown, {
        ready,
        what: "Library View",
        tries: 120,
      });
    /** Whether the list drew every row it counted, `count` of them. */
    const listing = (count: number) => (shown: Shown) =>
      shown.phase === "ready" &&
      shown.count === String(count) &&
      shown.rows.length === count;
    const inLibrary = (script: string) =>
      obEval(
        vaultId,
        `(async()=>{${PAGE}const el=app.workspace.getLeavesOfType('zotlit-library')[0].view.contentEl;${script};return true;})()`,
      );
    /** Press the tree node `key`; a narrow pane keeps the tree behind its button. */
    const pressNode = (key: string, what: string) =>
      inLibrary(
        `const pane=el.querySelector('[data-library-tree]');if(getComputedStyle(pane).display==='none'){press(el.querySelector('[data-library-tree-toggle]'),'Library Tree button');await until('Library Tree',()=>getComputedStyle(pane).display!=='none');}press([...pane.querySelectorAll('[data-library-node]')].find(n=>n.getAttribute('data-library-node')===${JSON.stringify(key)}),${JSON.stringify(what)})`,
      );
    const size = (libraries: readonly (typeof personal)[]) =>
      ITEMS.filter((item) =>
        libraries.some(({ libraryID }) => libraryID === item.libraryID),
      ).length;

    // The new view opens on Recent: every Item of the Library Scope, newest
    // change first, under a heading that names Recent and counts its papers.
    await obEval(
      vaultId,
      "app.commands.executeCommandById('zotlit:open-library-view');true",
    );
    const opened = await shownWhen(listing(size([personal, shared])));
    expect(opened).toMatchObject({
      recent: true,
      header: `${m.library_view_recent()} | ${m.library_view_heading_papers({ count: size([personal, shared]) })}`,
    });
    expectRecent(opened, [personal, shared], -1);
    // On a pane too narrow for the tree beside the list, Recent's tree
    // toggle sits beside the search box, not on a row of its own.
    const narrowRow = JSON.parse(
      await obEval(
        vaultId,
        `(()=>{const el=app.workspace.getLeavesOfType('zotlit-library')[0].view.contentEl;const width=el.style.width;el.style.width='400px';try{const toggle=el.querySelector('[data-library-tree-toggle]');const input=el.querySelector('[data-library-search] input');const t=toggle.getBoundingClientRect();const i=input.getBoundingClientRect();return JSON.stringify({toggle:toggle.checkVisibility(),beside:t.top<i.bottom&&t.bottom>i.top&&t.right<=i.left});}finally{el.style.width=width;}})()`,
      ),
    );
    expect(narrowRow).toEqual({ toggle: true, beside: true });

    // Another Library Scope changes what Recent lists.
    await obEval(
      vaultId,
      `(async()=>{const settings=${services}.settings;settings.update({${JSON.stringify(LIBRARY_SCOPE_SETTING_KEY)}:${scope([personal])}});await settings.flush();return true;})()`,
    );
    const narrowed = await shownWhen(listing(size([personal])));
    expectRecent(narrowed, [personal], -1);

    // A sort change keeps Recent selected; selecting Recent again after a
    // Library sorts newest change first again.
    await inLibrary(
      "press(el.querySelector('[data-query-toolbar=\"sort\"]'),'Sort');await pick(await until('sort direction',()=>el.querySelector('[data-query-popover=\"sort\"] [data-sort-direction]')),'ASC','sort direction')",
    );
    const ascending = await shownWhen(
      (shown) =>
        listing(size([personal]))(shown) && shown.rows[0] !== narrowed.rows[0],
    );
    expect(ascending.recent).toBe(true);
    expectRecent(ascending, [personal], 1);
    await pressNode(JSON.stringify(["personal"]), "My Library");
    await shownWhen((shown) => !shown.recent && shown.phase === "ready");
    await pressNode(JSON.stringify(["recent"]), "Recent");
    const again = await shownWhen(
      (shown) => shown.recent && listing(size([personal]))(shown),
    );
    expectRecent(again, [personal], -1);
    expect(again.sort).toEqual({ set: false, text: "Sort" });
    const saved = (doc: object) =>
      obEvalUntil(
        vaultId,
        `JSON.stringify(${services}.settings.current['library.document'],['node','kind','library','type','path','sort','property','direction'])`,
        { expected: JSON.stringify(doc) },
      );
    expect(
      await saved({
        node: { kind: "recent" },
        sort: [{ property: "dateModified", direction: "DESC" }],
      }),
    ).toBe(true);

    // Leaving Recent clears its own sort: the seed's "Shared key" Collection
    // of My Library lists in the default order, newest change first, and the
    // Sort button shows no sort set.
    const sharedKey = COLLECTIONS.find(
      (entry) =>
        entry.libraryID === personal.libraryID && entry.key === "SHAREDCL",
    )!;
    const subtree = (collectionID: number): number[] => [
      collectionID,
      ...COLLECTIONS.filter(
        (entry) => entry.parentCollectionID === collectionID,
      ).flatMap((child) => subtree(child.collectionID)),
    ];
    const inSharedKey = new Set(subtree(sharedKey.collectionID));
    const filed = ITEMS.filter(({ collectionIDs }) =>
      collectionIDs.some((id) => inSharedKey.has(id)),
    );
    const expectFiled = (shown: Shown, direction: 1 | -1) => {
      expect(shown.rows.toSorted()).toEqual(filed.map(indexedKey).toSorted());
      expect(shown.rows.map((key) => modified.get(key))).toEqual(
        filed
          .map(({ dateModified }) => dateModified)
          .toSorted((a, b) => direction * a.localeCompare(b)),
      );
    };
    const sharedKeyNode = JSON.stringify(["personal", sharedKey.name]);
    const sharedKeyPath = {
      kind: "collection",
      library: { type: "personal" },
      path: [sharedKey.name],
    };
    await pressNode(sharedKeyNode, "Shared key");
    const unsorted = await shownWhen(
      (shown) => !shown.recent && listing(filed.length)(shown),
    );
    expect(unsorted.sort).toEqual({ set: false, text: "Sort" });
    expectFiled(unsorted, -1);
    expect(await saved({ node: sharedKeyPath, sort: [] })).toBe(true);

    // A sort the researcher changed on Recent is theirs: it stays on the
    // Collection, and the Sort button shows it as set.
    await pressNode(JSON.stringify(["recent"]), "Recent");
    await shownWhen(
      (shown) => shown.recent && listing(size([personal]))(shown),
    );
    await inLibrary(
      "press(el.querySelector('[data-query-toolbar=\"sort\"]'),'Sort');await pick(await until('sort direction',()=>el.querySelector('[data-query-popover=\"sort\"] [data-sort-direction]')),'ASC','sort direction')",
    );
    const resorted = await shownWhen(
      (shown) =>
        shown.recent && shown.sort.set && listing(size([personal]))(shown),
    );
    expectRecent(resorted, [personal], 1);
    await pressNode(sharedKeyNode, "Shared key");
    const kept = await shownWhen(
      (shown) => !shown.recent && listing(filed.length)(shown),
    );
    expect(kept.sort).toEqual({ set: true, text: "Sort1" });
    expectFiled(kept, 1);
    expect(
      await saved({
        node: sharedKeyPath,
        sort: [{ property: "dateModified", direction: "ASC" }],
      }),
    ).toBe(true);
  });

  it("picks a sort property in the Library View's Sort popover from the property Select's options, and the row keeps one property Select", async () => {
    const services = "app.plugins.plugins.zotlit.services";
    const snapshot = await obEval(
      vaultId,
      `JSON.stringify({layout:app.workspace.getLayout(),document:${services}.settings.current['library.document']??null})`,
    );
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await obEval(
        vaultId,
        `(async()=>{const saved=JSON.parse(${JSON.stringify(snapshot)});const settings=${services}.settings;settings.update({'library.document':saved.document});await settings.flush();await app.workspace.changeLayout(saved.layout);return true;})()`,
      );
    });
    // A new Library View opens on Recent, whose sort is last change first.
    await obEval(
      vaultId,
      `(async()=>{app.workspace.getLeavesOfType('zotlit-library').forEach(leaf=>leaf.detach());const settings=${services}.settings;settings.update({'library.document':null});await settings.flush();app.commands.executeCommandById('zotlit:open-library-view');return true;})()`,
    );
    // The heading draws the Sort control in a React root of its own; the
    // property Select's popup opens its Chooser there, with its search and
    // rows, and a pick shuts it.
    const picked = JSON.parse(
      await obEval(
        vaultId,
        `(async()=>{${PAGE}const leaf=app.workspace.getLeavesOfType('zotlit-library')[0];await app.workspace.revealLeaf(leaf);const el=leaf.view.contentEl;await until('rows',()=>el.querySelectorAll('[data-query-papers-row]').length>0,20000);press(el.querySelector('[data-query-toolbar="sort"]'),'Sort');const popover=await until('Sort popover',()=>el.querySelector('[data-query-popover="sort"]:popover-open'));await pick(await until('sort property',()=>popover.querySelector('[data-sort-property]')),'title','sort property');const triggers=popover.querySelectorAll('[data-sort-property]').length;popover.hidePopover();return JSON.stringify({triggers});})()`,
      ),
    ) as { triggers: number };
    expect(picked).toEqual({ triggers: 1 });
    expect(
      await obEvalUntil(
        vaultId,
        `JSON.stringify(${services}.settings.current['library.document']?.sort)`,
        {
          expected: JSON.stringify([{ property: "title", direction: "DESC" }]),
        },
      ),
    ).toBe(true);
  });

  it("filters the Library View from the Library Tree, with counts that match the seed and follow a database change", async () => {
    const services = "app.plugins.plugins.zotlit.services";
    const snapshot = await obEval(
      vaultId,
      `JSON.stringify({layout:app.workspace.getLayout(),document:${services}.settings.current['library.document']??null,scope:${services}.settings.current[${JSON.stringify(LIBRARY_SCOPE_SETTING_KEY)}]??null})`,
    );
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await obEval(
        vaultId,
        `(async()=>{const saved=JSON.parse(${JSON.stringify(snapshot)});const settings=${services}.settings;settings.update({'library.document':saved.document,${JSON.stringify(LIBRARY_SCOPE_SETTING_KEY)}:saved.scope});await settings.flush();await app.workspace.changeLayout(saved.layout);return true;})()`,
      );
    });
    // The Library Scope holds My Library alone; the tree opens on My Library.
    await obEval(
      vaultId,
      `(async()=>{app.workspace.getLeavesOfType('zotlit-library').forEach(leaf=>leaf.detach());const settings=${services}.settings;settings.update({'library.document':${JSON.stringify(MY_LIBRARY_DOCUMENT)},${JSON.stringify(LIBRARY_SCOPE_SETTING_KEY)}:{mode:'selected',libraries:[{type:'personal'}]}});await settings.flush();return true;})()`,
    );

    // The seed's oracle: each Library's Items, and the Items a Collection
    // and its subcollections hold, each once.
    const library = (type: "user" | number) =>
      LIBRARIES.find((entry) =>
        type === "user" ? entry.type === "user" : entry.groupID === type,
      )!;
    const personal = library("user");
    const shared = library(4200309);
    const indexedKey = (item: FixtureItem) => {
      const { groupID } = LIBRARIES.find(
        (entry) => entry.libraryID === item.libraryID,
      )!;
      return groupID === null ? item.key : `${item.key}g${groupID}`;
    };
    const subtree = (collectionID: number): number[] => [
      collectionID,
      ...COLLECTIONS.filter(
        (entry) => entry.parentCollectionID === collectionID,
      ).flatMap((child) => subtree(child.collectionID)),
    ];
    const collection = (libraryID: number, key: string) =>
      COLLECTIONS.find(
        (entry) => entry.libraryID === libraryID && entry.key === key,
      )!;
    const filed = (collectionID: number) => {
      const ids = new Set(subtree(collectionID));
      return ITEMS.filter(({ collectionIDs }) =>
        collectionIDs.some((id) => ids.has(id)),
      );
    };
    const inLibrary = (libraryID: number) =>
      ITEMS.filter((item) => item.libraryID === libraryID);
    const parent = collection(personal.libraryID, "PERSNAL2");
    const child = collection(personal.libraryID, "PERSCHLD");
    const sharedKey = collection(personal.libraryID, "SHAREDCL");
    const nodeKey = (selector: string, ...path: string[]) =>
      JSON.stringify([selector, ...path]);
    const parentKey = nodeKey("personal", parent.name);
    const childKey = nodeKey("personal", parent.name, child.name);
    const sharedNode = nodeKey(`group:${shared.groupID}`);

    interface Shown {
      phase: string;
      header: string | null;
      all: string | null;
      tree: {
        key: string;
        level: number;
        label: string;
        count: string | null;
        selected: boolean;
      }[];
      count: string | null;
      rows: string[];
    }
    const readShown = `(async()=>{const view=app.workspace.getLeavesOfType('zotlit-library')[0]?.view;if(!view?.tree)return 'null';await view.query.settled;await view.tree.settled;const el=view.contentEl;return JSON.stringify({phase:view.query.state.getState().phase,header:${LIBRARY_HEADING},all:el.querySelector('[data-library-all]')?.getAttribute('data-library-all')??null,tree:[...el.querySelectorAll('[data-library-node]')].map(n=>({key:n.getAttribute('data-library-node'),level:Number(n.getAttribute('aria-level')),label:n.querySelector('[data-library-label]').textContent,count:n.querySelector('[data-library-count]')?.textContent??null,selected:n.getAttribute('aria-selected')==='true'})),count:el.querySelector('[data-query-count]')?.getAttribute('data-query-count')??null,rows:[...el.querySelectorAll('tr[data-query-table-row="item"], [data-query-papers-row]')].map(n=>n.getAttribute('data-query-key')??n.getAttribute('data-query-papers-row'))});})()`;
    const shownWhen = (ready: (shown: Shown) => boolean) =>
      obReadUntil<Shown>(vaultId, readShown, {
        ready,
        what: "Library View",
        tries: 120,
      });
    /** Whether the list drew every row it counted, for the selection `key`. */
    const listing = (key: string) => (shown: Shown) =>
      shown.phase === "ready" &&
      shown.tree.some((node) => node.key === key && node.selected) &&
      shown.count !== null &&
      shown.rows.length === Number(shown.count);
    const node = (shown: Shown, key: string) =>
      shown.tree.find((entry) => entry.key === key);
    /**
     * Press the element `target` finds in the tree pane. A narrow pane keeps
     * the tree behind its button, so the press opens it first.
     */
    const inTree = (target: string, what: string) =>
      obEval(
        vaultId,
        `(async()=>{${PAGE}const el=app.workspace.getLeavesOfType('zotlit-library')[0].view.contentEl;const pane=el.querySelector('[data-library-tree]');if(getComputedStyle(pane).display==='none'){press(el.querySelector('[data-library-tree-toggle]'),'Library Tree button');await until('Library Tree',()=>getComputedStyle(pane).display!=='none');}press(${target},${JSON.stringify(what)});return true;})()`,
      );
    /** Press the node `key`, or its element that `part` selects. */
    const press = (key: string, part: string, what: string) => {
      const row = `[...pane.querySelectorAll('[data-library-node]')].find(n=>n.getAttribute('data-library-node')===${JSON.stringify(key)})`;
      return inTree(
        part === "" ? row : `${row}.querySelector(${JSON.stringify(part)})`,
        what,
      );
    };

    await obEval(
      vaultId,
      "app.commands.executeCommandById('zotlit:open-library-view');true",
    );
    // The tree shows the Library Scope: My Library and its Collections, each
    // counted from the seed, a subcollection's Items inside its parent.
    const opened = await shownWhen(
      (shown) =>
        listing(nodeKey("personal"))(shown) &&
        node(shown, parentKey)?.count != null,
    );
    expect(
      opened.tree.map(({ key, level, count }) => ({ key, level, count })),
    ).toEqual([
      // Recent, above the Libraries, counts nothing.
      { key: JSON.stringify(["recent"]), level: 1, count: null },
      {
        key: nodeKey("personal"),
        level: 1,
        count: String(inLibrary(personal.libraryID).length),
      },
      ...[parent, sharedKey]
        .toSorted((a, b) => a.name.localeCompare(b.name))
        .map((entry) => ({
          key: nodeKey("personal", entry.name),
          level: 2,
          count: String(filed(entry.collectionID).length),
        })),
    ]);
    expect(opened.header).toBe(
      libraryHeader(
        m.settings_library_scope_personal(),
        inLibrary(personal.libraryID),
      ),
    );
    await press(parentKey, "[data-library-expand]", "Collection disclosure");
    expect(
      node(
        await shownWhen((shown) => node(shown, childKey) !== undefined),
        childKey,
      ),
    ).toMatchObject({
      level: 3,
      count: String(filed(child.collectionID).length),
    });

    // "All libraries" shows the group libraries outside the Library Scope;
    // one lists its own Items.
    expect(opened.all).toBe("off");
    await inTree("pane.querySelector('[data-library-all]')", "All libraries");
    const widened = await shownWhen(
      (shown) =>
        shown.all === "on" &&
        LIBRARIES.every(
          ({ groupID }) =>
            groupID === null ||
            node(shown, nodeKey(`group:${groupID}`))?.count != null,
        ),
    );
    for (const entry of LIBRARIES.filter(({ groupID }) => groupID !== null))
      expect(node(widened, nodeKey(`group:${entry.groupID}`))).toMatchObject({
        label: entry.name,
        count: String(inLibrary(entry.libraryID).length),
      });
    await press(sharedNode, "", "group library");
    const group = await shownWhen(listing(sharedNode));
    expect(group.rows.toSorted()).toEqual(
      inLibrary(shared.libraryID).map(indexedKey).toSorted(),
    );

    // A Collection lists exactly its Items and its subcollection's, and the
    // header names it with the count.
    await press(parentKey, "", "Collection");
    const expected = filed(parent.collectionID).map(indexedKey).toSorted();
    const chosen = await shownWhen(listing(parentKey));
    expect(chosen.rows.toSorted()).toEqual(expected);
    expect(chosen.header).toBe(
      libraryHeader(parent.name, filed(parent.collectionID)),
    );

    // A plugin reload comes back on the Collection.
    expect(
      await obEvalUntil(
        vaultId,
        "app.plugins.disablePlugin('zotlit').then(function () { return app.plugins.enablePlugin('zotlit'); }).then(function () { return true; })",
        { expected: "true", tries: 20 },
      ),
    ).toBe(true);
    const reloaded = await shownWhen(listing(parentKey));
    expect(reloaded.rows.toSorted()).toEqual(expected);
    expect(reloaded.header).toBe(chosen.header);

    // Zotero files one more Item in the subcollection: the counts up the
    // tree and the list take it after the database change.
    const added = inLibrary(personal.libraryID).find(
      ({ collectionIDs }) =>
        !collectionIDs.some((id) => subtree(parent.collectionID).includes(id)),
    )!;
    const file = (sql: string) => {
      using database = new DatabaseSync(e2eFixture.databasePath);
      database.prepare(sql).run(child.collectionID, added.itemID);
    };
    file(
      "insert into collectionItems (collectionID, itemID, orderIndex) values (?, ?, 0)",
    );
    cleanup.defer(async () => {
      file("delete from collectionItems where collectionID = ? and itemID = ?");
      await signalDatabaseUpdated(vaultId);
    });
    await signalDatabaseUpdated(vaultId);
    const changed = await shownWhen(
      (shown) =>
        listing(parentKey)(shown) &&
        node(shown, parentKey)?.count === String(expected.length + 1),
    );
    expect(changed.rows.toSorted()).toEqual(
      [...expected, indexedKey(added)].toSorted(),
    );
    expect(changed.header).toBe(
      libraryHeader(parent.name, [...filed(parent.collectionID), added]),
    );
  });

  /**
   * Reload the vault's window, as Obsidian's "Reload app without saving"
   * does, and wait for ZotLit to load in the new page with plugin data read.
   */
  async function reloadWindow(): Promise<void> {
    // The page before the reload carries a mark the new page lacks. The
    // workspace saves its layout a while after a change; a researcher
    // reloads later than that, so the case saves it at once.
    await obEval(
      vaultId,
      "(async()=>{window.__ztBeforeReload=true;await app.workspace.requestSaveLayout.run();return true;})()",
    );
    await cli([`vault=${vaultId}`, "reload"]);
    expect(
      await obEvalUntil(
        vaultId,
        "String(!window.__ztBeforeReload&&!!app.plugins.plugins.zotlit?.services?.settings?.current&&app.workspace.layoutReady)",
        { expected: "true", tries: 120 },
      ),
    ).toBe(true);
    await keepRendering(vaultId);
  }

  /** What the Library View shows that a reload must keep, once it settled. */
  interface Kept {
    phase: string;
    open: string[];
    selected: string | null;
    card: string | null;
    inView: boolean;
    banner: boolean;
    pressed: string | null;
    rows: number;
  }
  const readKept = (help: string) =>
    `(async()=>{const view=app.workspace.getLeavesOfType('zotlit-library')[0]?.view;if(!view?.tree)return 'null';await view.searched;await view.query.settled;await view.tree.settled;await new Promise(r=>setTimeout(r,200));const el=view.contentEl;const row=el.querySelector('[data-query-item-row][data-selected]');const card=el.querySelector('[data-library-card]');let inView=false;if(row){const r=row.getBoundingClientRect();const hit=el.ownerDocument.elementFromPoint(r.left+r.width/2,r.top+r.height/2);inView=!!hit&&row.contains(hit);}const action=view.containerEl.querySelector(${JSON.stringify(`.view-actions .view-action[aria-label="${help}"]`)});return JSON.stringify({phase:view.query.state.getState().phase,open:[...el.querySelectorAll('[data-library-node][aria-expanded="true"]')].map(n=>n.getAttribute('data-library-node')),selected:row?.getAttribute('data-query-item-row')??null,card:card&&!card.hidden&&card.checkVisibility()?card.querySelector('[data-library-card-title]')?.textContent??'':null,inView,banner:!!el.querySelector('[data-welcome-banner]'),pressed:action?.getAttribute('aria-pressed')??null,rows:el.querySelectorAll('[data-query-item-row]').length});})()`;

  it("puts the researcher back where they were after a window reload: the Collection left open, the selected paper in view with its Reading Card beside a wide list and none over a narrow one, and the Welcome View banner they asked for, with Zotero closed", async () => {
    const services = "app.plugins.plugins.zotlit.services";
    const snapshot = await obEval(
      vaultId,
      `JSON.stringify({layout:app.workspace.getLayout(),document:${services}.settings.current['library.document']??null,scope:${services}.settings.current[${JSON.stringify(LIBRARY_SCOPE_SETTING_KEY)}]??null,dismissed:${services}.settings.current['welcome.dismissed'],requested:${services}.settings.current['welcome.requested']})`,
    );
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await obEval(
        vaultId,
        `(async()=>{const saved=JSON.parse(${JSON.stringify(snapshot)});const settings=${services}.settings;settings.update({'library.document':saved.document,${JSON.stringify(LIBRARY_SCOPE_SETTING_KEY)}:saved.scope,'welcome.dismissed':saved.dismissed,'welcome.requested':saved.requested});await settings.flush();await app.workspace.changeLayout(saved.layout);return true;})()`,
      );
    });
    await wideWindow(cleanup);
    // The window is short, so the list scrolls under the banner.
    await obEval(
      vaultId,
      "require('@electron/remote').getCurrentWindow().setSize(1600,640);true",
    );
    // My Library alone, with the banner put away.
    await obEval(
      vaultId,
      `(async()=>{app.workspace.getLeavesOfType('zotlit-library').forEach(leaf=>leaf.detach());const settings=${services}.settings;settings.update({'library.document':${JSON.stringify(MY_LIBRARY_DOCUMENT)},${JSON.stringify(LIBRARY_SCOPE_SETTING_KEY)}:{mode:'selected',libraries:[{type:'personal'}]},'welcome.dismissed':true,'welcome.requested':false});await settings.flush();await app.commands.executeCommandById('zotlit:open-library-view');return true;})()`,
    );
    const help = m.library_view_help_action();
    const keptWhen = (ready: (kept: Kept) => boolean) =>
      obReadUntil<Kept>(vaultId, readKept(help), {
        ready,
        what: "Library View",
        tries: 120,
      });
    const personal = LIBRARIES.find(({ type }) => type === "user")!;
    const parent = COLLECTIONS.find(
      (entry) =>
        entry.libraryID === personal.libraryID && entry.key === "PERSNAL2",
    )!;
    const parentKey = JSON.stringify(["personal", parent.name]);
    const first = await keptWhen(
      (kept) => kept.phase === "ready" && kept.rows > 0,
    );
    expect(first).toMatchObject({ banner: false, pressed: "false" });
    expect(first.open).not.toContain(parentKey);

    // Open the Collection, select the last paper, and ask for the banner.
    const last = JSON.parse(
      await obEval(
        vaultId,
        `(async()=>{${PAGE}const leaf=app.workspace.getLeavesOfType('zotlit-library')[0];await app.workspace.revealLeaf(leaf);app.workspace.setActiveLeaf(leaf,{focus:true});const view=leaf.view;const el=view.contentEl;press([...el.querySelectorAll('[data-library-node]')].find(n=>n.getAttribute('data-library-node')===${JSON.stringify(parentKey)}).querySelector('[data-library-expand]'),'Collection disclosure');await until('Collection open',()=>[...el.querySelectorAll('[data-library-node][aria-expanded="true"]')].some(n=>n.getAttribute('data-library-node')===${JSON.stringify(parentKey)}));const rows=[...el.querySelectorAll('[data-query-item-row]')];const row=rows.at(-1);press(row,'last paper');await until('card',()=>{const card=el.querySelector('[data-library-card]');return !card.hidden&&card.checkVisibility();});press(view.containerEl.querySelector(${JSON.stringify(`.view-actions .view-action[aria-label="${help}"]`)}),'Welcome & help');await until('banner',()=>el.querySelector('[data-welcome-banner]'));return JSON.stringify(row.getAttribute('data-query-item-row'));})()`,
      ),
    ) as string;
    const before = await keptWhen(
      (kept) => kept.selected === last && kept.banner,
    );
    expect(before).toMatchObject({
      open: expect.arrayContaining([parentKey]),
      selected: last,
      banner: true,
      pressed: "true",
    });
    expect(before.card).not.toBeNull();

    // A reload right after the changes keeps every one of them.
    await reloadWindow();
    const after = await keptWhen(
      (kept) => kept.phase === "ready" && kept.selected !== null,
    );
    expect(after).toEqual({ ...before, inView: true });
    // The list scrolled to the paper, which a fresh page would not show.
    expect(
      await obEval(
        vaultId,
        `(()=>{const el=app.workspace.getLeavesOfType('zotlit-library')[0].view.contentEl;let n=el.querySelector('[data-query-item-row][data-selected]');for(;n&&n!==el;n=n.parentElement)if(n.scrollTop>0)return 'scrolled';return 'top';})()`,
      ),
    ).toBe("scrolled");

    // On a narrow pane the restored paper is selected as the arrow keys
    // select a row: its card does not open over the list, which stays
    // uncovered with the row in view.
    await obEval(
      vaultId,
      "require('@electron/remote').getCurrentWindow().setSize(900,640);true",
    );
    await reloadWindow();
    const narrow = await keptWhen(
      (kept) => kept.phase === "ready" && kept.selected !== null,
    );
    expect(narrow).toMatchObject({
      selected: last,
      card: null,
      inView: true,
      banner: true,
      pressed: "true",
    });
  });

  it("keeps the Welcome View banner away after a window reload once the researcher dismissed it", async () => {
    const services = "app.plugins.plugins.zotlit.services";
    const snapshot = await obEval(
      vaultId,
      `JSON.stringify({layout:app.workspace.getLayout(),dismissed:${services}.settings.current['welcome.dismissed'],requested:${services}.settings.current['welcome.requested']})`,
    );
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await obEval(
        vaultId,
        `(async()=>{const saved=JSON.parse(${JSON.stringify(snapshot)});const settings=${services}.settings;settings.update({'welcome.dismissed':saved.dismissed,'welcome.requested':saved.requested});await settings.flush();await app.workspace.changeLayout(saved.layout);return true;})()`,
      );
    });
    const help = m.library_view_help_action();
    const helpAction = `app.workspace.getLeavesOfType('zotlit-library')[0].view.containerEl.querySelector(${JSON.stringify(`.view-actions .view-action[aria-label="${help}"]`)})`;
    const banner = `app.workspace.getLeavesOfType('zotlit-library')[0]?.view.contentEl.querySelector('[data-welcome-banner]')`;
    // The banner shows, as "Open welcome view" shows it, then the researcher
    // dismisses it from its dismiss button.
    await obEval(
      vaultId,
      `(async()=>{${PAGE}app.workspace.getLeavesOfType('zotlit-library').forEach(leaf=>leaf.detach());await app.commands.executeCommandById('zotlit:open-welcome-view');const el=await until('banner',()=>${banner},5000);press(el.querySelector('[data-welcome-dismiss]'),'Dismiss the welcome banner');await until('banner gone',()=>!${banner});return true;})()`,
    );
    await reloadWindow();
    const kept = await obReadUntil<Kept>(vaultId, readKept(help), {
      ready: (shown) => shown.phase === "ready",
      what: "Library View",
      tries: 120,
    });
    expect(kept).toMatchObject({ banner: false, pressed: "false" });
    expect(
      await obEval(
        vaultId,
        `JSON.stringify({dismissed:${services}.settings.current['welcome.dismissed'],requested:${services}.settings.current['welcome.requested'],action:!!${helpAction}})`,
      ),
    ).toBe(JSON.stringify({ dismissed: true, requested: false, action: true }));
  });

  it("resizes the Reading Card from its inner edge with the keys and a drag, keeps the width after a window reload, and returns it to 24rem on a double click, with Zotero closed", async () => {
    const services = "app.plugins.plugins.zotlit.services";
    const snapshot = await obEval(
      vaultId,
      `JSON.stringify({layout:app.workspace.getLayout(),document:${services}.settings.current['library.document']??null,dismissed:${services}.settings.current['welcome.dismissed'],requested:${services}.settings.current['welcome.requested']})`,
    );
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await obEval(
        vaultId,
        `(async()=>{const saved=JSON.parse(${JSON.stringify(snapshot)});const settings=${services}.settings;settings.update({'library.document':saved.document,'welcome.dismissed':saved.dismissed,'welcome.requested':saved.requested});await settings.flush();await app.workspace.changeLayout(saved.layout);return true;})()`,
      );
    });
    await wideWindow(cleanup);
    /** Save a picture of the window as `library-card-<name>.png`. */
    const screenshot = async (name: string) => {
      const folder = join(workspaceRoot, ".scratch/e2e-screenshots");
      await mkdir(folder, { recursive: true });
      await cli([
        `vault=${vaultId}`,
        "dev:screenshot",
        `path=${join(folder, `library-${name}.png`)}`,
      ]);
    };
    /** The card's width, its edge's values and the width plugin data keeps. */
    interface CardWidth {
      phase: string;
      shown: boolean;
      width: number;
      list: number;
      now: number;
      min: number;
      max: number;
      stored: number | null;
      label: string | null;
    }
    const readWidth = `(async()=>{const view=app.workspace.getLeavesOfType('zotlit-library')[0]?.view;if(!view?.query)return 'null';await view.query.settled;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));const el=view.contentEl;const card=el.querySelector('[data-library-card]');const edge=card.querySelector('[data-library-card-resizer]');const num=n=>Number(edge.getAttribute(n));return JSON.stringify({phase:view.query.state.getState().phase,shown:!card.hidden&&card.checkVisibility(),width:Math.round(card.getBoundingClientRect().width),list:Math.round(el.querySelector('[data-library-search-row]').parentElement.getBoundingClientRect().width),now:num('aria-valuenow'),min:num('aria-valuemin'),max:num('aria-valuemax'),stored:${services}.settings.current['library.document']?.cardWidth??null,label:edge.getAttribute('aria-label')});})()`;
    const widthWhen = (ready: (shown: CardWidth) => boolean) =>
      obReadUntil<CardWidth>(vaultId, readWidth, {
        ready,
        what: "Reading Card width",
        tries: 120,
      });
    const edge = `app.workspace.getLeavesOfType('zotlit-library')[0].view.contentEl.querySelector('[data-library-card] [data-library-card-resizer]')`;
    const keys = (...names: string[]) =>
      obEval(
        vaultId,
        `(async()=>{const edge=${edge};edge.focus();for(const key of ${JSON.stringify(names)}){edge.dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true,cancelable:true}));await new Promise(r=>requestAnimationFrame(r));}return true;})()`,
      );
    // My Library with no width kept, and its first paper selected.
    await obEval(
      vaultId,
      `(async()=>{${PAGE}app.workspace.getLeavesOfType('zotlit-library').forEach(leaf=>leaf.detach());const settings=${services}.settings;settings.update({'library.document':${JSON.stringify(MY_LIBRARY_DOCUMENT)},'welcome.dismissed':true,'welcome.requested':false});await settings.flush();await app.commands.executeCommandById('zotlit:open-library-view');const leaf=app.workspace.getLeavesOfType('zotlit-library')[0];await app.workspace.revealLeaf(leaf);app.workspace.setActiveLeaf(leaf,{focus:true});const el=leaf.view.contentEl;const row=await until('rows',()=>el.querySelector('[data-query-item-row]'),20000);press(row,'first paper');await until('card',()=>{const card=el.querySelector('[data-library-card]');return !card.hidden&&card.checkVisibility();},5000);return true;})()`,
    );
    const first = await widthWhen((shown) => shown.shown);
    // The default 24rem, said on its edge, which names what it does.
    expect(first).toMatchObject({
      width: 384,
      now: 384,
      min: 288,
      stored: null,
      label: m.library_view_card_resize_hint(),
    });
    expect(first.max).toBe(first.width + first.list - 320);
    await screenshot("card-default");

    // Three presses toward the list widen it by 16px each.
    await keys("ArrowLeft", "ArrowLeft", "ArrowLeft");
    expect(await widthWhen((shown) => shown.stored === 432)).toMatchObject({
      width: 432,
      now: 432,
    });
    await keys("ArrowRight");
    await widthWhen((shown) => shown.stored === 416);
    // Home and End take it to its narrowest and its widest, which leaves
    // the list 20rem.
    await keys("Home");
    expect(await widthWhen((shown) => shown.stored === 288)).toMatchObject({
      width: 288,
    });
    await keys("End");
    const widest = await widthWhen((shown) => shown.stored === first.max);
    expect(widest).toMatchObject({ width: first.max, list: 320 });

    // A drag of the edge 100px away from the list, back from the widest.
    await obEval(
      vaultId,
      `(async()=>{const edge=${edge};const r=edge.getBoundingClientRect();const x=r.left+r.width/2;const y=r.top+r.height/2;const fire=(type,clientX)=>edge.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,pointerId:7,isPrimary:true,button:0,buttons:type==='pointerup'?0:1,clientX,clientY:y}));fire('pointerdown',x);if(!document.body.classList.contains('zt-is-resizing-library-card'))throw new Error('No resize cursor');for(const step of [25,50,75,100]){fire('pointermove',x+step);await new Promise(r=>requestAnimationFrame(r));}fire('pointerup',x+100);return true;})()`,
    );
    const dragged = await widthWhen(
      (shown) => shown.stored === first.max - 100,
    );
    expect(dragged).toMatchObject({ width: first.max - 100 });
    await screenshot("card-resized");

    // A reload keeps the width.
    await reloadWindow();
    const after = await widthWhen(
      (shown) => shown.phase === "ready" && shown.shown,
    );
    expect(after).toMatchObject({
      width: dragged.width,
      now: dragged.width,
      stored: dragged.width,
    });

    // A double click puts the default back, and keeps no width.
    await obEval(
      vaultId,
      `(()=>{${edge}.dispatchEvent(new MouseEvent('dblclick',{bubbles:true,cancelable:true,detail:2}));return true;})()`,
    );
    expect(await widthWhen((shown) => shown.stored === null)).toMatchObject({
      width: 384,
      now: 384,
    });
  });

  it("closes the Reading Card on a wide pane from its close button or a drag of its edge past the minimum, keeps it closed while the arrow keys move and after a window reload, and opens it on a row click at the width it had, with Zotero closed", async () => {
    const services = "app.plugins.plugins.zotlit.services";
    const snapshot = await obEval(
      vaultId,
      `JSON.stringify({layout:app.workspace.getLayout(),document:${services}.settings.current['library.document']??null,dismissed:${services}.settings.current['welcome.dismissed'],requested:${services}.settings.current['welcome.requested']})`,
    );
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await obEval(
        vaultId,
        `(async()=>{const saved=JSON.parse(${JSON.stringify(snapshot)});const settings=${services}.settings;settings.update({'library.document':saved.document,'welcome.dismissed':saved.dismissed,'welcome.requested':saved.requested});await settings.flush();await app.workspace.changeLayout(saved.layout);return true;})()`,
      );
    });
    await wideWindow(cleanup);
    const shots = "/tmp/lv-card-close-shots";
    /** Save a picture of the window as `<name>.png` in {@link shots}. */
    const screenshot = async (name: string) => {
      await mkdir(shots, { recursive: true });
      await cli([
        `vault=${vaultId}`,
        "dev:screenshot",
        `path=${join(shots, `${name}.png`)}`,
      ]);
    };
    /** Whether the card shows, its width, the list's, and what plugin data keeps. */
    interface CardClosed {
      phase: string;
      shown: boolean;
      width: number;
      list: number;
      selected: string | null;
      focused: string | null;
      stored: number | null;
      closed: boolean | null;
      kept: string | null;
    }
    const view = `app.workspace.getLeavesOfType('zotlit-library')[0]?.view`;
    const readClosed = `(async()=>{const view=${view};if(!view?.query)return 'null';await view.query.settled;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));const el=view.contentEl;const card=el.querySelector('[data-library-card]');const doc=${services}.settings.current['library.document'];return JSON.stringify({phase:view.query.state.getState().phase,shown:!card.hidden&&card.checkVisibility(),width:Math.round(card.getBoundingClientRect().width),list:Math.round(el.querySelector('[data-library-search-row]').parentElement.getBoundingClientRect().width),selected:view.selection.getState().key,focused:activeDocument.activeElement?.getAttribute('data-query-item-row')??null,stored:doc?.cardWidth??null,closed:doc?.cardClosed??null,kept:doc?.selected??null});})()`;
    const closedWhen = (ready: (shown: CardClosed) => boolean) =>
      obReadUntil<CardClosed>(vaultId, readClosed, {
        ready,
        what: "Reading Card",
        tries: 120,
      });
    const rows = `[...${view}.contentEl.querySelectorAll('[data-query-item-row]')]`;
    const rowKey = async (index: number) =>
      JSON.parse(
        await obEval(
          vaultId,
          `JSON.stringify(${rows}[${index}].getAttribute('data-query-item-row'))`,
        ),
      ) as string;
    const clickRow = (index: number) =>
      obEval(
        vaultId,
        `(async()=>{${PAGE}press(${rows}[${index}],'paper ${index}');return true;})()`,
      );
    const edge = `${view}.contentEl.querySelector('[data-library-card] [data-library-card-resizer]')`;
    /**
     * Drag the edge: press it, then move the pointer by each of `steps`
     * pixels away from the list, a frame apiece, and let go where `release`.
     */
    const drag = (steps: number[], { press = true, release = true } = {}) =>
      obEval(
        vaultId,
        `(async()=>{const edge=${edge};const r=edge.getBoundingClientRect();window.__lvccDrag??={x:r.left+r.width/2,y:r.top+r.height/2};const {x,y}=window.__lvccDrag;const fire=(type,clientX)=>edge.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,pointerId:7,isPrimary:true,button:0,buttons:type==='pointerup'?0:1,clientX,clientY:y}));if(${press})fire('pointerdown',x);let last=0;for(const step of ${JSON.stringify(steps)}){last=step;fire('pointermove',x+step);await new Promise(r=>requestAnimationFrame(r));}if(${release}){fire('pointerup',x+last);delete window.__lvccDrag;}return true;})()`,
      );
    // My Library with the card 400px wide, and its first paper selected.
    await obEval(
      vaultId,
      `(async()=>{${PAGE}app.workspace.getLeavesOfType('zotlit-library').forEach(leaf=>leaf.detach());const settings=${services}.settings;settings.update({'library.document':${JSON.stringify({ ...MY_LIBRARY_DOCUMENT, cardWidth: 400 })},'welcome.dismissed':true,'welcome.requested':false});await settings.flush();await app.commands.executeCommandById('zotlit:open-library-view');const leaf=app.workspace.getLeavesOfType('zotlit-library')[0];await app.workspace.revealLeaf(leaf);app.workspace.setActiveLeaf(leaf,{focus:true});const el=leaf.view.contentEl;const row=await until('rows',()=>el.querySelector('[data-query-item-row]'),20000);press(row,'first paper');await until('card',()=>{const card=el.querySelector('[data-library-card]');return !card.hidden&&card.checkVisibility();},5000);return true;})()`,
    );
    const first = await rowKey(0);
    const second = await rowKey(1);
    const open = await closedWhen((shown) => shown.shown);
    expect(open).toMatchObject({ width: 400, selected: first, closed: null });

    // The close button shows on the wide pane too; it hides the card, the
    // list takes its room, and the row keeps the selection and the focus.
    await obEval(
      vaultId,
      `(async()=>{${PAGE}press(${view}.contentEl.querySelector('[data-library-card] [data-library-card-close]'),'close button');return true;})()`,
    );
    const closed = await closedWhen((shown) => shown.closed === true);
    expect(closed).toMatchObject({
      shown: false,
      selected: first,
      focused: first,
      stored: 400,
    });
    expect(closed.list).toBe(open.list + open.width);
    await screenshot("wide-closed");

    // The arrow keys move the selection and leave the card closed.
    await obEval(
      vaultId,
      "activeDocument.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true}));true",
    );
    expect(
      await closedWhen((shown) => shown.selected === second),
    ).toMatchObject({ shown: false, closed: true });

    // A reload keeps it closed beside the restored selection.
    await closedWhen((shown) => shown.kept === second);
    await reloadWindow();
    expect(
      await closedWhen(
        (shown) => shown.phase === "ready" && shown.selected === second,
      ),
    ).toMatchObject({ shown: false, closed: true, stored: 400 });

    // A click on a row opens it again, at its width.
    await clickRow(1);
    expect(await closedWhen((shown) => shown.shown)).toMatchObject({
      width: 400,
      closed: null,
    });

    // A drag 300px away from the list takes the card 156px under its
    // 288px minimum, past the 144px that collapses it while the pointer
    // stays; back within the threshold it shows again at the minimum.
    await drag([100, 200, 300], { release: false });
    expect(await closedWhen((shown) => !shown.shown)).toMatchObject({
      closed: null,
      stored: 400,
    });
    await screenshot("mid-drag-collapsed");
    await drag([200], { press: false, release: false });
    expect(await closedWhen((shown) => shown.shown)).toMatchObject({
      width: 288,
    });
    // Let go past the threshold, it closes and keeps the width it had.
    await drag([300], { press: false });
    expect(await closedWhen((shown) => shown.closed === true)).toMatchObject({
      shown: false,
      stored: 400,
      focused: second,
    });
    await clickRow(1);
    expect(await closedWhen((shown) => shown.shown)).toMatchObject({
      width: 400,
      closed: null,
    });

    // Escape during a collapsed drag puts the card and its width back.
    await drag([100, 200, 300], { release: false });
    await closedWhen((shown) => !shown.shown);
    await obEval(
      vaultId,
      "activeDocument.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));delete window.__lvccDrag;true",
    );
    expect(await closedWhen((shown) => shown.shown)).toMatchObject({
      width: 400,
      stored: 400,
      closed: null,
    });
  });

  it("draws My Library as two-line Papers with the seeded Literature Notes and Attachment kinds and Sort and Save as query file in its heading, and expands a paper into its seeded Attachments, Child Notes and Annotations that open their targets, with Zotero closed", async () => {
    const layout = await obEval(
      vaultId,
      "JSON.stringify(app.workspace.getLayout())",
    );
    const stored = await obEval(
      vaultId,
      "JSON.stringify(app.plugins.plugins.zotlit.services.settings.current['library.document'])",
    );
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await obEval(
        vaultId,
        `(async()=>{const settings=app.plugins.plugins.zotlit.services.settings;settings.update({'library.document':${stored}});await settings.flush();await app.workspace.changeLayout(JSON.parse(${JSON.stringify(layout)}));return true;})()`,
      );
    });
    // My Library on the Papers Layout, which a new Library View opens on
    // (the Recent case checks that default).
    await obEval(
      vaultId,
      `(async()=>{app.workspace.getLeavesOfType('zotlit-library').forEach(leaf=>leaf.detach());const settings=app.plugins.plugins.zotlit.services.settings;settings.update({'library.document':${JSON.stringify(MY_LIBRARY_DOCUMENT)}});await settings.flush();return true;})()`,
    );

    /** What the Library View shows once its query settled, or `null` while no tab holds it. */
    const readPapers = `(async()=>{const view=app.workspace.getLeavesOfType('zotlit-library')[0]?.view;if(!view?.query)return 'null';await view.query.settled;const el=view.contentEl;const state=view.query.state.getState();const text=(n,s)=>n.querySelector(s)?.textContent??null;return JSON.stringify({phase:state.phase,layout:el.querySelector('[data-query-layout]')?.getAttribute('data-query-layout')??null,toolbar:[...el.querySelectorAll('[role="toolbar"] > button')].map(n=>n.getAttribute('data-query-toolbar')??[...n.attributes].map(a=>a.name).find(a=>a.startsWith('data-query-'))??null),count:el.querySelector('[data-query-count]')?.getAttribute('data-query-count')??null,papers:[...el.querySelectorAll('[data-query-papers-row]')].map(n=>({key:n.getAttribute('data-query-papers-row'),title:text(n,'[data-query-papers-title]'),meta:text(n,'[data-query-papers-meta]'),lines:n.querySelector('[data-query-papers-title]').parentElement.childElementCount,attachment:n.querySelector('[data-query-papers-attachment]')?.getAttribute('data-query-papers-attachment')??null,note:n.querySelector('[data-query-papers-note]')!==null,children:[...n.querySelectorAll('[data-query-papers-child]')].map(c=>[c.getAttribute('data-query-papers-child'),c.getAttribute('data-query-key')])})),tableRows:el.querySelectorAll('tr[data-query-table-row="item"]').length});})()`;
    interface Paper {
      key: string;
      title: string | null;
      meta: string | null;
      /** The lines of the row's text. */
      lines: number;
      attachment: string | null;
      note: boolean;
      children: [string, string | null][];
    }
    interface Papers {
      phase: string;
      layout: string | null;
      /** The toolbar's buttons, by their hook. */
      toolbar: (string | null)[];
      count: string | null;
      papers: Paper[];
      tableRows: number;
    }
    const papersWhen = (ready: (papers: Papers) => boolean) =>
      obReadUntil<Papers>(vaultId, readPapers, {
        ready,
        what: "Library View",
        tries: 120,
      });

    // The seed's My Library: each Item's Attachments, and the Literature
    // Note the Fixture Vault holds for every Item but the demo papers.
    const userLibrary = LIBRARIES.find(({ type }) => type === "user")!;
    const personal = ITEMS.filter(
      ({ libraryID }) => libraryID === userLibrary.libraryID,
    );
    const attachmentsOf = (item: FixtureItem) =>
      ATTACHMENTS.filter(({ parentItemID }) => parentItemID === item.itemID);
    /** The kind Zotero gives a file: a link to a page is a web page. */
    const kindOf = ({ linkMode, contentType }: (typeof ATTACHMENTS)[number]) =>
      linkMode === "linked_url"
        ? "web"
        : (
            {
              "application/pdf": "pdf",
              "application/epub+zip": "epub",
              "text/html": "web",
            } as Record<string, string>
          )[contentType];
    const expected = (item: FixtureItem) => {
      const kinds = new Set(attachmentsOf(item).map(kindOf));
      const note = !DEMO_ITEMS.includes(item);
      // The Literature Note shows as the note icon, not on the line.
      return {
        key: item.key,
        title: item.title,
        attachment:
          ["pdf", "epub", "web"].find((kind) => kinds.has(kind)) ?? null,
        note,
      };
    };

    await obEval(
      vaultId,
      "app.commands.executeCommandById('zotlit:open-library-view');true",
    );
    const opened = await papersWhen(
      (papers) =>
        papers.phase === "ready" &&
        papers.count !== null &&
        papers.papers.length === Number(papers.count),
    );
    // No view menu and no Properties menu: the full Query View is a
    // "Save as query file" away.
    expect(opened).toMatchObject({
      layout: "papers",
      toolbar: ["sort", "data-query-save-as"],
      count: String(personal.length),
    });
    expect(
      opened.papers
        .map(({ key, title, attachment, note }) => ({
          key,
          title,
          attachment,
          note,
        }))
        .toSorted((a, b) => a.key.localeCompare(b.key)),
    ).toEqual(
      personal.map(expected).toSorted((a, b) => a.key.localeCompare(b.key)),
    );
    // Each paper takes two lines at most, with no reading-state line.
    expect(opened.papers.every(({ lines }) => lines <= 2)).toBe(true);
    // The second line names the first creator, the year and the Venue.
    const missing = personal.flatMap((item) => {
      const meta = opened.papers.find(({ key }) => key === item.key)!.meta;
      return [
        item.creators[0]?.lastName,
        item.date.slice(0, 4),
        item.venue ?? item.publisher,
      ]
        .filter((part) => part !== undefined)
        .filter((part) => !meta?.includes(part))
        .map((part) => [item.key, part]);
    });
    expect(missing).toEqual([]);

    // A paper expands into its Attachments, its live Child Notes and its
    // Literature Note, and its PDF into its Annotations.
    const paper = annotationItem;
    const pdf = annotationAttachment;
    const live = NOTES.filter(
      (note) => note.parentItemID === paper.itemID && !note.trashed,
    );
    // Each gesture brings the Library View's tab to the front first: a link
    // it opened may stand in front of it.
    const inLibrary = (script: string) =>
      obEval(
        vaultId,
        `(async()=>{${PAGE}const leaf=app.workspace.getLeavesOfType('zotlit-library')[0];await app.workspace.revealLeaf(leaf);const el=leaf.view.contentEl;${script}})()`,
      );
    await inLibrary(
      `press(el.querySelector('[data-query-expand="item:${paper.key}"]'),'expand paper');return true`,
    );
    const childrenOf = (papers: Papers) =>
      papers.papers.find(({ key }) => key === paper.key)!.children;
    // The Literature Note row shows at once; the others once their query ran.
    const expanded = await papersWhen(
      (papers) =>
        childrenOf(papers).filter(([kind]) => kind === "attachment").length ===
        attachmentsOf(paper).length,
    );
    expect(childrenOf(expanded).at(-1)?.[0]).toBe("literature-note");
    expect(
      childrenOf(expanded)
        .filter(([kind]) => kind === "attachment")
        .map(([, key]) => key)
        .toSorted(),
    ).toEqual(
      attachmentsOf(paper)
        .map(({ key }) => key)
        .toSorted(),
    );
    expect(
      childrenOf(expanded)
        .filter(([kind]) => kind === "note")
        .map(([, key]) => key),
    ).toEqual(live.map(({ key }) => key));
    await inLibrary(
      `press(el.querySelector('[data-query-expand="attachment:${pdf.key}"]'),'expand PDF');return true`,
    );
    const pdfAnnotations = ANNOTATIONS.filter(
      ({ parentItemID }) => parentItemID === pdf.itemID,
    );
    const withAnnotations = await papersWhen(
      (papers) =>
        childrenOf(papers).filter(([kind]) => kind === "annotation").length ===
        pdfAnnotations.length,
    );
    expect(
      childrenOf(withAnnotations)
        .filter(([kind]) => kind === "annotation")
        .map(([, key]) => key)
        .toSorted(),
    ).toEqual(pdfAnnotations.map(({ key }) => key).toSorted());

    // The PDF opens in Obsidian's reader, an Annotation at its page, and the
    // Literature Note in Obsidian.
    const child = (kind: string, key: string) =>
      `el.querySelector('[data-query-papers-row="${paper.key}"] [data-query-papers-child="${kind}"][data-query-key="${key}"] a')`;
    const pdfName = pdf.path!.split("/").pop()!;
    expect(
      await inLibrary(
        `press(${child("attachment", pdf.key)},'PDF link');return String(!!(await until('the PDF opens',()=>app.workspace.getLeavesOfType('pdf').find(l=>l.view.file?.name===${JSON.stringify(pdfName)}),10000)))`,
      ),
    ).toBe("true");
    const anchored = pdfAnnotations.find(
      (annotation) => "pageIndex" in annotation.position,
    )!;
    expect(
      await inLibrary(
        `const proto=Object.getPrototypeOf(app.workspace.getMostRecentLeaf());const native=proto.setEphemeralState;let subpath=null;proto.setEphemeralState=function(state){if(typeof state?.subpath==='string')subpath=state.subpath;return native.call(this,state);};try{/* A middle click opens a new tab, as the Table case does. */const link=${child("annotation", anchored.key)};link.dispatchEvent(new link.ownerDocument.defaultView.MouseEvent('auxclick',{bubbles:true,cancelable:true,button:1}));return await until('the PDF opens at the Annotation',()=>subpath,10000);}finally{proto.setEphemeralState=native;}`,
      ),
    ).toBe(
      `#page=${(anchored.position as { pageIndex: number }).pageIndex + 1}&zt-annotation=${anchored.key}`,
    );

    expect(
      await inLibrary(
        `const link=el.querySelector('[data-query-papers-row="${paper.key}"] [data-query-papers-child="literature-note"] [data-query-note]');press(link,'Literature Note link');const path=link.getAttribute('data-query-note');return String(!!(await until('the Literature Note opens',()=>app.workspace.getLeavesOfType('markdown').find(l=>l.view.file?.path===path),10000)))`,
      ),
    ).toBe("true");

    // An Item with Child Notes lists its live ones, and a Child Note opens
    // in Zotero through its link.
    const noted = ITEMS.find(({ itemID }) => itemID === 1)!;
    const notes = NOTES.filter(
      (note) => note.parentItemID === noted.itemID && !note.trashed,
    );
    expect(notes.length, "the Fixture Item has a live Child Note").toBe(1);
    await inLibrary(
      `press(el.querySelector('[data-query-expand="item:${noted.key}"]'),'expand noted paper');return true`,
    );
    const withNotes = await papersWhen(
      (papers) =>
        papers.papers
          .find(({ key }) => key === noted.key)!
          .children.filter(([kind]) => kind === "note").length === notes.length,
    );
    expect(
      withNotes.papers
        .find(({ key }) => key === noted.key)!
        .children.filter(([kind]) => kind === "note")
        .map(([, key]) => key),
    ).toEqual(notes.map(({ key }) => key));
    expect(
      await inLibrary(
        `const native=window.open;let opened=null;window.open=url=>{opened=String(url);return null;};try{press(el.querySelector('[data-query-papers-row="${noted.key}"] [data-query-papers-child="note"][data-query-key="${notes[0]!.key}"] a'),'Child Note link');return await until('Zotero shows the note',()=>opened,10000);}finally{window.open=native;}`,
      ),
    ).toBe(`zotero://select/library/items/${notes[0]!.key}`);
  }, 180000);

  it("scrolls the Library View's rows alone, under a search box and a heading that stay put, keeps each row's trailing icons clear of the scrollbar, and keeps a row the arrow keys select in view under them, on a wide and a narrow pane", async () => {
    const services = "app.plugins.plugins.zotlit.services";
    const snapshot = await obEval(
      vaultId,
      `JSON.stringify({layout:app.workspace.getLayout(),document:${services}.settings.current['library.document']??null})`,
    );
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await obEval(
        vaultId,
        `(async()=>{const saved=JSON.parse(${JSON.stringify(snapshot)});const settings=${services}.settings;settings.update({'library.document':saved.document});await settings.flush();await app.workspace.changeLayout(saved.layout);return true;})()`,
      );
    });
    // My Library: more papers than the pane holds.
    await wideWindow(cleanup);
    await obEval(
      vaultId,
      `(async()=>{${PAGE}app.workspace.getLeavesOfType('zotlit-library').forEach(leaf=>leaf.detach());const settings=${services}.settings;settings.update({'library.document':${JSON.stringify(MY_LIBRARY_DOCUMENT)}});await settings.flush();app.commands.executeCommandById('zotlit:open-library-view');await until('library',()=>app.workspace.getLeavesOfType('zotlit-library')[0]);return true;})()`,
    );

    interface Pane {
      /** Whether the rows overflow the list, so there is a scroll to test. */
      overflows: boolean;
      /** How far the list scrolled. */
      scrolled: number;
      /** The on-screen tops of the search box and the heading, before and after the scroll. */
      tops: { before: number[]; after: number[] };
      /** The room between the rows' rightmost icon and the list's edges, in px. */
      icon: { toClient: number; toEdge: number };
      /** Obsidian's scrollbar width, in px. */
      scrollbar: number;
      /** The row the arrow keys selected, against the list and the heading. */
      moved: {
        up: { selected: boolean; inList: boolean; underToolbar: boolean };
        down: { selected: boolean; inList: boolean; underToolbar: boolean };
      };
    }
    /** Lay the tab out `width` px wide, scroll its list, and move the selection with the arrow keys. */
    const measure = async (width: number) =>
      JSON.parse(
        await obEval(
          vaultId,
          `(async()=>{${PAGE}const leaf=app.workspace.getLeavesOfType('zotlit-library')[0];await app.workspace.revealLeaf(leaf);app.workspace.setActiveLeaf(leaf,{focus:true});await leaf.view.query.settled;const el=leaf.view.contentEl;const width=el.style.width;el.style.width='${width}px';const frame=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));try{await until('rows',()=>el.querySelectorAll('[data-query-papers-row]').length>10,10000);await frame();const list=el.querySelector('[data-query-layout]');const input=el.querySelector('[data-library-search] input');const toolbar=el.querySelector('[data-library-heading]');const tops=()=>[input,toolbar].map(n=>n.getBoundingClientRect().top);list.scrollTop=0;await frame();const before=tops();list.scrollTop=list.scrollHeight;await frame();const after=tops();const scrolled=list.scrollTop;const box=list.getBoundingClientRect();const clientRight=box.left+list.clientLeft+list.clientWidth;const iconRight=Math.max(...[...list.querySelectorAll('[data-query-papers-note],[data-query-papers-attachment]')].filter(n=>n.checkVisibility()).map(n=>n.getBoundingClientRect().right));const rows=()=>[...list.querySelectorAll('[data-query-item-row]')];const place=row=>{const r=row.getBoundingClientRect();const b=list.getBoundingClientRect();return{selected:row.hasAttribute('data-selected'),inList:r.top>=b.top-0.5&&r.bottom<=b.bottom+0.5,underToolbar:r.top>=toolbar.getBoundingClientRect().bottom-0.5};};const arrow=async(key,from,to)=>{const start=rows()[from];leaf.view.selection.setState({key:start.getAttribute('data-query-item-row'),card:false});await until('row selected',()=>start.hasAttribute('data-selected'));start.focus({preventScroll:true});list.scrollTop=key==='ArrowDown'?list.scrollHeight:0;await frame();activeDocument.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true,cancelable:true}));await until('selection moves',()=>rows()[to].hasAttribute('data-selected'));await frame();return place(rows()[to]);};const n=rows().length;const down=await arrow('ArrowDown',0,1);const up=await arrow('ArrowUp',n-1,n-2);leaf.view.selection.setState({key:null,card:false});return JSON.stringify({overflows:list.scrollHeight>list.clientHeight,scrolled,tops:{before,after},icon:{toClient:clientRight-iconRight,toEdge:box.right-iconRight},scrollbar:parseFloat(getComputedStyle(document.body).getPropertyValue('--scrollbar-width')),moved:{down,up}});}finally{el.style.width=width;}})()`,
        ),
      ) as Pane;

    for (const width of [1600, 528]) {
      const pane = await measure(width);
      expect(pane.overflows, `${width}px`).toBe(true);
      expect(pane.scrolled, `${width}px`).toBeGreaterThan(0);
      // The search box and the heading keep their place as the rows scroll.
      expect(pane.tops.after, `${width}px`).toEqual(pane.tops.before);
      // The rows' icons end inside the list's client box, and at least a
      // scrollbar's width short of its edge, so neither an overlay
      // scrollbar nor one that takes room draws over them.
      expect(pane.icon.toClient, `${width}px`).toBeGreaterThan(0);
      expect(pane.icon.toEdge, `${width}px`).toBeGreaterThanOrEqual(
        pane.scrollbar,
      );
      // ArrowDown from a row scrolled off the top, and ArrowUp from one
      // scrolled off the bottom, bring the row they select whole into the
      // list, under the heading.
      const whole = { selected: true, inList: true, underToolbar: true };
      expect(pane.moved, `${width}px`).toEqual({ down: whole, up: whole });
    }
  }, 120000);

  it("expands a row of the Library View, in a tab and in the sidebar, and of a Query File's Papers and Table, in one step whether ZotLit Query answers at once or late, with no row drawn again or over another, with Zotero closed", async () => {
    const services = "app.plugins.plugins.zotlit.services";
    const path = "query-files/Expanding.zotquery";
    const snapshot = await obEval(
      vaultId,
      `JSON.stringify({layout:app.workspace.getLayout(),document:${services}.settings.current['library.document']??null})`,
    );
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await obEval(
        vaultId,
        `(async()=>{const saved=JSON.parse(${JSON.stringify(snapshot)});const settings=${services}.settings;settings.update({'library.document':saved.document});await settings.flush();await app.workspace.changeLayout(saved.layout);const file=app.vault.getFileByPath(${JSON.stringify(path)});if(file)await app.vault.delete(file);return true;})()`,
      );
    });
    await wideWindow(cleanup);

    // A book with a Literature Note and nothing in Zotero under it, and a
    // paper with Attachments, a Child Note and its Literature Note.
    const noteOnly = ITEMS.find(({ key }) => key === "NW2CPDTC")!;
    expect(
      ATTACHMENTS.some(({ parentItemID }) => parentItemID === noteOnly.itemID),
    ).toBe(false);
    expect(
      NOTES.some(
        ({ parentItemID, trashed }) =>
          parentItemID === noteOnly.itemID && !trashed,
      ),
    ).toBe(false);
    const paper = annotationItem;

    interface Expansion {
      /** The row's `aria-expanded` once the frames are taken. */
      expanded: string | null;
      /** Per animation frame, from just before the click on: the Item rows, the next one's offset from the expanded one, the rows over another, the rows being read. */
      frames: {
        rows: number;
        /** The height of the expanded row's own element: a Papers row holds its children. */
        height: number;
        next: number | null;
        overlaps: number;
        status: number;
        /** The opacity of the "Loading…" text, while a row is read. */
        loading: string | null;
      }[];
      /** The Item rows the expansion took out of the page. */
      removed: string[];
    }
    /** An Item row to expand: the view that shows it, its rows, and its key. */
    interface Target {
      view: string;
      rowSelector: string;
      item: string;
    }
    /**
     * Click the expander of the target's Item, with each ZotLit Query run
     * held `delay` ms first, and read each frame the window draws until half
     * a second after that.
     */
    const expand = async ({ view, rowSelector, item }: Target, delay: number) =>
      JSON.parse(
        await obEval(
          vaultId,
          `(async()=>{${PAGE}const view=${view};await app.workspace.revealLeaf(view.leaf);await view.query.settled;const el=view.contentEl;const rowSel=${JSON.stringify(rowSelector)};const button=await until('expander',()=>el.querySelector('[data-query-expand="item:${item}"]'),10000);const frame=()=>new Promise(r=>requestAnimationFrame(r));button.scrollIntoView({block:'center',behavior:'instant'});await frame();await frame();const rows=()=>[...el.querySelectorAll(rowSel)];const own=button.closest(rowSel);const at=rows().indexOf(own);const removed=[];const observer=new MutationObserver(records=>{for(const record of records)for(const n of record.removedNodes)if(n.nodeType===1&&(n.matches(rowSel)||n.querySelector(rowSel)))removed.push(n.getAttribute('data-query-papers-row')??n.getAttribute('data-query-key')??n.nodeName);});observer.observe(el,{childList:true,subtree:true});const frames=[];const take=()=>{const list=rows();const boxes=list.map(n=>n.getBoundingClientRect());const box=own.getBoundingClientRect();const top=box.top;frames.push({rows:list.length,height:Math.round(box.height),next:list[at+1]?Math.round(boxes[at+1].top-top):null,overlaps:boxes.filter((b,i)=>i>0&&b.top<boxes[i-1].bottom-0.5).length,status:el.querySelectorAll('[data-query-table-status]').length,loading:(()=>{const text=el.querySelector('[data-query-loading]');return text?getComputedStyle(text).opacity:null;})()});};const service=app.plugins.plugins.zotlit.services.query;const run=service.run;if(${delay}>0)service.run=function(...args){return new Promise(r=>setTimeout(r,${delay})).then(()=>run.apply(this,args));};let expanded=null;try{take();press(button,'expander');take();const start=performance.now();while(performance.now()-start<${delay}+500){await frame();take();}expanded=button.getAttribute('aria-expanded');}finally{service.run=run;observer.disconnect();}press(button,'collapse');return JSON.stringify({expanded,frames,removed});})()`,
        ),
      ) as Expansion;
    /**
     * The expansion draws the closed row, then the open one: the rows under
     * it move once, straight to where the open row puts them, and none is
     * drawn again or over another.
     */
    const oneStep = (what: string, expansion: Expansion) => {
      expect.soft(expansion.expanded, what).toBe("true");
      expect.soft(expansion.removed, what).toEqual([]);
      const { frames } = expansion;
      expect.soft(new Set(frames.map(({ rows }) => rows)).size, what).toBe(1);
      expect
        .soft(
          frames.filter(({ overlaps }) => overlaps > 0),
          what,
        )
        .toEqual([]);
      expect.soft(frames[0]!.next, what).not.toBeNull();
      // The row under it moves once: from under the closed row to under
      // the open one.
      expect
        .soft([...new Set(frames.map(({ next }) => next))], what)
        .toHaveLength(2);
      expect
        .soft(new Set(frames.map(({ height }) => height)).size, what)
        .toBeLessThanOrEqual(2);
    };

    /**
     * Expand the target with ZotLit Query answering at once, then with it
     * held 400 ms. A row with rows to read shows them being read in the
     * late case, in the room they take; the note-only row reads nothing.
     */
    const expandEach = async (what: string, target: Target) => {
      oneStep(`${what}, fast read`, await expand(target, 0));
      const late = await expand(target, 400);
      oneStep(`${what}, slow read`, late);
      expect
        .soft(
          late.frames.some(({ status }) => status > 0),
          `${what}, slow read`,
        )
        .toBe(target.item !== noteOnly.key);
      // Its "Loading…" text shows only once the read has taken a while.
      const loading = late.frames.flatMap(({ loading }) =>
        loading === null ? [] : [loading],
      );
      expect
        .soft([loading[0], loading.at(-1)], `${what}, slow read`)
        .toEqual(
          target.item === noteOnly.key ? [undefined, undefined] : ["0", "1"],
        );
    };

    // The Library View in a tab, on Papers.
    await obEval(
      vaultId,
      `(async()=>{${PAGE}app.workspace.getLeavesOfType('zotlit-library').forEach(leaf=>leaf.detach());const settings=${services}.settings;settings.update({'library.document':${JSON.stringify(MY_LIBRARY_DOCUMENT)}});await settings.flush();app.commands.executeCommandById('zotlit:open-library-view');await until('library',()=>app.workspace.getLeavesOfType('zotlit-library')[0],10000);return true;})()`,
    );
    const library = "app.workspace.getLeavesOfType('zotlit-library')[0].view";
    const papersRow = "li[data-query-papers-row]";
    await expandEach("Library View tab, note only", {
      view: library,
      rowSelector: papersRow,
      item: noteOnly.key,
    });
    await expandEach("Library View tab, Attachments", {
      view: library,
      rowSelector: papersRow,
      item: paper.key,
    });

    // The Library View in the sidebar.
    await obEval(
      vaultId,
      `(async()=>{app.workspace.getLeavesOfType('zotlit-library').forEach(leaf=>leaf.detach());const leaf=app.workspace.getRightLeaf(false);await leaf.setViewState({type:'zotlit-library',active:true});app.workspace.rightSplit.expand();await app.workspace.revealLeaf(leaf);return true;})()`,
    );
    await expandEach("Library View sidebar, note only", {
      view: library,
      rowSelector: papersRow,
      item: noteOnly.key,
    });
    await expandEach("Library View sidebar, Attachments", {
      view: library,
      rowSelector: papersRow,
      item: paper.key,
    });

    // A Query File tab on Papers, then on the Table.
    for (const layout of ["papers", "table"]) {
      await obEval(
        vaultId,
        `(async()=>{const old=app.vault.getFileByPath(${JSON.stringify(path)});if(old)await app.vault.delete(old);const file=await app.vault.create(${JSON.stringify(path)},${JSON.stringify(
          [
            "views:",
            `  - type: ${layout}`,
            "    name: Mine",
            "    from: items",
            '    filters: library == "personal"',
            "    limit: 100",
            "",
          ].join("\n"),
        )});const leaf=app.workspace.getLeaf('tab');await leaf.openFile(file);app.workspace.setActiveLeaf(leaf,{focus:true});return true;})()`,
      );
      const tab = `app.workspace.getLeavesOfType('zotlit-query-file').find(leaf=>leaf.view.file?.path===${JSON.stringify(path)}).view`;
      await expandEach(`Query File ${layout}, Attachments`, {
        view: tab,
        rowSelector:
          layout === "papers" ? papersRow : 'tr[data-query-table-row="item"]',
        item: paper.key,
      });
    }
  }, 180000);

  it("swaps the Reading Card from one paper to the next in one step, by the arrow keys and by a click, beside a wide list and over a narrow one, with its Annotations closed and open, whether ZotLit Query answers at once or late, with Zotero closed", async () => {
    const services = "app.plugins.plugins.zotlit.services";
    const snapshot = await obEval(
      vaultId,
      `JSON.stringify({layout:app.workspace.getLayout(),document:${services}.settings.current['library.document']??null})`,
    );
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await obEval(
        vaultId,
        `(async()=>{delete window.zotlitE2EBeside;const saved=JSON.parse(${JSON.stringify(snapshot)});const settings=${services}.settings;settings.update({'library.document':saved.document});await settings.flush();await app.workspace.changeLayout(saved.layout);return true;})()`,
      );
    });
    await wideWindow(cleanup);
    await obEval(
      vaultId,
      `(async()=>{${PAGE}app.workspace.getLeavesOfType('zotlit-library').forEach(leaf=>leaf.detach());const settings=${services}.settings;settings.update({'library.document':${JSON.stringify(MY_LIBRARY_DOCUMENT)}});await settings.flush();app.commands.executeCommandById('zotlit:open-library-view');await until('library',()=>app.workspace.getLeavesOfType('zotlit-library')[0],10000);return true;})()`,
    );

    interface Frame {
      /** The title's text; `null` with no title element. */
      title: string | null;
      /** The top of the Open PDF button, from the card's top; `null` with no button. */
      top: number | null;
      /** The keys of the Annotation Cards drawn. */
      cards: string[];
      /** Whether the card shows at all. */
      shown: boolean;
    }
    interface Switch {
      from: string;
      to: string;
      /** The card just before the switch, then as each animation frame draws it. */
      frames: Frame[];
      /** The title's text after each batch of mutations of the card. */
      mutations: (string | null)[];
    }
    /**
     * Select the row `from`, or none for `null`, wait for its card, then move
     * the selection to the row `to` by `how`: the arrow key, a click, or the selection set
     * as "Show in Library" sets it, with each ZotLit Query run held `delay` ms
     * first, and read each frame the window draws until half a second after
     * that.
     */
    const switchCard = async (
      how: "key" | "click" | "show",
      [from, to]: readonly [string | null, string],
      delay: number,
    ) =>
      JSON.parse(
        await obEval(
          vaultId,
          `(async()=>{${PAGE}const leaf=app.workspace.getLeavesOfType('zotlit-library')[0];const view=leaf.view;await app.workspace.revealLeaf(leaf);app.workspace.setActiveLeaf(leaf,{focus:true});await view.query.settled;const el=view.contentEl;const card=el.querySelector('[data-library-card]');const row=key=>el.querySelector('[data-query-item-row="'+key+'"]');const frame=()=>new Promise(r=>requestAnimationFrame(r));const title=()=>card.querySelector('[data-library-card-title]');await until('rows',()=>row(${JSON.stringify(to)}),10000);${
            from === null
              ? "view.selection.setState({key:null,card:false});await until('no card',()=>!card.checkVisibility(),10000);await view.card.settled;await frame();await frame();"
              : `view.selection.setState({key:${JSON.stringify(from)},card:true});await until('card',()=>card.checkVisibility()&&title()?.textContent,10000);await view.card.settled;await frame();await frame();row(${JSON.stringify(from)}).focus({preventScroll:true});`
          }const sample=()=>{const button=card.querySelector('[data-library-card-action="pdf"]');const box=card.getBoundingClientRect();return{title:title()?title().textContent:null,top:button&&card.checkVisibility()?Math.round(button.getBoundingClientRect().top-box.top):null,cards:[...card.querySelectorAll('.zt-annot-card[data-zotero-annotation-key]')].map(n=>n.getAttribute('data-zotero-annotation-key')),shown:card.checkVisibility()};};const mutations=[];const observer=new MutationObserver(()=>mutations.push(title()?title().textContent:null));observer.observe(card,{childList:true,subtree:true,characterData:true});const frames=[sample()];const service=${services}.query;const run=service.run;if(${delay}>0)service.run=function(...args){return new Promise(r=>setTimeout(r,${delay})).then(()=>run.apply(this,args));};try{${
            {
              key: "activeDocument.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true}));",
              click: `press(row(${JSON.stringify(to)}),'row');`,
              // As "Show in Library" does for a row the list shows.
              show: `view.selection.setState({key:${JSON.stringify(to)},card:true});`,
            }[how]
          }const start=performance.now();while(performance.now()-start<${delay}+600){await frame();frames.push(sample());}await view.card.settled;await frame();frames.push(sample());}finally{service.run=run;observer.disconnect();}return JSON.stringify({from:frames[0].title,to:frames.at(-1).title,frames,mutations});})()`,
        ),
      ) as Switch;

    /**
     * The card goes from the first paper to the second in one step: its
     * title is never gone or empty and reads the old title, then the new
     * one; its buttons move once, and not at all between headers of one
     * height; and the Annotation Cards of one paper never show under the
     * other's title.
     */
    const oneStep = (what: string, step: Switch) => {
      const titles = [step.from, step.to];
      expect.soft(step.from, what).toBeTruthy();
      expect.soft(step.to, what).toBeTruthy();
      expect.soft(step.from, what).not.toBe(step.to);
      // Over a narrow list a click puts the card away while it waits out a
      // double click: the frames it is away count for nothing.
      const frames = step.frames.filter(({ shown }) => shown);
      expect
        .soft(
          frames.filter(({ title }) => !title),
          what,
        )
        .toEqual([]);
      expect
        .soft(
          step.mutations.filter((title) => !title),
          what,
        )
        .toEqual([]);
      const seen = <T>(list: T[]) =>
        list.filter((value, at) => at === 0 || value !== list[at - 1]);
      expect.soft(seen(frames.map(({ title }) => title)), what).toEqual(titles);
      expect
        .soft(seen(step.mutations), what)
        .toEqual(seen(step.mutations)[0] === step.from ? titles : [step.to]);
      const top = frames[0]!.top;
      const settled = frames.at(-1)!.top;
      expect
        .soft(seen(frames.map(({ top }) => top)), what)
        .toEqual(top === settled ? [top] : [top, settled]);
      // The old paper's Annotation Cards stay until its title goes, and
      // only the new paper's come under its title, once read.
      const under = (title: string | null) =>
        frames.filter((frame) => frame.title === title);
      expect
        .soft(
          under(step.from).filter(
            ({ cards }) => cards.join() !== frames[0]!.cards.join(),
          ),
          `${what}: Annotation Cards under ${step.from}`,
        )
        .toEqual([]);
      const last = frames.at(-1)!.cards;
      expect
        .soft(
          under(step.to).filter(
            ({ cards }, at, list) =>
              cards.some((key) => !last.includes(key)) ||
              (at > 0 && cards.length < list[at - 1]!.cards.length),
          ),
          `${what}: Annotation Cards under ${step.to}`,
        )
        .toEqual([]);
    };

    /**
     * The card opens on the paper whole: no frame shows it without its
     * title, and its buttons stay where its header puts them.
     */
    const opens = (what: string, step: Switch) => {
      const frames = step.frames.filter(({ shown }) => shown);
      expect.soft(step.to, what).toBeTruthy();
      expect.soft(step.frames[0]!.shown, what).toBe(false);
      expect
        .soft(
          frames.filter(({ title }) => !title),
          what,
        )
        .toEqual([]);
      const seen = <T>(list: T[]) =>
        list.filter((value, at) => at === 0 || value !== list[at - 1]);
      expect
        .soft(seen(frames.map(({ title }) => title)), what)
        .toEqual([step.to]);
      expect.soft(seen(frames.map(({ top }) => top)), what).toHaveLength(1);
    };

    /** The keys of the first rows of the list, and the row of the paper with Annotations. */
    const { rows, listed } = JSON.parse(
      await obEval(
        vaultId,
        `(async()=>{${PAGE}const view=app.workspace.getLeavesOfType('zotlit-library')[0].view;await view.query.settled;const el=view.contentEl;await until('rows',()=>el.querySelectorAll('[data-query-item-row]').length>6,10000);const keys=[...el.querySelectorAll('[data-query-item-row]')].map(n=>n.getAttribute('data-query-item-row'));return JSON.stringify({rows:keys.slice(0,7),listed:keys.find(k=>k.endsWith(${JSON.stringify(annotationItem.key)}))??null});})()`,
      ),
    ) as { rows: string[]; listed: string | null };
    expect(listed).not.toBeNull();

    const switches = async (where: string, narrow: boolean) => {
      for (const delay of [0, 400]) {
        const pace = delay === 0 ? "fast read" : "slow read";
        // From no selection, the card opens on the paper.
        opens(
          `${where}, opens on 3, ${pace}`,
          await switchCard(narrow ? "show" : "click", [null, rows[3]!], delay),
        );
        // Down the first rows by the arrow keys, then by a click; over a
        // narrow list those put the card away, so the selection moves as
        // "Show in Library" moves it.
        if (!narrow)
          for (let at = 0; at + 1 < 5; at++)
            oneStep(
              `${where}, ↓ ${at}, ${pace}`,
              await switchCard("key", [rows[at]!, rows[at + 1]!], delay),
            );
        for (const [a, b] of [
          [4, 1],
          [1, 2],
          [2, 6],
        ] as const)
          oneStep(
            `${where}, ${narrow ? "show" : "click"} ${a} → ${b}, ${pace}`,
            await switchCard(
              narrow ? "show" : "click",
              [rows[a]!, rows[b]!],
              delay,
            ),
          );
      }
    };

    // Beside a wide list, with the Annotations closed.
    await switches("wide", false);

    // With the Annotations open, to and from the paper that has some.
    const other = rows.find((key) => key !== listed)!;
    const disclose = (open: boolean) =>
      obEval(
        vaultId,
        `(()=>{app.workspace.getLeavesOfType('zotlit-library')[0]?.view.card.disclose('annotations',${open});return true;})()`,
      );
    await disclose(true);
    cleanup.defer(async () => {
      await disclose(false);
    });
    for (const delay of [0, 400]) {
      const pace = delay === 0 ? "fast read" : "slow read";
      const there = await switchCard("click", [other, listed!], delay);
      oneStep(`Annotations open, to the paper, ${pace}`, there);
      expect.soft(there.frames.at(-1)!.cards.length, pace).toBeGreaterThan(0);
      oneStep(
        `Annotations open, from the paper, ${pace}`,
        await switchCard("click", [listed!, other], delay),
      );
    }
    await disclose(false);

    // Over a narrow list.
    await obEval(
      vaultId,
      `(async()=>{${PAGE}const leaf=app.workspace.getLeavesOfType('zotlit-library')[0];const beside=window.zotlitE2EBeside??=app.workspace.createLeafBySplit(leaf,'vertical');leaf.parent.setDimension(30);beside.parent.setDimension(70);const card=leaf.view.contentEl.querySelector('[data-library-card]');leaf.view.selection.setState({key:${JSON.stringify(rows[0])},card:true});await until('card over the list',()=>card.checkVisibility()&&getComputedStyle(card).position==='absolute',5000);return true;})()`,
    );
    await switches("narrow", true);
  }, 240000);

  it("swaps the sidebar Annotation View from one Item to the next in one step, as it follows the active tab from one Literature Note to another and as the Item picker pins another Item, whether ZotLit Query answers at once or late, with Zotero closed", async () => {
    const layout = await obEval(
      vaultId,
      "JSON.stringify(app.workspace.getLayout())",
    );
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await obEval(
        vaultId,
        `(async()=>{const view=app.workspace.getLeavesOfType('zotero-annotation-view')[0]?.view;if(view?.getState().followMode==='pinned')app.commands.executeCommandById('zotlit:annot-view-unpin');app.commands.executeCommandById('zotlit:annot-view-follow-active-tab');await app.workspace.changeLayout(JSON.parse(${JSON.stringify(layout)}));return true;})()`,
      );
    });
    await wideWindow(cleanup);
    // Two Literature Notes of Items whose Annotations differ.
    const items = [annotationItem, positionDocumentItem];
    const notes = items.map(
      (item) => `literatures/${item.literatureNoteName ?? item.key}.md`,
    );
    await obEval(
      vaultId,
      `(async()=>{const leaf=app.workspace.getLeaf('tab');await leaf.openFile(app.vault.getFileByPath(${JSON.stringify(notes[0])}));app.workspace.setActiveLeaf(leaf,{focus:true});app.commands.executeCommandById('zotlit:open-annot-view');app.commands.executeCommandById('zotlit:annot-view-follow-active-tab');app.workspace.rightSplit.expand();return true;})()`,
    );

    interface Frame {
      /** The Item the header names, `null` while it names none. */
      title: string | null;
      /** The keys of the cards drawn. */
      cards: string[];
      /** Whether the body says it is loading. */
      loading: boolean;
      /** Milliseconds since the step began; none for the settled view before it. */
      at?: number;
    }
    interface Step {
      /** The view settled before the step, then as each animation frame draws it. */
      frames: Frame[];
      /** The view after each batch of mutations of it. */
      mutations: Frame[];
    }
    const sidebar =
      "app.workspace.getLeavesOfType('zotero-annotation-view')[0].view";
    /**
     * Settle the view after `prepare`, then run `trigger`, with each ZotLit
     * Query run held `delay` ms first, and read each frame the window draws
     * until 600 ms after that and the view settles.
     */
    const step = async (prepare: string, trigger: string, delay: number) =>
      JSON.parse(
        await obEval(
          vaultId,
          `(async()=>{${PAGE}const view=${sidebar};${prepare}await until('cards',()=>view.contentEl.querySelector('.zt-annot-card'),10000);await view.read;const frame=()=>new Promise(r=>requestAnimationFrame(r));await frame();await frame();const el=view.contentEl;const cards=()=>[...el.querySelectorAll('.zt-annot-card[data-zotero-annotation-key]')].map(n=>n.getAttribute('data-zotero-annotation-key'));const sample=()=>({title:el.querySelector('[data-annot-header-title]')?.textContent??null,cards:cards(),loading:!!el.querySelector('[data-annot-view-loading]')});const mutations=[];let start=performance.now();const observer=new MutationObserver(()=>mutations.push({...sample(),at:Math.round(performance.now()-start)}));observer.observe(el,{childList:true,subtree:true});const frames=[sample()];const service=${"app.plugins.plugins.zotlit.services"}.query;const run=service.run;if(${delay}>0)service.run=function(...args){return new Promise(r=>setTimeout(r,${delay})).then(()=>run.apply(this,args));};try{start=performance.now();${trigger}const first=frames[0].cards.join();const moved=()=>{const now=frames.at(-1);return now.cards.length>0&&now.cards.join()!==first;};while(performance.now()-start<${delay}+600||(!moved()&&performance.now()-start<5000)){await frame();frames.push({...sample(),at:Math.round(performance.now()-start)});}await view.read;await frame();frames.push({...sample(),at:Math.round(performance.now()-start)});}finally{service.run=run;observer.disconnect();}return JSON.stringify({frames,mutations});})()`,
        ),
      ) as Step;

    /**
     * The view goes from one Item to the next in one step: the last Item's
     * cards stay until the next Item's are read, and never show under the
     * next one's name; the next one's show whole. A read that takes longer
     * than 150 ms may show the next Item's name over a loading body first.
     */
    const oneStep = (
      what: string,
      { frames, mutations }: Step,
      { named, slow }: { named: boolean; slow: boolean },
    ) => {
      const before = frames[0]!;
      const after = frames.at(-1)!;
      // A read held past 150 ms shows the next Item over its cards loading.
      expect
        .soft(
          !slow ||
            frames.some(
              ({ loading, title }) =>
                loading && (!named || title === after.title),
            ),
          `${what}: the next Item loading`,
        )
        .toBe(true);
      expect.soft(before.cards.length, what).toBeGreaterThan(0);
      expect.soft(after.cards.length, what).toBeGreaterThan(0);
      expect.soft(after.cards.join(), what).not.toBe(before.cards.join());
      const seen = <T>(list: T[]) =>
        list.filter((value, at) => at === 0 || value !== list[at - 1]);
      const shown = (cards: string[]) =>
        cards.length === 0
          ? "none"
          : cards.join() === before.cards.join()
            ? "last"
            : cards.join() === after.cards.join()
              ? "next"
              : `other: ${cards.join()}`;
      for (const [kind, samples] of [
        ["frames", frames],
        ["mutations", mutations],
      ] as const) {
        const where = `${what}, ${kind}`;
        // The cards go from the last Item's to the next Item's, with at
        // most a loading body between, once the read has taken 150 ms.
        expect
          .soft(
            [
              ["last", "next"],
              ["last", "none", "next"],
            ],
            where,
          )
          .toContainEqual(
            seen([before, ...samples].map(({ cards }) => shown(cards))),
          );
        expect
          .soft(
            samples.filter(
              ({ cards, loading, at }) =>
                cards.length === 0 && (!loading || (at ?? 0) < 150),
            ),
            `${where}: no cards before 150 ms, or with no loading body`,
          )
          .toEqual([]);
        if (!named) continue;
        // The header names one Item at a time, never goes blank, and never
        // names one Item over the other's cards.
        expect
          .soft(
            samples.filter(({ title }) => !title),
            where,
          )
          .toEqual([]);
        expect
          .soft(seen([before, ...samples].map(({ title }) => title)), where)
          .toEqual([before.title, after.title]);
        expect
          .soft(
            samples.filter(
              ({ title, cards }) =>
                (title === before.title && shown(cards) !== "last") ||
                (title === after.title && shown(cards) === "last"),
            ),
            `${where}: cards under another Item's name`,
          )
          .toEqual([]);
      }
      if (!named) return;
      expect.soft(before.title, what).toBeTruthy();
      expect.soft(before.title, what).not.toBe(after.title);
    };

    for (const delay of [0, 400]) {
      const pace = delay === 0 ? "fast read" : "slow read";
      // Following the active tab from one Literature Note to the other.
      for (const [from, to] of [
        [notes[0]!, notes[1]!],
        [notes[1]!, notes[0]!],
      ] as const)
        oneStep(
          `active tab, ${from} → ${to}, ${pace}`,
          await step(
            `if(view.getState().followMode!=='active-tab'){app.commands.executeCommandById('zotlit:annot-view-unpin');app.commands.executeCommandById('zotlit:annot-view-follow-active-tab');await until('active tab',()=>view.getState().followMode==='active-tab');}const leaf=app.workspace.getMostRecentLeaf(app.workspace.rootSplit);if(leaf.view.file?.path!==${JSON.stringify(from)})await leaf.openFile(app.vault.getFileByPath(${JSON.stringify(from)}));`,
            `void app.workspace.getMostRecentLeaf(app.workspace.rootSplit).openFile(app.vault.getFileByPath(${JSON.stringify(to)}));`,
            delay,
          ),
          { named: false, slow: delay > 0 },
        );
      // Pinned, the Item picker pins the other Item.
      for (const [from, to] of [
        [items[0]!, items[1]!],
        [items[1]!, items[0]!],
      ] as const)
        oneStep(
          `pinned, picker ${from.key} → ${to.key}, ${pace}`,
          await step(
            `view.pinItem(${JSON.stringify(from.key)});await until('pinned',()=>view.getState().pinnedItemKey===${JSON.stringify(from.key)});app.commands.executeCommandById('zotlit:annot-view-pin-item');const input=await until('picker',()=>activeDocument.querySelector('.prompt .prompt-input'),5000);input.value=${JSON.stringify(to.title)};input.dispatchEvent(new Event('input',{bubbles:true}));const choice=await until('suggestion',()=>[...activeDocument.querySelectorAll('.prompt .suggestion-item')].find(n=>n.textContent.includes(${JSON.stringify(to.title)})),10000);`,
            "choice.click();",
            delay,
          ),
          { named: true, slow: delay > 0 },
        );
    }
  }, 240000);

  it("opens a Library View Document an earlier build stored with the Table on Papers, and saves its Collection from the toolbar as a Query File whose tab lists the same papers with every control, with Zotero closed", async () => {
    const services = "app.plugins.plugins.zotlit.services";
    const savedPath = "query-files/Saved library.zotquery";
    const snapshot = await obEval(
      vaultId,
      `JSON.stringify({layout:app.workspace.getLayout(),document:${services}.settings.current['library.document']??null,scope:${services}.settings.current[${JSON.stringify(LIBRARY_SCOPE_SETTING_KEY)}]??null})`,
    );
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await obEval(
        vaultId,
        `(async()=>{const saved=JSON.parse(${JSON.stringify(snapshot)});const settings=${services}.settings;settings.update({'library.document':saved.document,${JSON.stringify(LIBRARY_SCOPE_SETTING_KEY)}:saved.scope});await settings.flush();await app.workspace.changeLayout(saved.layout);const file=app.vault.getFileByPath(${JSON.stringify(savedPath)});if(file)await app.vault.delete(file);return true;})()`,
      );
    });

    // The seed's "Shared key" Collection of My Library. A Collection of that
    // name holds Items in other Libraries too, which the Library Scope
    // reads, so the saved file has to keep to My Library.
    const personal = LIBRARIES.find(({ type }) => type === "user")!;
    const sharedKey = COLLECTIONS.find(
      (entry) =>
        entry.libraryID === personal.libraryID && entry.key === "SHAREDCL",
    )!;
    const filedIn = (collectionIDs: Set<number>) =>
      ITEMS.filter((item) =>
        item.collectionIDs.some((id) => collectionIDs.has(id)),
      );
    const subtree = (collectionID: number): number[] => [
      collectionID,
      ...COLLECTIONS.filter(
        (entry) => entry.parentCollectionID === collectionID,
      ).flatMap((child) => subtree(child.collectionID)),
    ];
    const expected = filedIn(new Set(subtree(sharedKey.collectionID)))
      .map(({ key }) => key)
      .toSorted();
    expect(expected.length).toBeGreaterThan(0);
    const namesakes = COLLECTIONS.filter(
      (entry) =>
        entry.name === sharedKey.name && entry.libraryID !== personal.libraryID,
    );
    expect(
      filedIn(new Set(namesakes.map(({ collectionID }) => collectionID)))
        .length,
      "another Library files Items in a Collection of the same name",
    ).toBeGreaterThan(0);

    // The document as an earlier build stored it, with the Table and its
    // Visible Properties, which this build ignores.
    await obEval(
      vaultId,
      `(async()=>{app.workspace.getLeavesOfType('zotlit-library').forEach(leaf=>leaf.detach());const settings=${services}.settings;settings.update({'library.document':{node:{kind:'collection',library:{type:'personal'},path:[${JSON.stringify(sharedKey.name)}]},facets:[],search:'',sort:[{property:'dateModified',direction:'DESC'}],layout:'table',order:['title']},${JSON.stringify(LIBRARY_SCOPE_SETTING_KEY)}:{mode:'all'}});await settings.flush();app.commands.executeCommandById('zotlit:open-library-view');return true;})()`,
    );

    /** What a view shows once its query settled: its Layout, rows and toolbar. */
    const readRows = (view: string) =>
      `(async()=>{const view=${view};if(!view?.query)return 'null';await view.query.settled;const el=view.contentEl;return JSON.stringify({type:view.getViewType(),file:view.file?.path??null,phase:view.query.state.getState().phase,layout:el.querySelector('[data-query-layout]')?.getAttribute('data-query-layout')??(el.querySelector('[data-query-table]')?'table':null),count:el.querySelector('[data-query-count]')?.getAttribute('data-query-count')??null,rows:[...el.querySelectorAll('[data-query-papers-row], tr[data-query-table-row="item"]')].map(n=>n.getAttribute('data-query-papers-row')??n.getAttribute('data-query-key')),toolbar:[...el.querySelectorAll('[role="toolbar"] > button, [role="toolbar"] [data-query-view-menu], [role="toolbar"] [data-query-properties]')].map(n=>n.getAttribute('data-query-toolbar')??[...n.attributes].map(a=>a.name).find(a=>a.startsWith('data-query-'))??null)});})()`;
    interface Rows {
      type: string;
      file: string | null;
      phase: string;
      layout: string | null;
      count: string | null;
      rows: string[];
      /** The toolbar's controls, by their hook. */
      toolbar: (string | null)[];
    }
    const rowsWhen = (view: string, ready: (rows: Rows) => boolean) =>
      obReadUntil<Rows>(vaultId, readRows(view), {
        ready,
        what: view,
        tries: 120,
      });
    const library = "app.workspace.getLeavesOfType('zotlit-library')[0]?.view";
    const drawn = (layout: string) => (rows: Rows) =>
      rows.phase === "ready" &&
      rows.layout === layout &&
      rows.count !== null &&
      rows.rows.length === Number(rows.count);
    const papers = await rowsWhen(library, drawn("papers"));
    expect(papers.rows.toSorted()).toEqual(expected);

    // "Save as query file" sits in the heading beside Sort, and asks the
    // name and the folder only.
    expect(papers.toolbar).toEqual(["sort", "data-query-save-as"]);
    await obEval(
      vaultId,
      `(async()=>{${PAGE}const leaf=app.workspace.getLeavesOfType('zotlit-library')[0];await app.workspace.revealLeaf(leaf);app.workspace.setActiveLeaf(leaf,{focus:true});press(leaf.view.contentEl.querySelector('[data-query-save-as]'),'Save as query file');return true;})()`,
    );
    const modal = "document.querySelector('.modal.zt-save-query-file-modal')";
    expect(
      await obEvalUntil(
        vaultId,
        `(function(){const modal=${modal};return JSON.stringify(modal?{title:modal.querySelector('.modal-title')?.textContent??null,fields:[...modal.querySelectorAll('[data-save-field]')].map(n=>n.getAttribute('data-save-field')),records:modal.querySelectorAll('[data-save-records]').length}:null);})()`,
        {
          expected: JSON.stringify({
            title: m.annot_view_save_title(),
            fields: ["name", "folder"],
            records: 0,
          }),
        },
      ),
    ).toBe(true);
    await obEval(
      vaultId,
      `(function(){${PAGE}const modal=${modal};const set=(field,value)=>{const input=modal.querySelector('[data-save-field="'+field+'"]');input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));};set('name','Saved library');set('folder','query-files');press(modal.querySelector('.modal-button-container button.mod-cta'),'Save');return true;})()`,
    );

    // The file opens in a tab that lists the Library View's papers, in its
    // order, and only those of My Library.
    const tab = `(()=>{const view=app.workspace.getMostRecentLeaf()?.view;return view?.getViewType()==='zotlit-query-file'&&view.file?.path===${JSON.stringify(savedPath)}?view:null;})()`;
    const saved = await rowsWhen(tab, drawn("papers"));
    expect(saved.rows).toEqual(papers.rows);
    // The Query File keeps every control the Library View leaves out.
    expect(saved.toolbar).toEqual(
      expect.arrayContaining([
        "data-query-view-menu",
        "group",
        "filter",
        "data-query-properties",
      ]),
    );
    const text = await obEval(
      vaultId,
      `app.vault.read(app.vault.getFileByPath(${JSON.stringify(savedPath)}))`,
    );
    expect(text).toContain('library == "personal"');
    expect(text).toContain(
      `collections.within(${JSON.stringify(sharedKey.name)})`,
    );
  }, 180000);

  it("narrows the Library View by each Reading State facet to the seed's Items, with a Collection, counts the unread papers after the vault's pass, and keeps the facets across a plugin reload", async () => {
    const services = "app.plugins.plugins.zotlit.services";
    const snapshot = await obEval(
      vaultId,
      `JSON.stringify({layout:app.workspace.getLayout(),document:${services}.settings.current['library.document']??null})`,
    );
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await obEval(
        vaultId,
        `(async()=>{const saved=JSON.parse(${JSON.stringify(snapshot)});const settings=${services}.settings;settings.update({'library.document':saved.document});await settings.flush();await app.workspace.changeLayout(saved.layout);return true;})()`,
      );
    });
    // A Library View on My Library, with no facet.
    await obEval(
      vaultId,
      `(async()=>{app.workspace.getLeavesOfType('zotlit-library').forEach(leaf=>leaf.detach());const settings=${services}.settings;settings.update({'library.document':${JSON.stringify(MY_LIBRARY_DOCUMENT)}});await settings.flush();return true;})()`,
    );

    const personal = ITEMS.filter(({ libraryID }) => libraryID === 1);
    const sharedKey = COLLECTIONS.find(
      (entry) => entry.libraryID === 1 && entry.key === "SHAREDCL",
    )!;
    const filed = personal.filter(({ collectionIDs }) =>
      collectionIDs.includes(sharedKey.collectionID),
    );
    const keys = (items: readonly FixtureItem[]) =>
      items.map(({ key }) => key).toSorted();
    const sharedNode = JSON.stringify(["personal", sharedKey.name]);

    interface Shown {
      phase: string;
      header: string | null;
      facets: Record<string, boolean>;
      selected: string | null;
      search: string;
      count: string | null;
      rows: string[];
    }
    const readShown = `(async()=>{const view=app.workspace.getLeavesOfType('zotlit-library')[0]?.view;if(!view?.tree)return 'null';await view.searched;await view.query.settled;await view.tree.settled;const el=view.contentEl;return JSON.stringify({phase:view.query.state.getState().phase,header:${LIBRARY_HEADING},facets:Object.fromEntries([...el.querySelectorAll('[data-library-facet]')].map(n=>[n.getAttribute('data-library-facet'),n.getAttribute('aria-pressed')==='true'])),selected:el.querySelector('[data-library-node][aria-selected="true"]')?.getAttribute('data-library-node')??null,search:el.querySelector('[data-library-search] input').value,count:el.querySelector('[data-query-count]')?.getAttribute('data-query-count')??null,rows:[...el.querySelectorAll('[data-query-papers-row]')].map(n=>n.getAttribute('data-query-papers-row'))});})()`;
    /** What the view shows once it lists every row it counts with `facets` on. */
    const shownWith = async (
      facets: readonly string[],
      ready: (shown: Shown) => boolean = () => true,
    ) => {
      let shown: Shown | null = null;
      const settled = await waitFor(async () => {
        shown = JSON.parse(await obEval(vaultId, readShown)) as Shown | null;
        return (
          shown !== null &&
          shown.phase === "ready" &&
          shown.count !== null &&
          shown.rows.length === Number(shown.count) &&
          Object.entries(shown.facets).every(
            ([id, on]) => on === facets.includes(id),
          ) &&
          ready(shown)
        );
      }, 120);
      if (!settled) throw new Error(`Library View: ${JSON.stringify(shown)}`);
      return shown!;
    };
    /**
     * Press the element `target` finds in the tree pane. A narrow pane keeps
     * the tree behind its button, so the press opens it first.
     */
    const inTree = (target: string, what: string) =>
      obEval(
        vaultId,
        `(async()=>{${PAGE}const el=app.workspace.getLeavesOfType('zotlit-library')[0].view.contentEl;const pane=el.querySelector('[data-library-tree]');if(getComputedStyle(pane).display==='none'){press(el.querySelector('[data-library-tree-toggle]'),'Library Tree button');await until('Library Tree',()=>getComputedStyle(pane).display!=='none');}press(${target},${JSON.stringify(what)});return true;})()`,
      );
    const facet = (id: string) =>
      inTree(
        `pane.querySelector('[data-library-facet="${id}"]')`,
        `${id} facet`,
      );

    await obEval(
      vaultId,
      "app.commands.executeCommandById('zotlit:open-library-view');true",
    );
    const opened = await shownWith([]);
    expect(opened.rows.toSorted()).toEqual(keys(personal));

    // Each facet narrows My Library to the Items the seed gives it.
    const oracle: Record<string, (item: FixtureItem) => boolean> = {
      unread: (item) => unreadOf([item]).length === 1,
      annotated: readingState.annotated,
      "has-note": readingState.noted,
      pdf: readingState.pdf,
    };
    for (const [id, keeps] of Object.entries(oracle)) {
      await facet(id);
      const narrowed = await shownWith([id]);
      expect(narrowed.rows.toSorted(), id).toEqual(
        keys(personal.filter(keeps)),
      );
      await facet(id);
      await shownWith([]);
    }

    // Facets combine with the Collection selected and with each other.
    await inTree(
      `[...pane.querySelectorAll('[data-library-node]')].find(n=>n.getAttribute('data-library-node')===${JSON.stringify(sharedNode)})`,
      "Collection",
    );
    await shownWith([], (shown) => shown.selected === sharedNode);
    await facet("annotated");
    const annotated = filed.filter(readingState.annotated);
    expect(annotated.length).toBeGreaterThan(0);
    expect((await shownWith(["annotated"])).rows.toSorted()).toEqual(
      keys(annotated),
    );
    await facet("pdf");
    const both = annotated.filter(readingState.pdf);
    expect(both.length).toBeGreaterThan(0);
    expect((await shownWith(["annotated", "pdf"])).rows.toSorted()).toEqual(
      keys(both),
    );
    await facet("annotated");
    await facet("pdf");
    await shownWith([]);

    // The vault loses the Literature Note of an Item with no Annotation: the
    // Item becomes unread, in the list and in the header's count.
    const reader = filed.find(
      (item) => !readingState.annotated(item) && readingState.noted(item),
    )!;
    const notePath = await obEval(
      vaultId,
      `${services}.noteIndex.getNotesByItemKey(${JSON.stringify(reader.key)})[0]?.path??''`,
    );
    expect(notePath).not.toBe("");
    const moveNote = (from: string, to: string) =>
      obEval(
        vaultId,
        `(async()=>{await app.vault.rename(app.vault.getAbstractFileByPath(${JSON.stringify(from)}),${JSON.stringify(to)});return true;})()`,
      );
    const away = `${notePath}.away`;
    await moveNote(notePath, away);
    cleanup.defer(async () => {
      await moveNote(away, notePath);
    });
    const noted = (item: FixtureItem) =>
      item !== reader && readingState.noted(item);
    await facet("unread");
    const unread = await shownWith(
      ["unread"],
      (shown) =>
        shown.header ===
        libraryHeader(sharedKey.name, filed, {
          noted,
          shown: unreadOf(filed, noted).length,
        }),
    );
    expect(unread.rows.toSorted()).toEqual(keys(unreadOf(filed, noted)));
    expect(unread.rows).toContain(reader.key);

    // A search keeps to the facets: in the Collection, then in every
    // Library, each in the quick switcher's rank.
    const lookup = async (query: string, everywhere: boolean) =>
      JSON.parse(
        await obEval(
          vaultId,
          `(async()=>{const s=${services};const libraries=${everywhere ? "s.libraryScope.current.available" : "s.libraryScope.libraries.filter(l=>l.selector.type==='personal')"};return JSON.stringify((await s.itemLookup.search(${JSON.stringify(query)},{limit:500,libraries})).map(h=>h.item.indexedKey));})()`,
        ),
      ) as string[];
    /**
     * Type `text` into the search box as a researcher does: the press into
     * the box, on its part the tree leaves uncovered, puts away the tree a
     * facet press left open over a narrow list.
     */
    const type = (text: string) =>
      obEval(
        vaultId,
        `(async()=>{${PAGE}const view=app.workspace.getLeavesOfType('zotlit-library')[0].view;const input=view.contentEl.querySelector('[data-library-search] input');input.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));input.focus();await until('Library Tree put away',()=>!view.tree.store.getState().open);input.value=${JSON.stringify(text)};input.dispatchEvent(new Event('input',{bubbles:true}));return true;})()`,
      );
    const indexedKey = (item: FixtureItem) => {
      const { groupID } = LIBRARIES.find(
        (entry) => entry.libraryID === item.libraryID,
      )!;
      return groupID === null ? item.key : `${item.key}g${groupID}`;
    };
    const unreadHere = new Set(unreadOf(filed, noted).map(indexedKey));
    const unreadAnywhere = new Set(unreadOf(ITEMS, noted).map(indexedKey));
    await type(reader.title);
    const here = (await lookup(reader.title, false)).filter((key) =>
      unreadHere.has(key),
    );
    expect(here).toContain(reader.key);
    expect(
      (
        await shownWith(
          ["unread"],
          (shown) =>
            shown.search === reader.title && shown.rows.length === here.length,
        )
      ).rows,
    ).toEqual(here);
    await obEval(
      vaultId,
      `(()=>{${PAGE}press(app.workspace.getLeavesOfType('zotlit-library')[0].view.contentEl.querySelector('[data-library-search-all]'),'Search all libraries');return true;})()`,
    );
    const anywhere = (await lookup(reader.title, true)).filter((key) =>
      unreadAnywhere.has(key),
    );
    expect(
      (
        await shownWith(
          ["unread"],
          (shown) =>
            shown.header ===
            m.library_view_heading_search({
              count: anywhere.length,
              query: reader.title,
            }),
        )
      ).rows,
    ).toEqual(anywhere);
    await type("");
    await shownWith(
      ["unread"],
      (shown) =>
        shown.search === "" &&
        shown.header ===
          libraryHeader(sharedKey.name, filed, {
            noted,
            shown: unreadOf(filed, noted).length,
          }),
    );

    // A plugin reload comes back on the Collection with the facet on.
    expect(
      await obEvalUntil(
        vaultId,
        "app.plugins.disablePlugin('zotlit').then(function () { return app.plugins.enablePlugin('zotlit'); }).then(function () { return true; })",
        { expected: "true", tries: 20 },
      ),
    ).toBe(true);
    const reloaded = await shownWith(
      ["unread"],
      (shown) =>
        shown.selected === sharedNode &&
        shown.header ===
          libraryHeader(sharedKey.name, filed, {
            noted,
            shown: unreadOf(filed, noted).length,
          }),
    );
    expect(reloaded.rows.toSorted()).toEqual(unread.rows.toSorted());
  }, 180000);

  it("narrows the Library View by the tags selected in the Tag Selector to the seed's Items with every one, filters the tag names alone, deselects them all, and keeps them across a plugin reload", async () => {
    const services = "app.plugins.plugins.zotlit.services";
    const snapshot = await obEval(
      vaultId,
      `JSON.stringify({layout:app.workspace.getLayout(),document:${services}.settings.current['library.document']??null})`,
    );
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await obEval(
        vaultId,
        `(async()=>{const saved=JSON.parse(${JSON.stringify(snapshot)});const settings=${services}.settings;settings.update({'library.document':saved.document});await settings.flush();await app.workspace.changeLayout(saved.layout);return true;})()`,
      );
    });
    // A Library View on My Library, with no tag selected: a document of an
    // earlier build, which stored none.
    await obEval(
      vaultId,
      `(async()=>{app.workspace.getLeavesOfType('zotlit-library').forEach(leaf=>leaf.detach());const settings=${services}.settings;settings.update({'library.document':${JSON.stringify(MY_LIBRARY_DOCUMENT)}});await settings.flush();return true;})()`,
    );

    const personal = ITEMS.filter(({ libraryID }) => libraryID === 1);
    const tagsOf = (item: FixtureItem) =>
      (item.tags ?? []).map(({ name }) => name);
    const withEvery = (tags: readonly string[]) =>
      personal.filter((item) =>
        tags.every((tag) => tagsOf(item).includes(tag)),
      );
    const namesOf = (items: readonly FixtureItem[]) =>
      [...new Set(items.flatMap(tagsOf))].toSorted();
    const keys = (items: readonly FixtureItem[]) =>
      items.map(({ key }) => key).toSorted();

    interface Shown {
      phase: string;
      header: string | null;
      tags: string[];
      pressed: string[];
      /** The filter chips under the heading, by their hook. */
      chips: string[];
      count: string | null;
      rows: string[];
    }
    const readShown = `(async()=>{const view=app.workspace.getLeavesOfType('zotlit-library')[0]?.view;if(!view?.tree)return 'null';await view.searched;await view.query.settled;await view.tree.settled;const el=view.contentEl;const tags=[...el.querySelectorAll('[data-library-tag]')];return JSON.stringify({phase:view.query.state.getState().phase,header:${LIBRARY_HEADING},tags:tags.map(n=>n.getAttribute('data-library-tag')),chips:[...el.querySelectorAll('[data-library-filter]')].map(n=>n.getAttribute('data-library-filter')),pressed:tags.filter(n=>n.getAttribute('aria-pressed')==='true').map(n=>n.getAttribute('data-library-tag')),count:el.querySelector('[data-query-count]')?.getAttribute('data-query-count')??null,rows:[...el.querySelectorAll('[data-query-papers-row]')].map(n=>n.getAttribute('data-query-papers-row'))});})()`;
    /** What the view shows once it lists every row it counts with `pressed` selected. */
    const shownWith = async (
      pressed: readonly string[],
      ready: (shown: Shown) => boolean = () => true,
    ) => {
      let shown: Shown | null = null;
      const settled = await waitFor(async () => {
        shown = JSON.parse(await obEval(vaultId, readShown)) as Shown | null;
        return (
          shown !== null &&
          shown.phase === "ready" &&
          shown.count !== null &&
          shown.rows.length === Number(shown.count) &&
          JSON.stringify(shown.pressed) === JSON.stringify(pressed) &&
          ready(shown)
        );
      }, 120);
      if (!settled) throw new Error(`Library View: ${JSON.stringify(shown)}`);
      return shown!;
    };
    /** Press `target` in the tree pane, opening the tree first on a narrow pane. */
    const inTree = (target: string, what: string) =>
      obEval(
        vaultId,
        `(async()=>{${PAGE}const el=app.workspace.getLeavesOfType('zotlit-library')[0].view.contentEl;const pane=el.querySelector('[data-library-tree]');if(getComputedStyle(pane).display==='none'){press(el.querySelector('[data-library-tree-toggle]'),'Library Tree button');await until('Library Tree',()=>getComputedStyle(pane).display!=='none');}press(${target},${JSON.stringify(what)});return true;})()`,
      );
    const tag = (name: string) =>
      inTree(
        `[...pane.querySelectorAll('[data-library-tag]')].find(n=>n.getAttribute('data-library-tag')===${JSON.stringify(name)})`,
        `${name} tag`,
      );
    /** The chips under the heading while `tags` are selected. */
    const tagged = (tags: readonly string[]) => tags.map((tag) => `tag:${tag}`);

    await obEval(
      vaultId,
      "app.commands.executeCommandById('zotlit:open-library-view');true",
    );
    // The Tag Selector lists the tags of My Library's Items.
    const opened = await shownWith([], (shown) => shown.tags.length > 0);
    expect(opened.rows.toSorted()).toEqual(keys(personal));
    expect(opened.tags.toSorted()).toEqual(namesOf(personal));

    // A tag narrows the list to its Items, and the tags to theirs.
    const first = "fixture-core";
    await tag(first);
    const one = await shownWith([first]);
    expect(withEvery([first]).length).toBeGreaterThan(0);
    expect(one.rows.toSorted()).toEqual(keys(withEvery([first])));
    expect(one.tags.toSorted()).toEqual(namesOf(withEvery([first])));

    // A second tag narrows to the Items with both, the heading counts them
    // of all My Library holds, and a chip under it names each tag.
    const second = one.tags.find((name) => name !== first)!;
    expect(second).toBeDefined();
    await tag(second);
    const both = [first, second].toSorted();
    const two = await shownWith(
      both,
      (shown) => JSON.stringify(shown.chips) === JSON.stringify(tagged(both)),
    );
    expect(two.header).toContain(
      m.library_view_heading_papers_of({
        count: withEvery(both).length,
        total: personal.length,
      }),
    );
    expect(withEvery(both).length).toBeGreaterThan(0);
    expect(two.rows.toSorted()).toEqual(keys(withEvery(both)));

    // The "Filter tags" box narrows the names it shows, never the papers.
    await obEval(
      vaultId,
      `(()=>{const input=app.workspace.getLeavesOfType('zotlit-library')[0].view.contentEl.querySelector('[data-library-tags-filter]');input.value='zzz-no-tag';input.dispatchEvent(new Event('input',{bubbles:true}));return true;})()`,
    );
    const filtered = await shownWith(
      both,
      (shown) => shown.tags.length === both.length,
    );
    expect(filtered.tags).toEqual(both);
    expect(filtered.rows).toEqual(two.rows);

    // A plugin reload comes back with the tags selected.
    expect(
      await obEvalUntil(
        vaultId,
        "app.plugins.disablePlugin('zotlit').then(function () { return app.plugins.enablePlugin('zotlit'); }).then(function () { return true; })",
        { expected: "true", tries: 20 },
      ),
    ).toBe(true);
    const reloaded = await shownWith(both);
    expect(reloaded.rows).toEqual(two.rows);

    // Deselect all lists every Item of My Library again.
    await inTree(
      "pane.querySelector('[data-library-tags-clear]')",
      "Deselect all",
    );
    const cleared = await shownWith(
      [],
      (shown) => shown.rows.length === personal.length,
    );
    expect(cleared.rows.toSorted()).toEqual(keys(personal));
    expect(
      await obEval(
        vaultId,
        `JSON.stringify(${services}.settings.current['library.document'].tags)`,
      ),
    ).toBe("[]");
  }, 180000);

  it("searches the Library View as the quick switcher ranks, inside the tree node, with tag:, Search all libraries and Escape", async () => {
    const services = "app.plugins.plugins.zotlit.services";
    const snapshot = await obEval(
      vaultId,
      `JSON.stringify({layout:app.workspace.getLayout(),document:${services}.settings.current['library.document']??null,scope:${services}.settings.current[${JSON.stringify(LIBRARY_SCOPE_SETTING_KEY)}]??null})`,
    );
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await obEval(
        vaultId,
        `(async()=>{const saved=JSON.parse(${JSON.stringify(snapshot)});const settings=${services}.settings;settings.update({'library.document':saved.document,${JSON.stringify(LIBRARY_SCOPE_SETTING_KEY)}:saved.scope});await settings.flush();await app.workspace.changeLayout(saved.layout);return true;})()`,
      );
    });
    // Every Library is in the Library Scope; the tab opens on My Library.
    await obEval(
      vaultId,
      `(async()=>{app.workspace.getLeavesOfType('zotlit-library').forEach(leaf=>leaf.detach());const settings=${services}.settings;settings.update({'library.document':${JSON.stringify(MY_LIBRARY_DOCUMENT)},${JSON.stringify(LIBRARY_SCOPE_SETTING_KEY)}:{mode:'all'}});await settings.flush();return true;})()`,
    );

    // The seed's oracle.
    const personal = LIBRARIES.find((entry) => entry.type === "user")!;
    const indexedKey = (item: FixtureItem) => {
      const { groupID } = LIBRARIES.find(
        (entry) => entry.libraryID === item.libraryID,
      )!;
      return groupID === null ? item.key : `${item.key}g${groupID}`;
    };
    const inPersonal = ITEMS.filter(
      (item) => item.libraryID === personal.libraryID,
    );
    const subtree = (collectionID: number): number[] => [
      collectionID,
      ...COLLECTIONS.filter(
        (entry) => entry.parentCollectionID === collectionID,
      ).flatMap((child) => subtree(child.collectionID)),
    ];
    const sharedKey = COLLECTIONS.find(
      (entry) =>
        entry.libraryID === personal.libraryID && entry.key === "SHAREDCL",
    )!;
    const inSharedKey = new Set(
      inPersonal
        .filter(({ collectionIDs }) =>
          collectionIDs.some((id) =>
            subtree(sharedKey.collectionID).includes(id),
          ),
        )
        .map(indexedKey),
    );
    /** The Indexed Keys the quick switcher's search answers, best first. */
    const lookup = async (query: string, everywhere: boolean) =>
      JSON.parse(
        await obEval(
          vaultId,
          `(async()=>{const s=${services};const libraries=${everywhere ? "s.libraryScope.current.available" : "s.libraryScope.libraries.filter(l=>l.selector.type==='personal')"};return JSON.stringify((await s.itemLookup.search(${JSON.stringify(query)},{limit:500,libraries})).map(h=>h.item.indexedKey));})()`,
        ),
      ) as string[];

    interface Shown {
      phase: string;
      header: string | null;
      value: string;
      focused: boolean;
      /** The offer beside the header to search all libraries, while it shows. */
      searchAll: string | null;
      rows: string[];
    }
    const readShown = `(async()=>{const view=app.workspace.getLeavesOfType('zotlit-library')[0]?.view;if(!view?.search)return 'null';await view.searched;await view.query.settled;const el=view.contentEl;const input=el.querySelector('[data-library-search] input');return JSON.stringify({phase:view.query.state.getState().phase,header:${LIBRARY_HEADING},value:input.value,focused:document.activeElement===input,searchAll:el.querySelector('[data-library-search-all]')?.textContent??null,rows:[...el.querySelectorAll('tr[data-query-table-row="item"], [data-query-papers-row]')].map(n=>n.getAttribute('data-query-key')??n.getAttribute('data-query-papers-row'))});})()`;
    const shownWhen = (ready: (shown: Shown) => boolean) =>
      obReadUntil<Shown>(vaultId, readShown, {
        ready: (shown) => shown.phase === "ready" && ready(shown),
        what: "Library View",
        tries: 120,
      });
    /** Type `text` into the search box, as the keyboard sets an input's value. */
    const type = (text: string) =>
      obEval(
        vaultId,
        `(()=>{const input=app.workspace.getLeavesOfType('zotlit-library')[0].view.contentEl.querySelector('[data-library-search] input');input.value=${JSON.stringify(text)};input.dispatchEvent(new Event('input',{bubbles:true}));return true;})()`,
      );
    const header = (shown: Shown) => shown.header;

    await obEval(
      vaultId,
      "app.commands.executeCommandById('zotlit:open-library-view');true",
    );
    // The search box has the cursor; the list shows My Library.
    const opened = await shownWhen(
      (shown) => shown.rows.length === inPersonal.length,
    );
    expect(opened.focused).toBe(true);
    expect(opened.rows.toSorted()).toEqual(
      inPersonal.map(indexedKey).toSorted(),
    );

    // A seeded title ranks its Item first, and the rows keep the order of
    // the quick switcher's search.
    const title = "Communicating with Slip Boxes";
    const wanted = inPersonal.find((item) => item.title.startsWith(title))!;
    await type(title);
    const ranked = await shownWhen((shown) => shown.value === title);
    expect(ranked.rows[0]).toBe(indexedKey(wanted));
    expect(ranked.rows).toEqual(await lookup(title, false));

    // The search keeps to the selected Collection; Search all libraries
    // widens it past the Collection, to every Library.
    await type("duplicate");
    const library = await shownWhen((shown) => shown.value === "duplicate");
    expect(library.rows).toEqual(await lookup("duplicate", false));
    await obEval(
      vaultId,
      `(()=>{${PAGE}const el=app.workspace.getLeavesOfType('zotlit-library')[0].view.contentEl;const pane=el.querySelector('[data-library-tree]');const row=[...pane.querySelectorAll('[data-library-node]')].find(n=>n.getAttribute('data-library-node')===${JSON.stringify(JSON.stringify(["personal", sharedKey.name]))});if(getComputedStyle(pane).display==='none')press(el.querySelector('[data-library-tree-toggle]'),'Library Tree button');press(row,'Collection');return true;})()`,
    );
    const filed = (await lookup("duplicate", false)).filter((key) =>
      inSharedKey.has(key),
    );
    const collection = await shownWhen(
      (shown) =>
        shown.rows.length === filed.length &&
        header(shown) ===
          `${m.library_view_heading_search({ count: filed.length, query: "duplicate" })} | ${m.library_view_search_everywhere()}` &&
        shown.searchAll === m.library_view_search_everywhere(),
    );
    expect(collection.rows).toEqual(filed);
    await obEval(
      vaultId,
      `(()=>{${PAGE}press(app.workspace.getLeavesOfType('zotlit-library')[0].view.contentEl.querySelector('[data-library-search-all]'),'Search all libraries');return true;})()`,
    );
    const everywhere = await lookup("duplicate", true);
    expect(
      everywhere.some((key) => !inPersonal.map(indexedKey).includes(key)),
    ).toBe(true);
    const widened = await shownWhen(
      (shown) =>
        header(shown) ===
        m.library_view_heading_search({
          count: everywhere.length,
          query: "duplicate",
        }),
    );
    expect(widened.rows).toEqual(everywhere);

    // A tag: token narrows to the seeded Items with that tag.
    await obEval(
      vaultId,
      `(()=>{${PAGE}const el=app.workspace.getLeavesOfType('zotlit-library')[0].view.contentEl;const pane=el.querySelector('[data-library-tree]');const row=[...pane.querySelectorAll('[data-library-node]')].find(n=>n.getAttribute('data-library-node')===${JSON.stringify(JSON.stringify(["personal"]))});if(getComputedStyle(pane).display==='none')press(el.querySelector('[data-library-tree-toggle]'),'Library Tree button');press(row,'My Library');return true;})()`,
    );
    await type("tag:fixture-core");
    const tagged = inPersonal
      .filter((item) => item.tags?.some(({ name }) => name === "fixture-core"))
      .map(indexedKey);
    expect(tagged.length).toBeGreaterThan(0);
    const byTag = await shownWhen(
      (shown) =>
        shown.value === "tag:fixture-core" &&
        shown.rows.length === tagged.length,
    );
    expect(byTag.rows.toSorted()).toEqual(tagged.toSorted());

    // Escape clears the search, and the list shows My Library again.
    await obEval(
      vaultId,
      "(()=>{const input=app.workspace.getLeavesOfType('zotlit-library')[0].view.contentEl.querySelector('[data-library-search] input');input.focus();input.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));return true;})()",
    );
    const cleared = await shownWhen(
      (shown) => shown.value === "" && shown.rows.length === inPersonal.length,
    );
    expect(cleared.rows).toEqual(opened.rows);
    expect(cleared.header).toBe(
      libraryHeader(m.settings_library_scope_personal(), inPersonal),
    );
  });

  it("answers the quick switcher's keys on a Library View row, lists its actions in a menu other plugins add to, inserts its citation by menu and by drag, and shows it in the Library View from the quick switcher, with Zotero closed", async () => {
    const services = "app.plugins.plugins.zotlit.services";
    const snapshot = await obEval(
      vaultId,
      `JSON.stringify({layout:app.workspace.getLayout(),document:${services}.settings.current['library.document']??null})`,
    );
    const notePath = "Library row citations.md";
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await obEval(
        vaultId,
        `(async()=>{const saved=JSON.parse(${JSON.stringify(snapshot)});const settings=${services}.settings;settings.update({'library.document':saved.document});await settings.flush();const file=app.vault.getFileByPath(${JSON.stringify(notePath)});if(file)await app.vault.delete(file);await app.workspace.changeLayout(saved.layout);return true;})()`,
      );
    });

    // The seed's oracle: an Item with its Literature Note and one PDF, an
    // Item with no Literature Note that two Profiles fit, and an Item filed
    // in one subcollection.
    const reading = annotationItem;
    const readingPdf = ATTACHMENTS.filter(
      ({ parentItemID }) => parentItemID === reading.itemID,
    );
    expect(readingPdf.map(({ key }) => key)).toEqual([
      annotationAttachment.key,
    ]);
    const unwritten = booksProfileTargetItem;
    const unwrittenGroup = LIBRARIES.find(
      ({ libraryID }) => libraryID === unwritten.libraryID,
    )!.groupID!;
    const unwrittenKey = `${unwritten.key}g${unwrittenGroup}`;
    // The Literature Note that Enter writes below goes when the test ends,
    // whichever step fails first, and the test fails while one stays: by the
    // Note Index or by its frontmatter.
    cleanup.defer(async () => {
      await obEval(
        vaultId,
        `(async()=>{${PAGE}const key=${JSON.stringify(unwrittenKey)};const written=()=>[...new Set([...${services}.noteIndex.getNotesByItemKey(key),...app.vault.getMarkdownFiles().filter(file=>app.metadataCache.getFileCache(file)?.frontmatter?.['zotero-key']===key)])];for(const file of written())await app.vault.delete(file);await until('no Literature Note of '+key+' left',()=>written().length===0,10000);return true;})()`,
      );
    });
    const child = COLLECTIONS.find(({ key }) => key === "PERSCHLD")!;
    const parent = COLLECTIONS.find(
      ({ collectionID }) => collectionID === child.parentCollectionID,
    )!;
    const filed = ITEMS.find(
      (item) =>
        item.libraryID === child.libraryID &&
        item.collectionIDs.length === 1 &&
        item.collectionIDs[0] === child.collectionID,
    )!;

    // The Library View on My Library, and beside it a note to cite into, in
    // a window wide enough that the Reading Card, which shows over a
    // narrow list, leaves the start of each row in reach.
    await wideWindow(cleanup);
    await obEval(
      vaultId,
      `(async()=>{${PAGE}app.workspace.getLeavesOfType('zotlit-library').forEach(leaf=>leaf.detach());const settings=${services}.settings;settings.update({'library.document':null});await settings.flush();const file=app.vault.getFileByPath(${JSON.stringify(notePath)})??await app.vault.create(${JSON.stringify(notePath)},'LEFT RIGHT');app.commands.executeCommandById('zotlit:open-library-view');await until('library',()=>app.workspace.getLeavesOfType('zotlit-library')[0]);await app.workspace.getLeaf('split').openFile(file);return true;})()`,
    );
    /**
     * Run `script` with the Library View's tab active and `el` its content.
     * `pressRow` presses a row near its start, where a reader clicks while
     * the Reading Card over a narrow list covers the row's far end: it
     * presses what stands at that point, inside the row, through `press`.
     */
    const inLibrary = (script: string) =>
      obEval(
        vaultId,
        `(async()=>{${PAGE}const leaf=app.workspace.getLeavesOfType('zotlit-library')[0];await app.workspace.revealLeaf(leaf);app.workspace.setActiveLeaf(leaf,{focus:true});await leaf.view.query.settled;const el=leaf.view.contentEl;const row=key=>el.querySelector('[data-query-item-row="'+key+'"]');const keydown=(target,init)=>target.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,cancelable:true,...init}));const pressRow=(el,what)=>{if(!el)throw new Error('Missing: '+what);el.scrollIntoView({block:'center',behavior:'instant'});const r=el.getBoundingClientRect();const hit=el.ownerDocument.elementFromPoint(r.left+24,r.top+r.height/2);if(!hit||!el.contains(hit))throw new Error('Covered: '+what+' (by '+(hit?hit.outerHTML.slice(0,80):'nothing')+')');press(hit,what);return el;};${script}})()`,
      );
    const active = () => activeTab(vaultId);
    const activeWhen = (ready: (shown: ActiveTab) => boolean) =>
      readUntil(active, ready, { what: "Active tab", tries: 60 });
    /** The selected row's key, waiting until a row of the list is drawn. */
    const selected = () =>
      inLibrary(
        `await until('rows',()=>el.querySelector('[data-query-item-row]'),10000);return el.querySelector('[data-query-item-row][data-selected]')?.getAttribute('data-query-item-row')??'none'`,
      );

    // A click selects a row and opens nothing; ↓ moves the selection to the
    // next row on screen.
    const { next } = JSON.parse(
      await inLibrary(
        `await until('rows',()=>row(${JSON.stringify(reading.key)}),10000);pressRow(row(${JSON.stringify(reading.key)}),'reading row');const keys=[...el.querySelectorAll('[data-query-item-row]')].map(n=>n.getAttribute('data-query-item-row'));keydown(row(${JSON.stringify(reading.key)}),{key:'ArrowDown'});return JSON.stringify({next:keys[keys.indexOf(${JSON.stringify(reading.key)})+1]})`,
      ),
    ) as { next: string };
    // A row drawn moments before takes the selection to its markup a frame
    // later.
    expect(
      await readUntil(selected, (key) => key === next, {
        what: "Selected row",
      }),
    ).toBe(next);
    expect((await active()).type).toBe("zotlit-library");

    // Enter opens the Item's Literature Note; Shift+Enter its PDF in
    // Obsidian.
    await inLibrary(
      `pressRow(row(${JSON.stringify(reading.key)}),'reading row');keydown(row(${JSON.stringify(reading.key)}),{key:'Enter'});return true`,
    );
    // Shift+Enter opens the PDF in the tab the note opened in, once that
    // open is done.
    expect(
      await activeWhen((shown) => shown.type === "markdown" && !shown.opening),
    ).toMatchObject({ key: reading.key });
    await inLibrary(
      `pressRow(row(${JSON.stringify(reading.key)}),'reading row');keydown(row(${JSON.stringify(reading.key)}),{key:'Enter',shiftKey:true});return true`,
    );
    expect(await pdfOpened(vaultId, annotationAttachment.path!)).toBe(true);

    // On an Item with no Literature Note, Enter writes one through the
    // Profile selection, as the quick switcher does.
    await inLibrary(
      `const groupNode=[...el.querySelectorAll('[data-library-node]')].find(n=>n.getAttribute('data-library-node')===${JSON.stringify(JSON.stringify([`group:${unwrittenGroup}`]))});if(!groupNode.checkVisibility())press(el.querySelector('[data-library-tree-toggle]'),'tree toggle');press(groupNode,'group library');await until('group rows',()=>groupNode.getAttribute('aria-selected')==='true'&&leaf.view.query.state.getState().phase==='ready'&&row(${JSON.stringify(unwrittenKey)}),10000);pressRow(row(${JSON.stringify(unwrittenKey)}),'unwritten row');keydown(row(${JSON.stringify(unwrittenKey)}),{key:'Enter'});return true`,
    );
    // The picker reads every Profile's preview before it shows.
    expect(
      await obEvalUntil(
        vaultId,
        `String(Array.from(activeDocument.querySelectorAll('.prompt .suggestion-item')).some(el=>el.textContent.includes(${JSON.stringify(booksProfile.label)})))`,
        { expected: "true", tries: 120 },
      ),
    ).toBe(true);
    expect(await selectSuggestion(vaultId, booksProfile.label)).toContain(
      booksProfile.label,
    );
    await obEval(
      vaultId,
      "Array.from(activeDocument.querySelectorAll('.prompt')).at(-1).querySelector('input').dispatchEvent(new activeWindow.KeyboardEvent('keydown',{key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true}));true",
    );
    const written = await activeWhen(
      (shown) => shown.type === "markdown" && shown.key === unwrittenKey,
    );
    expect(written.path).toMatch(/^books\//);

    // The row menu lists every action of the Item, and an entry another
    // plugin adds through `zotlit:item-menu`. This Item holds no PDF, so the
    // menu offers no Open PDF. The note to cite into is the
    // one active last; the notes and the PDF opened above took the tab
    // beside the view, so it opens again.
    await obEval(
      vaultId,
      `(async()=>{const leaf=app.workspace.getLeaf('split');await leaf.openFile(app.vault.getFileByPath(${JSON.stringify(notePath)}));app.workspace.setActiveLeaf(leaf,{focus:true});leaf.view.editor.setCursor({line:0,ch:'LEFT '.length});return true;})()`,
    );
    const menu = JSON.parse(
      await inLibrary(
        `const ref=app.workspace.on('zotlit:item-menu',(menu,info)=>menu.addItem(item=>item.setTitle('Listener: '+info.source+' '+info.indexedKey).setIcon('star')));try{const target=row(${JSON.stringify(unwrittenKey)});const r=target.getBoundingClientRect();target.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:r.left+20,clientY:r.top+10}));const menu=await until('row menu',()=>activeDocument.querySelector('.menu'));return JSON.stringify([...menu.querySelectorAll('.menu-item')].map(item=>item.textContent));}finally{app.workspace.offref(ref);}`,
      ),
    ) as string[];
    expect(menu).toEqual([
      m.library_view_menu_open_note(),
      m.library_view_menu_insert_citation(),
      m.graph_citations_menu_copy_citekey(),
      m.library_view_menu_show_in_zotero(),
      `Listener: library-view ${unwrittenKey}`,
    ]);

    // Insert citation puts the Item's citation into the note last active.
    await inLibrary(
      `press([...activeDocument.querySelectorAll('.menu .menu-item')].find(item=>item.textContent===${JSON.stringify(m.library_view_menu_insert_citation())}),'Insert citation');return true`,
    );
    const noteText = () =>
      obEval(
        vaultId,
        `app.workspace.getLeavesOfType('markdown').find(leaf=>leaf.view.file?.path===${JSON.stringify(notePath)}).view.editor.getValue()`,
      );
    const cited = (text: string) =>
      text.split(`@${unwritten.citationKey}`).length - 1;
    expect(await waitFor(async () => cited(await noteText()) === 1)).toBe(true);
    // At the cursor, between the words.
    expect(await noteText()).toMatch(/^LEFT .+RIGHT$/);

    // A row dragged over the view is refused; dropped into the note, it
    // inserts its citation where it lands.
    const drag = JSON.parse(
      await inLibrary(
        `const note=app.workspace.getLeavesOfType('markdown').find(leaf=>leaf.view.file?.path===${JSON.stringify(notePath)});const cm=note.view.editor.cm;const transfer=new DataTransfer();const source=row(${JSON.stringify(unwrittenKey)});source.dispatchEvent(new DragEvent('dragstart',{bubbles:true,cancelable:true,dataTransfer:transfer}));const over=new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:transfer});el.querySelector('[data-library-node]').dispatchEvent(over);const refused=over.defaultPrevented&&transfer.dropEffect==='none';const at=cm.coordsAtPos(0);cm.contentDOM.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:transfer,clientX:Math.floor(at.left+1),clientY:Math.floor((at.top+at.bottom)/2)}));source.dispatchEvent(new DragEvent('dragend',{bubbles:true}));return JSON.stringify({refused,types:[...transfer.types]});`,
      ),
    ) as { refused: boolean; types: string[] };
    expect(drag).toEqual({
      refused: true,
      types: ["text/plain", "application/x-zotlit-item"],
    });
    expect(await waitFor(async () => cited(await noteText()) === 2)).toBe(true);
    // At the start, where it landed.
    expect(await noteText()).not.toMatch(/^LEFT/);

    // "Show in Library" in the quick switcher opens the view on the Item's
    // Collection, with its row selected.
    await obEval(
      vaultId,
      `(async()=>{const leaf=app.workspace.getLeavesOfType('markdown').find(leaf=>leaf.view.file?.path===${JSON.stringify(notePath)});await app.workspace.revealLeaf(leaf);app.workspace.setActiveLeaf(leaf,{focus:true});app.commands.executeCommandById('zotlit:note-quick-switcher');return true;})()`,
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
      `(function(){var input=activeDocument.querySelector('.prompt input');input.value=${JSON.stringify(filed.title)};input.dispatchEvent(new Event('input',{bubbles:true}));return true;})()`,
    );
    await selectSuggestion(vaultId, filed.title);
    await obEval(
      vaultId,
      "activeDocument.querySelector('.prompt input').dispatchEvent(new activeWindow.KeyboardEvent('keydown',{key:'Enter',code:'Enter',keyCode:13,which:13,altKey:true,bubbles:true}));true",
    );
    expect(
      await obEvalUntil(
        vaultId,
        `(async()=>{const view=app.workspace.getLeavesOfType('zotlit-library')[0]?.view;if(app.workspace.activeLeaf?.view!==view)return 'not active';await view.query.settled;const el=view.contentEl;return JSON.stringify({node:el.querySelector('[data-library-node][aria-selected=true]')?.getAttribute('data-library-node'),row:el.querySelector('[data-query-item-row][data-selected]')?.getAttribute('data-query-item-row')});})()`,
        {
          expected: JSON.stringify({
            node: JSON.stringify(["personal", parent.name, child.name]),
            row: filed.key,
          }),
        },
      ),
    ).toBe(true);
  }, 180000);

  it("opens the Library View once on a fresh install, shows the Welcome View banner above it until dismissed, whose Search your library focuses the Library View's search box, and says where Zotero's data folder is missing until it is set", async () => {
    const services = "app.plugins.plugins.zotlit.services";
    const dataPath = "app.vault.configDir+'/plugins/zotlit/data.json'";
    const reload =
      "app.plugins.disablePlugin('zotlit').then(function () { return app.plugins.enablePlugin('zotlit'); }).then(function () { return true; })";
    const snapshot = await obEval(
      vaultId,
      `(async()=>JSON.stringify({layout:app.workspace.getLayout(),data:await app.vault.adapter.read(${dataPath}),dataDir:${services}.zoteroPref.dataDirOverride}))()`,
    );
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await obEval(
        vaultId,
        `(async()=>{const saved=JSON.parse(${JSON.stringify(snapshot)});${services}.zoteroPref.setDataDir(saved.dataDir);await ${services}.settings.flush();await app.plugins.disablePlugin('zotlit');await app.vault.adapter.write(${dataPath},saved.data);await app.plugins.enablePlugin('zotlit');await app.workspace.changeLayout(saved.layout);return true;})()`,
      );
    });
    const libraryLeaves = () =>
      obEval(
        vaultId,
        "String(app.workspace.getLeavesOfType('zotlit-library').length)",
      );
    /** Reload the plugin and wait for its release check to open what it opens. */
    const reloadAndCheck = () =>
      obEval(
        vaultId,
        `(async()=>{await ${reload};await ${services}.release.checked;return true;})()`,
      );

    // A fresh install has no plugin data: the release check opens the
    // Library View, once.
    await obEval(
      vaultId,
      `(async()=>{app.workspace.getLeavesOfType('zotlit-library').forEach(leaf=>leaf.detach());await ${services}.settings.flush();await app.plugins.disablePlugin('zotlit');await app.vault.adapter.remove(${dataPath});return true;})()`,
    );
    expect(
      await obEvalUntil(
        vaultId,
        `(async()=>{await ${reload};return true;})()`,
        {
          expected: "true",
          tries: 20,
        },
      ),
    ).toBe(true);
    expect(
      await obEvalUntil(
        vaultId,
        "String(app.workspace.getLeavesOfType('zotlit-library').length)",
        { expected: "1" },
      ),
    ).toBe(true);
    // The release check recorded this launch in plugin data, which the next
    // launch reads.
    await obEval(
      vaultId,
      `(async()=>{app.workspace.getLeavesOfType('zotlit-library').forEach(leaf=>leaf.detach());await ${services}.settings.flush();return true;})()`,
    );
    await reloadAndCheck();
    expect(await libraryLeaves()).toBe("0");

    // A Welcome tab that a workspace saved before the banner turns into the
    // Library View, and closes where one is open already.
    const welcomeTab = (want: string) =>
      `(async()=>{const leaf=app.workspace.getLeaf('tab');await leaf.setViewState({type:'zotlit-welcome'});${PAGE}await until('the Welcome tab',()=>app.workspace.getLeavesOfType('zotlit-welcome').length===0,5000);return JSON.stringify({library:app.workspace.getLeavesOfType('zotlit-library').length,${want}});})()`;
    expect(
      JSON.parse(
        await obEval(
          vaultId,
          welcomeTab("turned:leaf.view.getViewType()==='zotlit-library'"),
        ),
      ),
    ).toEqual({ library: 1, turned: true });
    expect(
      JSON.parse(
        await obEval(
          vaultId,
          welcomeTab("closed:!app.workspace.getLeafById(leaf.id)"),
        ),
      ),
    ).toEqual({ library: 1, closed: true });
    await obEval(
      vaultId,
      "app.workspace.getLeavesOfType('zotlit-library').forEach(leaf=>leaf.detach());true",
    );

    // Setup is incomplete while the literature-notes folder is missing: the
    // banner shows the checklist and the Help Links above the Library View,
    // and names no Companion.
    await obEval(
      vaultId,
      `(async()=>{${services}.settings.updateDefaultLiteratureNoteProfileBindings({'note.literature-folder':'Not yet created'});await app.commands.executeCommandById('zotlit:open-library-view');return true;})()`,
    );
    const banner = `app.workspace.getLeavesOfType('zotlit-library')[0]?.view.contentEl.querySelector('[data-welcome-banner]')`;
    const readBanner = `(()=>{const el=${banner};if(!el)return 'null';return JSON.stringify({steps:[...el.querySelectorAll('[role=heading][aria-level="3"]')].map(n=>n.textContent),open:el.querySelector('[data-welcome-step][data-open] [role=heading]')?.textContent,help:[...el.querySelectorAll('[data-welcome-help] a')].map(a=>a.getAttribute('href')),companion:el.textContent.includes('Companion')});})()`;
    expect(
      await obEvalUntil(vaultId, readBanner, {
        expected: JSON.stringify({
          steps: [
            m.welcome_step_connect_title(),
            m.welcome_step_folder_title(),
            m.welcome_step_library_title(),
          ],
          // Zotero reads, so the folder is the one step still open.
          open: m.welcome_step_folder_title(),
          // The Help Links show beside the checklist.
          help: [
            "https://zotlit.aidenlx.site/docs",
            "https://zotlit.aidenlx.site/community",
            "https://github.com/aidenlx/zotlit",
            "https://zotlit.aidenlx.site/docs/reference/templates",
            "https://zotlit.aidenlx.site/docs/how-to/insert-citations",
            "https://zotlit.aidenlx.site/blog",
            "https://zotlit.aidenlx.site/changelog",
            "https://github.com/sponsors/aidenlx",
            "https://zotlit.aidenlx.site/docs/how-to/migrate-from-v1",
          ],
          companion: false,
        }),
      }),
    ).toBe(true);
    // Search your library puts the cursor in the Library View's own search
    // box, just under the banner.
    expect(
      await obEval(
        vaultId,
        `(async()=>{${PAGE}const el=app.workspace.getLeavesOfType('zotlit-library')[0].view.contentEl;press([...${banner}.querySelectorAll('button')].find(n=>n.textContent===${JSON.stringify(m.welcome_action_search())}),'Search your library');const input=el.querySelector('[data-library-search] input');await until('search box focused',()=>input.ownerDocument.activeElement===input);return String(!activeDocument.querySelector('.modal-container'));})()`,
      ),
    ).toBe("true");
    // A notice over the tab's corner would cover the dismiss control.
    await clearNotices(vaultId);
    await obEval(
      vaultId,
      `(async()=>{${PAGE}press(${banner}.querySelector('[data-welcome-dismiss]'),'Dismiss the welcome banner');await until('banner gone',()=>!${banner});return true;})()`,
    );
    expect(
      await obEval(
        vaultId,
        `String(${services}.settings.current['welcome.dismissed'])`,
      ),
    ).toBe("true");
    // The Welcome command shows it again.
    await obEval(
      vaultId,
      "app.commands.executeCommandById('zotlit:open-welcome-view');true",
    );
    expect(
      await obEvalUntil(vaultId, `String(!!${banner})`, { expected: "true" }),
    ).toBe(true);
    // So does the Welcome & help view action in the tab header, with the
    // setup steps, and focus moves to the banner; the action reads as
    // pressed while the banner shows, and a second press dismisses it.
    await obEval(
      vaultId,
      `(async()=>{${PAGE}press(${banner}.querySelector('[data-welcome-dismiss]'),'Dismiss the welcome banner');await until('banner gone',()=>!${banner});return true;})()`,
    );
    const helpAction = `app.workspace.getLeavesOfType('zotlit-library')[0].view.containerEl.querySelector(${JSON.stringify(`.view-actions .view-action[aria-label="${m.library_view_help_action()}"]`)})`;
    const readHelpAction = `const action=${helpAction};const pressed={active:action.classList.contains('is-active'),pressed:action.getAttribute('aria-pressed')};`;
    expect(
      await obEval(
        vaultId,
        `(async()=>{${PAGE}const view=app.workspace.getLeavesOfType('zotlit-library')[0].view;const before={active:${helpAction}.classList.contains('is-active'),pressed:${helpAction}.getAttribute('aria-pressed')};press(${helpAction},${JSON.stringify(m.library_view_help_action())});const el=await until('banner back',()=>${banner});await until('banner focused',()=>el.ownerDocument.activeElement===el);${readHelpAction}return JSON.stringify({before,dismissed:${services}.settings.current['welcome.dismissed'],steps:el.querySelectorAll('[data-welcome-step]').length,rows:view.contentEl.querySelectorAll('[data-welcome-help-row]').length,...pressed});})()`,
      ),
    ).toBe(
      JSON.stringify({
        before: { active: false, pressed: "false" },
        dismissed: false,
        steps: 3,
        rows: 0,
        active: true,
        pressed: "true",
      }),
    );
    expect(
      await obEval(
        vaultId,
        `(async()=>{${PAGE}press(${helpAction},${JSON.stringify(m.library_view_help_action())});await until('banner gone',()=>!${banner});await ${services}.settings.flush();const saved=JSON.parse(await app.vault.adapter.read(${dataPath}))['welcome.dismissed'];${readHelpAction}return JSON.stringify({dismissed:${services}.settings.current['welcome.dismissed'],saved,...pressed});})()`,
      ),
    ).toBe(
      JSON.stringify({
        dismissed: true,
        saved: true,
        active: false,
        pressed: "false",
      }),
    );

    // ZotLit reads a folder without Zotero's database: the tree and the
    // list say so and offer to locate it, in place of the papers. A narrow
    // pane keeps the tree out of view, and the list says it alone.
    const readPapers = `(async()=>{const view=app.workspace.getLeavesOfType('zotlit-library')[0].view;await view.query.settled;const el=view.contentEl;return JSON.stringify({missing:el.querySelector('[data-zotero-missing]')!==null,rows:[...el.querySelectorAll('tr[data-query-table-row="item"], [data-query-papers-row]')].map(n=>n.getAttribute('data-query-key')??n.getAttribute('data-query-papers-row'))});})()`;
    const listed = JSON.parse(await obEval(vaultId, readPapers)) as {
      rows: string[];
    };
    expect(listed.rows.length).toBeGreaterThan(0);
    const emptyDir = join(e2eFixture.root, "library-not-found");
    await mkdir(emptyDir, { recursive: true });
    cleanup.defer(() => rm(emptyDir, { recursive: true, force: true }));
    await obEval(
      vaultId,
      `${services}.zoteroPref.setDataDir(${JSON.stringify(emptyDir)});true`,
    );
    const readNotFound = `(()=>{const el=app.workspace.getLeavesOfType('zotlit-library')[0].view.contentEl;const shown=(n)=>!!n&&n.checkVisibility();const part=(name)=>el.querySelector('[data-library-not-found="'+name+'"]');const pane=el.querySelector('[data-library-tree]');return JSON.stringify({tree:shown(part('tree'))||getComputedStyle(pane).display==='none'?part('tree').textContent:null,list:shown(part('list'))?[...part('list').querySelectorAll('button')].map(b=>b.textContent):null,papers:[...el.querySelectorAll('[data-query-table], [data-query-layout]')].some(shown),search:shown(el.querySelector('[data-library-search]')),nodes:[...el.querySelectorAll('[data-library-node]')].some(shown),facets:[...el.querySelectorAll('[data-library-facet]')].some(shown)});})()`;
    expect(
      await obEvalUntil(vaultId, readNotFound, {
        expected: JSON.stringify({
          tree: m.library_view_not_found(),
          list: [m.library_view_locate(), m.welcome_action_open_settings()],
          papers: false,
          search: false,
          nodes: false,
          facets: false,
        }),
        tries: 120,
      }),
    ).toBe(true);

    // "Locate data folder" saves the folder the system dialog returns; the
    // case sets the same folder, since no reader can press a native dialog.
    await obEval(
      vaultId,
      `${services}.zoteroPref.setDataDir(${JSON.stringify(JSON.parse(snapshot).dataDir)});true`,
    );
    // The papers the Library View listed before come back.
    expect(
      await obEvalUntil(vaultId, readPapers, {
        expected: JSON.stringify({ missing: false, rows: listed.rows }),
        tries: 120,
      }),
    ).toBe(true);
  });

  it("opens the Library View after an update of ZotLit in its own tab beside the open note, with no notice, and announces the update in the banner beside the Help Links until What's new acknowledges it", async () => {
    const services = "app.plugins.plugins.zotlit.services";
    const dataPath = "app.vault.configDir+'/plugins/zotlit/data.json'";
    const snapshot = await obEval(
      vaultId,
      `(async()=>{await ${services}.settings.flush();return JSON.stringify({layout:app.workspace.getLayout(),data:await app.vault.adapter.read(${dataPath})});})()`,
    );
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await obEval(
        vaultId,
        `(async()=>{const saved=JSON.parse(${JSON.stringify(snapshot)});await ${services}.settings.flush();await app.plugins.disablePlugin('zotlit');await app.vault.adapter.write(${dataPath},saved.data);await app.plugins.enablePlugin('zotlit');await app.workspace.changeLayout(saved.layout);return true;})()`,
      );
    });
    /** Reload the plugin and wait for its release check to open what it opens. */
    const reloadAndCheck = (before = "") =>
      obEval(
        vaultId,
        `(async()=>{app.workspace.getLeavesOfType('zotlit-library').forEach(leaf=>leaf.detach());await ${services}.settings.flush();await app.plugins.disablePlugin('zotlit');${before}await app.plugins.enablePlugin('zotlit');await ${services}.release.checked;return true;})()`,
      );

    // The plugin data of a set-up vault that last ran an older release and
    // put the banner away after setup.
    const seeded = {
      ...(JSON.parse(JSON.parse(snapshot).data) as Record<string, unknown>),
      "release.previous-version": "2.1.0",
      "release.notices-enabled": true,
      "welcome.dismissed": true,
    };
    // The researcher has a note open in the active leaf.
    const note = JSON.parse(
      await obEval(
        vaultId,
        `(async()=>{app.workspace.getLeavesOfType('zotlit-library').forEach(leaf=>leaf.detach());const file=app.vault.getMarkdownFiles()[0];const leaf=app.workspace.getLeaf(false);await leaf.openFile(file);app.workspace.setActiveLeaf(leaf);return JSON.stringify({id:leaf.id,path:file.path});})()`,
      ),
    ) as { id: string; path: string };
    await clearNotices(vaultId);
    await reloadAndCheck(
      `await app.vault.adapter.write(${dataPath},${JSON.stringify(JSON.stringify(seeded))});`,
    );
    // The Library View opens in its own tab: the note's leaf keeps its note.
    expect(
      await obEval(
        vaultId,
        `JSON.stringify({note:app.workspace.getLeafById(${JSON.stringify(note.id)})?.view.file?.path,library:app.workspace.getLeavesOfType('zotlit-library').map(leaf=>leaf.id!==${JSON.stringify(note.id)})})`,
      ),
    ).toBe(JSON.stringify({ note: note.path, library: [true] }));

    const banner = `app.workspace.getLeavesOfType('zotlit-library')[0]?.view.contentEl.querySelector('[data-welcome-banner]')`;
    const readBanner = `(()=>{const el=${banner};return JSON.stringify({library:app.workspace.getLeavesOfType('zotlit-library').length,banner:!!el&&{badge:el.querySelector('[data-welcome-badge]')?.textContent,headings:[...el.querySelectorAll('[role=heading][aria-level="3"]')].map(n=>n.textContent),buttons:[...el.querySelectorAll('button')].map(n=>n.textContent).filter(Boolean),help:el.querySelectorAll('[data-welcome-help] a').length},notices:activeDocument.querySelectorAll('.notice').length});})()`;
    const version = await obEval(vaultId, `${services}.release.version`);
    expect(
      await obEvalUntil(vaultId, readBanner, {
        expected: JSON.stringify({
          library: 1,
          banner: {
            badge: m.welcome_badge_updated(),
            // The update alone: setup is done.
            headings: [m.welcome_update_title({ version })],
            buttons: [m.welcome_update_action()],
            help: 9,
          },
          // The banner says it in place of the update notice.
          notices: 0,
        }),
      }),
    ).toBe(true);
    expect(
      await obEval(
        vaultId,
        `String(${services}.settings.current['release.update-pending'])`,
      ),
    ).toBe("true");

    // "What's new" opens the Release Note and acknowledges the update.
    expect(
      await obEval(
        vaultId,
        `(async()=>{${PAGE}const opened=[];const open=window.open;window.open=(url)=>{opened.push(url);return null;};const before=new Set(app.workspace.getLeavesOfType('webviewer'));try{press([...${banner}.querySelectorAll('button')].find(n=>n.textContent===${JSON.stringify(m.welcome_update_action())}),"What's new");await until('banner gone',()=>!${banner});}finally{window.open=open;}const leaves=app.workspace.getLeavesOfType('webviewer').filter(leaf=>!before.has(leaf));const urls=[...opened,...leaves.map(leaf=>leaf.view.getState().url)];leaves.forEach(leaf=>leaf.detach());return JSON.stringify({urls,pending:${services}.settings.current['release.update-pending']});})()`,
      ),
    ).toBe(
      JSON.stringify({
        urls: [`https://zotlit.aidenlx.site/changelog/${version}`],
        pending: false,
      }),
    );

    // The next launch announces nothing: no Library View opens, and the one
    // the command opens shows no banner.
    await reloadAndCheck();
    expect(
      await obEval(
        vaultId,
        `(async()=>{const opened=app.workspace.getLeavesOfType('zotlit-library').length;await app.commands.executeCommandById('zotlit:open-library-view');${PAGE}await until('library view',()=>app.workspace.getLeavesOfType('zotlit-library')[0]?.view.contentEl);await new Promise(r=>setTimeout(r,500));return JSON.stringify({opened,banner:!!${banner}});})()`,
      ),
    ).toBe(JSON.stringify({ opened: 0, banner: false }));

    // An update beside the template conversion: the badge still says
    // Updated, the done steps fold into one line, and the conversion's long
    // explanation waits behind How it works. The vault holds converted
    // templates, so the load clears a saved offer; the offer is armed after
    // it, as the template service does.
    await reloadAndCheck(
      `await app.vault.adapter.write(${dataPath},${JSON.stringify(
        JSON.stringify({ ...seeded, "welcome.dismissed": false }),
      )});`,
    );
    await obEval(
      vaultId,
      `(${services}.settings.update({'note.template-conversion-pending':true}),true)`,
    );
    expect(
      await obEvalUntil(
        vaultId,
        `(()=>{const el=${banner};return JSON.stringify(!!el&&{badge:el.querySelector('[data-welcome-badge]')?.textContent,headings:[...el.querySelectorAll('[role=heading][aria-level="3"]')].map(n=>n.textContent),folded:!!el.querySelector('[data-welcome-setup-done]'),how:[...el.querySelectorAll('details')].map(d=>d.open+':'+d.querySelector('summary').textContent)});})()`,
        {
          expected: JSON.stringify({
            badge: m.welcome_badge_updated(),
            headings: [
              m.welcome_update_title({ version }),
              m.welcome_template_conversion_title(),
            ],
            folded: true,
            how: [`false:${m.welcome_how_it_works()}`],
          }),
        },
      ),
    ).toBe(true);

    // The dismiss button puts every combination away, and it stays away
    // after a reload, until a later update.
    await obEval(
      vaultId,
      `(async()=>{${PAGE}press(${banner}.querySelector('[data-welcome-dismiss]'),'Dismiss the welcome banner');await until('banner gone',()=>!${banner});return true;})()`,
    );
    await reloadAndCheck();
    expect(
      await obEval(
        vaultId,
        `(async()=>{await app.commands.executeCommandById('zotlit:open-library-view');${PAGE}await until('library view',()=>app.workspace.getLeavesOfType('zotlit-library')[0]?.view.contentEl);await new Promise(r=>setTimeout(r,500));return JSON.stringify({banner:!!${banner},dismissed:${services}.settings.current['welcome.dismissed'],update:${services}.settings.current['release.update-pending']});})()`,
      ),
    ).toBe(JSON.stringify({ banner: false, dismissed: true, update: false }));
  });

  it("lays the Welcome View banner out on one start edge, in a column centered beside Help Links pinned to the pane's end, with the first section and the Help Links on one top line, at a wide, a medium and a narrow pane, for an incomplete setup and for an update beside the folded Setup done line", async () => {
    const services = "app.plugins.plugins.zotlit.services";
    const keys = [
      "welcome.dismissed",
      "welcome.requested",
      "welcome.steps-shown",
      "release.update-pending",
      "release.notices-enabled",
      "note.template-conversion-pending",
    ];
    const snapshot = await obEval(
      vaultId,
      `JSON.stringify({layout:app.workspace.getLayout(),size:require('@electron/remote').getCurrentWindow().getSize(),folder:${services}.settings.current['note.default-profile'].bindings['note.literature-folder'],settings:Object.fromEntries(${JSON.stringify(keys)}.map(k=>[k,${services}.settings.current[k]]))})`,
    );
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await obEval(
        vaultId,
        `(async()=>{const saved=JSON.parse(${JSON.stringify(snapshot)});const settings=${services}.settings;settings.update(saved.settings);settings.updateDefaultLiteratureNoteProfileBindings({'note.literature-folder':saved.folder});await settings.flush();require('@electron/remote').getCurrentWindow().setSize(...saved.size);await app.workspace.changeLayout(saved.layout);return true;})()`,
      );
    });
    const { folder } = JSON.parse(snapshot) as { folder: string };
    const created = await obEval(
      vaultId,
      `(async()=>{if(app.vault.getFolderByPath(${JSON.stringify(folder)}))return 'false';await app.vault.createFolder(${JSON.stringify(folder)});return 'true';})()`,
    );
    if (created === "true")
      cleanup.defer(async () => {
        await obEval(
          vaultId,
          `(async()=>{const f=app.vault.getFolderByPath(${JSON.stringify(folder)});if(f)await app.vault.delete(f,true);return true;})()`,
        );
      });
    await obEval(
      vaultId,
      `(async()=>{${PAGE}app.workspace.leftSplit.collapse();app.workspace.rightSplit.collapse();app.workspace.getLeavesOfType('zotlit-library').forEach(leaf=>leaf.detach());await app.commands.executeCommandById('zotlit:open-library-view');const leaf=app.workspace.getLeavesOfType('zotlit-library')[0];await app.workspace.revealLeaf(leaf);app.workspace.setActiveLeaf(leaf,{focus:true});return true;})()`,
    );

    /** The rects that carry the banner's edges, in CSS pixels. */
    interface Box {
      l: number;
      r: number;
      t: number;
      b: number;
    }
    interface Layout {
      banner: Box;
      contentStart: number;
      contentEnd: number;
      gap: number;
      lockup: Box;
      marks: Box[];
      notices: Box[];
      surfaces: Box[];
      header: Box;
      column: Box;
      first: Box;
      help: Box;
      tiles: Box[];
      dismiss: Box;
      glyph: Box;
    }
    const measure = `(async()=>{${PAGE}const el=app.workspace.getLeavesOfType('zotlit-library')[0]?.view.contentEl;const b=await until('banner',()=>el?.querySelector('[data-welcome-banner]'),5000);await new Promise(r=>setTimeout(r,300));await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));const R=n=>{const r=n.getBoundingClientRect();return{l:r.left,r:r.right,t:r.top,b:r.bottom};};const all=(...s)=>{for(const q of s){const n=[...b.querySelectorAll(q)];if(n.length)return n;}return [];};const cs=getComputedStyle(b);const help=b.querySelector('[data-welcome-help]');const column=b.querySelector('[data-welcome-column]')??help.parentElement.firstElementChild;const grid=help.parentElement;const notices=[...b.querySelectorAll('[role=heading][aria-level="3"]')].filter(n=>!n.closest('[data-welcome-step]'));const banner=R(b);return JSON.stringify({banner,contentStart:banner.l+parseFloat(cs.paddingLeft),contentEnd:banner.r-parseFloat(cs.paddingRight),gap:parseFloat(getComputedStyle(grid).columnGap)||0,lockup:R(b.querySelector('[data-welcome-lockup]')??b.querySelector('[role=heading][aria-level="2"]')),marks:all('[data-welcome-mark]','[data-welcome-step] > div > span:first-child, [data-welcome-setup-done] > span:first-child').map(R),notices:notices.map(R),surfaces:[...b.querySelectorAll('[data-welcome-step][data-open]'),...notices.map(n=>n.closest('[data-welcome-callout]')??n.parentElement.parentElement)].map(R),header:R(b.querySelector('header')),column:R(column),first:R(column.firstElementChild),help:R(help),tiles:all('[data-welcome-help-tile]','[data-welcome-help] > div > a').map(R),dismiss:R(b.querySelector('[data-welcome-dismiss]')),glyph:R(b.querySelector('[data-welcome-dismiss] svg'))});})()`;
    const shots = join(workspaceRoot, ".scratch/e2e-screenshots");
    await mkdir(shots, { recursive: true });
    const cases = {
      // Setup is incomplete: the literature-notes folder is missing, so its
      // step opens on the accent surface.
      setup: `{'welcome.dismissed':false,'welcome.requested':true,'welcome.steps-shown':false,'release.update-pending':false,'note.template-conversion-pending':false}`,
      // An update beside the template conversion, with the done steps
      // folded into Setup done.
      update: `{'welcome.dismissed':false,'welcome.requested':false,'welcome.steps-shown':false,'release.update-pending':true,'release.notices-enabled':true,'note.template-conversion-pending':true}`,
    };
    const widths = { wide: 1750, medium: 1050, narrow: 740 };
    const results: Record<string, Layout> = {};
    for (const [name, settings] of Object.entries(cases)) {
      await obEval(
        vaultId,
        `(async()=>{const settings=${services}.settings;settings.updateDefaultLiteratureNoteProfileBindings({'note.literature-folder':${JSON.stringify(name === "setup" ? "Banner alignment, not yet created" : folder)}});settings.update(${settings});await settings.flush();return true;})()`,
      );
      for (const [size, width] of Object.entries(widths)) {
        await obEval(
          vaultId,
          `require('@electron/remote').getCurrentWindow().setSize(${width},900);true`,
        );
        const label = `${name}-${size}`;
        results[label] = JSON.parse(await obEval(vaultId, measure)) as Layout;
        await cli([
          `vault=${vaultId}`,
          "dev:screenshot",
          `path=${join(shots, `banner-${label}.png`)}`,
        ]);
      }
    }
    console.log(`banner layout: ${JSON.stringify(results)}`);

    const near = (a: number, b: number) => Math.abs(a - b) <= 1;
    const overlaps = (a: Box, b: Box) =>
      a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
    for (const [label, at] of Object.entries(results)) {
      const stacked = at.help.t >= at.column.b;
      const edges = [at.lockup, ...at.marks, ...at.notices].map((n) => n.l);
      const check = {
        label,
        // The banner keeps one inline margin at both of the pane's edges.
        margins: near(
          at.contentStart - at.banner.l,
          at.banner.r - at.contentEnd,
        ),
        // The lockup, the step marks and the notices' text share one start
        // edge, the centered column's.
        edge: edges.every((x) => near(x, at.column.l)),
        // Each tinted surface hangs outside that edge, inside the banner and
        // clear of the Help Links.
        hang: at.surfaces.every(
          (s) =>
            s.l < at.column.l &&
            s.l >= at.banner.l &&
            (stacked ? s.r <= at.banner.r : s.r <= at.help.l),
        ),
        // The Help Links end at the banner's content end.
        helpEnd: near(at.help.r, at.contentEnd),
        // Beside each other, the column is centered in the space before the
        // Help Links, and the first section starts on their top line;
        // stacked, the column takes the full width.
        column: stacked
          ? near(at.column.l, at.contentStart) &&
            near(at.column.r, at.contentEnd)
          : near(
              at.column.l - at.contentStart,
              at.help.l - at.gap - at.column.r,
            ),
        top: stacked || near(at.first.t, at.help.t),
        // The dismiss button sits on the title's line, its glyph ending on
        // the banner's content end, clear of every tile.
        dismiss:
          near(
            (at.glyph.t + at.glyph.b) / 2,
            (at.lockup.t + at.lockup.b) / 2,
          ) &&
          near(at.glyph.r, at.contentEnd) &&
          at.tiles.every((tile) => !overlaps(at.dismiss, tile)),
      };
      expect(check).toEqual({
        label,
        margins: true,
        edge: true,
        hang: true,
        helpEnd: true,
        column: true,
        top: true,
        dismiss: true,
      });
    }
    // The narrow pane stacks the column, and the wide ones do not.
    expect(
      Object.entries(results).map(([label, at]) => [
        label,
        at.help.t >= at.column.b,
      ]),
    ).toEqual(
      Object.keys(results).map((label) => [label, label.endsWith("narrow")]),
    );
  });

  it("shows the selected row's Reading Card with its seeded fields, abstract and, once opened, Annotation Cards under the Editing Capability, runs the row menu's actions from its buttons, opens its Annotations in the sidebar, shows it over the list on a narrow pane on a click or Space and puts it away on Escape, keeps a double click on the row for the PDF, selects the row the keyboard enters the list at, shows it beside a wide list as the arrow keys move, and hides it with no selection and while Zotero's data folder is missing", async () => {
    const services = "app.plugins.plugins.zotlit.services";
    const snapshot = await obEval(
      vaultId,
      `JSON.stringify({layout:app.workspace.getLayout(),document:${services}.settings.current['library.document']??null,dataDir:${services}.zoteroPref.dataDirOverride})`,
    );
    const notePath = "Reading Card citations.md";
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await obEval(
        vaultId,
        `(async()=>{const saved=JSON.parse(${JSON.stringify(snapshot)});${services}.zoteroPref.setDataDir(saved.dataDir);const settings=${services}.settings;settings.update({'library.document':saved.document});await settings.flush();const file=app.vault.getFileByPath(${JSON.stringify(notePath)});if(file)await app.vault.delete(file);await app.workspace.changeLayout(saved.layout);return true;})()`,
      );
    });

    // The seed's oracle: the paper, its one PDF, and the Annotations on it.
    const paper = annotationItem;
    const abstract = paper.fields?.abstractNote;
    expect(abstract).toBeTruthy();
    const pdfs = ATTACHMENTS.filter(
      ({ parentItemID }) => parentItemID === paper.itemID,
    );
    expect(pdfs.map(({ key }) => key)).toEqual([annotationAttachment.key]);
    const seededCards = attachmentAnnotations
      .map(({ key, color, pageLabel, comment }) => ({
        key,
        color,
        page: m.annot_view_page({ page: pageLabel }),
        comment,
      }))
      .toSorted((a, b) => a.key.localeCompare(b.key));
    const authors = paper.creators
      .filter(({ creatorType }) => creatorType === "author")
      .map(({ firstName, lastName }) => `${firstName} ${lastName}`);

    // The Library View on My Library, wide enough for the card, and a note
    // to cite into that was active last.
    await wideWindow(cleanup);
    await obEval(
      vaultId,
      `(async()=>{${PAGE}app.workspace.getLeavesOfType('zotlit-library').forEach(leaf=>leaf.detach());const settings=${services}.settings;settings.update({'library.document':${JSON.stringify(MY_LIBRARY_DOCUMENT)}});await settings.flush();const file=app.vault.getFileByPath(${JSON.stringify(notePath)})??await app.vault.create(${JSON.stringify(notePath)},'CITE ');const note=app.workspace.getLeaf('tab');await note.openFile(file);app.workspace.setActiveLeaf(note,{focus:true});note.view.editor.setCursor({line:0,ch:'CITE '.length});app.commands.executeCommandById('zotlit:open-library-view');await until('library',()=>app.workspace.getLeavesOfType('zotlit-library')[0]);return true;})()`,
    );
    /** Run `script` with the Library View's tab active, `el` its content and `card` its Reading Card pane. */
    const inLibrary = (script: string) =>
      obEval(
        vaultId,
        `(async()=>{${PAGE}const leaf=app.workspace.getLeavesOfType('zotlit-library')[0];await app.workspace.revealLeaf(leaf);app.workspace.setActiveLeaf(leaf,{focus:true});await leaf.view.query.settled;const el=leaf.view.contentEl;const card=el.querySelector('[data-library-card]');const row=key=>el.querySelector('[data-query-item-row="'+key+'"]');${script}})()`,
      );
    /** What the card shows, `null` while it is out of view. */
    const readCard = `const part=name=>card.querySelector('[data-library-card-'+name+']')?.textContent??null;return JSON.stringify(card.checkVisibility()?{title:part('title'),creators:part('creators'),venue:part('venue'),citationKey:part('citekey'),abstract:part('abstract'),actions:[...card.querySelectorAll('[data-library-card-action]')].map(b=>b.textContent||b.getAttribute('aria-label')),cards:[...card.querySelectorAll('.zt-annot-card[data-zotero-annotation-key]')].map(n=>({key:n.getAttribute('data-zotero-annotation-key'),color:n.getAttribute('data-annot-color'),page:n.querySelector('.zt-annot-page-chip')?.textContent??null,text:n.textContent})).toSorted((a,b)=>a.key.localeCompare(b.key))}:null);`;

    // No row is selected: the card is out of view.
    expect(
      await inLibrary(
        `await until('rows',()=>row(${JSON.stringify(paper.key)}),10000);${readCard}`,
      ),
    ).toBe("null");

    // A click on the paper's row shows its card with a preview of its
    // Annotations: the first two quoted, the count of each colour, and "See
    // all", with no Annotation Card drawn.
    expect(
      JSON.parse(
        await inLibrary(
          `press(row(${JSON.stringify(paper.key)}),'paper row');await until('card',()=>card.checkVisibility()&&card.querySelector('[data-library-card-toggle="annotations"]'),10000);await leaf.view.card.settled;const toggle=card.querySelector('[data-library-card-toggle="annotations"]');return JSON.stringify({toggle:toggle.textContent,expanded:toggle.getAttribute('aria-expanded'),cards:card.querySelectorAll('.zt-annot-card').length,quotes:card.querySelectorAll('[data-library-card-quote]').length,colours:[...card.querySelectorAll('[data-library-card-colour]')].reduce((sum,n)=>sum+Number(n.textContent.split(': ').at(-1)),0)});`,
        ),
      ),
    ).toEqual({
      toggle: m.library_view_card_see_all({ count: seededCards.length }),
      expanded: "false",
      cards: 0,
      quotes: Math.min(2, seededCards.length),
      colours: seededCards.length,
    });
    // Opened, the card shows the seeded fields and abstract, the row menu's
    // actions, and its Annotations as cards.
    const shown = JSON.parse(
      await inLibrary(
        `press(card.querySelector('[data-library-card-toggle="annotations"]'),'Annotations');await until('cards',()=>card.querySelectorAll('.zt-annot-card').length>=${seededCards.length},10000);await leaf.view.card.settled;${readCard}`,
      ),
    ) as {
      title: string;
      creators: string;
      venue: string;
      citationKey: string;
      abstract: string;
      actions: string[];
      cards: { key: string; color: string; page: string; text: string }[];
    };
    expect({
      title: shown.title,
      creators: shown.creators,
      venue: shown.venue,
      citationKey: shown.citationKey,
      abstract: shown.abstract,
      actions: shown.actions,
    }).toEqual({
      title: paper.title,
      // The authors in full, and the Venue with the year.
      creators: authors.join(", "),
      venue: `${paper.venue} · ${paper.date}`,
      citationKey: paper.citationKey,
      abstract,
      // Two buttons; the rest of the row menu under More, and the sidebar
      // as an icon.
      actions: [
        m.library_view_menu_open_pdf(),
        m.library_view_menu_open_note(),
        m.library_view_card_more(),
        m.library_view_card_open_in_annot_view(),
      ],
    });
    expect(
      shown.cards.map(({ key, color, page }) => ({ key, color, page })),
    ).toEqual(
      seededCards.map(({ key, color, page }) => ({ key, color, page })),
    );
    // Each card shows its seeded comment.
    const commented = seededCards.filter(({ comment }) => comment);
    expect(commented.length).toBeGreaterThan(0);
    expect(
      commented.map(({ key, comment }) =>
        shown.cards.find((card) => card.key === key)!.text.includes(comment!),
      ),
    ).toEqual(commented.map(() => true));

    // With Zotero closed the Editing Capability is read-only: each card's
    // colour and tag verbs, and any comment field it shows, say they are
    // blocked, as in the sidebar.
    expect(
      JSON.parse(
        await inLibrary(
          `return JSON.stringify({capability:${services}.annotationRepository.capabilityFor(${JSON.stringify(annotationAttachment.key)}),blocked:[...card.querySelectorAll('.zt-annot-card')].every(n=>n.querySelectorAll('.clickable-icon[data-blocked]').length>=2)&&[...card.querySelectorAll('.zt-annot-comment-field[role=textbox]')].every(f=>f.hasAttribute('data-blocked'))});`,
        ),
      ),
    ).toEqual({
      capability: { kind: "read-only", reason: "zotero-unavailable" },
      blocked: true,
    });

    // The buttons do what the row menu does: Insert citation, from the More
    // menu, into the note active last, Open literature note, Open PDF.
    const active = () => activeTab(vaultId);
    const activeWhen = (ready: (shown: ActiveTab) => boolean) =>
      readUntil(active, ready, { what: "Active tab", tries: 60 });
    await inLibrary(
      `press(card.querySelector('[data-library-card-action="more"]'),'More actions');const item=await until('Insert citation',()=>[...activeDocument.querySelectorAll('.menu .menu-item')].find(n=>n.querySelector('.menu-item-title')?.textContent===${JSON.stringify(m.library_view_menu_insert_citation())}));press(item,'Insert citation');return true`,
    );
    expect(
      await waitFor(async () =>
        (
          await obEval(
            vaultId,
            `app.workspace.getLeavesOfType('markdown').find(leaf=>leaf.view.file?.path===${JSON.stringify(notePath)}).view.editor.getValue()`,
          )
        ).includes(`@${paper.citationKey}`),
      ),
    ).toBe(true);
    await inLibrary(
      `press(card.querySelector('[data-library-card-action="note"]'),'Open literature note');return true`,
    );
    // Open PDF opens in the tab the note opened in, once that open is done.
    expect(
      await activeWhen(
        (state) =>
          state.type === "markdown" &&
          state.key === paper.key &&
          !state.opening,
      ),
    ).toMatchObject({ key: paper.key });
    await inLibrary(
      `press(card.querySelector('[data-library-card-action="pdf"]'),'Open PDF');return true`,
    );
    expect(await pdfOpened(vaultId, annotationAttachment.path!)).toBe(true);

    // "Open in the annotation view" pins the paper in the sidebar Annotation View, which
    // lists its cards.
    await inLibrary(
      `press(card.querySelector('[data-library-card-action="sidebar"]'),'Open in the annotation view');return true`,
    );
    expect(
      await obEvalUntil(
        vaultId,
        `(async()=>{const view=app.workspace.getLeavesOfType('zotero-annotation-view')[0]?.view;if(!view)return 'none';await view.read;return JSON.stringify({pinned:view.getState().pinnedItemKey,cards:[...view.contentEl.querySelectorAll('.zt-annot-card[data-zotero-annotation-key]')].map(n=>n.getAttribute('data-zotero-annotation-key')).toSorted()});})()`,
        {
          expected: JSON.stringify({
            pinned: paper.key,
            cards: seededCards.map(({ key }) => key),
          }),
          tries: 120,
        },
      ),
    ).toBe(true);

    // A narrow pane shows the card over the list, and a wide one beside it;
    // the row stays selected.
    const narrow = (share: number, over: boolean) =>
      inLibrary(
        `app.workspace.rightSplit.collapse();const beside=window.zotlitE2EBeside??=app.workspace.createLeafBySplit(leaf,'vertical');leaf.parent.setDimension(${share});beside.parent.setDimension(${100 - share});await until('card ${over ? "over" : "beside"} the list at '+el.clientWidth+'px',()=>card.checkVisibility()&&(getComputedStyle(card).position==='absolute')===${over},5000);return JSON.stringify({card:card.checkVisibility(),over:getComputedStyle(card).position==='absolute',selected:el.querySelector('[data-query-item-row][data-selected]')?.getAttribute('data-query-item-row')??null});`,
      );
    cleanup.defer(async () => {
      await obEval(vaultId, "delete window.zotlitE2EBeside;true");
    });
    expect(JSON.parse(await narrow(30, true))).toEqual({
      card: true,
      over: true,
      selected: paper.key,
    });
    // Its close button puts it away; the row stays selected and takes the
    // focus back.
    expect(
      JSON.parse(
        await inLibrary(
          `press(card.querySelector('[data-library-card-close]'),'Close');await until('card hides',()=>!card.checkVisibility());return JSON.stringify({selected:el.querySelector('[data-query-item-row][data-selected]')?.getAttribute('data-query-item-row')??null,focused:activeDocument.activeElement?.getAttribute('data-query-item-row')??null});`,
        ),
      ),
    ).toEqual({ selected: paper.key, focused: paper.key });
    // The arrow keys move the selection and leave the list uncovered; Space
    // on the selected row opens its card over the list, and Escape on the
    // row puts it away.
    /** Press `key` where the focus is; report once the card shows or hides. */
    const keyThen = (key: string, shows: boolean) =>
      inLibrary(
        `activeDocument.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:${JSON.stringify(key)},bubbles:true,cancelable:true}));await until('card ${shows ? "shows" : "hides"}',()=>card.checkVisibility()===${shows});return JSON.stringify({card:card.checkVisibility(),selected:el.querySelector('[data-query-item-row][data-selected]')?.getAttribute('data-query-item-row')??null,focused:activeDocument.activeElement?.getAttribute('data-query-item-row')??null});`,
      );
    /** The row after `key` on screen. */
    const rowAfter = async (key: string) =>
      JSON.parse(
        await inLibrary(
          `const keys=[...el.querySelectorAll('[data-query-item-row]')].map(n=>n.getAttribute('data-query-item-row'));return JSON.stringify(keys[keys.indexOf(${JSON.stringify(key)})+1]??null);`,
        ),
      ) as string;
    // Over the list, a click waits out a double click before it opens the
    // card.
    await inLibrary(
      `press(row(${JSON.stringify(paper.key)}),'paper row');await until('card',()=>card.checkVisibility());return true`,
    );
    const next = await rowAfter(paper.key);
    expect(next).not.toBeNull();
    expect(JSON.parse(await keyThen("ArrowDown", false))).toEqual({
      card: false,
      selected: next,
      focused: next,
    });
    expect(JSON.parse(await keyThen(" ", true))).toEqual({
      card: true,
      selected: next,
      focused: next,
    });
    expect(JSON.parse(await keyThen("Escape", false))).toEqual({
      card: false,
      selected: next,
      focused: next,
    });
    // A double click on the paper's row, by the pointer, where the card
    // goes over the list, opens its PDF: the first click leaves the row
    // uncovered for the second.
    expect(
      await inLibrary(
        `const target=row(${JSON.stringify(paper.key)});target.scrollIntoView({block:'center',behavior:'instant'});const box=target.getBoundingClientRect();const x=Math.round(box.right-60),y=Math.round(box.top+box.height/2);const hit=activeDocument.elementFromPoint(x,y);if(!target.contains(hit)||hit.closest('a, button'))throw new Error('No plain part of the row at '+x+','+y+': '+hit?.outerHTML.slice(0,80));const zoom=require('electron').webFrame.getZoomFactor();const contents=require('@electron/remote').getCurrentWebContents();const at={x:Math.round(x*zoom),y:Math.round(y*zoom),button:'left'};for(const clickCount of [1,2]){contents.sendInputEvent({type:'mouseDown',...at,clickCount});contents.sendInputEvent({type:'mouseUp',...at,clickCount});}return 'double-clicked';`,
      ),
    ).toBe("double-clicked");
    expect(await pdfOpened(vaultId, annotationAttachment.path!)).toBe(true);
    // The keyboard that enters the list at its first row selects it, with
    // no card, so Space opens its card. Selecting the node again lets go of
    // the selection.
    const entered = JSON.parse(
      await inLibrary(
        `press(el.querySelector('[data-library-tree-toggle]'),'tree toggle');press(await until('selected node',()=>el.querySelector('[data-library-node][aria-selected=true]')),'selected node');await leaf.view.searched;await leaf.view.query.settled;await until('no selection',()=>!el.querySelector('[data-query-item-row][data-selected]'));const first=el.querySelector('[data-query-item-row][tabindex="0"]');first.focus();await until('first row selected',()=>first.hasAttribute('data-selected'));return JSON.stringify({card:card.checkVisibility(),selected:el.querySelector('[data-query-item-row][data-selected]').getAttribute('data-query-item-row'),focused:activeDocument.activeElement?.getAttribute('data-query-item-row')??null,first:el.querySelector('[data-query-item-row]').getAttribute('data-query-item-row')});`,
      ),
    ) as {
      card: boolean;
      selected: string;
      focused: string | null;
      first: string;
    };
    expect(entered).toEqual({
      card: false,
      selected: entered.first,
      focused: entered.first,
      first: entered.first,
    });
    expect(JSON.parse(await keyThen(" ", true))).toEqual({
      card: true,
      selected: entered.first,
      focused: entered.first,
    });
    expect(JSON.parse(await keyThen("Escape", false))).toMatchObject({
      card: false,
    });
    // Back to the card of the row after the paper.
    await inLibrary(
      `press(row(${JSON.stringify(next)}),'row after the paper');await until('card',()=>card.checkVisibility());return true`,
    );
    // ↑ goes back to the paper and puts its card away; a wide pane shows
    // the card of the selected row beside the list.
    expect(JSON.parse(await keyThen("ArrowUp", false))).toEqual({
      card: false,
      selected: paper.key,
      focused: paper.key,
    });
    expect(JSON.parse(await narrow(90, false))).toEqual({
      card: true,
      over: false,
      selected: paper.key,
    });
    // Beside a wide list the card follows the arrow keys.
    expect(JSON.parse(await keyThen("ArrowDown", true))).toEqual({
      card: true,
      selected: next,
      focused: next,
    });

    // While Zotero's data folder is missing the card goes with the list.
    const emptyDir = join(e2eFixture.root, "reading-card-not-found");
    await mkdir(emptyDir, { recursive: true });
    cleanup.defer(() => rm(emptyDir, { recursive: true, force: true }));
    await obEval(
      vaultId,
      `${services}.zoteroPref.setDataDir(${JSON.stringify(emptyDir)});true`,
    );
    expect(
      await obEvalUntil(
        vaultId,
        `(()=>{const el=app.workspace.getLeavesOfType('zotlit-library')[0].view.contentEl;return JSON.stringify({missing:el.querySelector('[data-zotero-missing]')!==null,card:el.querySelector('[data-library-card]').checkVisibility()});})()`,
        {
          expected: JSON.stringify({ missing: true, card: false }),
          tries: 120,
        },
      ),
    ).toBe(true);
    await obEval(
      vaultId,
      `${services}.zoteroPref.setDataDir(${JSON.stringify(JSON.parse(snapshot).dataDir)});true`,
    );

    // Picking another node in the tree leaves no row selected, and the card
    // goes.
    expect(
      await inLibrary(
        `await until('found',()=>el.querySelector('[data-zotero-missing]')===null,20000);const recent=await until('recent',()=>el.querySelector('[data-library-node=\\'["recent"]\\']'));if(!recent.checkVisibility())press(el.querySelector('[data-library-tree-toggle]'),'tree toggle');press(recent,'Recent');await leaf.view.searched;await leaf.view.query.settled;${readCard}`,
      ),
    ).toBe("null");
  }, 180000);

  it("shows a Query File toolbar as icons with tooltips on a narrow pane, and with names on a wide one", async () => {
    const layout = await obEval(
      vaultId,
      "JSON.stringify(app.workspace.getLayout())",
    );
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await obEval(
        vaultId,
        `(async()=>{delete window.zotlitE2EPanes;await app.workspace.changeLayout(JSON.parse(${JSON.stringify(layout)}));return true;})()`,
      );
    });
    // The Fixture's Query File in two panes side by side: one wide, one
    // narrow, as a user drags the divider.
    await obEval(
      vaultId,
      `(async()=>{app.workspace.leftSplit.collapse();app.workspace.rightSplit.collapse();const file=app.vault.getFileByPath('query-files/Reading annotations.zotquery');const wide=app.workspace.getLeaf('tab');await wide.openFile(file);app.workspace.setActiveLeaf(wide,{focus:true});const narrow=app.workspace.createLeafBySplit(wide,'vertical');await narrow.openFile(file);await Promise.all([wide.view.query.settled,narrow.view.query.settled]);wide.parent.setDimension(80);narrow.parent.setDimension(20);window.zotlitE2EPanes={wide,narrow};return true;})()`,
    );
    const names = {
      filter: m.query_view_filter(),
      sort: m.query_view_sort(),
      group: m.query_view_group(),
      properties: m.query_view_properties(),
      search: m.query_view_search(),
    };
    /** Each toolbar button's tooltip text and whether its name shows beside its icon. */
    // The sidebars fold with an animation; a width the same over three frames
    // is the settled pane.
    const readPane = (pane: "wide" | "narrow") =>
      `(async()=>{${PAGE}const bar=window.zotlitE2EPanes.${pane}.view.contentEl.querySelector('[role="toolbar"]');let last=-1,steady=0;await until('toolbar width settles',async()=>{await new Promise(r=>requestAnimationFrame(r));const width=bar.clientWidth;steady=width>0&&width===last?steady+1:0;last=width;return steady>=3;});const button=hook=>hook==='properties'?bar.querySelector('[data-query-properties]'):bar.querySelector('[data-query-toolbar="'+hook+'"]');const out={width:bar.clientWidth,overflow:bar.scrollWidth>bar.clientWidth,buttons:{}};for(const hook of ${JSON.stringify(Object.keys(names))}){const el=button(hook);const name=[...el.querySelectorAll('span')].find(s=>s.textContent.trim()!=='');out.buttons[hook]={tooltip:el.getAttribute('aria-label'),nameShown:!!name&&getComputedStyle(name).display!=='none',iconShown:!!el.querySelector('svg')&&el.querySelector('svg').getBoundingClientRect().width>0};}return JSON.stringify(out);})()`;
    interface Pane {
      width: number;
      overflow: boolean;
      buttons: Record<
        string,
        { tooltip: string | null; nameShown: boolean; iconShown: boolean }
      >;
    }
    const each = (nameShown: boolean) =>
      Object.fromEntries(
        Object.entries(names).map(([hook, name]) => [
          hook,
          { tooltip: name, nameShown, iconShown: true },
        ]),
      );

    const narrow = JSON.parse(
      await obEval(vaultId, readPane("narrow")),
    ) as Pane;
    expect(narrow.width).toBeLessThan(400);
    expect(narrow).toMatchObject({ overflow: false, buttons: each(false) });

    const wide = JSON.parse(await obEval(vaultId, readPane("wide"))) as Pane;
    expect(wide.width).toBeGreaterThan(700);
    expect(wide).toMatchObject({ overflow: false, buttons: each(true) });

    // A pointer over an icon-only button shows its name as a tooltip.
    const tooltip = await obEval(
      vaultId,
      `(async()=>{${PAGE}const el=window.zotlitE2EPanes.narrow.view.contentEl.querySelector('[data-query-toolbar="sort"]');const r=el.getBoundingClientRect();const at={bubbles:true,pointerType:'mouse',clientX:r.x+5,clientY:r.y+5};for(let i=0;i<3;i++){el.dispatchEvent(new PointerEvent('pointermove',{...at,clientX:at.clientX+i}));el.dispatchEvent(new MouseEvent('mousemove',{...at,clientX:at.clientX+i}));}el.dispatchEvent(new PointerEvent('pointerover',at));return (await until('tooltip shows',()=>activeDocument.querySelector('.tooltip'),3000)).textContent;})()`,
    );
    expect(tooltip).toBe(names.sort);
  }, 120000);

  it("exports a note with a Query File embed and a Query Block to PDF with their rows and no toolbar", async () => {
    const notePath = "query-files/Export check.md";
    const pdfPath = join(workspaceRoot, ".scratch", "e2e-query-export.pdf");
    const layout = await obEval(
      vaultId,
      "JSON.stringify(app.workspace.getLayout())",
    );
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await rm(pdfPath, { force: true });
      await obEval(
        vaultId,
        `(async()=>{await app.workspace.changeLayout(JSON.parse(${JSON.stringify(layout)}));const file=app.vault.getFileByPath(${JSON.stringify(notePath)});if(file)await app.vault.delete(file);return true;})()`,
      );
    });
    const note = [
      "---",
      "zotero-key: SAKIMA22",
      "---",
      "![[Lab annotations.zotquery#This item]]",
      "",
      "```zotquery",
      "views:",
      "  - type: annotations",
      "    name: Block view",
      "    from: annotations",
      "    filters: item == this.item",
      "```",
      "",
    ].join("\n");
    const report = JSON.parse(
      await cliCommand(vaultId, "zotlit:query", {
        args: {
          from: "annotations",
          filter: "item == this.item",
          "this-item": "SAKIMA22",
          fields: "item.title",
          limit: "100",
        },
      }),
    ) as ItemQueryReport;
    expect(report.ok).toBe(true);
    const own = report.rows!.map((row) => row.indexedKey);
    expect(own.length).toBeGreaterThan(1);

    // Obsidian's own Export to PDF: its modal's export, with the file path
    // the save dialog would give. The printed page is read as it is drawn,
    // in the hidden window Obsidian prints from.
    const printed = JSON.parse(
      await obEval(
        vaultId,
        `(async()=>{const file=await app.vault.create(${JSON.stringify(notePath)},${JSON.stringify(note)});const leaf=app.workspace.getLeaf('tab');await leaf.openFile(file,{state:{mode:'preview'}});app.workspace.setActiveLeaf(leaf,{focus:true});const modalProto=Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(app.setting)));const open=modalProto.open;let modal=null;modalProto.open=function(){modal=this;return open.call(this);};try{leaf.view.printToPdf();}finally{modalProto.open=open;}modal.close();let page=null;const print=modal.print.bind(modal);modal.print=async(el,component,includeName)=>{const out=await print(el,component,includeName);const win=el.win;const shown=n=>win.getComputedStyle(n).display!=='none';const views=[...el.querySelectorAll('.zt-query-view')];page={ownWindow:win!==window,views:views.map(view=>({host:view.classList.contains('internal-embed')?'embed':view.classList.contains('block-language-zotquery')?'block':'other',cards:[...view.querySelectorAll('.zt-annot-card')].map(n=>n.getAttribute('data-zotero-annotation-key')),toolbar:[...view.querySelectorAll('[role="toolbar"]')].some(shown),readOnly:[...view.querySelectorAll('[data-query-read-only]')].some(shown),clipped:[...view.querySelectorAll('.annots-container')].some(list=>list.scrollHeight>list.clientHeight+1),blank:view.offsetHeight-(view.querySelector('[role="grid"]')?.offsetHeight??0)>100}))};return out;};await modal.printToPdf({filepath:${JSON.stringify(pdfPath)},includeName:true,pageSize:'A4',landscape:false,marginsType:0,scaleFactor:100,scale:1,open:false});return JSON.stringify(page);})()`,
        180000,
      ),
    ) as {
      ownWindow: boolean;
      views: {
        host: string;
        cards: string[];
        toolbar: boolean;
        readOnly: boolean;
        clipped: boolean;
        /** Empty space below the cards, as a fixed height leaves. */
        blank: boolean;
      }[];
    };
    expect(printed).toEqual({
      ownWindow: true,
      views: ["embed", "block"].map((host) => ({
        host,
        cards: own,
        toolbar: false,
        readOnly: false,
        clipped: false,
        blank: false,
      })),
    });
    expect((await readFile(pdfPath)).subarray(0, 5).toString()).toBe("%PDF-");
  }, 240000);

  it("filters a Query File tab from its Filter popover, and the file text and the cards follow", async () => {
    const layout = await obEval(
      vaultId,
      "JSON.stringify(app.workspace.getLayout())",
    );
    const path = "query-files/Filtered.zotquery";
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await obEval(
        vaultId,
        `(async()=>{await app.workspace.changeLayout(JSON.parse(${JSON.stringify(layout)}));const file=app.vault.getFileByPath(${JSON.stringify(path)});if(file)await app.vault.delete(file);return true;})()`,
      );
    });
    /** The rows ZotLit Query gives for a filter, through the CLI. */
    const queryKeys = async (filter: string) => {
      const report = JSON.parse(
        await cliCommand(vaultId, "zotlit:query", {
          args: { from: "annotations", fields: "[]", limit: "100", filter },
        }),
      ) as ItemQueryReport;
      expect(report.ok).toBe(true);
      return report.rows!.map((row) => row.indexedKey);
    };
    interface Tab {
      text: string;
      cards: string[];
      filterError: boolean;
      /** The row count the Results menu shows, or `null` while it shows none. */
      count: string | null;
      /** The text of each row's diagnostic in the "This view" section. */
      rowIssues: (string | null)[];
      /** The report of the diagnostic the view shows above the cards. */
      diagnostic: string | null;
    }
    const readTab = `(async()=>{const view=app.workspace.getMostRecentLeaf().view;if(view.getViewType()!=='zotlit-query-file'||view.file?.path!==${JSON.stringify(path)})return 'null';await view.query.settled;const el=view.contentEl;return JSON.stringify({text:await app.vault.read(view.file),cards:[...el.querySelectorAll('.zt-annot-card')].map(n=>n.getAttribute('data-zotero-annotation-key')),filterError:el.querySelector('[data-query-filter-error]')!==null,count:el.querySelector('[data-query-count]')?.getAttribute('data-query-count')??null,rowIssues:[...el.querySelectorAll('[data-filter-section="view"] [data-condition-row]')].map(n=>n.querySelector('[role="alert"]')?.textContent??null),diagnostic:el.querySelector('[data-query-diagnostic] pre')?.textContent??null});})()`;
    const tabWhen = async (ready: (tab: Tab) => boolean): Promise<Tab> => {
      let tab: Tab | null = null;
      const settled = await waitFor(async () => {
        tab = JSON.parse(await obEval(vaultId, readTab)) as Tab | null;
        return tab !== null && ready(tab);
      }, 120);
      if (!settled) throw new Error(`Filtered tab: ${JSON.stringify(tab)}`);
      return tab!;
    };
    /** Run `body` against the open Filter popover of the active tab. */
    const inPopover = (body: string) =>
      obEval(
        vaultId,
        `(async()=>{${PAGE}const el=app.workspace.getMostRecentLeaf().view.contentEl;const popover=el.querySelector('[data-query-popover="filter"]');if(!popover.matches(':popover-open'))press(el.querySelector('[data-query-toolbar="filter"]'),'Filter');const section=name=>popover.querySelector('[data-filter-section="'+name+'"]');const set=(control,value)=>{control.value=value;control.dispatchEvent(new Event('input',{bubbles:true}));};const write=(field,text)=>{const view=field.querySelector('.cm-content').cmTile.root.view;view.dispatch({changes:{from:0,to:view.state.doc.length,insert:text},userEvent:'input.type'});};${body}})()`,
      );

    await obEval(
      vaultId,
      `(async()=>{const file=await app.vault.create(${JSON.stringify(path)},${JSON.stringify(
        [
          "views:",
          "  - type: annotations",
          "    name: Figures",
          "    from: annotations",
          '    filters: tags.contains("figure")',
          "    limit: 100",
          "",
        ].join("\n"),
      )});const leaf=app.workspace.getLeaf('tab');await leaf.openFile(file);app.workspace.setActiveLeaf(leaf,{focus:true});return true;})()`,
    );
    const figures = await queryKeys('tags.contains("figure")');
    expect(figures.length).toBeGreaterThan(0);
    await tabWhen(
      (tab) => JSON.stringify(tab.cards) === JSON.stringify(figures),
    );

    // The popover opens with the two sections; the view's tag condition
    // shows as a visual row, and the empty "All views" section shows one
    // placeholder row.
    const sections = JSON.parse(
      await inPopover(
        `return JSON.stringify({open:popover.matches(':popover-open'),all:section('all').querySelector('[data-filter-heading]').textContent,allRows:section('all').querySelectorAll('[data-condition-row]').length,view:section('view').querySelector('[data-filter-heading]').textContent,tag:section('view').querySelector('[data-condition-row] input[aria-label="${m.workbench_filter_value()}"]').value});`,
      ),
    ) as Record<string, unknown>;
    expect(sections).toEqual({
      open: true,
      all: m.query_view_filter_all_views(),
      allRows: 1,
      view: m.query_view_filter_this_view(),
      tag: "figure",
    });

    // A new tag value saves the view's filters and runs them.
    await inPopover(
      `set(section('view').querySelector('[data-condition-row] input[aria-label="${m.workbench_filter_value()}"]'),'methodology');return true;`,
    );
    const methodology = await queryKeys('tags.contains("methodology")');
    expect(methodology).not.toEqual(figures);
    // The tab saves after a short delay, so the file text follows the cards.
    await tabWhen(
      (tab) =>
        JSON.stringify(tab.cards) === JSON.stringify(methodology) &&
        tab.text.includes(
          '    filters:\n      and:\n        - tags.contains("methodology")\n',
        ),
    );

    // The placeholder row for all views becomes a colour condition, Yellow,
    // and saves as the file's top-level filters; both sections hold. The
    // empty section starts folded, so the reader unfolds it first.
    await inPopover(
      `const fold=section('all').querySelector('details');if(!fold.open)press(fold.querySelector('summary'),'All views heading');await pick(section('all').querySelector('[data-condition-row] select[aria-label="${m.workbench_filter_value()}"]'),'yellow','Value');return true;`,
    );
    const yellow = await queryKeys(
      '(colorName == "yellow") && (tags.contains("methodology"))',
    );
    await tabWhen(
      (tab) =>
        /^filters:\n {2}and:\n {4}- colorName == "yellow"\nviews:/.test(
          tab.text,
        ) && JSON.stringify(tab.cards) === JSON.stringify(yellow),
    );

    // A wrong expression marks its row with the query's diagnostic; the
    // cards stay, and the view says the filter has an error.
    await inPopover(
      `press(section('view').querySelector('[data-condition-row] button[aria-label="${m.workbench_match_edit_as_expression()}"]'),'Edit as expression');write(await until('expression field',()=>section('view').querySelector('[data-condition-row] .cm-content')?.parentElement),'nosuchfield == 1');return true;`,
    );
    const broken = await tabWhen(
      (tab) =>
        tab.filterError &&
        tab.rowIssues[0] !== null &&
        tab.text.includes("        - nosuchfield == 1\n"),
    );
    expect(broken.cards).toEqual(yellow);
    // The count of the kept cards stays in the Results menu.
    expect(broken.count).toBe(String(yellow.length));
    expect(broken.rowIssues[0]).toContain("nosuchfield");
    // The expression field colors the parts of its Filter Expression.
    expect(
      await inPopover(
        `return section('view').querySelectorAll('[data-condition-row] .cm-line span[class]').length>0;`,
      ),
    ).toBe("true");

    // A syntax error names the tokens the filter lacks once, with the place
    // in the filter: the hint that lists them again stays out. The fault sits
    // at the ")" after the condition, so the view shows it above the cards.
    await inPopover(
      `write(section('view').querySelector('[data-condition-row]'),'place !=');return true;`,
    );
    const unfinished = await tabWhen(
      (tab) =>
        tab.diagnostic !== null && tab.text.includes("        - place !=\n"),
    );
    const [said, excerpt, caret, ...rest] = unfinished.diagnostic!.split("\n");
    expect(said).toMatch(/where the filter takes .*a regular expression.*\.$/);
    expect(rest).toEqual([]);
    expect(excerpt).toContain("(place !=)");
    expect(caret!.trim()).toBe("^");

    // "Edit visually" goes back once the expression fits a row.
    await inPopover(
      `const row=section('view').querySelector('[data-condition-row]');write(row,'tags.contains("figure")');press(await until('Edit visually enabled',()=>{const button=row.querySelector('button[aria-label="${m.workbench_match_edit_visually()}"]');return button&&!button.disabled?button:null;}),'Edit visually');return true;`,
    );
    const back = await queryKeys(
      '(colorName == "yellow") && (tags.contains("figure"))',
    );
    await tabWhen(
      (tab) =>
        !tab.filterError &&
        JSON.stringify(tab.cards) === JSON.stringify(back) &&
        tab.text.includes('        - tags.contains("figure")\n'),
    );
    expect(
      await inPopover(
        `return section('view').querySelector('[data-condition-row] input[aria-label="${m.workbench_filter_value()}"]')?.value??null;`,
      ),
    ).toBe("figure");

    // A condition dragged by its grip above another takes the first place,
    // and the file keeps the new order.
    const figureLine = '        - tags.contains("figure")';
    const nextLine = (text: string) => {
      const lines = text.split("\n");
      return lines[lines.indexOf(figureLine) + 1] ?? "";
    };
    await inPopover(
      `press([...section('view').querySelectorAll('button')].find(button=>button.textContent.trim()===${JSON.stringify(m.workbench_match_add_condition())}),'Add condition');await until('new row',()=>section('view').querySelector('[data-condition-row] select[aria-label="${m.workbench_filter_value()}"]'));return true;`,
    );
    // The focus goes to the new row's condition type.
    expect(
      await inPopover(
        `return popover.ownerDocument.activeElement?.closest('[data-condition-row]')===[...section('view').querySelectorAll('[data-condition-row]')].at(-1)&&popover.ownerDocument.activeElement.getAttribute('aria-label');`,
      ),
    ).toBe(m.workbench_match_condition_kind());
    await inPopover(
      `await pick(section('view').querySelector('[data-condition-row] select[aria-label="${m.workbench_filter_value()}"]'),'red','Value');return true;`,
    );
    const added = nextLine(
      (await tabWhen((tab) => nextLine(tab.text).startsWith("        - ")))
        .text,
    );
    // `drag(from, over, y)` drags the grip at path `from` over `over` at the
    // height `y` answers from its box, drops it, and tells whether `over`
    // took the drop.
    const DRAG = `const grip=path=>section('view').querySelector('[data-reorder-handle="'+path+'"]');const drag=(from,over,y)=>{const transfer=new DataTransfer();const fire=(target,type)=>{const r=target.getBoundingClientRect();const event=new DragEvent(type,{bubbles:true,cancelable:true,dataTransfer:transfer,clientX:r.left+r.width/2,clientY:y(r)});target.dispatchEvent(event);return event.defaultPrevented;};fire(grip(from),'dragstart');const took=fire(over,'dragover');if(took)fire(over,'drop');fire(grip(from),'dragend');return took;};const top=r=>r.top+2;`;
    const viewFilters = (...lines: string[]) =>
      `    filters:\n      and:\n${lines.join("\n")}\n`;
    await inPopover(
      `${DRAG}return drag('1',grip('0').closest('[data-part="row"]'),top);`,
    );
    await tabWhen((tab) => tab.text.includes(viewFilters(added, figureLine)));

    // Alt+ArrowDown and Alt+ArrowUp move the focused condition one place,
    // and the focus stays on its grip.
    const press = (key: string) =>
      inPopover(
        `document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'${key}',altKey:true,bubbles:true,cancelable:true}));return (await until('focus follows',()=>{const path=document.activeElement?.getAttribute('data-reorder-handle');return path&&path!=='${key === "ArrowDown" ? "0" : "1"}'?path:null;})).toString();`,
      );
    await inPopover(
      `section('view').querySelector('[data-reorder-handle="0"]').focus();return true;`,
    );
    expect(await press("ArrowDown")).toBe("1");
    await tabWhen((tab) => tab.text.includes(viewFilters(figureLine, added)));
    expect(await press("ArrowUp")).toBe("0");
    await tabWhen((tab) => tab.text.includes(viewFilters(added, figureLine)));

    // A condition dropped on a nested group's body goes to the end of that
    // group; a group takes no drop inside itself; a nested condition dragged
    // above the first row leaves its group.
    const nested = (line: string) => `    ${line}`;
    await inPopover(
      `press([...section('view').querySelectorAll('button')].find(button=>button.textContent.trim()===${JSON.stringify(m.workbench_match_add_group())}),'Add group');await pick(await until('group row',()=>section('view').querySelectorAll('[data-condition-row] select[aria-label="${m.workbench_filter_value()}"]')[1]),'red','Value');return true;`,
    );
    await tabWhen((tab) =>
      tab.text.includes(
        viewFilters(added, figureLine, "        - and:", nested(added)),
      ),
    );
    expect(
      await inPopover(
        `${DRAG}const footer=[...section('view').querySelectorAll('[data-part="group"][data-state="nested"] > [data-part="actions"]')].at(-1);return drag('1',footer,r=>r.top+r.height/2);`,
      ),
    ).toBe("true");
    await tabWhen((tab) =>
      tab.text.includes(
        viewFilters(added, "        - and:", nested(added), nested(figureLine)),
      ),
    );
    expect(
      await inPopover(
        `${DRAG}return drag('1',grip('1.0').closest('[data-part="row"]'),top);`,
      ),
    ).toBe("false");
    await inPopover(
      `${DRAG}return drag('1.1',grip('0').closest('[data-part="row"]'),top);`,
    );
    await tabWhen((tab) =>
      tab.text.includes(
        viewFilters(figureLine, added, "        - and:", nested(added)),
      ),
    );

    // A None group stores as `not`, and its rows after the first read "or".
    const blue = '            - colorName == "blue"';
    const nestedGroup = `section('view').querySelector('[data-part="group"][data-state="nested"]')`;
    await inPopover(
      `set(${nestedGroup}.querySelector('select[aria-label="${m.workbench_match_match()}"]'),'none');return true;`,
    );
    await tabWhen((tab) =>
      tab.text.includes(
        viewFilters(figureLine, added, "        - not:", nested(added)),
      ),
    );
    await inPopover(
      `const group=()=>${nestedGroup};press([...group().querySelectorAll('button')].find(button=>button.textContent.trim()===${JSON.stringify(m.workbench_match_add_condition())}),'Add condition');await pick(await until('second row',()=>group()?.querySelectorAll('[data-condition-row] select[aria-label="${m.workbench_filter_value()}"]')[1]),'blue','Value');return true;`,
    );
    await tabWhen((tab) =>
      tab.text.includes(
        viewFilters(figureLine, added, "        - not:", nested(added), blue),
      ),
    );
    expect(
      JSON.parse(
        await inPopover(
          `return JSON.stringify([...section('view').querySelectorAll('[data-part="group"][data-state="nested"] [data-part="conjunction"]')].map(label=>label.textContent));`,
        ),
      ),
    ).toEqual([
      m.workbench_match_conjunction_where(),
      m.workbench_match_conjunction_or(),
    ]);

    // Removing the last row of a nested group removes the group, and
    // removing the last row of the view's filter removes its filter.
    const removeRow = (scope: string) =>
      inPopover(
        `press(${scope}.querySelector('[data-condition-row] button[aria-label="${m.workbench_match_remove_condition()}"]'),'Remove condition');return true;`,
      );
    await removeRow(nestedGroup);
    await tabWhen((tab) =>
      tab.text.includes(viewFilters(figureLine, added, "        - not:", blue)),
    );
    await removeRow(nestedGroup);
    await tabWhen(
      (tab) =>
        tab.text.includes(viewFilters(figureLine, added)) &&
        !tab.text.includes("- not:"),
    );
    expect(await inPopover(`return ${nestedGroup}===null;`)).toBe("true");
    await removeRow("section('view')");
    await removeRow("section('view')");
    await tabWhen((tab) => !/^ {4}filters:/m.test(tab.text));
    expect(
      await inPopover(
        `return section('view').querySelectorAll('[data-condition-row]').length;`,
      ),
    ).toBe("1");
  }, 180000);

  // The Fixture's Literature Note of SAKIMA22 ends with a Query Block of
  // `item == this.item`. A change in the view rewrites the block text only,
  // and the Live Preview widget stays on the page.
  it("shows a Query Block of its note's Item and saves a sort change into the block", async () => {
    const notePath = "literatures/SAKIMA22.md";
    const layout = await obEval(
      vaultId,
      "JSON.stringify(app.workspace.getLayout())",
    );
    const original = await obEval(
      vaultId,
      `app.vault.read(app.vault.getFileByPath(${JSON.stringify(notePath)}))`,
    );
    await using cleanup = new AsyncDisposableStack();
    const scratchFiles: string[] = [];
    cleanup.defer(async () => {
      await obEval(
        vaultId,
        `(async()=>{await app.workspace.changeLayout(JSON.parse(${JSON.stringify(layout)}));await app.vault.modify(app.vault.getFileByPath(${JSON.stringify(notePath)}),${JSON.stringify(original)});for(const path of ${JSON.stringify(scratchFiles)}){const file=app.vault.getFileByPath(path);if(file)await app.vault.delete(file);}return true;})()`,
      );
    });

    /** What the Query Block in the active note shows, once its query settled. */
    const readBlock = `(async()=>{const view=app.workspace.getMostRecentLeaf().view;const el=view.containerEl.querySelector('.block-language-zotquery');if(!el?.zotlitQueryView)return 'null';await el.zotlitQueryView.settled;return JSON.stringify({file:view.file?.path,mark:el.dataset.e2eMark??null,count:el.querySelector('[data-query-count]')?.getAttribute('data-query-count')??null,cards:[...el.querySelectorAll('.zt-annot-card')].map(n=>n.getAttribute('data-zotero-annotation-key')),diagnostic:el.querySelector('[data-query-diagnostic]')?.getAttribute('data-query-diagnostic')??null,readOnly:el.querySelector('[data-query-read-only]')?.textContent??null});})()`;
    interface Block {
      file: string;
      mark: string | null;
      count: string | null;
      cards: string[];
      diagnostic: string | null;
      readOnly: string | null;
    }
    const blockWhen = async (
      ready: (block: Block) => boolean,
    ): Promise<Block> => {
      let block: Block | null = null;
      const settled = await waitFor(async () => {
        block = JSON.parse(await obEval(vaultId, readBlock)) as Block | null;
        return block !== null && ready(block);
      }, 120);
      if (!settled) throw new Error(`Query Block: ${JSON.stringify(block)}`);
      return block!;
    };
    /** The Annotation keys ZotLit Query gives for an Item, through the CLI. */
    const itemAnnotations = async (item: string, sort?: string) => {
      const report = JSON.parse(
        await cliCommand(vaultId, "zotlit:query", {
          args: {
            from: "annotations",
            filter: "item == this.item",
            "this-item": item,
            fields: "item.title",
            limit: "100",
            ...(sort === undefined ? {} : { sort }),
          },
        }),
      ) as ItemQueryReport;
      expect(report.ok).toBe(true);
      return report.rows!.map((row) => row.indexedKey);
    };
    const open = (path: string, mode: "live" | "reading") =>
      obEval(
        vaultId,
        `(async()=>{const leaf=app.workspace.getLeaf('tab');await leaf.openFile(app.vault.getFileByPath(${JSON.stringify(path)}),{state:${mode === "live" ? "{mode:'source',source:false}" : "{mode:'preview'}"}});app.workspace.setActiveLeaf(leaf,{focus:true});return true;})()`,
      );

    // In Live Preview, `this` is the Item of the note's `zotero-key`.
    const own = await itemAnnotations("SAKIMA22");
    expect(own.length).toBeGreaterThan(1);
    await open(notePath, "live");
    const live = await blockWhen((block) => block.count !== null);
    expect(live).toMatchObject({
      file: notePath,
      count: String(own.length),
      cards: own,
      diagnostic: null,
      readOnly: null,
    });

    // A sort change in the toolbar rewrites the block text, and nothing else
    // in the note. Each step of the Sort control saves.
    const inBlock = (script: string) =>
      obEval(
        vaultId,
        `(async()=>{${PAGE}const el=app.workspace.getMostRecentLeaf().view.containerEl.querySelector('.block-language-zotquery');${script};return true;})()`,
      );
    await inBlock(
      "el.dataset.e2eMark='kept';press(el.querySelector('[data-query-toolbar=\"sort\"]'),'Sort')",
    );
    await inBlock(
      "press(el.querySelector('[data-query-popover=\"sort\"] [data-sort-add]'),'Add sort')",
    );
    for (const [control, value] of [
      ["data-sort-property", "type"],
      ["data-sort-direction", "DESC"],
    ] as const) {
      expect(
        await waitFor(async () =>
          JSON.parse(
            await obEval(
              vaultId,
              `JSON.stringify(!!app.workspace.getMostRecentLeaf().view.containerEl.querySelector('.block-language-zotquery [data-query-popover="sort"] [${control}]'))`,
            ),
          ),
        ),
      ).toBe(true);
      await inBlock(
        `await pick(el.querySelector('[data-query-popover="sort"] [${control}]'),${JSON.stringify(value)},'${control}')`,
      );
    }
    const written = original.replace(
      "    limit: 100\n```",
      "    limit: 100\n    sort:\n      - property: type\n        direction: DESC\n```",
    );
    expect(written).not.toBe(original);
    expect(
      await waitFor(
        async () =>
          (await obEval(
            vaultId,
            `app.vault.read(app.vault.getFileByPath(${JSON.stringify(notePath)}))`,
          )) === written,
      ),
    ).toBe(true);
    const sorted = await itemAnnotations("SAKIMA22", "-type");
    const resorted = await blockWhen(
      (block) => JSON.stringify(block.cards) === JSON.stringify(sorted),
    );
    // The Live Preview widget that showed the view is the one that shows it now.
    expect(resorted.mark).toBe("kept");

    // Reading view shows the saved sort, and `this` follows the note's
    // `zotero-key` when the frontmatter changes.
    await open(notePath, "reading");
    await blockWhen(
      (block) => JSON.stringify(block.cards) === JSON.stringify(sorted),
    );
    const other = await itemAnnotations("RUGIER24", "-type");
    expect(other.length).toBeGreaterThan(0);
    await obEval(
      vaultId,
      `(async()=>{await app.fileManager.processFrontMatter(app.vault.getFileByPath(${JSON.stringify(notePath)}),fm=>{fm['zotero-key']='RUGIER24';});return true;})()`,
    );
    await blockWhen(
      (block) => JSON.stringify(block.cards) === JSON.stringify(other),
    );

    // A section embed shows the block, and a sort change there saves to the
    // note that holds it.
    const embedPath = "Query block embed.md";
    scratchFiles.push(embedPath);
    await obEval(
      vaultId,
      `(async()=>{await app.vault.modify(app.vault.getFileByPath(${JSON.stringify(notePath)}),${JSON.stringify(written)});await app.vault.create(${JSON.stringify(embedPath)},'![[SAKIMA22#Sakima’s song]]\\n');return true;})()`,
    );
    await open(embedPath, "reading");
    const embedded = await blockWhen(
      (block) => JSON.stringify(block.cards) === JSON.stringify(sorted),
    );
    expect(embedded.readOnly).toBeNull();
    await inBlock(
      "press(el.querySelector('[data-query-toolbar=\"sort\"]'),'Sort')",
    );
    await inBlock(
      `const select=el.querySelector('[data-query-popover="sort"] [data-sort-direction]');select.value='ASC';select.dispatchEvent(new Event('change',{bubbles:true}))`,
    );
    const fromEmbed = written.replace(
      "        direction: DESC\n```",
      "        direction: ASC\n```",
    );
    expect(fromEmbed).not.toBe(written);
    expect(
      await waitFor(
        async () =>
          (await obEval(
            vaultId,
            `app.vault.read(app.vault.getFileByPath(${JSON.stringify(notePath)}))`,
          )) === fromEmbed,
      ),
    ).toBe(true);
    expect(
      await obEval(
        vaultId,
        `app.vault.read(app.vault.getFileByPath(${JSON.stringify(embedPath)})).then(JSON.stringify)`,
      ),
    ).toBe(JSON.stringify("![[SAKIMA22#Sakima’s song]]\n"));

    // In a note without a `zotero-key`, the view names `this`.
    const plainPath = "Query block without key.md";
    scratchFiles.push(plainPath);
    await obEval(
      vaultId,
      `(async()=>{await app.vault.create(${JSON.stringify(plainPath)},${JSON.stringify("# Without a key\n\n```zotquery\nviews:\n  - type: annotations\n    name: Mine\n    from: annotations\n    filters: item == this.item\n```\n")});return true;})()`,
    );
    await open(plainPath, "live");
    const unbound = await blockWhen((block) => block.diagnostic !== null);
    expect(unbound).toMatchObject({
      diagnostic: "unbound-context",
      cards: [],
    });
  }, 180000);

  it("saves a limit typed into a Query Block when its note closes or shows another file before the save delay ends", async () => {
    const notePath = "literatures/SAKIMA22.md";
    const layout = await obEval(
      vaultId,
      "JSON.stringify(app.workspace.getLayout())",
    );
    const original = await obEval(
      vaultId,
      `app.vault.read(app.vault.getFileByPath(${JSON.stringify(notePath)}))`,
    );
    expect(original).toContain("    limit: 100\n```");
    const restore = `(async()=>{await app.workspace.changeLayout(JSON.parse(${JSON.stringify(layout)}));await app.vault.modify(app.vault.getFileByPath(${JSON.stringify(notePath)}),${JSON.stringify(original)});return true;})()`;
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await obEval(vaultId, restore);
    });
    const read = () =>
      obEval(
        vaultId,
        `app.vault.read(app.vault.getFileByPath(${JSON.stringify(notePath)}))`,
      );

    const cases = [
      ["live", "close"],
      ["live", "switch"],
      ["reading", "close"],
    ] as const;
    const outcomes: { mode: string; leave: string; saved: boolean }[] = [];
    for (const [index, [mode, leave]] of cases.entries()) {
      const limit = String(3 + index);
      await obEval(vaultId, restore);
      await obEval(
        vaultId,
        `(async()=>{const leaf=app.workspace.getLeaf('tab');await leaf.openFile(app.vault.getFileByPath(${JSON.stringify(notePath)}),{state:${mode === "live" ? "{mode:'source',source:false}" : "{mode:'preview'}"}});app.workspace.setActiveLeaf(leaf,{focus:true});window.zotlitE2EBlockLeaf=leaf;return true;})()`,
      );
      expect(
        await obEvalUntil(
          vaultId,
          `(async()=>{const el=[...window.zotlitE2EBlockLeaf.view.containerEl.querySelectorAll('.block-language-zotquery')].find(el=>el.checkVisibility());if(!el?.zotlitQueryView)return 'no';await el.zotlitQueryView.settled;return el.querySelector('[data-query-count]')?'ready':'no';})()`,
          { expected: "ready", tries: 120 },
        ),
      ).toBe(true);
      // The limit, then the note goes at once, well inside the save delay. The
      // block is the one the mode shows; the other mode's copy stays hidden.
      await obEval(
        vaultId,
        `(async()=>{${PAGE}const leaf=window.zotlitE2EBlockLeaf;const el=[...leaf.view.containerEl.querySelectorAll('.block-language-zotquery')].find(el=>el.checkVisibility());press(el.querySelector('[data-query-results]'),'Results');const input=await until('limit field',()=>el.querySelector('[data-query-results-popup] [data-query-limit]'));Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(limit)});input.dispatchEvent(new Event('input',{bubbles:true}));${leave === "close" ? "leaf.detach();" : `await leaf.openFile(app.vault.getMarkdownFiles().find(f=>f.path!==${JSON.stringify(notePath)}));`}delete window.zotlitE2EBlockLeaf;return true;})()`,
      );
      const expected = original.replace(
        "    limit: 100\n```",
        `    limit: ${limit}\n\`\`\``,
      );
      await waitFor(async () => (await read()) === expected);
      outcomes.push({ mode, leave, saved: (await read()) === expected });
    }
    expect(outcomes).toEqual(
      cases.map(([mode, leave]) => ({ mode, leave, saved: true })),
    );
  }, 180000);

  it("adds, renames and sets a default view of a Query File from the view menu, and the file keeps them", async () => {
    const path = "query-files/Reading annotations.zotquery";
    const layout = await obEval(
      vaultId,
      "JSON.stringify(app.workspace.getLayout())",
    );
    const original = await obEval(
      vaultId,
      `app.vault.read(app.vault.getFileByPath(${JSON.stringify(path)}))`,
    );
    await using cleanup = new AsyncDisposableStack();
    // The tab closes before the text goes back, so no pending save of the
    // tab writes over it.
    cleanup.defer(async () => {
      await obEval(
        vaultId,
        `(async()=>{for(const leaf of app.workspace.getLeavesOfType('zotlit-query-file'))leaf.detach();await app.vault.modify(app.vault.getFileByPath(${JSON.stringify(path)}),${JSON.stringify(original)});await app.workspace.changeLayout(JSON.parse(${JSON.stringify(layout)}));return true;})()`,
      );
    });
    const tab = "app.workspace.getMostRecentLeaf().view";
    const open = `(async()=>{const old=app.workspace.getLeavesOfType('zotlit-query-file');const leaf=app.workspace.getLeaf('tab');await leaf.openFile(app.vault.getFileByPath(${JSON.stringify(path)}));app.workspace.setActiveLeaf(leaf,{focus:true});for(const other of old)other.detach();return true;})()`;
    /** The view on screen, its cards, and the page labels the cards show. */
    const shown = (view: string) =>
      obEvalUntil(
        vaultId,
        `(async()=>{const view=${tab};if(view.getViewType()!=='zotlit-query-file')return 'none';await view.query.settled;const el=view.contentEl;const cards=el.querySelectorAll('.zt-annot-card').length;return el.querySelector('[data-query-view-menu]')?.textContent+':'+(cards>0);})()`,
        { expected: `${view}:true` },
      );
    const pages = `(()=>JSON.stringify([...${tab}.contentEl.querySelectorAll('.zt-annot-page-chip')].map(n=>n.textContent).filter(Boolean)))()`;
    /** The view rows the open view menu shows. */
    const rows = `(()=>JSON.stringify([...${tab}.contentEl.querySelectorAll('[data-query-view-list]:popover-open [data-query-view-row]')].map(n=>n.getAttribute('data-query-view-row'))))()`;
    const search = (text: string) =>
      `(()=>{const input=${tab}.contentEl.querySelector('[data-query-view-list] input');input.value=${JSON.stringify(text)};input.dispatchEvent(new Event('input',{bubbles:true}));return true;})()`;

    await obEval(vaultId, open);
    expect(await shown("All annotations")).toBe(true);
    // A page number takes "p."; a named page label reads as it is.
    const shownPages: string[] = JSON.parse(await obEval(vaultId, pages));
    expect(shownPages).toContain("p. 1");
    expect(shownPages).toContain("Chapter 1");

    // The view menu narrows its views as the researcher types.
    await obEval(
      vaultId,
      `(()=>{${PAGE}press(${tab}.contentEl.querySelector('[data-query-view-menu]'),'View menu');return true;})()`,
    );
    expect(
      await obEvalUntil(vaultId, rows, {
        expected: JSON.stringify(["All annotations", "Figures"]),
      }),
    ).toBe(true);
    await obEval(vaultId, search("fig"));
    expect(
      await obEvalUntil(vaultId, rows, {
        expected: JSON.stringify(["Figures"]),
      }),
    ).toBe(true);
    await obEval(vaultId, search(""));

    // "Add view" adds a view, shows it, and opens Configure view on its
    // name as a page of the menu; the name typed there renames it.
    await obEval(
      vaultId,
      `(()=>{${PAGE}press(${tab}.contentEl.querySelector('[data-query-view-action="add"]'),'Add view');return true;})()`,
    );
    expect(
      await obEvalUntil(
        vaultId,
        `String(!!activeDocument.querySelector('[data-query-view-list]:popover-open [data-chooser-page] [data-query-view-name]'))`,
        { expected: "true" },
      ),
    ).toBe(true);
    // Configure view offers only the layouts built for the view's dataset.
    expect(
      await obEval(
        vaultId,
        `JSON.stringify([...activeDocument.querySelectorAll('[data-query-view-list]:popover-open [data-chooser-page] [data-query-view-layout] option')].map(n=>n.textContent))`,
      ),
    ).toBe(
      JSON.stringify([
        m.query_view_layout_annotations(),
        m.query_view_layout_list(),
        m.query_view_layout_cards(),
      ]),
    );
    await obEval(
      vaultId,
      `(()=>{const input=activeDocument.querySelector('[data-query-view-list]:popover-open [data-chooser-page] [data-query-view-name]');input.value='Methods';input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));return true;})()`,
    );
    expect(await shown("Methods")).toBe(true);

    // "Show page" off takes the page labels off the cards at once.
    expect(JSON.parse(await obEval(vaultId, pages))).not.toEqual([]);
    await obEval(
      vaultId,
      `(()=>{${PAGE}const page=activeDocument.querySelector('[data-query-view-list]:popover-open [data-chooser-page]');press(page.querySelector('[data-query-view-option="showPage"] [role="switch"]'),'Show page');press(page.querySelector('[data-chooser-page-close]'),'Close');return true;})()`,
    );
    expect(await obEvalUntil(vaultId, pages, { expected: "[]" })).toBe(true);

    // A right-click on the view's row opens its Configure view, whose
    // "Default view" moves it to the top of the list.
    await obEval(
      vaultId,
      `(()=>{${PAGE}press(${tab}.contentEl.querySelector('[data-query-view-menu]'),'View menu');return true;})()`,
    );
    expect(
      await obEvalUntil(vaultId, rows, {
        expected: JSON.stringify(["All annotations", "Figures", "Methods"]),
      }),
    ).toBe(true);
    await obEval(
      vaultId,
      `(async()=>{${PAGE}const row=${tab}.contentEl.querySelector('[data-query-view-row="Methods"]');row.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:200,clientY:200}));const page=await until('Configure view of Methods',()=>activeDocument.querySelector('[data-query-view-list]:popover-open [data-query-configure-view="Methods"]')?.closest('[data-chooser-page]'));press(page.querySelector('[data-chooser-page-menu]'),'More options');const item=await until('Default view',()=>page.querySelector('[role="menu"]:popover-open [data-chooser-page-menu-item="default"]'));press(item,'Default view');press(page.querySelector('[data-chooser-page-close]'),'Close');return true;})()`,
    );

    // Each change saved to the file.
    expect(
      await obEvalUntil(
        vaultId,
        `app.vault.read(app.vault.getFileByPath(${JSON.stringify(path)})).then(t=>String(t.indexOf('name: Methods')>-1&&t.indexOf('name: Methods')<t.indexOf('name: All annotations')&&t.includes('showPage: false')))`,
        { expected: "true" },
      ),
    ).toBe(true);

    // A plain open of the file shows the first view, as the file holds it.
    await obEval(vaultId, open);
    expect(await shown("Methods")).toBe(true);
    expect(await obEval(vaultId, pages)).toBe("[]");
    await obEval(
      vaultId,
      `(()=>{${PAGE}press(${tab}.contentEl.querySelector('[data-query-view-menu]'),'View menu');return true;})()`,
    );
    expect(
      await obEvalUntil(vaultId, rows, {
        expected: JSON.stringify(["Methods", "All annotations", "Figures"]),
      }),
    ).toBe(true);

    // The chevron on a view's row opens Configure view on that view and
    // leaves the view on screen as it is.
    await obEval(
      vaultId,
      `(()=>{${PAGE}press(${tab}.contentEl.querySelector('[data-query-view-list]:popover-open [data-query-view-configure="Figures"]'),'Configure Figures');return true;})()`,
    );
    expect(
      await obEvalUntil(
        vaultId,
        `String(activeDocument.querySelector('[data-query-view-list]:popover-open [data-chooser-page] [data-query-view-name]')?.value)`,
        { expected: "Figures" },
      ),
    ).toBe(true);
    expect(await shown("Methods")).toBe(true);
    await obEval(
      vaultId,
      `(()=>{${PAGE}press(activeDocument.querySelector('[data-query-view-list]:popover-open [data-chooser-page] [data-chooser-page-close]'),'Close');return true;})()`,
    );
  }, 180000);

  it("switches a Query File view to List and to Cards, and shows the same rows under the same groups", async () => {
    const path = "query-files/Reading annotations.zotquery";
    const layout = await obEval(
      vaultId,
      "JSON.stringify(app.workspace.getLayout())",
    );
    const original = await obEval(
      vaultId,
      `app.vault.read(app.vault.getFileByPath(${JSON.stringify(path)}))`,
    );
    await using cleanup = new AsyncDisposableStack();
    // The tab closes before the text goes back, so no pending save of the
    // tab writes over it.
    cleanup.defer(async () => {
      // Teardown closes a popover a failed step left open; not a reader's press.
      await obEval(
        vaultId,
        `(async()=>{for(const popup of activeDocument.querySelectorAll('[popover]:popover-open'))popup.hidePopover();for(const leaf of app.workspace.getLeavesOfType('zotlit-query-file'))leaf.detach();await app.vault.modify(app.vault.getFileByPath(${JSON.stringify(path)}),${JSON.stringify(original)});await app.workspace.changeLayout(JSON.parse(${JSON.stringify(layout)}));return true;})()`,
      );
    });
    await obEval(
      vaultId,
      `(async()=>{const leaf=app.workspace.getLeaf('tab');await leaf.openFile(app.vault.getFileByPath(${JSON.stringify(path)}));app.workspace.setActiveLeaf(leaf,{focus:true});return true;})()`,
    );
    /** The rows the tab shows, by the Layout that draws them. */
    const readTab = `(async()=>{const view=app.workspace.getMostRecentLeaf().view;if(view.getViewType()!=='zotlit-query-file')return 'null';await view.query.settled;const el=view.contentEl;return JSON.stringify({layout:el.querySelector('[data-query-layout]')?.getAttribute('data-query-layout')??'annotations',cards:[...el.querySelectorAll('.zt-annot-card')].map(n=>n.getAttribute('data-zotero-annotation-key')),rows:[...el.querySelectorAll('[data-query-row]')].map(n=>n.getAttribute('data-query-row')),headings:[...el.querySelectorAll('[data-query-group]')].map(n=>n.textContent),markers:el.querySelector('[data-query-markers]')?.getAttribute('data-query-markers')??null,text:await app.vault.read(view.file)});})()`;
    interface Tab {
      layout: string;
      cards: string[];
      rows: string[];
      headings: string[];
      markers: string | null;
      text: string;
    }
    const tabWhen = async (ready: (tab: Tab) => boolean): Promise<Tab> => {
      let tab: Tab | null = null;
      const settled = await waitFor(async () => {
        tab = JSON.parse(await obEval(vaultId, readTab)) as Tab | null;
        return tab !== null && ready(tab);
      }, 120);
      if (!settled) throw new Error(`Query File tab: ${JSON.stringify(tab)}`);
      return tab!;
    };
    /** Open Configure view on the view on screen, and pick a Layout there. */
    const pickLayout = (type: string) =>
      obEval(
        vaultId,
        `(async()=>{${PAGE}const el=app.workspace.getMostRecentLeaf().view.contentEl;if(!activeDocument.querySelector('[data-query-view-list]:popover-open [data-chooser-page]'))el.querySelector('[data-query-view-menu]').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:200,clientY:200}));const select=await until('Configure view opens',()=>activeDocument.querySelector('[data-query-view-list]:popover-open [data-chooser-page] [data-query-view-layout]'));select.value=${JSON.stringify(type)};select.dispatchEvent(new Event('change',{bubbles:true}));return true;})()`,
      );

    const annotations = await tabWhen((tab) => tab.cards.length > 0);
    expect(annotations.layout).toBe("annotations");
    expect(annotations.headings.length).toBeGreaterThan(1);

    // List: the same rows in the same order, under the same Item headings.
    await pickLayout("list");
    const list = await tabWhen((tab) => tab.layout === "list");
    expect(list).toMatchObject({
      cards: [],
      rows: annotations.cards,
      headings: annotations.headings,
      markers: "bullet",
    });

    // A List option in Configure view draws at once and saves to the file.
    await obEval(
      vaultId,
      `(()=>{const select=activeDocument.querySelector('[data-query-view-list]:popover-open [data-chooser-page] [data-query-view-option="markers"]');select.value='number';select.dispatchEvent(new Event('change',{bubbles:true}));return true;})()`,
    );
    const numbered = await tabWhen(
      (tab) => tab.markers === "number" && tab.text.includes("markers: number"),
    );
    expect(numbered.rows).toEqual(annotations.cards);

    // Cards: the same rows again; the switch keeps the grouping and the
    // limit of the view, and changes only its Layout.
    await pickLayout("cards");
    const cards = await tabWhen(
      (tab) => tab.layout === "cards" && tab.text.includes("type: cards"),
    );
    expect(cards).toMatchObject({
      cards: [],
      rows: annotations.cards,
      headings: annotations.headings,
    });
    expect(cards.text).toContain(
      "groupBy:\n      property: item.indexedKey\n      direction: ASC\n",
    );
    expect(cards.text).toContain("limit: 100\n");
  }, 180000);

  it("finds the same Items in the Table, List and Cards from one search, and Cards name and show properties as the Table does", async () => {
    const path = "query-files/Items in three layouts.zotquery";
    const layout = await obEval(
      vaultId,
      "JSON.stringify(app.workspace.getLayout())",
    );
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      // Teardown closes a popover a failed step left open; not a reader's press.
      await obEval(
        vaultId,
        `(async()=>{for(const popup of activeDocument.querySelectorAll('[popover]:popover-open'))popup.hidePopover();for(const leaf of app.workspace.getLeavesOfType('zotlit-query-file'))leaf.detach();const file=app.vault.getFileByPath(${JSON.stringify(path)});if(file)await app.vault.delete(file);await app.workspace.changeLayout(JSON.parse(${JSON.stringify(layout)}));return true;})()`,
      );
    });
    await obEval(
      vaultId,
      `(async()=>{const file=await app.vault.create(${JSON.stringify(path)},${JSON.stringify("views:\n  - type: table\n    name: Items\n    from: items\n    order:\n      - title\n      - itemType\n      - date\n      - publicationTitle\n    limit: 100\n")});const leaf=app.workspace.getLeaf('tab');await leaf.openFile(file);app.workspace.setActiveLeaf(leaf,{focus:true});return true;})()`,
    );
    /**
     * The Items the tab shows, each with the text of its cells, and the
     * names of the properties: the Table's column headers, or the labels of
     * the first card.
     */
    const readTab = `(async()=>{const view=app.workspace.getMostRecentLeaf().view;if(view.getViewType()!=='zotlit-query-file')return 'null';await view.query.settled;const el=view.contentEl;const layout=el.querySelector('[data-query-layout]')?.getAttribute('data-query-layout')??(el.querySelector('[data-query-table]')?'table':'annotations');const rows=layout==='table'?[...el.querySelectorAll('tr[data-query-table-row="item"]')].map(n=>({key:n.getAttribute('data-query-key'),cells:[...n.querySelectorAll('td')].slice(1).map(c=>c.textContent)})):[...el.querySelectorAll('[data-query-row]')].map(n=>({key:n.getAttribute('data-query-row'),cells:layout==='cards'?[...n.children].map((part,at)=>at===0?part.textContent:part.children[1]?.textContent):[n.textContent]}));const labels=layout==='table'?[...el.querySelectorAll('th[data-query-column]')].map(n=>n.textContent):[...el.querySelector('[data-query-row]')?.children??[]].slice(1).map(part=>part.children[0]?.textContent);return JSON.stringify({layout,rows,labels});})()`;
    interface Tab {
      layout: string;
      rows: { key: string; cells: string[] }[];
      labels: string[];
    }
    const tabWhen = async (ready: (tab: Tab) => boolean): Promise<Tab> => {
      let tab: Tab | null = null;
      const settled = await waitFor(async () => {
        tab = JSON.parse(await obEval(vaultId, readTab)) as Tab | null;
        return tab !== null && ready(tab);
      }, 120);
      if (!settled) throw new Error(`Query File tab: ${JSON.stringify(tab)}`);
      return tab!;
    };
    /** Pick a Layout in Configure view, then close it. */
    const pickLayout = (type: string) =>
      obEval(
        vaultId,
        `(async()=>{${PAGE}const el=app.workspace.getMostRecentLeaf().view.contentEl;el.querySelector('[data-query-view-menu]').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:200,clientY:200}));await until('Configure view opens',()=>activeDocument.querySelector('[data-query-view-list]:popover-open [data-chooser-page] [data-query-view-layout]'));const page=activeDocument.querySelector('[data-query-view-list]:popover-open [data-chooser-page]');const select=page.querySelector('[data-query-view-layout]');select.value=${JSON.stringify(type)};select.dispatchEvent(new Event('change',{bubbles:true}));press(page.querySelector('[data-chooser-page-close]'),'Close');return true;})()`,
      );
    /** Type into the toolbar search, which opens on its first use. */
    const search = (text: string) =>
      obEval(
        vaultId,
        `(async()=>{${PAGE}const el=app.workspace.getMostRecentLeaf().view.contentEl;if(!el.querySelector('[data-query-search]')){press(el.querySelector('[data-query-toolbar="search"]'),'Search');await until('search field',()=>el.querySelector('[data-query-search]'));}const input=el.querySelector('[data-query-search]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(text)});input.dispatchEvent(new Event('input',{bubbles:true}));return true;})()`,
      );

    const table = await tabWhen(
      (tab) => tab.layout === "table" && tab.rows.length > 0,
    );
    const total = table.rows.length;
    // Each layout finds the Items by the Item Type the Table shows, not by
    // the name Zotero stores.
    const found: Record<string, string[]> = {};
    for (const type of ["table", "list", "cards"]) {
      if (type !== "table") {
        await search("");
        await pickLayout(type);
        await tabWhen(
          (tab) => tab.layout === type && tab.rows.length === total,
        );
      }
      await search("journal article");
      const hits = await tabWhen(
        (tab) =>
          tab.layout === type && tab.rows.length > 0 && tab.rows.length < total,
      );
      found[type] = hits.rows.map((row) => row.key).toSorted();
      await search("journalarticle");
      await tabWhen((tab) => tab.layout === type && tab.rows.length === 0);
    }
    expect(found.list).toEqual(found.table);
    expect(found.cards).toEqual(found.table);

    // A card names each property under the title by the Table's column
    // header, and shows each value as the Table's cell does.
    await search("");
    const cards = await tabWhen(
      (tab) => tab.layout === "cards" && tab.rows.length === total,
    );
    expect(table.labels.slice(0, 2)).toEqual(["Title", "Item Type"]);
    expect(cards.labels).toEqual(table.labels.slice(1));
    const cells = new Map(table.rows.map((row) => [row.key, row.cells]));
    for (const card of cards.rows)
      expect(card.cells).toEqual(cells.get(card.key)!.slice(0, 4));

    // "Hide all" leaves no property ticked and none shown, as in Bases, the
    // Literature Note Property with them: the Table keeps a row for each Item,
    // and a card stays for each Item with nothing in it.
    await pickLayout("table");
    await tabWhen((tab) => tab.layout === "table" && tab.rows.length === total);
    const hidden = JSON.parse(
      await obEval(
        vaultId,
        `(async()=>{${PAGE}const view=app.workspace.getMostRecentLeaf().view;const el=view.contentEl;press(el.querySelector('[data-query-properties]'),'Properties');const popup=()=>activeDocument.querySelector('[data-query-properties-popup]');const selected=()=>[...popup().querySelectorAll('[data-query-property][aria-selected="true"]')];await until('Properties popover opens',()=>popup()?.matches(':popover-open')&&selected().length>0);press(popup().querySelector('[data-query-properties-action="hide-all"]'),'Hide all');await until('Hide all clears the ticks',()=>selected().length===0);const ticks=selected().length;popup().hidePopover();await until('Table drops the columns',()=>!el.querySelector('th[data-query-column]'));await view.query.settled;return JSON.stringify({header:[...el.querySelectorAll('[data-query-table] thead th')].map(n=>n.textContent.trim()),rows:el.querySelectorAll('tr[data-query-table-row="item"]').length,ticks});})()`,
      ),
    ) as { header: string[]; rows: number; ticks: number };
    expect(hidden).toEqual({
      header: [""],
      rows: total,
      ticks: 0,
    });
    await pickLayout("cards");
    const empty = await tabWhen(
      (tab) => tab.layout === "cards" && tab.rows.length === total,
    );
    expect(empty.labels).toEqual([]);
    expect(empty.rows.every((row) => row.cells.length === 0)).toBe(true);
  }, 180000);

  it("groups a Query File by colour in a Manual order, hides a colour, and keeps it on reopen", async () => {
    const layout = await obEval(
      vaultId,
      "JSON.stringify(app.workspace.getLayout())",
    );
    const path = "query-files/By colour.zotquery";
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await obEval(
        vaultId,
        `(async()=>{await app.workspace.changeLayout(JSON.parse(${JSON.stringify(layout)}));const file=app.vault.getFileByPath(${JSON.stringify(path)});if(file)await app.vault.delete(file);return true;})()`,
      );
    });
    const open = `(async()=>{const file=app.vault.getFileByPath(${JSON.stringify(path)});const leaf=app.workspace.getLeaf('tab');await leaf.openFile(file);app.workspace.setActiveLeaf(leaf,{focus:true});return true;})()`;
    await obEval(
      vaultId,
      `(async()=>{await app.vault.create(${JSON.stringify(path)},${JSON.stringify("views:\n  - type: annotations\n    name: Colours\n    from: annotations\n    limit: 100\n")});return true;})()`,
    );
    await obEval(vaultId, open);

    /** The group headings and the Manual order rows of the active tab, once settled. */
    const readTab = `(async()=>{const view=app.workspace.getMostRecentLeaf().view;if(view.getViewType()!=='zotlit-query-file'||view.file?.path!==${JSON.stringify(path)})return 'null';await view.query.settled;const el=view.contentEl;return JSON.stringify({count:el.querySelector('[data-query-count]')?.getAttribute('data-query-count')??null,headings:[...el.querySelectorAll('[data-query-group]')].map(n=>n.textContent),order:[...el.querySelectorAll('[data-group-row]')].map(n=>[n.getAttribute('data-group-row'),n.querySelector('input').checked])});})()`;
    interface Tab {
      count: string | null;
      headings: string[];
      order: [string, boolean][];
    }
    const tabWhen = async (ready: (tab: Tab) => boolean): Promise<Tab> => {
      let tab: Tab | null = null;
      const settled = await waitFor(async () => {
        tab = JSON.parse(await obEval(vaultId, readTab)) as Tab | null;
        return tab !== null && ready(tab);
      }, 120);
      if (!settled) throw new Error(`Query File tab: ${JSON.stringify(tab)}`);
      return tab!;
    };
    /** Choose an option of a select in the Group popover, opening it first. */
    const choose = (selector: string, value: string) =>
      obEval(
        vaultId,
        `(async()=>{${PAGE}const el=app.workspace.getMostRecentLeaf().view.contentEl;const popover=el.querySelector('[data-query-popover="group"]');if(!popover.matches(':popover-open'))press(el.querySelector('[data-query-toolbar="group"]'),'Group');await pick(popover.querySelector('${selector}'),${JSON.stringify(value)},${JSON.stringify(selector)});return true;})()`,
      );

    await tabWhen((tab) => tab.count !== null);
    // The colours of the rows.
    const report = JSON.parse(
      await cliCommand(vaultId, "zotlit:query", {
        args: { from: "annotations", fields: "colorName", limit: "100" },
      }),
    ) as ItemQueryReport;
    expect(report.ok).toBe(true);
    const colours = [
      ...new Set(report.rows!.map((row) => String(row.values.colorName))),
    ];
    expect(colours.length).toBeGreaterThan(1);

    await choose("[data-group-property]", "colorName");
    const grouped = await tabWhen(
      (tab) => tab.headings.length === colours.length,
    );
    // Ascending groups go from A to Z by the colour's name, as in Bases.
    expect(grouped.headings).toEqual(
      grouped.headings.toSorted((a, b) => a.localeCompare(b, "en")),
    );
    await choose("[data-group-direction]", "MANUAL");
    const manual = await tabWhen((tab) => tab.order.length > 0);
    expect(manual.order.map(([colour]) => colour).toSorted()).toEqual(
      colours.toSorted(),
    );
    expect(manual.order.every(([, ticked]) => ticked)).toBe(true);

    // A tick hides the first colour.
    const [hidden, ...shown] = manual.order.map(([colour]) => colour);
    await obEval(
      vaultId,
      `(()=>{${PAGE}const el=app.workspace.getMostRecentLeaf().view.contentEl;const popover=el.querySelector('[data-query-popover="group"]');if(!popover.matches(':popover-open'))press(el.querySelector('[data-query-toolbar="group"]'),'Group');press(popover.querySelector('[data-group-row=${JSON.stringify(hidden)}] input'),'group row '+${JSON.stringify(hidden)});popover.hidePopover();return true;})()`,
    );
    const after = await tabWhen((tab) => tab.headings.length === shown.length);
    const expectedCount = report.rows!.filter(
      (row) => row.values.colorName !== hidden,
    ).length;
    expect(after.count).toBe(String(expectedCount));

    // The file holds the grouping; a reopened tab shows the same groups.
    await obEval(
      vaultId,
      "(async()=>{app.workspace.getMostRecentLeaf().detach();return true;})()",
    );
    let text = "";
    await waitFor(async () => {
      text = await obEval(
        vaultId,
        `app.vault.read(app.vault.getFileByPath(${JSON.stringify(path)}))`,
      );
      return text.includes("groupOrder");
    }, 30);
    expect(text).toContain(
      "    groupBy:\n      property: colorName\n      direction: ASC\n",
    );
    expect(text).toContain(
      `    groupOrder:\n${shown.map((colour) => `      - ${colour}`).join("\n")}`,
    );
    await obEval(vaultId, open);
    const reopened = await tabWhen((tab) => tab.count !== null);
    expect(reopened.headings).toEqual(after.headings);
    expect(reopened.count).toBe(after.count);
  }, 180000);

  it("steps the Card Selection through the cards a grouped Query File draws: past a collapsed group, and to each place of a card under two tags", async () => {
    const layout = await obEval(
      vaultId,
      "JSON.stringify(app.workspace.getLayout())",
    );
    const colourPath = "query-files/Step by colour.zotquery";
    const tagPath = "query-files/Step by tag.zotquery";
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await obEval(
        vaultId,
        `(async()=>{await app.workspace.changeLayout(JSON.parse(${JSON.stringify(layout)}));for(const path of ${JSON.stringify([colourPath, tagPath])}){const file=app.vault.getFileByPath(path);if(file)await app.vault.delete(file);}return true;})()`,
      );
    });
    const tab = "app.workspace.getMostRecentLeaf().view";
    /** The cards on screen in DOM order, each at its place, and the headings. */
    const readCards = (path: string) =>
      `(async()=>{const view=${tab};if(view.getViewType()!=='zotlit-query-file'||view.file?.path!==${JSON.stringify(path)})return 'null';await view.query.settled;const grid=view.contentEl.querySelector('[role="grid"]');return JSON.stringify({cards:[...grid?.querySelectorAll('.zt-annot-card')??[]].map(n=>({key:n.getAttribute('data-zotero-annotation-key'),place:n.getAttribute('data-card-place')})),headings:[...grid?.querySelectorAll('[data-query-group]')??[]].map(n=>({key:n.getAttribute('data-query-group'),collapsed:n.hasAttribute('data-collapsed')}))});})()`;
    interface Shown {
      cards: { key: string; place: string }[];
      headings: { key: string; collapsed: boolean }[];
    }
    const open = async (
      path: string,
      text: string,
      ready: (shown: Shown) => boolean,
    ): Promise<Shown> => {
      await obEval(
        vaultId,
        `(async()=>{const file=await app.vault.create(${JSON.stringify(path)},${JSON.stringify(text)});const leaf=app.workspace.getLeaf('tab');await leaf.openFile(file);app.workspace.setActiveLeaf(leaf,{focus:true});return true;})()`,
      );
      return shownWhen(path, ready);
    };
    const shownWhen = async (
      path: string,
      ready: (shown: Shown) => boolean,
    ): Promise<Shown> => {
      let shown: Shown | null = null;
      const settled = await waitFor(async () => {
        shown = JSON.parse(await obEval(vaultId, readCards(path))) as Shown;
        return shown !== null && ready(shown);
      }, 120);
      if (!settled) throw new Error(`Query File tab: ${JSON.stringify(shown)}`);
      return shown!;
    };
    /**
     * The Card Selection, the place its focus holds, and what the screen
     * shows of it: the card at that place, and the card that has the focus.
     */
    const readSelection = `(()=>{const view=${tab};const sel=view.query.layout.store.getState().cardSelection;const el=view.contentEl;const at=[...el.querySelectorAll('.zt-annot-card')].find(n=>n.getAttribute('data-card-place')===sel.focus);return JSON.stringify({focus:sel.focus,selected:sel.selected,drawn:!!at&&at.getClientRects().length>0&&at.hasAttribute('data-selected'),active:el.ownerDocument.activeElement?.closest?.('.zt-annot-card')?.getAttribute('data-card-place')??null});})()`;
    interface Selection {
      focus: string | null;
      selected: string[];
      drawn: boolean;
      active: string | null;
    }
    const selection = async () =>
      JSON.parse(await obEval(vaultId, readSelection)) as Selection;
    /** Click the card at one place, as a pointer does. */
    const clickAt = (place: string) =>
      obEval(
        vaultId,
        `(()=>{${PAGE}const card=[...${tab}.contentEl.querySelectorAll('.zt-annot-card')].find(n=>n.getAttribute('data-card-place')===${JSON.stringify(place)});press(card,'card '+${JSON.stringify(place)});card.focus();return true;})()`,
      );
    /**
     * One key as Obsidian delivers it: through the view's own Scope, with the
     * focused card as the event's target.
     * @returns whether the view handled it.
     */
    const press = async (key: "ArrowDown" | "ArrowUp" | "Delete") =>
      (await obEval(
        vaultId,
        `(()=>{const view=${tab};const el=view.contentEl;const active=el.ownerDocument.activeElement;const target=active&&el.contains(active)?active:el.querySelector('[role="grid"]');const event=new KeyboardEvent('keydown',{key:${JSON.stringify(key)},code:${JSON.stringify(key)},bubbles:true,cancelable:true});Object.defineProperty(event,'target',{value:target});return String(view.scope.handleKey(event,{modifiers:'',key:${JSON.stringify(key)},vkey:${JSON.stringify(key)}})===false);})()`,
      )) === "true";
    /** The card at a place, selected alone, drawn, and holding the focus. */
    const on = (place: string, key: string): Selection => ({
      focus: place,
      selected: [key],
      drawn: true,
      active: place,
    });

    // Grouped by colour, with the second group collapsed, ↓ from the last
    // card of the first group lands on the first card of the third: the
    // cards of a collapsed group are not drawn, so the keys pass them.
    const colours = await open(
      colourPath,
      "views:\n  - type: annotations\n    name: Colours\n    from: annotations\n    limit: 100\n    groupBy:\n      property: colorName\n      direction: ASC\n",
      (shown) => shown.headings.length > 2 && shown.cards.length > 3,
    );
    const [first, second, third] = colours.headings;
    const inGroup = (shown: Shown, group: string) =>
      shown.cards.filter((card) => card.place.startsWith(`${group}\n`));
    const secondCards = inGroup(colours, second!.key);
    await obEval(
      vaultId,
      `(()=>{${PAGE}press(${tab}.contentEl.querySelector('[data-query-group=${JSON.stringify(second!.key)}] button'),'group heading');return true;})()`,
    );
    const folded = await shownWhen(
      colourPath,
      (shown) =>
        shown.headings.find((heading) => heading.key === second!.key)!
          .collapsed,
    );
    const lastOfFirst = inGroup(folded, first!.key).at(-1)!;
    const firstOfThird = inGroup(folded, third!.key)[0]!;
    await clickAt(lastOfFirst.place);
    expect(await press("ArrowDown")).toBe(true);
    expect(await selection()).toEqual(on(firstOfThird.place, firstOfThird.key));
    expect(await press("ArrowUp")).toBe(true);
    expect(await selection()).toEqual(on(lastOfFirst.place, lastOfFirst.key));

    // A collapse that folds the Selected Card away drops it, so a Delete
    // that follows acts on no hidden Annotation.
    const toggleSecond = `(()=>{${PAGE}press(${tab}.contentEl.querySelector('[data-query-group=${JSON.stringify(second!.key)}] button'),'group heading');return true;})()`;
    await obEval(vaultId, toggleSecond);
    await shownWhen(colourPath, (shown) =>
      shown.cards.some((card) => card.place === secondCards[0]!.place),
    );
    await clickAt(secondCards[0]!.place);
    expect((await selection()).selected).toEqual([secondCards[0]!.key]);
    await obEval(vaultId, toggleSecond);
    await shownWhen(
      colourPath,
      (shown) =>
        shown.headings.find((heading) => heading.key === second!.key)!
          .collapsed,
    );
    expect((await selection()).selected).toEqual([]);
    expect(await press("Delete")).toBe(false);

    // Grouped by tag, a card with two tags shows under both headings. ↓ and
    // ↑ reach it at each place and step on from the place it holds.
    const tags = await open(
      tagPath,
      "views:\n  - type: annotations\n    name: Tags\n    from: annotations\n    limit: 100\n    groupBy:\n      property: tags[]\n      direction: ASC\n",
      (shown) =>
        shown.headings.length > 1 &&
        shown.cards.some(
          (card, index) =>
            shown.cards.findIndex((other) => other.key === card.key) < index,
        ),
    );
    const twice = tags.cards.findIndex(
      (card, index) =>
        index < tags.cards.length - 1 &&
        tags.cards.findIndex((other) => other.key === card.key) < index,
    );
    expect(twice).toBeGreaterThan(0);
    const [before, at, after] = tags.cards.slice(twice - 1, twice + 2);
    await clickAt(at!.place);
    expect(await press("ArrowDown")).toBe(true);
    expect(await selection()).toEqual(on(after!.place, after!.key));
    expect(await press("ArrowUp")).toBe(true);
    expect(await selection()).toEqual(on(at!.place, at!.key));
    expect(await press("ArrowUp")).toBe(true);
    expect(await selection()).toEqual(on(before!.place, before!.key));

    // From the first card, ↓ walks every card in the order drawn.
    await clickAt(tags.cards[0]!.place);
    const walk = [tags.cards[0]!.place];
    while (await press("ArrowDown")) walk.push((await selection()).focus!);
    expect(walk).toEqual(tags.cards.map((card) => card.place));
  }, 300000);

  it("embeds a Query File in two notes, and a change in one embed saves the file and updates the other", async () => {
    const queryPath = "query-files/Lab annotations.zotquery";
    const labNote = `literatures/${annotationItem.literatureNoteName ?? annotationItem.key}.md`;
    const overview = "query-files/Lab overview.md";
    const layout = await obEval(
      vaultId,
      "JSON.stringify(app.workspace.getLayout())",
    );
    const original = await obEval(
      vaultId,
      `app.vault.read(app.vault.getFileByPath(${JSON.stringify(queryPath)}))`,
    );
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await obEval(
        vaultId,
        `(async()=>{await app.workspace.changeLayout(JSON.parse(${JSON.stringify(layout)}));await app.vault.modify(app.vault.getFileByPath(${JSON.stringify(queryPath)}),${JSON.stringify(original)});return true;})()`,
      );
    });

    // The Literature Note in Reading view, the overview in Live Preview, and the
    // Query File in its own tab, each in a pane of its own so all render.
    await obEval(
      vaultId,
      `(async()=>{const open=async(path,state)=>{const leaf=app.workspace.getLeaf('split');await leaf.setViewState({type:state?'markdown':'zotlit-query-file',state:{file:path,...state},active:true});};await open(${JSON.stringify(labNote)},{mode:'preview'});await open(${JSON.stringify(overview)},{mode:'source',source:false});await open(${JSON.stringify(queryPath)});return true;})()`,
    );

    /** What each pane shows of the Query File, once every query settled. */
    const readPanes = `(async()=>{${PAGE}const out={};const show=async(el,query)=>{await query.settled;return {view:el.querySelector('[data-query-view-menu]')?.textContent??null,count:el.querySelector('[data-query-count]')?.getAttribute('data-query-count')??null,cards:[...el.querySelectorAll('.zt-annot-card')].map(n=>n.getAttribute('data-zotero-annotation-key'))};};for(const leaf of app.workspace.getLeavesOfType('markdown')){if(leaf.view.getMode()==='preview'){const line=leaf.view.data.split('\\n').findIndex(text=>text.startsWith('![['));leaf.view.setEphemeralState({scroll:line});await until('embed renders',()=>[...leaf.view.containerEl.querySelectorAll('.internal-embed')].some(el=>el.zotlitQueryView&&el.isShown()));}if(leaf.view.getMode()==='source'){const line=leaf.view.editor.getValue().split('\\n').findIndex(text=>text.startsWith('![['));leaf.view.editor.scrollIntoView({from:{line,ch:0},to:{line,ch:0}});await until('embed renders',()=>[...leaf.view.containerEl.querySelectorAll('.internal-embed')].some(el=>el.zotlitQueryView&&el.isShown()));}const embeds=[...leaf.view.containerEl.querySelectorAll('.internal-embed')].filter(el=>el.zotlitQueryView&&el.isShown());out[leaf.view.file.path]=await Promise.all(embeds.map(async el=>({...await show(el,el.zotlitQueryView),interactive:el.classList.contains('interactive-child')})));}for(const leaf of app.workspace.getLeavesOfType('zotlit-query-file'))out.tab=await show(leaf.view.contentEl,leaf.view.query);return JSON.stringify(out);})()`;
    interface Pane {
      view: string | null;
      count: string | null;
      cards: string[];
      interactive?: boolean;
    }
    type Panes = Record<string, Pane[]> & { tab?: Pane };
    const panesWhen = async (ready: (panes: Panes) => boolean) => {
      let panes: Panes | null = null;
      const settled = await waitFor(async () => {
        panes = JSON.parse(await obEval(vaultId, readPanes)) as Panes;
        return ready(panes);
      }, 120);
      if (!settled)
        throw new Error(`Query File panes: ${JSON.stringify(panes)}`);
      return panes!;
    };
    /** The Annotation rows ZotLit Query gives, through the CLI. */
    const queryRows = async (filter: string | null, thisItem?: string) => {
      const report = JSON.parse(
        await cliCommand(vaultId, "zotlit:query", {
          args: {
            from: "annotations",
            fields: "item.title",
            limit: "100",
            ...(filter === null ? {} : { filter }),
            ...(thisItem === undefined ? {} : { "this-item": thisItem }),
          },
        }),
      ) as ItemQueryReport;
      expect(report.ok).toBe(true);
      return report.rows!;
    };
    const queryKeys = async (filter: string | null, thisItem?: string) =>
      (await queryRows(filter, thisItem)).map((row) => row.indexedKey);

    // `![[file#View]]` shows that view, with `this.item` the note's Item;
    // `![[file]]` shows the first view, grouped by Item.
    const mine = await queryKeys("item == this.item", annotationItem.key);
    const all = byItem(await queryRows(null)).cards;
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.length).toBeLessThan(all.length);
    const before = await panesWhen(
      (panes) =>
        panes[labNote]?.[0]?.count != null &&
        panes[overview]?.[0]?.count != null &&
        panes.tab?.count != null,
    );
    expect(before[labNote]).toEqual([
      {
        view: "This item",
        count: String(mine.length),
        cards: mine,
        interactive: true,
      },
    ]);
    expect(before[overview]).toEqual([
      {
        view: "All annotations",
        count: String(all.length),
        cards: all,
        interactive: true,
      },
    ]);

    // A filter for all views, set in the Literature Note's embed, saves to the file;
    // the overview's embed and the open tab show it.
    const figure = 'tags.contains("figure")';
    await obEval(
      vaultId,
      `(async()=>{${PAGE}const leaf=app.workspace.getLeavesOfType('markdown').find(l=>l.view.file.path===${JSON.stringify(labNote)});const el=[...leaf.view.containerEl.querySelectorAll('.internal-embed')].find(el=>el.zotlitQueryView&&el.isShown());press(el.querySelector('[data-query-toolbar="filter"]'),'Filter');const all=()=>el.querySelector('[data-query-popover="filter"] [data-filter-section="all"] [data-condition-row]');const set=(control,value)=>{control.value=value;control.dispatchEvent(new Event('input',{bubbles:true}));};const fold=el.querySelector('[data-query-popover="filter"] [data-filter-section="all"] details');if(!fold.open)press(fold.querySelector('summary'),'All views heading');await until('placeholder row',all);await pick(all().querySelector('button[aria-label="${m.workbench_match_condition_kind()}"]'),'tags','Condition type');set(await until('tag value field',()=>all().querySelector('input[aria-label="${m.workbench_filter_value()}"]')),'figure');el.querySelector('[data-query-popover="filter"]').hidePopover();return true;})()`,
    );
    const figures = byItem(await queryRows(figure)).cards;
    const myFigures = await queryKeys(
      `(${figure}) && (item == this.item)`,
      annotationItem.key,
    );
    expect(figures.length).toBeLessThan(all.length);
    const after = await panesWhen(
      (panes) =>
        panes[overview]?.[0]?.count === String(figures.length) &&
        panes.tab?.count === String(figures.length) &&
        panes[labNote]?.[0]?.cards.length === myFigures.length,
    );
    expect(
      await obEval(
        vaultId,
        `app.vault.read(app.vault.getFileByPath(${JSON.stringify(queryPath)}))`,
      ),
    ).toMatch(/^filters:\n {2}and:\n {4}- tags\.contains\("figure"\)$/m);
    expect(after[overview]![0]!.cards).toEqual(figures);
    expect(after.tab!.cards).toEqual(figures);
    expect(after[labNote]![0]!.cards).toEqual(myFigures);

    // The count in each pane opens that pane's own Results menu.
    const results = JSON.parse(
      await obEval(
        vaultId,
        `(async()=>{${PAGE}const views=[...app.workspace.getLeavesOfType('markdown').flatMap(l=>[...l.view.containerEl.querySelectorAll('.internal-embed')].filter(el=>el.zotlitQueryView&&el.isShown())),...app.workspace.getLeavesOfType('zotlit-query-file').map(l=>l.view.contentEl)];const out=[];for(const el of views){press(el.querySelector('[data-query-results]'),'Results');const popup=el.querySelector('[data-query-results-popup]');out.push(await until('Results opens',()=>popup.matches(':popover-open'),1000).catch(()=>false));activeDocument.querySelectorAll(':popover-open').forEach(p=>p.hidePopover());}return JSON.stringify(out);})()`,
      ),
    ) as boolean[];
    expect(results).toEqual([true, true, true]);

    // A click in the Live Preview embed leaves the editor's selection alone.
    // The 400 ms after the click is the window an absent selection change is
    // checked over; no event marks "nothing happened".
    const selection = JSON.parse(
      await obEval(
        vaultId,
        `(async()=>{const leaf=app.workspace.getLeavesOfType('markdown').find(l=>l.view.file.path===${JSON.stringify(overview)});app.workspace.setActiveLeaf(leaf,{focus:true});const cm=leaf.view.editor.cm;cm.dispatch({selection:{anchor:0}});const target=[...leaf.view.containerEl.querySelectorAll('.internal-embed')].find(el=>el.zotlitQueryView&&el.isShown()).querySelector('[role=toolbar]');const rect=target.getBoundingClientRect();const init={bubbles:true,cancelable:true,clientX:rect.left+rect.width/2,clientY:rect.top+rect.height/2,button:0,detail:1};target.dispatchEvent(new MouseEvent('mousedown',init));target.dispatchEvent(new MouseEvent('mouseup',init));target.dispatchEvent(new MouseEvent('click',init));await new Promise(r=>setTimeout(r,400));const {from,to}=cm.state.selection.main;return JSON.stringify({from,to});})()`,
      ),
    ) as { from: number; to: number };
    expect(selection).toEqual({ from: 0, to: 0 });

    // A hover popover over a link to the file shows the embed's first view.
    const popover = JSON.parse(
      await obEval(
        vaultId,
        `(async()=>{${PAGE}const leaf=app.workspace.getLeavesOfType('markdown').find(l=>l.view.file.path===${JSON.stringify(labNote)});const targetEl=leaf.view.containerEl.querySelector('.markdown-reading-view h1')??leaf.view.containerEl;const rect=targetEl.getBoundingClientRect();app.workspace.trigger('hover-link',{event:new MouseEvent('mouseover',{clientX:rect.left+5,clientY:rect.top+5,ctrlKey:true,metaKey:true}),source:'preview',hoverParent:leaf.view,targetEl,linktext:${JSON.stringify(queryPath)},sourcePath:${JSON.stringify(labNote)}});const el=await until('hover popover',()=>[...activeDocument.querySelectorAll('.hover-popover .internal-embed, .hover-popover .zt-query-view')].find(el=>el.zotlitQueryView),10000).catch(()=>null);if(!el)return 'null';await el.zotlitQueryView.settled;const out={view:el.querySelector('[data-query-view-menu]')?.textContent??null,count:el.querySelector('[data-query-count]')?.getAttribute('data-query-count')??null};const popover=leaf.view.hoverPopover;if(popover)typeof popover.hide==='function'?popover.hide():popover.unload();await until('hover popover closes',()=>!leaf.view.containerEl.doc.querySelector('.hover-popover'),5000);return JSON.stringify(out);})()`,
      ),
    ) as { view: string | null; count: string | null } | null;
    expect(popover).toEqual({
      view: "All annotations",
      count: String(figures.length),
    });

    // The link button opens the Query File at the view the embed shows.
    await obEval(
      vaultId,
      `(()=>{${PAGE}const leaf=app.workspace.getLeavesOfType('markdown').find(l=>l.view.file.path===${JSON.stringify(labNote)});app.workspace.setActiveLeaf(leaf,{focus:true});press([...leaf.view.containerEl.querySelectorAll('.internal-embed')].find(el=>el.zotlitQueryView&&el.isShown()).querySelector('[data-query-open-file]'),'Open query file');return true;})()`,
    );
    expect(
      await waitFor(async () => {
        const state = JSON.parse(
          await obEval(
            vaultId,
            "JSON.stringify(app.workspace.getMostRecentLeaf().getViewState())",
          ),
        ) as { type: string; state: { file?: string; view?: string } };
        return (
          state.type === "zotlit-query-file" &&
          state.state.file === queryPath &&
          state.state.view === "This item"
        );
      }, 30),
    ).toBe(true);
  }, 180000);

  // Each Query View is a Preact root of its own; the ids its labels point
  // to must still be unique in the window.
  it("focuses the limit field of the second of two embeds of one Query File when its label is selected", async () => {
    const queryPath = "query-files/Lab annotations.zotquery";
    const notePath = "query-files/Two embeds.md";
    const layout = await obEval(
      vaultId,
      "JSON.stringify(app.workspace.getLayout())",
    );
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await obEval(
        vaultId,
        `(async()=>{await app.workspace.changeLayout(JSON.parse(${JSON.stringify(layout)}));const file=app.vault.getFileByPath(${JSON.stringify(notePath)});if(file)await app.vault.delete(file);return true;})()`,
      );
    });

    await obEval(
      vaultId,
      `(async()=>{await app.vault.create(${JSON.stringify(notePath)},${JSON.stringify(
        `![[${queryPath}]]\n\n![[${queryPath}]]\n`,
      )});const leaf=app.workspace.getLeaf('tab');await leaf.setViewState({type:'markdown',state:{file:${JSON.stringify(notePath)},mode:'preview'},active:true});return true;})()`,
    );
    /** The embeds of the Query File in the note, once each query settled. */
    const embeds = `const leaf=app.workspace.getLeavesOfType('markdown').find(l=>l.view.file?.path===${JSON.stringify(notePath)});const views=[...leaf.view.containerEl.querySelectorAll('.internal-embed')].filter(el=>el.zotlitQueryView&&el.isShown());for(const el of views)await el.zotlitQueryView.settled;`;
    expect(
      await waitFor(
        async () =>
          (await obEval(
            vaultId,
            `(async()=>{${embeds}return views.length===2&&views.every(el=>el.querySelector('[data-query-count]')?.getAttribute('data-query-count'))?'ready':'no';})()`,
          )) === "ready",
        120,
      ),
    ).toBe(true);

    // The second embed's Results menu opens with its limit field focused;
    // focus leaves it, and its label brings it back.
    const focus = JSON.parse(
      await obEval(
        vaultId,
        `(async()=>{${PAGE}${embeds}const el=views[1];press(el.querySelector('[data-query-results]'),'Results');const popup=el.querySelector('[data-query-results-popup]');const field=await until('limit field',()=>popup.querySelector('[data-query-limit]'));const label=popup.querySelector('label');field.blur();const blurred=activeDocument.activeElement!==field;press(label,'limit label');await until('label focuses the limit field',()=>activeDocument.activeElement===field);const out={blurred,sameId:label.htmlFor===field.id,unique:activeDocument.querySelectorAll('#'+CSS.escape(field.id)).length===1,focused:activeDocument.activeElement===field};activeDocument.querySelectorAll(':popover-open').forEach(p=>p.hidePopover());return JSON.stringify(out);})()`,
      ),
    ) as Record<string, boolean>;
    expect(focus).toEqual({
      blurred: true,
      sameId: true,
      unique: true,
      focused: true,
    });
  }, 180000);

  it("chooses two properties in a Query File view, limits it, and exports those columns as CSV", async () => {
    const layout = await obEval(
      vaultId,
      "JSON.stringify(app.workspace.getLayout())",
    );
    const path = "query-files/Shared figures.zotquery";
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await obEval(
        vaultId,
        `(async()=>{await app.workspace.changeLayout(JSON.parse(${JSON.stringify(layout)}));const file=app.vault.getFileByPath(${JSON.stringify(path)});if(file)await app.vault.delete(file);return true;})()`,
      );
    });
    const filter = 'tags.contains("figure")';
    await obEval(
      vaultId,
      `(async()=>{const file=await app.vault.create(${JSON.stringify(path)},${JSON.stringify(`views:\n  - type: annotations\n    name: Shared figures\n    from: annotations\n    filters: ${filter}\n    limit: 100\n`)});const leaf=app.workspace.getLeaf('tab');await leaf.openFile(file);app.workspace.setActiveLeaf(leaf,{focus:true});return true;})()`,
    );
    /** What the tab shows once its query settled, and the file's saved text. */
    const readTab = `(async()=>{const view=app.workspace.getMostRecentLeaf().view;if(view.getViewType()!=='zotlit-query-file'||view.file?.path!==${JSON.stringify(path)})return 'null';await view.query.settled;await view.save();const el=view.contentEl;return JSON.stringify({count:el.querySelector('[data-query-count]')?.getAttribute('data-query-count')??null,matched:el.querySelector('[data-query-count]')?.getAttribute('data-query-matched')??null,countText:el.querySelector('[data-query-count]')?.textContent??null,cards:el.querySelectorAll('.zt-annot-card').length,text:await app.vault.read(view.file)});})()`;
    interface Tab {
      count: string | null;
      matched: string | null;
      countText: string | null;
      cards: number;
      text: string;
    }
    const tabWhen = async (ready: (tab: Tab) => boolean): Promise<Tab> => {
      let tab: Tab | null = null;
      const settled = await waitFor(async () => {
        tab = JSON.parse(await obEval(vaultId, readTab)) as Tab | null;
        return tab !== null && ready(tab);
      }, 120);
      if (!settled) throw new Error(`Query File tab: ${JSON.stringify(tab)}`);
      return tab!;
    };
    const queryRows = async (fields: string, limit: string) => {
      const report = JSON.parse(
        await cliCommand(vaultId, "zotlit:query", {
          args: { from: "annotations", filter, fields, limit },
        }),
      ) as ItemQueryReport;
      expect(report.ok).toBe(true);
      return report.rows!;
    };
    const figures = await queryRows("pageLabel", "100");
    expect(figures.length).toBeGreaterThan(2);
    await tabWhen((tab) => tab.count === String(figures.length));

    // The view has no order: the Properties popover ticks the default
    // properties the cards show, at the top of the list. "Hide all" clears
    // them; tick "pageLabel", then "colorName": the order of the ticks is the
    // order of the columns, and it saves.
    /** The default fields of the annotations dataset that give one cell each. */
    const defaultProperties = [
      "type",
      "text",
      "comment",
      "color",
      "colorName",
      "pageLabel",
      "pageIndex",
      "tags",
      "dateAdded",
      "dateModified",
      "hasExcerptImage",
      "item.title",
      "item.citationKey",
    ];
    const ticked = JSON.parse(
      await obEval(
        vaultId,
        `(async()=>{${PAGE}const el=app.workspace.getMostRecentLeaf().view.contentEl;press(el.querySelector('[data-query-properties]'),'Properties');const popup=()=>activeDocument.querySelector('[data-query-properties-popup]');const rows=()=>[...popup().querySelectorAll('[data-query-property]')];const selected=()=>rows().filter(n=>n.getAttribute('aria-selected')==='true').map(n=>n.dataset.queryProperty);await until('Properties popover opens',()=>popup()?.matches(':popover-open')&&rows().length>0);const defaults=selected();const leading=rows().slice(0,defaults.length).map(n=>n.dataset.queryProperty);press(popup().querySelector('[data-query-properties-action="hide-all"]'),'Hide all');await until('Hide all clears the ticks',()=>selected().length===0);const paths=()=>rows().map(n=>n.dataset.queryProperty);const untouched=paths();for(const name of ['pageLabel','colorName']){press(popup().querySelector('[data-query-property="'+name+'"]'),'property '+name);await until('ticks '+name,()=>selected().includes(name));}const kept=paths();popup().hidePopover();await until('Properties popover closes',()=>!popup()?.matches(':popover-open'));press(el.querySelector('[data-query-properties]'),'Properties');await until('Properties popover opens again',()=>popup()?.matches(':popover-open')&&rows().length>0);const shown=rows().slice(0,3).map(n=>[n.dataset.queryProperty,n.getAttribute('aria-selected')]);popup().hidePopover();return JSON.stringify({defaults,leading,untouched,kept,shown});})()`,
      ),
    ) as {
      defaults: string[];
      leading: string[];
      untouched: string[];
      kept: string[];
      shown: [string, string][];
    };
    expect(ticked.defaults).toEqual(defaultProperties);
    expect(ticked.leading).toEqual(defaultProperties);
    // A tick leaves every row in place, as in Bases; the popover sorts the
    // visible properties first when it opens again.
    expect(ticked.kept).toEqual(ticked.untouched);
    expect(ticked.shown.slice(0, 2)).toEqual([
      ["pageLabel", "true"],
      ["colorName", "true"],
    ]);
    expect(ticked.shown[2]?.[1]).toBe("false");
    const ordered = await tabWhen((tab) =>
      tab.text.includes("order:\n      - pageLabel\n      - colorName\n"),
    );
    expect(ordered.count).toBe(String(figures.length));

    // A limit of 2 from the Results menu saves to the file; the count still
    // names every match.
    await obEval(
      vaultId,
      `(async()=>{${PAGE}const el=app.workspace.getMostRecentLeaf().view.contentEl;press(el.querySelector('[data-query-results]'),'Results');const input=await until('limit field',()=>activeDocument.querySelector('[data-query-results-popup]:popover-open [data-query-limit]'));input.value='2';input.dispatchEvent(new Event('input',{bubbles:true}));return true;})()`,
    );
    const limited = await tabWhen(
      (tab) => tab.text.includes("limit: 2\n") && tab.cards === 2,
    );
    expect(limited).toMatchObject({
      count: "2",
      matched: String(figures.length),
      countText: `2 of ${figures.length} results`,
    });

    // "Export CSV…" writes the rows on screen with the two columns in the
    // order they were ticked.
    const exported = JSON.parse(
      await obEval(
        vaultId,
        `(async()=>{${PAGE}const create=URL.createObjectURL;const click=HTMLAnchorElement.prototype.click;let blob=null,name=null;URL.createObjectURL=b=>{blob=b;return create.call(URL,b);};HTMLAnchorElement.prototype.click=function(){name=this.download;};try{press(activeDocument.querySelector('[data-query-results-popup] [data-query-export]'),'Export CSV');}finally{URL.createObjectURL=create;HTMLAnchorElement.prototype.click=click;}return JSON.stringify({name,type:blob?.type??null,text:blob?new TextDecoder('utf-8',{ignoreBOM:true}).decode(await blob.arrayBuffer()):null});})()`,
      ),
    ) as { name: string | null; type: string | null; text: string | null };
    const rows = await queryRows("pageLabel,colorName", "2");
    const cell = (value: unknown) => {
      const text = value === null || value === undefined ? "" : String(value);
      return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
    };
    expect(exported).toEqual({
      name: "Shared figures.csv",
      type: "text/csv",
      // A byte order mark first, so a spreadsheet reads UTF-8; CRLF after each line.
      text:
        BYTE_ORDER_MARK +
        [
          // The header names a property by its label where it has one.
          `pageLabel,${m.query_view_property_color()}`,
          ...rows.map(
            (row) =>
              `${cell(row.values.pageLabel)},${cell(row.values.colorName)}`,
          ),
        ]
          .map((line) => `${line}\r\n`)
          .join(""),
    });
    expect(rows.every((row) => row.values.colorName)).toBe(true);
  }, 180000);

  /** The open popover of the Query View toolbar that `selector` names. */
  const toolbarPopup = (selector: string) =>
    `activeDocument.querySelector(${JSON.stringify(`${selector}:popover-open`)})`;
  /**
   * Opens a toolbar popover of the view that `tab` names, and waits until it
   * shows the element that `ready` names.
   */
  async function openToolbarPopup(
    tab: string,
    { button, popup, ready }: { button: string; popup: string; ready: string },
  ): Promise<void> {
    // The poll clicks the button while the popover is closed, so a view that
    // is not on screen yet gets the click once it is.
    expect(
      await obEvalUntil(
        vaultId,
        `(()=>{${PAGE}const popup=${toolbarPopup(popup)};if(popup?.querySelector(${JSON.stringify(ready)}))return 'true';if(!popup)press(${tab}?.contentEl?.querySelector(${JSON.stringify(button)}),${JSON.stringify(button)});return 'false';})()`,
        { expected: "true" },
      ),
    ).toBe(true);
  }
  /** The open Properties popover. */
  const propertiesPopup = toolbarPopup("[data-query-properties-popup]");
  /** Opens the Properties popover and waits for its property rows. */
  const openProperties = (tab: string) =>
    openToolbarPopup(tab, {
      button: "[data-query-properties]",
      popup: "[data-query-properties-popup]",
      ready: "[data-query-property]",
    });
  /** The page open in the Properties popover. */
  const propertiesPage = `${propertiesPopup}?.querySelector('[data-chooser-page]')`;
  /**
   * Opens the page of a property's row in the open Properties popover: its
   * chevron opens it, as a reader presses it.
   */
  const openPropertyPage = (property: string) =>
    obEval(
      vaultId,
      `(async()=>{${PAGE}const popup=${propertiesPopup};press(popup.querySelector('[data-query-property-more="${property}"]'),'page of property '+${JSON.stringify(property)});await until('page of property '+${JSON.stringify(property)},()=>popup.querySelector('[data-query-property-page="${property}"]'));return true;})()`,
    );
  /** Runs an item of the "…" menu of the open property page. */
  const runPageMenuItem = (hook: string) =>
    obEval(
      vaultId,
      `(async()=>{${PAGE}const page=${propertiesPage};press(page.querySelector('[data-chooser-page-menu]'),'More options');const item=await until('menu item '+${JSON.stringify(hook)},()=>page.querySelector('[role="menu"]:popover-open [data-chooser-page-menu-item="${hook}"]'));press(item,'menu item '+${JSON.stringify(hook)});return true;})()`,
    );
  /** Closes the open Properties popover from its page's close button. */
  const closePropertyPage = () =>
    obEval(
      vaultId,
      `(()=>{${PAGE}press(${propertiesPage}.querySelector('[data-chooser-page-close]'),'Close');return true;})()`,
    );
  /** Opens the results popover and waits for its "Export CSV…" action. */
  const openResults = (tab: string) =>
    openToolbarPopup(tab, {
      button: "[data-query-results]",
      popup: "[data-query-results-popup]",
      ready: "[data-query-export]",
    });

  it("adds a Formula Property from the Properties popover, edits it, marks a wrong one at its row, and removes it, and an embed and a Query Block show its column", async () => {
    const path = "query-files/Formula items.zotquery";
    const notePath = "query-files/Formula note.md";
    const layout = await obEval(
      vaultId,
      "JSON.stringify(app.workspace.getLayout())",
    );
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      // Teardown closes a popover a failed step left open; not a reader's press.
      await obEval(
        vaultId,
        `(async()=>{for(const popup of activeDocument.querySelectorAll('[popover]:popover-open'))popup.hidePopover();await app.workspace.changeLayout(JSON.parse(${JSON.stringify(layout)}));for(const path of ${JSON.stringify([path, notePath])}){const file=app.vault.getFileByPath(path);if(file)await app.vault.delete(file);}return true;})()`,
      );
    });
    const source = `views:\n  - type: table\n    name: Items\n    from: items\n    order:\n      - title\n    limit: 5\n`;
    await obEval(
      vaultId,
      `(async()=>{const file=await app.vault.create(${JSON.stringify(path)},${JSON.stringify(source)});const leaf=app.workspace.getLeaf('tab');await leaf.openFile(file);app.workspace.setActiveLeaf(leaf,{focus:true});return true;})()`,
    );
    const tab = "app.workspace.getMostRecentLeaf().view";
    /** What the tab shows once its query settled, and the file's saved text. */
    const readTab = `(async()=>{const view=${tab};if(view.getViewType()!=='zotlit-query-file'||view.file?.path!==${JSON.stringify(path)})return 'null';await view.query.settled;await view.save();const el=view.contentEl;const columns=[...el.querySelectorAll('[data-query-table] thead th')].map(n=>n.getAttribute('data-query-column'));return JSON.stringify({columns,headerIssue:el.querySelector('[data-query-table] thead [data-query-formula-issue]')?.getAttribute('data-query-formula-issue')??null,rows:[...el.querySelectorAll('[data-query-table-row="item"]')].map(tr=>[tr.getAttribute('data-query-key'),...[...tr.children].map(td=>td.textContent)]),list:[...el.querySelectorAll('[data-query-layout="list"] [data-query-row]')].map(li=>[li.getAttribute('data-query-row'),li.textContent]),text:await app.vault.read(view.file)});})()`;
    interface Tab {
      columns: (string | null)[];
      headerIssue: string | null;
      /** Each Item row: its key, then the text of each cell. */
      rows: string[][];
      list: [string, string][];
      text: string;
    }
    const tabWhen = async (ready: (tab: Tab) => boolean): Promise<Tab> => {
      let tab: Tab | null = null;
      const settled = await waitFor(async () => {
        tab = JSON.parse(await obEval(vaultId, readTab)) as Tab | null;
        return tab !== null && ready(tab);
      }, 120);
      if (!settled) throw new Error(`Query File tab: ${JSON.stringify(tab)}`);
      return tab!;
    };
    /** The value of each row's Formula, as ZotLit Query gives it. */
    const formulaValues = async (expression: string) => {
      const report = JSON.parse(
        await cliCommand(vaultId, "zotlit:query", {
          args: {
            from: "items",
            formulas: JSON.stringify({ year: expression }),
            fields: "title,formula.year",
            limit: "5",
          },
        }),
      ) as ItemQueryReport;
      expect(report.ok).toBe(true);
      return report.rows!.map((row) => [
        row.indexedKey,
        row.values["formula.year"] === null
          ? ""
          : String(row.values["formula.year"]),
      ]);
    };
    /** The key and the cell of one column of each Table row. */
    const column = (shown: Tab, property: string) => {
      // The first cell is the expander.
      const at = shown.columns.indexOf(property);
      return shown.rows.map((row) => [row[0], row[at + 1]]);
    };
    const shown = await tabWhen((tab) => tab.rows.length > 0);
    expect(shown.columns).toEqual([null, "title"]);

    // "Add formula" in the Properties popover opens its page.
    await openProperties(tab);
    await obEval(
      vaultId,
      `(()=>{${PAGE}press([...${propertiesPopup}.querySelectorAll('[role="option"]')].find(n=>n.textContent===${JSON.stringify(m.query_view_formula_add())}),'Add formula');return true;})()`,
    );
    /**
     * Types into the formula's page, and reads what it says about the text.
     * The page draws the text in a microtask after the input event, so the
     * read in the next call sees it. A Formula's own page saves as it goes:
     * it has no Save button, and reads `save: null`.
     */
    const typeFormula = async (fields: {
      name?: string;
      expression: string;
    }) => {
      await obEval(
        vaultId,
        `(()=>{const page=${propertiesPage};const set=(el,value)=>{el.value=value;el.dispatchEvent(new InputEvent('input',{bubbles:true}));};${fields.name === undefined ? "" : `set(page.querySelector('[data-query-formula-name]'),${JSON.stringify(fields.name)});`}const view=page.querySelector('[data-query-formula-expression] .cm-content').cmTile.root.view;view.dispatch({changes:{from:0,to:view.state.doc.length,insert:${JSON.stringify(fields.expression)}},userEvent:'input.type'});return true;})()`,
      );
      return JSON.parse(
        await obEval(
          vaultId,
          `(()=>{const page=${propertiesPage};const save=page.querySelector('[data-query-formula-save]');return JSON.stringify({syntax:page.querySelector('[data-query-formula-syntax]')?.getAttribute('data-query-formula-syntax')??null,save:save?!save.disabled:null});})()`,
        ),
      ) as { syntax: string; save: boolean | null };
    };
    /**
     * Saves the formula's page: "Add formula" by its Save button, which
     * turns the page into the Formula's own; then the close button, which
     * saves the text of a Formula's own page as the popover closes.
     */
    const saveFormula = () =>
      obEval(
        vaultId,
        `(async()=>{${PAGE}const popup=${propertiesPopup};const save=popup.querySelector('[data-chooser-page] [data-query-formula-save]');if(save){press(save,'Save');await until('page of the Formula',()=>popup.querySelector('[data-query-property-page]'));}press(popup.querySelector('[data-chooser-page-close]'),'Close');return true;})()`,
      );
    expect(
      await obEvalUntil(vaultId, `String(!!${propertiesPage})`, {
        expected: "true",
      }),
    ).toBe(true);
    // The Formula field looks and focuses as the text input above it: the
    // same border, radius, fill and focus ring, its text at the same inset,
    // and no focus outline of the editor's own.
    interface InputLook {
      border: string;
      radius: string;
      fill: string;
      ring: string;
    }
    const fieldLook = JSON.parse(
      await obEval(
        vaultId,
        `(async()=>{${PAGE}
          const page=${propertiesPage};
          const input=page.querySelector('[data-query-formula-name]');
          const field=page.querySelector('[data-query-formula-expression]');
          const editor=field.querySelector('.cm-editor');
          const line=field.querySelector('.cm-line');
          // The box and focus ring that show: the shadows that have a spread.
          const ringOf=(shadow)=>shadow.split(/,\\s*(?![^(]*\\))/).filter((one)=>!one.endsWith('0px 0px 0px 0px')).join(', ');
          const look=(el)=>{const c=getComputedStyle(el);return {border:[c.borderTopWidth,c.borderTopStyle,c.borderTopColor].join(' '),radius:c.borderTopLeftRadius,fill:c.backgroundColor,ring:ringOf(c.boxShadow)};};
          const inputStyle=getComputedStyle(input);
          const inset={
            input:parseFloat(inputStyle.borderLeftWidth)+parseFloat(inputStyle.paddingLeft),
            field:line.getBoundingClientRect().left+parseFloat(getComputedStyle(line).paddingLeft)-field.getBoundingClientRect().left,
          };
          // The page focuses the Name input when it opens; rest is the look with no focus.
          activeDocument.activeElement?.blur();
          await until('no focus on the page',()=>!editor.classList.contains('cm-focused')&&activeDocument.activeElement!==input);
          const rest={input:look(input),field:look(field)};
          input.focus();
          await until('focus on the Name input',()=>activeDocument.activeElement===input);
          const inputFocused=look(input);
          field.querySelector('.cm-content').focus();
          await until('focus in the Formula field',()=>editor.classList.contains('cm-focused'));
          return JSON.stringify({rest,focused:{input:inputFocused,field:look(field)},inset,editor:{focused:editor.classList.contains('cm-focused'),outline:getComputedStyle(editor).outlineStyle}});
        })()`,
      ),
    ) as {
      rest: { input: InputLook; field: InputLook };
      focused: { input: InputLook; field: InputLook };
      inset: { input: number; field: number };
      editor: { focused: boolean; outline: string };
    };
    expect(fieldLook.rest.field).toEqual(fieldLook.rest.input);
    expect(fieldLook.focused.field).toEqual(fieldLook.focused.input);
    expect(fieldLook.inset.field).toBeCloseTo(fieldLook.inset.input);
    expect(fieldLook.editor).toEqual({ focused: true, outline: "none" });
    // The parse-only check marks a text that does not parse, and keeps it
    // from being saved.
    expect(
      await typeFormula({ name: "year", expression: "date.year +" }),
    ).toEqual({
      syntax: "invalid",
      save: false,
    });
    expect(await typeFormula({ expression: "date.year" })).toEqual({
      syntax: "valid",
      save: true,
    });
    await saveFormula();

    // The Formula saves under formulas, shows after the view's properties,
    // and each row shows the value ZotLit Query gives.
    const years = await formulaValues("date.year");
    expect(years.some(([, year]) => year !== "")).toBe(true);
    const added = await tabWhen((tab) => tab.columns.includes("formula.year"));
    expect(added.text).toContain("formulas:\n  year: date.year\nviews:");
    expect(added.text).toContain(
      "    order:\n      - title\n      - formula.year\n",
    );
    expect(column(added, "formula.year")).toEqual(years);

    // An embed and a Query Block of the same text show the same column.
    await obEval(
      vaultId,
      `(async()=>{const file=await app.vault.create(${JSON.stringify(notePath)},${JSON.stringify(`![[Formula items.zotquery]]\n\n\`\`\`zotquery\n`)}+${JSON.stringify(added.text)}+"\`\`\`\\n");const leaf=app.workspace.getLeaf('split');await leaf.openFile(file,{state:{mode:'preview'}});return true;})()`,
    );
    const readNote = `(async()=>{const leaf=app.workspace.getLeavesOfType('markdown').find(l=>l.view.file?.path===${JSON.stringify(notePath)});if(!leaf)return 'null';const el=leaf.view.containerEl;const embed=[...el.querySelectorAll('.internal-embed')].find(n=>n.zotlitQueryView);const block=el.querySelector('.block-language-zotquery');if(!embed||!block?.zotlitQueryView)return 'null';await embed.zotlitQueryView.settled;await block.zotlitQueryView.settled;const read=root=>{const columns=[...root.querySelectorAll('[data-query-table] thead th')].map(n=>n.getAttribute('data-query-column'));const at=columns.indexOf('formula.year');return [...root.querySelectorAll('[data-query-table-row="item"]')].map(tr=>[tr.getAttribute('data-query-key'),tr.children[at]?.textContent??null]);};return JSON.stringify({embed:read(embed),block:read(block)});})()`;
    expect(
      await obEvalUntil(vaultId, readNote, {
        expected: JSON.stringify({ embed: years, block: years }),
        tries: 120,
      }),
    ).toBe(true);
    await obEval(
      vaultId,
      `(async()=>{const leaf=app.workspace.getLeavesOfType('zotlit-query-file').find(l=>l.view.file?.path===${JSON.stringify(path)});app.workspace.setActiveLeaf(leaf,{focus:true});return true;})()`,
    );

    // The List shows the same values.
    await obEval(
      vaultId,
      `(()=>{${tab}.query.document.setViewLayout(0,'list');return true;})()`,
    );
    const listed = await tabWhen((tab) => tab.list.length > 0);
    expect(listed.list.map(([key]) => key)).toEqual(years.map(([key]) => key));
    for (const [index, [, year]] of years.entries())
      expect(listed.list[index]![1].endsWith(year!)).toBe(true);
    await obEval(
      vaultId,
      `(()=>{${tab}.query.document.setViewLayout(0,'table');return true;})()`,
    );
    await tabWhen((tab) => tab.columns.includes("formula.year"));

    // The Formula row's chevron opens its page for editing.
    const editFormula = async () => {
      await openProperties(tab);
      await openPropertyPage("formula.year");
    };
    await editFormula();
    await typeFormula({ expression: "date.year + 1" });
    await saveFormula();
    const next = await formulaValues("date.year + 1");
    const edited = await tabWhen((tab) =>
      tab.text.includes("  year: date.year + 1\n"),
    );
    expect(column(await tabWhen(() => true), "formula.year")).toEqual(next);
    expect(edited.columns).toContain("title");

    // A Formula ZotLit Query names as wrong shows its message at its row and
    // its column; the other columns still show their values.
    await editFormula();
    expect(await typeFormula({ expression: "title.nope()" })).toEqual({
      syntax: "valid",
      save: null,
    });
    await saveFormula();
    const wrong = await tabWhen((tab) => tab.headerIssue !== null);
    expect(wrong.headerIssue).toContain("formula.year");
    expect(column(wrong, "formula.year").every(([, cell]) => cell === "")).toBe(
      true,
    );
    expect(column(wrong, "title")).toEqual(column(added, "title"));
    await openProperties(tab);
    const rowIssue = await obEval(
      vaultId,
      `(()=>{const popup=${propertiesPopup};const issue=popup.querySelector('[data-query-property="formula.year"] [data-query-formula-issue]')?.getAttribute('data-query-formula-issue')??null;popup.hidePopover();return String(issue);})()`,
    );
    expect(rowIssue).toBe(wrong.headerIssue);

    // Remove, in the page's menu, leaves the file without the Formula and
    // its property, and steps back to the rows.
    await editFormula();
    await runPageMenuItem("remove-formula");
    expect(
      await obEvalUntil(
        vaultId,
        `(()=>{const popup=${propertiesPopup};return String(!!popup&&!popup.querySelector('[data-chooser-page]')&&!!popup.querySelector('[data-query-property]'));})()`,
        { expected: "true" },
      ),
    ).toBe(true);
    await obEval(
      vaultId,
      `(()=>{${propertiesPopup}.hidePopover();return true;})()`,
    );
    const removed = await tabWhen(
      (tab) =>
        !tab.text.includes("formula") && !tab.columns.includes("formula.year"),
    );
    expect(removed.text).toBe(source);
    expect(removed.headerIssue).toBeNull();
  }, 240000);

  it("filters a Query View by a Formula, shows a Formula that reads another, and marks a wrong Formula with the Formulas and the condition that read it in one run", async () => {
    const path = "query-files/Dependent formulas.zotquery";
    const layout = await obEval(
      vaultId,
      "JSON.stringify(app.workspace.getLayout())",
    );
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await obEval(
        vaultId,
        `(async()=>{await app.workspace.changeLayout(JSON.parse(${JSON.stringify(layout)}));const file=app.vault.getFileByPath(${JSON.stringify(path)});if(file)await app.vault.delete(file);return true;})()`,
      );
    });
    const formulas = {
      year: "date.year",
      next: "formula.year + 1",
      recent: "date.year >= 2020",
    };
    // A Formula that only another view of the file reads.
    const shared = "title";
    const source = (
      edits: { year?: string; filter?: string } = {},
    ) => `formulas:
  year: ${edits.year ?? formulas.year}
  next: ${formulas.next}
  recent: ${formulas.recent}
  shared: ${shared}
views:
  - type: table
    name: Recent
    from: items
    order:
      - title
      - formula.year
      - formula.next
    filters: ${edits.filter ?? "formula.recent"}
    limit: 100
`;
    await obEval(
      vaultId,
      `(async()=>{const file=await app.vault.create(${JSON.stringify(path)},${JSON.stringify(source())});const leaf=app.workspace.getLeaf('tab');await leaf.openFile(file);app.workspace.setActiveLeaf(leaf,{focus:true});return true;})()`,
    );
    const tab = "app.workspace.getMostRecentLeaf().view";
    const readTab = `(async()=>{const view=${tab};if(view.getViewType()!=='zotlit-query-file'||view.file?.path!==${JSON.stringify(path)})return 'null';await view.query.settled;const el=view.contentEl;return JSON.stringify({runs:app.plugins.plugins.zotlit.services.query.viewRuns,warnings:[...el.querySelectorAll('[data-query-warning]')].map(n=>n.getAttribute('data-query-warning')),text:await app.vault.read(view.file),columns:[...el.querySelectorAll('[data-query-table] thead th')].map(n=>n.getAttribute('data-query-column')),headerIssues:Object.fromEntries([...el.querySelectorAll('[data-query-table] thead [data-query-column]')].map(n=>[n.getAttribute('data-query-column'),n.getAttribute('data-query-formula-issue')])),rows:[...el.querySelectorAll('[data-query-table-row="item"]')].map(tr=>[tr.getAttribute('data-query-key'),...[...tr.children].map(td=>td.textContent)]),diagnostic:el.querySelector('[data-query-diagnostic]')?.getAttribute('data-query-diagnostic')??null});})()`;
    interface Tab {
      /** The Query View runs of ZotLit Query since the plugin loaded. */
      runs: number;
      warnings: string[];
      text: string;
      columns: (string | null)[];
      headerIssues: Record<string, string | null>;
      /** Each Item row: its key, then the text of each cell. */
      rows: string[][];
      diagnostic: string | null;
    }
    const tabWhen = async (ready: (tab: Tab) => boolean): Promise<Tab> => {
      let shown: Tab | null = null;
      const settled = await waitFor(async () => {
        shown = JSON.parse(await obEval(vaultId, readTab)) as Tab | null;
        return shown !== null && ready(shown);
      }, 120);
      if (!settled) throw new Error(`Query File tab: ${JSON.stringify(shown)}`);
      return shown!;
    };
    /** Edits the file as text in its tab. */
    const write = (text: string) =>
      obEval(
        vaultId,
        `(async()=>{const view=${tab};view.setViewData(${JSON.stringify(text)},false);await view.save();return true;})()`,
      );
    /** The Query View runs of ZotLit Query so far, as the dev build counts them. */
    const countRuns = async () =>
      Number(
        await obEval(
          vaultId,
          `String(app.plugins.plugins.zotlit.services.query.viewRuns)`,
        ),
      );
    /** The key and the cell of one column of each Table row. */
    const column = (shown: Tab, property: string) => {
      // The first cell is the expander.
      const at = shown.columns.indexOf(property);
      return shown.rows.map((row) => [row[0], row[at + 1]]);
    };
    /** The issue at each Formula's row in the Properties popover. */
    const rowIssues = async () => {
      await openProperties(tab);
      return JSON.parse(
        await obEval(
          vaultId,
          `(()=>{const popup=${propertiesPopup};const issues=Object.fromEntries(['year','next','recent'].map(name=>[name,popup.querySelector('[data-query-property="formula.'+name+'"] [data-query-formula-issue]')?.getAttribute('data-query-formula-issue')??null]));popup.hidePopover();return JSON.stringify(issues);})()`,
        ),
      ) as Record<string, string | null>;
    };
    /** The issue at each condition of the view's filters, in the Filter popover. */
    const conditionIssues = async () => {
      await openToolbarPopup(tab, {
        button: '[data-query-toolbar="filter"]',
        popup: '[data-query-popover="filter"]',
        ready: '[data-filter-section="view"] [data-condition-row]',
      });
      return JSON.parse(
        await obEval(
          vaultId,
          `(()=>{const popover=${toolbarPopup('[data-query-popover="filter"]')};const issues=[...popover.querySelectorAll('[data-filter-section="view"] [data-condition-row]')].map(n=>n.querySelector('[role="alert"]')?.textContent??null);popover.hidePopover();return JSON.stringify(issues);})()`,
        ),
      ) as (string | null)[];
    };

    // The view shows the rows ZotLit Query gives for the same filter, and a
    // Formula that reads another shows its value.
    const report = JSON.parse(
      await cliCommand(vaultId, "zotlit:query", {
        args: {
          from: "items",
          formulas: JSON.stringify(formulas),
          filter: "formula.recent",
          fields: "title,formula.year,formula.next",
          limit: "100",
        },
      }),
    ) as ItemQueryReport;
    expect(report.ok).toBe(true);
    expect(report.rows!.length).toBeGreaterThan(1);
    const expected = report.rows!.map((row) => [
      row.indexedKey,
      String(row.values["formula.next"]),
    ]);
    for (const row of report.rows!)
      expect(row.values["formula.next"]).toBe(
        Number(row.values["formula.year"]) + 1,
      );
    const shown = await tabWhen((t) => t.rows.length > 0);
    expect(shown.columns).toEqual([
      null,
      "title",
      "formula.year",
      "formula.next",
    ]);
    expect(column(shown, "formula.next")).toEqual(expected);
    expect(shown.warnings).toEqual([]);

    // A wrong Formula marks itself and the Formula that reads it, each with
    // its own reason, from one run; the view still shows its rows and its
    // other columns.
    const reads = "formula.next reads formula.year, which has a mistake.";
    let runs = await countRuns();
    await write(source({ year: "dat.year" }));
    const wrong = await tabWhen(
      (t) =>
        (t.headerIssues["formula.next"]?.startsWith(reads) ?? false) &&
        t.rows.length > 0,
    );
    expect(wrong.runs - runs).toBe(1);
    expect(wrong.headerIssues["formula.year"]).toContain("In formula.year");
    expect(wrong.diagnostic).toBeNull();
    expect(column(wrong, "title")).toEqual(column(shown, "title"));
    for (const property of ["formula.year", "formula.next"])
      expect(column(wrong, property).every(([, cell]) => cell === "")).toBe(
        true,
      );
    expect(await rowIssues()).toEqual({
      year: wrong.headerIssues["formula.year"],
      next: wrong.headerIssues["formula.next"],
      recent: null,
    });

    // A condition that reads the wrong Formula says so, and the view shows
    // no rows until the Formula is fixed.
    runs = await countRuns();
    await write(source({ year: "dat.year", filter: "formula.next > 2020" }));
    const filtered = await tabWhen(
      (t) => t.rows.length === 0 && t.diagnostic !== null,
    );
    expect(filtered.runs - runs).toBe(1);
    expect(await rowIssues()).toMatchObject({
      next: wrong.headerIssues["formula.next"],
    });
    expect(await conditionIssues()).toEqual([
      expect.stringContaining(
        "The filter reads formula.next, which has a mistake.",
      ),
    ]);
    await write(source({ filter: "formula.next > 2020" }));
    const fixed = await tabWhen((t) => t.rows.length > 0);
    expect(fixed.diagnostic).toBeNull();
    expect(fixed.headerIssues["formula.next"]).toBeNull();
    expect(
      column(fixed, "formula.next").every(([, cell]) => Number(cell) > 2020),
    ).toBe(true);
    expect(await conditionIssues()).toEqual([null]);

    // Removing a Formula that the filters still name leaves the condition,
    // and ZotLit Query's message shows at it.
    await obEval(
      vaultId,
      `(async()=>{${tab}.query.document.removeFormula('next');return true;})()`,
    );
    const removed = await tabWhen((t) => !t.text.includes("formula.next\n"));
    expect(removed.text).toContain("filters: formula.next > 2020\n");
    let issues: (string | null)[] = [];
    expect(
      await waitFor(async () => {
        issues = await conditionIssues();
        return issues[0] !== null;
      }, 60),
    ).toBe(true);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("next");
  }, 240000);

  it("shows an Error Value of a Formula as a warning icon in the Table, the List and the Cards, and copies and exports it as its message", async () => {
    const path = "query-files/Formula errors.zotquery";
    const layout = await obEval(
      vaultId,
      "JSON.stringify(app.workspace.getLayout())",
    );
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await obEval(
        vaultId,
        `(async()=>{await app.workspace.changeLayout(JSON.parse(${JSON.stringify(layout)}));const file=app.vault.getFileByPath(${JSON.stringify(path)});if(file)await app.vault.delete(file);return true;})()`,
      );
    });
    // The Formula cannot read the title of one Item as a number; the other
    // Item gives its year.
    const formula = `if(indexedKey == "${annotationItem.key}", number(title), date.year)`;
    const filter = `indexedKey == "${annotationItem.key}" || indexedKey == "${positionDocumentItem.key}"`;
    const view = (type: string, name: string) =>
      `  - type: ${type}\n    name: ${name}\n    from: items\n    filters: ${JSON.stringify(filter)}\n    order:\n      - title\n      - formula.n\n`;
    const source = `formulas:\n  n: ${JSON.stringify(formula)}\nviews:\n${view("table", "Table")}${view("list", "List")}${view("cards", "Cards")}`;
    await obEval(
      vaultId,
      `(async()=>{const file=await app.vault.create(${JSON.stringify(path)},${JSON.stringify(source)});const leaf=app.workspace.getLeaf('tab');await leaf.openFile(file);app.workspace.setActiveLeaf(leaf,{focus:true});return true;})()`,
    );

    const report = JSON.parse(
      await cliCommand(vaultId, "zotlit:query", {
        args: {
          from: "items",
          filter,
          formulas: JSON.stringify({ n: formula }),
          fields: "title,formula.n",
        },
      }),
    ) as ItemQueryReport;
    expect(report.ok).toBe(true);
    const rows = report.rows!;
    const failed = rows.filter((row) => row.indexedKey === annotationItem.key);
    expect(failed.length).toBeGreaterThan(0);
    for (const row of failed)
      expect(row.values["formula.n"]).toEqual({
        kind: "error",
        code: "unparseable-text",
        message: `number() cannot read ${JSON.stringify(annotationItem.title)} as a number.`,
      });
    const computed = rows.filter(
      (row) => row.indexedKey === positionDocumentItem.key,
    );
    expect(computed.length).toBeGreaterThan(0);
    for (const row of computed)
      expect(row.values["formula.n"]).toBe(
        Number(positionDocumentItem.date.slice(0, 4)),
      );
    const message = (failed[0]!.values["formula.n"] as { message: string })
      .message;

    // Each row's key, the text of each cell, and the Error Value marks.
    const readRows = (selector: string) =>
      `[...el.querySelectorAll(${JSON.stringify(selector)})].map(row=>({key:row.getAttribute('data-query-key')??row.getAttribute('data-query-row'),text:row.textContent,errors:[...row.querySelectorAll('[data-query-error]')].map(n=>[n.getAttribute('data-query-error'),n.getAttribute('aria-label'),!!n.querySelector('svg')])}))`;
    interface Shown {
      key: string;
      text: string;
      errors: [string, string, boolean][];
    }
    const showView = async (name: string, selector: string) => {
      let shown: Shown[] | null = null;
      const settled = await waitFor(async () => {
        shown = JSON.parse(
          await obEval(
            vaultId,
            `(async()=>{const leaf=app.workspace.getMostRecentLeaf();if(leaf.view.getViewType()!=='zotlit-query-file'||leaf.view.file?.path!==${JSON.stringify(path)})return 'null';if(leaf.getViewState().state.view!==${JSON.stringify(name)})await leaf.setViewState({...leaf.getViewState(),state:{...leaf.getViewState().state,view:${JSON.stringify(name)}}});await leaf.view.query.settled;const el=leaf.view.contentEl;return JSON.stringify(${readRows(selector)});})()`,
          ),
        ) as Shown[] | null;
        return shown !== null && shown.length === rows.length;
      }, 120);
      if (!settled) throw new Error(`${name} view: ${JSON.stringify(shown)}`);
      return shown!;
    };
    // The Annotation's row carries the mark and no "Error" text; every
    // other row shows its year and no mark.
    const marked = {
      errors: [["unparseable-text", message, true]],
      text: expect.not.stringContaining("Error"),
    };
    const unmarked = {
      errors: [],
      text: expect.stringContaining(positionDocumentItem.date.slice(0, 4)),
    };
    const expectMarks = (shown: Shown[]) => {
      expect(shown).toEqual(
        shown.map((row) => ({
          key: row.key,
          ...(row.key === annotationItem.key ? marked : unmarked),
        })),
      );
    };
    expectMarks(await showView("Table", '[data-query-table-row="item"]'));
    expectMarks(
      await showView("List", '[data-query-layout="list"] [data-query-row]'),
    );
    expectMarks(
      await showView("Cards", '[data-query-layout="cards"] [data-query-row]'),
    );

    // "Copy to clipboard" and "Export CSV…" write the Formula column after
    // the title, as the view's order has it, and the Error Value as its
    // message.
    const cell = (value: unknown) => {
      const text =
        value === null || value === undefined
          ? ""
          : typeof value === "object"
            ? `Error: ${(value as { message: string }).message}`
            : String(value as string | number);
      return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
    };
    const lines = (separator: string, newline: string) =>
      [
        // The header names a field by its label, a Formula by its path.
        ["Title", "formula.n"].join(separator),
        ...rows.map((row) =>
          [cell(row.values.title), cell(row.values["formula.n"])].join(
            separator,
          ),
        ),
      ]
        .map((line) => `${line}${newline}`)
        .join("");
    const resultsTab = "app.workspace.getMostRecentLeaf().view";
    const resultsPopup = toolbarPopup("[data-query-results-popup]");
    await openResults(resultsTab);
    // The clipboard write has no time the test can name: poll for it, and
    // fail when it does not come.
    // JSON keeps the final newline, which the CLI reply would trim.
    const copied = JSON.parse(
      await obEval(
        vaultId,
        `(async()=>{${PAGE}let copied=null;navigator.clipboard.write=async items=>{copied=await (await items[0].getType('text/plain')).text();};try{press(${resultsPopup}.querySelector('[data-query-copy]'),'Copy to clipboard');await until('clipboard write',()=>copied!==null,5000).catch(()=>{});}finally{delete navigator.clipboard.write;}if(copied===null)throw new Error('"Copy to clipboard" wrote nothing');return JSON.stringify(copied);})()`,
      ),
    ) as string;
    await openResults(resultsTab);
    const exportedCsv = JSON.parse(
      await obEval(
        vaultId,
        `(async()=>{${PAGE}const create=URL.createObjectURL;const click=HTMLAnchorElement.prototype.click;let blob=null,name=null;URL.createObjectURL=b=>{blob=b;return create.call(URL,b);};HTMLAnchorElement.prototype.click=function(){name=this.download;};try{press(${resultsPopup}.querySelector('[data-query-export]'),'Export CSV');}finally{URL.createObjectURL=create;HTMLAnchorElement.prototype.click=click;}return JSON.stringify({name,type:blob?.type??null,text:blob?new TextDecoder('utf-8',{ignoreBOM:true}).decode(await blob.arrayBuffer()):null});})()`,
      ),
    ) as { name: string | null; type: string | null; text: string | null };
    const written = { copied, ...exportedCsv } as {
      copied: string | null;
      name: string | null;
      type: string | null;
      text: string | null;
    };
    expect(written).toEqual({
      // TSV on the clipboard puts LF between lines, none after the last; the
      // CSV file starts with a byte order mark and ends each line with CRLF.
      copied: lines("\t", "\n").slice(0, -1),
      name: "Cards.csv",
      type: "text/csv",
      text: BYTE_ORDER_MARK + lines(",", "\r\n"),
    });
    expect(written.text).toContain(`"Error: ${message.replaceAll('"', '""')}"`);
  }, 240000);

  it("renames a field and a Formula from the Properties popover, and the Table header, the popover and the CSV header row show their Display Names", async () => {
    const path = "query-files/Named columns.zotquery";
    const layout = await obEval(
      vaultId,
      "JSON.stringify(app.workspace.getLayout())",
    );
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      // Teardown closes a popover a failed step left open; not a reader's press.
      await obEval(
        vaultId,
        `(async()=>{for(const popup of activeDocument.querySelectorAll('[popover]:popover-open'))popup.hidePopover();await app.workspace.changeLayout(JSON.parse(${JSON.stringify(layout)}));const file=app.vault.getFileByPath(${JSON.stringify(path)});if(file)await app.vault.delete(file);return true;})()`,
      );
    });
    const source = `formulas:\n  year: date.year\nviews:\n  - type: table\n    name: Named columns\n    from: items\n    order:\n      - title\n      - formula.year\n    limit: 3\n`;
    await obEval(
      vaultId,
      `(async()=>{const file=await app.vault.create(${JSON.stringify(path)},${JSON.stringify(source)});const leaf=app.workspace.getLeaf('tab');await leaf.openFile(file);app.workspace.setActiveLeaf(leaf,{focus:true});return true;})()`,
    );
    const tab = "app.workspace.getMostRecentLeaf().view";
    /** The Table header, each popover row's Display Name, and the file's saved text. */
    const readTab = `(async()=>{const view=${tab};if(view.getViewType()!=='zotlit-query-file'||view.file?.path!==${JSON.stringify(path)})return 'null';await view.query.settled;await view.save();const el=view.contentEl;const header=[...el.querySelectorAll('[data-query-table] thead th[data-query-column]')].map(n=>[n.getAttribute('data-query-column'),n.textContent]);const popup=${propertiesPopup};if(!popup)return 'null';const names=['title','formula.year'].map(property=>popup.querySelector('[data-query-property="'+property+'"]')).filter(n=>n?.querySelector('[data-query-property-name]')).map(n=>[n.dataset.queryProperty,n.querySelector('[data-query-property-name]').textContent]);popup.hidePopover();return JSON.stringify({header,names,rows:el.querySelectorAll('[data-query-table-row="item"]').length,text:await app.vault.read(view.file)});})()`;
    interface Tab {
      header: [string, string][];
      names: [string, string][];
      rows: number;
      text: string;
    }
    const tabWhen = async (ready: (tab: Tab) => boolean): Promise<Tab> => {
      let tab: Tab | null = null;
      const settled = await waitFor(async () => {
        await openProperties("app.workspace.getMostRecentLeaf().view");
        tab = JSON.parse(await obEval(vaultId, readTab)) as Tab | null;
        return tab !== null && ready(tab);
      }, 120);
      if (!settled) throw new Error(`Query File tab: ${JSON.stringify(tab)}`);
      return tab!;
    };
    const shown = await tabWhen((tab) => tab.rows > 0 && tab.header.length > 0);
    // Without a Display Name, a field shows its label and a Formula its path,
    // in the Table header and in the Properties popover.
    expect(shown.header).toEqual([
      ["title", "Title"],
      ["formula.year", "formula.year"],
    ]);
    expect(shown.names).toEqual([
      ["title", "Title"],
      ["formula.year", "formula.year"],
    ]);

    // The title row's chevron opens its page. Escape there steps back to the
    // rows, with focus in the search field, and saves the name typed.
    await openProperties(tab);
    await openPropertyPage("title");
    await obEval(
      vaultId,
      `(()=>{const input=${propertiesPage}.querySelector('[data-query-display-name]');input.value='Work';input.dispatchEvent(new InputEvent('input',{bubbles:true}));input.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));return true;})()`,
    );
    expect(
      await obEvalUntil(
        vaultId,
        `(()=>{const popup=${propertiesPopup};return String(!!popup&&!popup.querySelector('[data-chooser-page]')&&popup.ownerDocument.activeElement?.getAttribute('role')==='combobox');})()`,
        { expected: "true" },
      ),
    ).toBe(true);
    await obEval(
      vaultId,
      `(()=>{${propertiesPopup}.hidePopover();return true;})()`,
    );
    const field = await tabWhen((tab) => tab.text.includes("displayName"));
    expect(field.text).toBe(
      source.replace(
        "views:",
        "properties:\n  title:\n    displayName: Work\nviews:",
      ),
    );

    // The Formula's page holds the Formula's Display Name.
    /** Opens the page of `formula.year`. */
    const editYear = async () => {
      await openProperties(tab);
      await openPropertyPage("formula.year");
    };
    await editYear();
    await obEval(
      vaultId,
      `(()=>{const input=${propertiesPage}.querySelector('[data-query-display-name]');input.value='Year of source';input.dispatchEvent(new InputEvent('input',{bubbles:true}));return true;})()`,
    );
    await closePropertyPage();
    const named = await tabWhen((tab) => tab.text.includes("Year of source"));
    expect(named.text).toBe(
      source.replace(
        "views:",
        "properties:\n  title:\n    displayName: Work\n  formula.year:\n    displayName: Year of source\nviews:",
      ),
    );
    expect(named.header).toEqual([
      ["title", "Work"],
      ["formula.year", "Year of source"],
    ]);
    expect(named.names).toEqual([
      ["title", "Work"],
      ["formula.year", "Year of source"],
    ]);

    // The popover search finds a property by its Display Name.
    await openProperties(tab);
    await obEval(
      vaultId,
      `(()=>{const input=${propertiesPopup}.querySelector('input[role="combobox"]');input.value='Year of source';input.dispatchEvent(new InputEvent('input',{bubbles:true}));return true;})()`,
    );
    const found = JSON.parse(
      await obEval(
        vaultId,
        `(()=>{const popup=${propertiesPopup};const rows=[...popup.querySelectorAll('[data-query-property]')].map(n=>n.dataset.queryProperty);popup.hidePopover();return JSON.stringify(rows);})()`,
      ),
    ) as string[];
    expect(found).toContain("formula.year");
    expect(found).not.toContain("title");
    // The popover opens again with an empty search and every property, so
    // the next typed text replaces the last search instead of adding to it.
    await openProperties(tab);
    expect(
      await obEvalUntil(
        vaultId,
        `(()=>{const popup=${propertiesPopup};const rows=[...popup.querySelectorAll('[data-query-property]')].map(n=>n.dataset.queryProperty);return JSON.stringify({search:popup.querySelector('input[role="combobox"]').value,title:rows.includes('title'),year:rows.includes('formula.year')});})()`,
        { expected: JSON.stringify({ search: "", title: true, year: true }) },
      ),
    ).toBe(true);
    await obEval(
      vaultId,
      `(()=>{${propertiesPopup}.hidePopover();return true;})()`,
    );

    // "Export CSV…" names the columns by their Display Names.
    await openResults(tab);
    const exported = JSON.parse(
      await obEval(
        vaultId,
        `(async()=>{${PAGE}const create=URL.createObjectURL;const click=HTMLAnchorElement.prototype.click;let blob=null;URL.createObjectURL=b=>{blob=b;return create.call(URL,b);};HTMLAnchorElement.prototype.click=function(){};try{press(${toolbarPopup("[data-query-results-popup]")}.querySelector('[data-query-export]'),'Export CSV');}finally{URL.createObjectURL=create;HTMLAnchorElement.prototype.click=click;}return JSON.stringify({text:blob?new TextDecoder('utf-8',{ignoreBOM:true}).decode(await blob.arrayBuffer()):null});})()`,
      ),
    ) as { text: string | null };
    expect(exported.text?.split("\r\n")[0]).toBe(
      `${BYTE_ORDER_MARK}Work,Year of source`,
    );

    // Removing the Formula also removes its Display Name; the field keeps its own.
    await editYear();
    await runPageMenuItem("remove-formula");
    expect(
      await obEvalUntil(
        vaultId,
        `(()=>{const popup=${propertiesPopup};return String(!!popup&&!popup.querySelector('[data-chooser-page]')&&!!popup.querySelector('[data-query-property]'));})()`,
        { expected: "true" },
      ),
    ).toBe(true);
    await obEval(
      vaultId,
      `(()=>{${propertiesPopup}.hidePopover();return true;})()`,
    );
    const removed = await tabWhen((tab) => !tab.text.includes("formula"));
    expect(removed.text).toBe(
      "properties:\n  title:\n    displayName: Work\nviews:\n  - type: table\n    name: Named columns\n    from: items\n    order:\n      - title\n    limit: 3\n",
    );
    expect(removed.header).toEqual([["title", "Work"]]);
  }, 240000);

  it("moves a Table column by its header and sets its width by its edge, saves both in the Query File view, and a double click sets the width back", async () => {
    const path = "query-files/Column widths.zotquery";
    const layout = await obEval(
      vaultId,
      "JSON.stringify(app.workspace.getLayout())",
    );
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await obEval(
        vaultId,
        `(async()=>{document.body.classList.remove('is-grabbing','zt-is-resizing-column');await app.workspace.changeLayout(JSON.parse(${JSON.stringify(layout)}));const file=app.vault.getFileByPath(${JSON.stringify(path)});if(file)await app.vault.delete(file);return true;})()`,
      );
    });
    const source = `views:\n  - type: table\n    name: Column widths\n    from: items\n    order:\n      - title\n      - firstAuthor\n      - date\n    limit: 3\n`;
    await obEval(
      vaultId,
      `(async()=>{const file=await app.vault.create(${JSON.stringify(path)},${JSON.stringify(source)});const leaf=app.workspace.getLeaf('tab');await leaf.openFile(file);app.workspace.setActiveLeaf(leaf,{focus:true});return true;})()`,
    );
    /**
     * Runs `steps` against the open Query File tab once its Table shows, with
     * `th(path)`, `edge(path)`, `fire(target, type, x)`, a drag event at
     * the client x `x`, and `pointer(target, type, x)`, a pointer event there;
     * then saves and reads the header and the file text.
     */
    const inTable = async <T>(steps: string): Promise<T> => {
      let out: T | null = null;
      const settled = await waitFor(async () => {
        out = JSON.parse(
          await obEval(
            vaultId,
            `(async()=>{${PAGE}const view=app.workspace.getMostRecentLeaf().view;if(view.getViewType()!=='zotlit-query-file'||view.file?.path!==${JSON.stringify(path)})return 'null';await view.query.settled;const el=view.contentEl;const th=p=>el.querySelector('[data-query-table] th[data-query-column="'+p+'"]');if(!th('title')||!el.querySelector('[data-query-table-row="item"]'))return 'null';const edge=p=>th(p).querySelector('[data-query-column-resizer]');const transfer=new DataTransfer();const fire=(target,type,x)=>{const r=target.getBoundingClientRect();const event=new DragEvent(type,{bubbles:true,cancelable:true,dataTransfer:transfer,clientX:x,clientY:r.top+r.height/2});target.dispatchEvent(event);return event.defaultPrevented;};const pointer=(target,type,x)=>{const r=target.getBoundingClientRect();const event=new PointerEvent(type,{bubbles:true,cancelable:true,pointerId:7,isPrimary:true,button:0,buttons:type==='pointerup'?0:1,clientX:x,clientY:r.top+r.height/2});target.dispatchEvent(event);return event.defaultPrevented;};const frame=()=>new Promise(r=>requestAnimationFrame(()=>r()));const width=p=>Math.round(th(p).getBoundingClientRect().width);const out=await (async()=>{${steps}})();await view.query.flush();return JSON.stringify({...out,columns:[...el.querySelectorAll('[data-query-table] th[data-query-column]')].map(n=>n.getAttribute('data-query-column')),text:await app.vault.read(view.file)});})()`,
          ),
        ) as T | null;
        return out !== null;
      }, 120);
      if (!settled) throw new Error("Query File tab shows no Table");
      return out!;
    };
    interface Read {
      columns: string[];
      text: string;
    }

    // A header dragged over a column after it drops after that column, and
    // the drop line stands at that column's end edge while the drag is on.
    const moved = await inTable<
      Read & { line: number; edge: number; layer: string; header: string }
    >(
      `const date=th('date').getBoundingClientRect();fire(th('title'),'dragstart',th('title').getBoundingClientRect().left+5);fire(th('date'),'dragover',date.left+5);const line=el.querySelector('.table-drag-target.mod-col');const at=line?Math.round(line.getBoundingClientRect().left):null;const layer=line?getComputedStyle(line).zIndex:null;const header=getComputedStyle(th('title')).zIndex;fire(th('date'),'drop',date.left+5);fire(th('title'),'dragend',0);await frame();return {line:at,edge:Math.round(date.right),layer,header};`,
    );
    expect(moved.line).toBe(moved.edge);
    // The line stands over the sticky header, not under it.
    expect(moved.layer).toBe(moved.header);
    expect(moved.columns).toEqual(["firstAuthor", "date", "title"]);
    expect(moved.text).toContain(
      "    order:\n      - firstAuthor\n      - date\n      - title\n",
    );

    // A drag on a column's edge sets its width as it goes, with the resize
    // cursor over the whole page, and saves it when the pointer lets go; the
    // header does not move and its menu does not open.
    const resized = await inTable<
      Read & {
        before: number;
        live: number;
        after: number;
        cursor: string;
        cursorAfter: string;
        menu: boolean;
      }
    >(
      `const before=width('date');const x=edge('date').getBoundingClientRect().left+2;pointer(edge('date'),'pointerdown',x);pointer(el,'pointermove',x+80);await until('live width',()=>width('date')!==before);const live=width('date');const cursor=getComputedStyle(th('title')).cursor;pointer(th('date'),'pointerup',x+80);th('date').dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}));await frame();const menu=!!activeDocument.querySelector('.menu');return {before,live,after:width('date'),cursor,cursorAfter:getComputedStyle(th('title')).cursor,menu};`,
    );
    expect(resized.cursor).toBe("col-resize");
    expect(resized.cursorAfter).toBe("grab");
    expect(resized.menu).toBe(false);
    expect(resized.columns).toEqual(["firstAuthor", "date", "title"]);
    expect(resized.live).toBe(resized.before + 80);
    expect(resized.after).toBe(resized.before + 80);
    expect(resized.text).toContain(
      `    columnSize:\n      date: ${resized.before + 80}\n`,
    );

    // Escape ends a drag on an edge: the width goes back and nothing saves.
    const cancelled = await inTable<
      Read & { before: number; live: number; after: number }
    >(
      `const before=width('title');const x=edge('title').getBoundingClientRect().left+2;pointer(edge('title'),'pointerdown',x);pointer(el,'pointermove',x+60);await until('live width',()=>width('title')!==before);const live=width('title');activeDocument.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));pointer(el,'pointerup',x+60);await frame();return {before,live,after:width('title')};`,
    );
    expect(cancelled.live).toBe(cancelled.before + 60);
    expect(cancelled.after).toBe(cancelled.before);
    expect(cancelled.text).toBe(resized.text);

    // A double click on the edge sets the column back to its auto width and
    // removes the key with its last width.
    const reset = await inTable<Read & { after: number }>(
      `edge('date').dispatchEvent(new MouseEvent('dblclick',{bubbles:true,cancelable:true}));await until('auto width',()=>!('sized' in th('date').dataset));return {after:width('date')};`,
    );
    expect(reset.after).toBe(resized.before);
    expect(reset.text).not.toContain("columnSize");
    expect(reset.columns).toEqual(["firstAuthor", "date", "title"]);

    // A column can be narrower than its longest word: it stops at the
    // narrowest Bases width, and its cells clip what does not fit — the
    // cell itself, or the line inside it that truncates its text.
    const narrowed = await inTable<
      Read & {
        min: number;
        auto: number;
        after: number;
        clipped: boolean;
        label: boolean;
      }
    >(
      `const min=Number.parseFloat(getComputedStyle(th('firstAuthor')).getPropertyValue('--bases-table-column-min-width'));const before=width('firstAuthor');const x=edge('firstAuthor').getBoundingClientRect().left+2;pointer(edge('firstAuthor'),'pointerdown',x);pointer(el,'pointermove',x-before);pointer(el,'pointerup',x-before);await until('narrow width',()=>width('firstAuthor')===min);const at=th('firstAuthor').cellIndex;const cells=[...el.querySelectorAll('[data-query-table-row="item"]')].map(row=>row.cells[at]);const label=th('firstAuthor').firstElementChild.lastElementChild;return {min,auto:before,after:width('firstAuthor'),clipped:cells.some(cell=>[cell,...cell.querySelectorAll('*')].some(box=>box.scrollWidth>box.clientWidth)),label:label.scrollWidth>label.clientWidth};`,
    );
    expect(narrowed.after).toBe(narrowed.min);
    expect(narrowed.clipped).toBe(true);
    expect(narrowed.label).toBe(true);
    expect(narrowed.text).toContain(
      `    columnSize:\n      firstAuthor: ${narrowed.min}\n`,
    );

    // A right click on a header opens its menu whatever the column's
    // state: an entry with nothing to do shows disabled, and Reset column
    // width on a resized column sets it back to its auto width.
    const menuReset = await inTable<
      Read & { auto: string[]; sized: string[]; after: number }
    >(
      `const items=()=>[...activeDocument.querySelectorAll('.menu')].at(-1).querySelectorAll('.menu-item');const read=()=>[...items()].map(n=>n.textContent.trim()+(n.classList.contains('is-disabled')?' (disabled)':''));const open=async p=>{const r=th(p).getBoundingClientRect();th(p).dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:r.left+5,clientY:r.top+5}));await until('header menu',()=>activeDocument.querySelector('.menu .menu-item'));};await open('date');const auto=read();await ${MENU_READY};activeDocument.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await until('first menu closes',()=>!activeDocument.querySelector('.menu'));await open('firstAuthor');const sized=read();press([...items()].find(n=>n.textContent.trim()==='Reset column width'),'Reset column width');await until('auto width',()=>!('sized' in th('firstAuthor').dataset));await until('second menu closes',()=>!activeDocument.querySelector('.menu'));return {auto,sized,after:width('firstAuthor')};`,
    );
    expect(menuReset.auto).toEqual([
      "Move left",
      "Move right",
      "Reset column width (disabled)",
    ]);
    expect(menuReset.sized).toEqual([
      "Move left (disabled)",
      "Move right",
      "Reset column width",
    ]);
    expect(menuReset.after).toBe(narrowed.auto);
    expect(menuReset.text).not.toContain("columnSize");

    // A pointer the system takes away ends a drag on an edge: the live width
    // goes back, the resize cursor goes, and nothing saves.
    const ended = await inTable<
      Read & { before: number; live: number; after: number; resizing: boolean }
    >(
      `const before=width('date');const x=edge('date').getBoundingClientRect().left+2;pointer(edge('date'),'pointerdown',x);pointer(el,'pointermove',x+50);await until('live width',()=>width('date')!==before);const live=width('date');pointer(el,'pointercancel',x+50);await frame();return {before,live,after:width('date'),resizing:activeDocument.body.classList.contains('zt-is-resizing-column')};`,
    );
    expect(ended.live).toBe(ended.before + 50);
    expect(ended.after).toBe(ended.before);
    expect(ended.resizing).toBe(false);
    expect(ended.text).toBe(menuReset.text);

    // A header dropped outside the table moves nothing, and the drag leaves
    // no drop line and no grabbing cursor.
    const outside = await inTable<Read & { line: boolean; grabbing: boolean }>(
      `const date=th('date').getBoundingClientRect();fire(th('title'),'dragstart',th('title').getBoundingClientRect().left+5);fire(th('date'),'dragover',date.left+5);const away=view.containerEl.querySelector('.view-header');fire(away,'dragover',away.getBoundingClientRect().left+5);fire(away,'drop',away.getBoundingClientRect().left+5);fire(th('title'),'dragend',0);return {line:!!activeDocument.querySelector('.table-drag-target'),grabbing:activeDocument.body.classList.contains('is-grabbing')};`,
    );
    expect(outside.line).toBe(false);
    expect(outside.grabbing).toBe(false);
    expect(outside.columns).toEqual(["firstAuthor", "date", "title"]);
    expect(outside.text).toBe(menuReset.text);

    // A move reads the order the view holds at the drop: here a save during
    // the drag puts the dragged column last, and the drop over the first
    // column still puts it first.
    const stale = await inTable<Read>(
      `fire(th('firstAuthor'),'dragstart',th('firstAuthor').getBoundingClientRect().left+5);view.query.document.editView({order:['date','title','firstAuthor']});await view.query.flush();await until('order changes',()=>[...el.querySelectorAll('[data-query-table] th[data-query-column]')].map(n=>n.getAttribute('data-query-column')).join()==='date,title,firstAuthor');const date=th('date').getBoundingClientRect();fire(th('date'),'dragover',date.left+5);fire(th('date'),'drop',date.left+5);fire(th('firstAuthor'),'dragend',0);await until('dropped',()=>[...el.querySelectorAll('[data-query-table] th[data-query-column]')].map(n=>n.getAttribute('data-query-column')).join()==='firstAuthor,date,title');return {};`,
    );
    expect(stale.columns).toEqual(["firstAuthor", "date", "title"]);
    expect(stale.text).toContain(
      "    order:\n      - firstAuthor\n      - date\n      - title\n",
    );

    // A tab that closes mid-drag ends the drag: no drop line, no grabbing
    // cursor, the width as it was, and a later drop saves nothing.
    const closed = JSON.parse(
      await obEval(
        vaultId,
        `(async()=>{${PAGE}const leaf=app.workspace.getMostRecentLeaf();const view=leaf.view;const el=view.contentEl;const th=p=>el.querySelector('[data-query-table] th[data-query-column="'+p+'"]');const transfer=new DataTransfer();const fire=(target,type,x)=>{const r=target.getBoundingClientRect();const event=new DragEvent(type,{bubbles:true,cancelable:true,dataTransfer:transfer,clientX:x,clientY:r.top+r.height/2});target.dispatchEvent(event);return event.defaultPrevented;};const before=await app.vault.read(view.file);const file=view.file;const date=th('date').getBoundingClientRect();fire(th('title'),'dragstart',th('title').getBoundingClientRect().left+5);fire(th('date'),'dragover',date.left+5);const during={line:!!activeDocument.querySelector('.table-drag-target'),grabbing:activeDocument.body.classList.contains('is-grabbing')};const layout=view.query.layout;const left=()=>!activeDocument.querySelector('.table-drag-target')&&!activeDocument.body.classList.contains('is-grabbing');leaf.detach();if(layout._loaded)throw new Error('the Table stays mounted');await until('drag ends',left).catch(()=>{});const after={line:!!activeDocument.querySelector('.table-drag-target'),grabbing:activeDocument.body.classList.contains('is-grabbing')};fire(activeDocument.body,'dragover',10);fire(activeDocument.body,'drop',10);return JSON.stringify({during,after,same:(await app.vault.read(file))===before});})()`,
      ),
    ) as {
      during: { line: boolean; grabbing: boolean };
      after: { line: boolean; grabbing: boolean };
      same: boolean;
    };
    expect(closed.during).toEqual({ line: true, grabbing: true });
    expect(closed.after).toEqual({ line: false, grabbing: false });
    expect(closed.same).toBe(true);
  }, 240000);

  it("moves, resizes and hides the Literature Note Property in the Table, saves it in the Query File view, and keeps it across a switch to Cards", async () => {
    const path = "query-files/Note column.zotquery";
    const layout = await obEval(
      vaultId,
      "JSON.stringify(app.workspace.getLayout())",
    );
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await obEval(
        vaultId,
        `(async()=>{for(const popup of activeDocument.querySelectorAll('[popover]:popover-open'))popup.hidePopover();document.body.classList.remove('is-grabbing');await app.workspace.changeLayout(JSON.parse(${JSON.stringify(layout)}));const file=app.vault.getFileByPath(${JSON.stringify(path)});if(file)await app.vault.delete(file);return true;})()`,
      );
    });
    const note = "vault.literatureNote";
    const source = `views:\n  - type: table\n    name: Note column\n    from: items\n    order:\n      - title\n      - date\n      - ${note}\n    limit: 3\n`;
    await obEval(
      vaultId,
      `(async()=>{const file=await app.vault.create(${JSON.stringify(path)},${JSON.stringify(source)});const leaf=app.workspace.getLeaf('tab');await leaf.openFile(file);app.workspace.setActiveLeaf(leaf,{focus:true});return true;})()`,
    );
    /**
     * Runs `steps` against the open Query File tab once its Table shows, with
     * `th(path)`, `edge(path)`, `fire(target, type, x)`, a drag event at the
     * client x `x`, `pointer(target, type, x)`, a pointer event there, and
     * `popup()`, the open Properties popover; then saves and reads the
     * header and the file.
     */
    const inTable = async <T>(steps: string): Promise<T> => {
      let out: T | null = null;
      const settled = await waitFor(async () => {
        out = JSON.parse(
          await obEval(
            vaultId,
            `(async()=>{${PAGE}const view=app.workspace.getMostRecentLeaf().view;if(view.getViewType()!=='zotlit-query-file'||view.file?.path!==${JSON.stringify(path)})return 'null';await view.query.settled;const el=view.contentEl;const th=p=>el.querySelector('[data-query-table] th[data-query-column="'+p+'"]');if(!th('title')||!el.querySelector('[data-query-table-row="item"]'))return 'null';const edge=p=>th(p).querySelector('[data-query-column-resizer]');const transfer=new DataTransfer();const fire=(target,type,x)=>{const r=target.getBoundingClientRect();const event=new DragEvent(type,{bubbles:true,cancelable:true,dataTransfer:transfer,clientX:x,clientY:r.top+r.height/2});target.dispatchEvent(event);return event.defaultPrevented;};const pointer=(target,type,x)=>{const r=target.getBoundingClientRect();const event=new PointerEvent(type,{bubbles:true,cancelable:true,pointerId:7,isPrimary:true,button:0,buttons:type==='pointerup'?0:1,clientX:x,clientY:r.top+r.height/2});target.dispatchEvent(event);return event.defaultPrevented;};const popup=()=>activeDocument.querySelector('[data-query-properties-popup]:popover-open');const columns=()=>[...el.querySelectorAll('[data-query-table] th[data-query-column]')].map(n=>n.getAttribute('data-query-column'));const width=p=>Math.round(th(p).getBoundingClientRect().width);const out=await (async()=>{${steps}})();await view.query.flush();return JSON.stringify({...out,columns:columns(),text:await app.vault.read(view.file)});})()`,
          ),
        ) as T | null;
        return out !== null;
      }, 120);
      if (!settled) throw new Error("Query File tab shows no Table");
      return out!;
    };
    interface Read {
      columns: string[];
      text: string;
    }
    const N = JSON.stringify(note);

    // The column's header drags as any other: dropped on the first column,
    // it goes first, and each Item row shows its note link or Create there.
    const moved = await inTable<Read & { cells: boolean[] }>(
      `const title=th('title').getBoundingClientRect();fire(th(${N}),'dragstart',th(${N}).getBoundingClientRect().left+5);fire(th('title'),'dragover',title.left+5);fire(th('title'),'drop',title.left+5);fire(th(${N}),'dragend',0);await until('moved',()=>columns()[0]===${N});const at=th(${N}).cellIndex;return {cells:[...el.querySelectorAll('[data-query-table-row="item"]')].map(row=>!!row.cells[at].querySelector('[data-query-note],[data-query-create-note]'))};`,
    );
    expect(moved.columns).toEqual([note, "title", "date"]);
    expect(moved.cells).toEqual([true, true, true]);
    expect(moved.text).toContain(
      `    order:\n      - ${note}\n      - title\n      - date\n`,
    );

    // Its edge sets its width, saved by its path.
    const resized = await inTable<Read & { before: number; after: number }>(
      `const before=width(${N});const x=edge(${N}).getBoundingClientRect().left+2;pointer(edge(${N}),'pointerdown',x);pointer(el,'pointermove',x+80);await until('live width',()=>width(${N})!==before);pointer(th(${N}),'pointerup',x+80);await until('saved width',()=>'sized' in th(${N}).dataset);return {before,after:width(${N})};`,
    );
    expect(resized.after).toBe(resized.before + 80);
    expect(resized.text).toContain(
      `    columnSize:\n      ${note}: ${resized.before + 80}\n`,
    );

    // The Properties popover ticks it; an untick hides the column and keeps
    // its row, unticked, so a tick shows it again, last.
    const toggled = await inTable<
      Read & {
        label: string;
        hidden: string[];
        hiddenText: string;
        kept: boolean;
      }
    >(
      `if(!popup())press(el.querySelector('[data-query-properties]'),'Properties');await until('Properties popover opens',()=>popup()?.querySelector('[data-query-property]'));const row=()=>popup().querySelector('[data-query-property='+JSON.stringify(${N})+']');const label=row().textContent;press(row(),'Literature Note Property row');await until('hidden',()=>!columns().includes(${N}));await view.query.flush();const hidden=columns();const hiddenText=await app.vault.read(view.file);const kept=row()?.getAttribute('aria-selected')==='false';press(row(),'Literature Note Property row');await until('shown',()=>columns().includes(${N}));popup().hidePopover();return {label,hidden,hiddenText,kept};`,
    );
    expect(toggled.label).toBe(m.query_view_table_literature_note());
    expect(toggled.hidden).toEqual(["title", "date"]);
    expect(toggled.hiddenText).toContain(
      "    order:\n      - title\n      - date\n    limit",
    );
    expect(toggled.kept).toBe(true);
    expect(toggled.columns).toEqual(["title", "date", note]);

    // Cards do not show it and name it no unused setting, and the Table
    // shows it again after the switch back.
    const switched = await inTable<
      Read & { card: boolean; unused: string | null }
    >(
      `view.query.document.setViewLayout(0,'cards');await until('cards',()=>el.querySelector('[data-query-row]'));await view.query.settled;const card=!!el.querySelector('[data-query-row] [data-query-note],[data-query-row] [data-query-create-note]');const unused=el.querySelector('[data-query-unused]')?.textContent??null;view.query.document.setViewLayout(0,'table');await until('table',()=>th(${N}));return {card,unused};`,
    );
    expect(switched.card).toBe(false);
    expect(switched.unused).toBeNull();
    expect(switched.columns).toEqual(["title", "date", note]);
    expect(switched.text).toContain(
      `    order:\n      - title\n      - date\n      - ${note}\n`,
    );
  }, 240000);

  it("switches a Fixture Query File view to Items and the Table, expands an Item into its Attachments, Annotations and Child Notes, and creates a Literature Note from its column", async () => {
    const path = "query-files/Reading annotations.zotquery";
    const layout = await obEval(
      vaultId,
      "JSON.stringify(app.workspace.getLayout())",
    );
    const original = await obEval(
      vaultId,
      `app.vault.read(app.vault.getFileByPath(${JSON.stringify(path)}))`,
    );
    const created: string[] = [];
    await using cleanup = new AsyncDisposableStack();
    // The tab closes before the text goes back, so no pending save of the
    // tab writes over it.
    cleanup.defer(async () => {
      // Teardown closes a popover a failed step left open; not a reader's press.
      await obEval(
        vaultId,
        `(async()=>{for(const popup of activeDocument.querySelectorAll('[popover]:popover-open'))popup.hidePopover();for(const leaf of app.workspace.getLeavesOfType('zotlit-query-file'))leaf.detach();await app.vault.modify(app.vault.getFileByPath(${JSON.stringify(path)}),${JSON.stringify(original)});for(const path of ${JSON.stringify(created)}){const file=app.vault.getFileByPath(path);if(file)await app.vault.delete(file);}await app.workspace.changeLayout(JSON.parse(${JSON.stringify(layout)}));return true;})()`,
      );
    });
    const tab = "app.workspace.getMostRecentLeaf().view";
    await obEval(
      vaultId,
      `(async()=>{const leaf=app.workspace.getLeaf('tab');await leaf.openFile(app.vault.getFileByPath(${JSON.stringify(path)}));app.workspace.setActiveLeaf(leaf,{focus:true});return true;})()`,
    );
    expect(
      await obEvalUntil(
        vaultId,
        `(async()=>{const view=${tab};if(view.getViewType()!=='zotlit-query-file')return 'none';await view.query.settled;return String(view.contentEl.querySelectorAll('.zt-annot-card').length>0);})()`,
        { expected: "true" },
      ),
    ).toBe(true);
    /** What the Table shows once its query settled. */
    const readTable = `(async()=>{const view=${tab};if(view.getViewType()!=='zotlit-query-file'||view.file?.path!==${JSON.stringify(path)})return 'null';await view.query.settled;const el=view.contentEl;const keys=kind=>[...el.querySelectorAll('[data-query-table-row="'+kind+'"]')].map(n=>n.getAttribute('data-query-key'));return JSON.stringify({header:[...el.querySelectorAll('[data-query-table] thead th')].map(n=>n.textContent),rows:[...el.querySelectorAll('[data-query-table-row]')].map(n=>[n.getAttribute('data-query-table-row'),n.getAttribute('data-query-key')]),items:keys('item'),attachments:keys('attachment'),annotations:keys('annotation'),childNotes:[...el.querySelectorAll('[data-query-table-row="note"]')].map(n=>[n.getAttribute('data-query-key'),n.textContent]),notes:Object.fromEntries([...el.querySelectorAll('[data-query-note]')].map(n=>[n.closest('tr').getAttribute('data-query-key'),n.getAttribute('data-query-note')])),create:[...el.querySelectorAll('[data-query-create-note]')].map(n=>n.getAttribute('data-query-create-note'))});})()`;
    interface Table {
      header: string[];
      /** Every row of the Table in screen order, as its kind and key. */
      rows: [string, string][];
      items: string[];
      attachments: string[];
      annotations: string[];
      childNotes: [string, string][];
      notes: Record<string, string>;
      create: string[];
    }
    const tableWhen = async (ready: (table: Table) => boolean) => {
      let table: Table | null = null;
      const settled = await waitFor(async () => {
        table = JSON.parse(await obEval(vaultId, readTable)) as Table | null;
        return table !== null && ready(table);
      }, 120);
      if (!settled)
        throw new Error(`Query File Table: ${JSON.stringify(table)}`);
      return table!;
    };
    const query = async (args: Record<string, string>) => {
      const report = JSON.parse(
        await cliCommand(vaultId, "zotlit:query", { args }),
      ) as ItemQueryReport;
      expect(report.ok).toBe(true);
      return report.rows!;
    };

    // Configure view switches the view's rows to Items. The Layout picker
    // then offers the layouts of Items, with the Table chosen. The grouping
    // by Item, which Items lack, stays in the file, and the view says it does
    // not use it.
    await obEval(
      vaultId,
      `(()=>{${tab}.contentEl.querySelector('[data-query-view-menu]').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}));return true;})()`,
    );
    // The Configure view page this view's menu opened.
    const configurePage =
      "activeDocument.querySelector('[data-query-view-list]:popover-open [data-chooser-page]')";
    expect(
      await obEvalUntil(
        vaultId,
        `String(${configurePage}?.querySelector('[data-query-view-name]')?.value===${JSON.stringify("All annotations")})`,
        { expected: "true" },
      ),
    ).toBe(true);
    await obEval(
      vaultId,
      `(()=>{const select=${configurePage}.querySelector('[data-query-view-dataset]');select.value='items';select.dispatchEvent(new Event('change',{bubbles:true}));return true;})()`,
    );
    expect(
      await obEvalUntil(
        vaultId,
        `JSON.stringify([...${configurePage}.querySelectorAll('[data-query-view-layout] option')].map(n=>[n.textContent,n.selected]))`,
        {
          expected: JSON.stringify([
            [m.query_view_layout_table(), true],
            [m.query_view_layout_list(), false],
            [m.query_view_layout_cards(), false],
            [m.query_view_layout_papers(), false],
          ]),
        },
      ),
    ).toBe(true);
    expect(
      await obEvalUntil(
        vaultId,
        `String(${tab}.contentEl.querySelector('[data-query-unused]')?.textContent)`,
        {
          expected: m.query_view_unused({
            dataset: m.query_view_dataset_items(),
            properties: m.query_view_property_parent_item(),
          }),
        },
      ),
    ).toBe(true);
    await obEval(
      vaultId,
      `(()=>{${PAGE}press(${configurePage}.querySelector('[data-chooser-page-close]'),'Close');return true;})()`,
    );
    // The view saves as a Table of Items, and keeps its grouping.
    expect(
      await obEvalUntil(
        vaultId,
        `(async()=>{const text=await app.vault.read(app.vault.getFileByPath(${JSON.stringify(path)}));const first=text.split('name: Figures')[0];return String(first.includes(${JSON.stringify("  - type: table\n    name: All annotations\n    from: items\n")})&&first.includes('groupBy'));})()`,
        { expected: "true" },
      ),
    ).toBe(true);

    // The rows are the Items ZotLit Query gives for the view, in its order.
    const items = await query({
      from: "items",
      fields: "title",
      limit: "100",
    });
    const shown = await tableWhen((table) => table.items.length > 0);
    expect(shown.items).toEqual(items.map((row) => row.indexedKey));
    expect(shown.header.at(-1)).toBe(m.query_view_table_literature_note());

    // The Item expands into its Attachments, and an Attachment with
    // Annotations into those Annotations, as ZotLit Query lists them.
    const item = ITEMS.find(
      ({ itemID }) => itemID === annotationAttachment.parentItemID,
    )!.key;
    const attachments = await query({
      from: "attachments",
      filter: `item.indexedKey == "${item}"`,
      fields: "title",
      limit: "all",
    });
    const annotations = await query({
      from: "annotations",
      filter: `attachment.indexedKey == "${annotationAttachment.key}"`,
      fields: "text,pageIndex",
      sort: "sortIndex",
      limit: "all",
    });
    expect(annotations.length).toBeGreaterThan(0);
    const click = (selector: string) =>
      obEval(
        vaultId,
        `(()=>{${PAGE}press(${tab}.contentEl.querySelector(${JSON.stringify(selector)}),${JSON.stringify(selector)});return true;})()`,
      );
    await click(`[data-query-expand="item:${item}"]`);
    await tableWhen((table) => table.attachments.length === attachments.length);
    await click(`[data-query-expand="attachment:${annotationAttachment.key}"]`);
    const expanded = await tableWhen(
      (table) => table.annotations.length === annotations.length,
    );
    expect(expanded.attachments).toEqual(
      attachments.map((row) => row.indexedKey),
    );
    expect(expanded.annotations).toEqual(
      annotations.map((row) => row.indexedKey),
    );

    // An Attachment link opens the PDF in Obsidian's reader as an Obsidian
    // link does: a Cmd/Ctrl click and a middle click each in a new tab, so
    // the Table stays open in its own.
    // A new tab takes the focus from the Table, so the links are read off
    // the Query File's own leaf.
    const queryLeaf = "app.workspace.getLeavesOfType('zotlit-query-file')[0]";
    const link = (kind: string, key: string) =>
      `${queryLeaf}.view.contentEl.querySelector('[data-query-table-row="${kind}"][data-query-key="${key}"] [data-query-open="${kind}"]')`;
    /** A click on `el` with the buttons and keys `init` names, as an eval statement. */
    const pointer = (el: string, type: string, init: string) =>
      `{const el=${el};el.dispatchEvent(new el.ownerDocument.defaultView.MouseEvent('${type}',{bubbles:true,cancelable:true,...${init}}));}`;
    const MOD_CLICK =
      "{button:0,metaKey:process.platform==='darwin',ctrlKey:process.platform!=='darwin'}";
    const MIDDLE_CLICK = "{button:1}";
    const pdfName = annotationAttachment.path!.split("/").pop()!;
    const pdfTabs = `app.workspace.getLeavesOfType('pdf').filter(l=>l.view.file?.name===${JSON.stringify(pdfName)}).length`;
    const before = Number(await obEval(vaultId, `String(${pdfTabs})`));
    await obEval(
      vaultId,
      `(()=>{${pointer(link("attachment", annotationAttachment.key), "click", MOD_CLICK)}return true;})()`,
    );
    expect(
      await obEvalUntil(vaultId, `String(${pdfTabs})`, {
        expected: String(before + 1),
      }),
    ).toBe(true);
    await obEval(
      vaultId,
      `(()=>{${pointer(link("attachment", annotationAttachment.key), "auxclick", MIDDLE_CLICK)}return true;})()`,
    );
    expect(
      await obEvalUntil(vaultId, `String(${pdfTabs})`, {
        expected: String(before + 2),
      }),
    ).toBe(true);
    expect(
      await obEval(
        vaultId,
        `String(app.workspace.getLeavesOfType('zotlit-query-file').length)`,
      ),
    ).toBe("1");

    // An Annotation link opens the PDF at the Annotation's page, with the
    // Annotation Anchor that lands on its mark.
    const anchored = annotations.find(
      (row) => typeof row.values.pageIndex === "number",
    )!;
    expect(anchored, "an Annotation has a PDF page").toBeDefined();
    expect(
      await obEval(
        vaultId,
        `(async()=>{${PAGE}const proto=Object.getPrototypeOf(app.workspace.getMostRecentLeaf());const native=proto.setEphemeralState;let subpath=null;proto.setEphemeralState=function(state){if(typeof state?.subpath==='string')subpath=state.subpath;return native.call(this,state);};try{${pointer(link("annotation", anchored.indexedKey), "auxclick", MIDDLE_CLICK)}return await until('the PDF opens at the Annotation',()=>subpath,10000);}finally{proto.setEphemeralState=native;}})()`,
      ),
    ).toBe(
      `#page=${(anchored.values.pageIndex as number) + 1}&zt-annotation=${anchored.indexedKey}`,
    );

    await obEval(
      vaultId,
      `(()=>{app.workspace.setActiveLeaf(${queryLeaf},{focus:true});return true;})()`,
    );

    // An Attachment Obsidian's reader cannot host, such as a web snapshot,
    // opens in Zotero's reader through its Zotero link.
    const snapshot = ATTACHMENTS.find(({ key }) => key === "HTMLSNAP")!;
    expect(snapshot.parentItemID).toBe(positionDocumentItem.itemID);
    await click(`[data-query-expand="item:${positionDocumentItem.key}"]`);
    await tableWhen((table) => table.attachments.includes(snapshot.key));
    expect(
      await obEval(
        vaultId,
        `(async()=>{${PAGE}const native=window.open;let opened=null;window.open=url=>{opened=String(url);return null;};try{press(${link("attachment", snapshot.key)},'snapshot link');return await until('Zotero opens the snapshot',()=>opened,10000);}finally{window.open=native;}})()`,
      ),
    ).toBe(`zotero://open/library/items/${snapshot.key}`);

    // An Item with Child Notes expands into them with their titles; its
    // trashed Child Note stays out.
    const noted = ITEMS.find(({ itemID }) => itemID === 1)!.key;
    const live = NOTES.filter(
      (note) => note.parentItemID === 1 && !note.trashed,
    );
    expect(
      NOTES.some((note) => note.parentItemID === 1 && note.trashed),
      "the Fixture Item has a trashed Child Note",
    ).toBe(true);
    await click(`[data-query-expand="item:${noted}"]`);
    const withNotes = await tableWhen(
      (table) => table.childNotes.length === live.length,
    );
    expect(withNotes.childNotes).toEqual(
      live.map((note) => [note.key, note.title]),
    );

    // An Item with both Attachments and a Child Note lists its notes after
    // its Attachments.
    const both = ITEMS.find(({ itemID }) => itemID === 57)!;
    const bothNotes = NOTES.filter(
      (note) => note.parentItemID === both.itemID && !note.trashed,
    );
    const bothAttachments = await query({
      from: "attachments",
      filter: `item.indexedKey == "${both.key}"`,
      fields: "title",
      limit: "all",
    });
    expect(bothNotes.length, "the Fixture Item has a Child Note").toBe(1);
    expect(
      bothAttachments.length,
      "the Fixture Item has Attachments",
    ).toBeGreaterThan(0);
    await click(`[data-query-expand="item:${both.key}"]`);
    const childRows = (table: Table) => {
      const start = table.rows.findIndex(
        ([kind, key]) => kind === "item" && key === both.key,
      );
      const end = table.rows.findIndex(
        ([kind], index) => index > start && kind === "item",
      );
      return table.rows.slice(start + 1, end === -1 ? undefined : end);
    };
    const withBoth = await tableWhen(
      (table) =>
        childRows(table).length === bothAttachments.length + bothNotes.length,
    );
    expect(childRows(withBoth)).toEqual([
      ...bothAttachments.map((row) => ["attachment", row.indexedKey]),
      ...bothNotes.map((note) => ["note", note.key]),
    ]);

    // "Create" asks for a Profile where more than one fits; the new
    // Literature Note, made with the Profile chosen, then shows as a link in
    // the column.
    const book = shown.create.find(
      (key) =>
        key === booksProfileTargetItem.key ||
        key.startsWith(`${booksProfileTargetItem.key}g`),
    )!;
    expect(book, "the Item has no Literature Note yet").toBeDefined();
    await click(`[data-query-create-note="${book}"]`);
    expect(await selectSuggestion(vaultId, booksProfile.label)).toContain(
      booksProfile.label,
    );
    await obEval(
      vaultId,
      "activeDocument.querySelector('.prompt input').dispatchEvent(new activeWindow.KeyboardEvent('keydown',{key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true}));true",
    );
    const linked = await tableWhen((table) => book in table.notes);
    created.push(linked.notes[book]!);
    expect(linked.create).not.toContain(book);
    expect(linked.notes[book]).toMatch(/^books\//);
    expect(
      await obEval(
        vaultId,
        `String(app.metadataCache.getFileCache(app.vault.getFileByPath(${JSON.stringify(linked.notes[book])}))?.frontmatter?.['zotero-key'])`,
      ),
    ).toBe(book);
  }, 180000);

  // Vault properties of Items edit in place in the Table, with trusted
  // input: a click anywhere in a cell, an empty one too, enters edit; focus
  // that leaves a list editor from an item commits it; the first edit of a
  // row with no note creates it; a vault sort and filter run (#1531).
  it("edits vault properties in the Table with real input, creates a note on a first edit, and sorts and filters by them", async () => {
    const path = "query-files/Vault properties.zotquery";
    // Two My Library Items that tie on their date, each with its seeded
    // Literature Note, and a Lab Archive Item with no note.
    const [tieFirst, tieSecond] = [11, 12].map(
      (itemID) => ITEMS.find((item) => item.itemID === itemID)!.key,
    ) as [string, string];
    const lab = LIBRARIES.find(({ libraryID }) => libraryID === 3)!;
    const fresh = `${ITEMS.find((item) => item.itemID === 9)!.key}g${lab.groupID}`;
    const notePath = (key: string) => `literatures/${key}.md`;
    const keys = JSON.stringify([tieFirst, tieSecond, fresh]);
    const viewText = (extra: string) =>
      `${[
        "views:",
        "  - type: table",
        "    name: Vault properties",
        "    from: items",
        "    filters:",
        "      and:",
        `        - '${keys}.contains(indexedKey)'`,
        extra,
        "    order:",
        "      - title",
        "      - vault.zt-status",
        "      - vault.zt-done",
        "      - vault.zt-projects",
        "      - vault.zt-rank",
        "      - vault.zt-due",
        "",
      ]
        .filter((line) => line !== "")
        .join("\n")}\n`;
    const layout = await obEval(
      vaultId,
      "JSON.stringify(app.workspace.getLayout())",
    );
    const seeded = [notePath(tieFirst), notePath(tieSecond)];
    const originals = JSON.parse(
      await obEval(
        vaultId,
        `(async()=>JSON.stringify(await Promise.all(${JSON.stringify(seeded)}.map(path=>app.vault.read(app.vault.getFileByPath(path))))))()`,
      ),
    ) as string[];
    const created: string[] = [path];
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await obEval(
        vaultId,
        `(async()=>{for(const leaf of app.workspace.getLeavesOfType('zotlit-query-file'))leaf.detach();for(const path of ${JSON.stringify(created)}){const file=app.vault.getFileByPath(path);if(file)await app.vault.delete(file);}const originals=${JSON.stringify(originals)};for(const [at,path] of ${JSON.stringify(seeded)}.entries())await app.vault.modify(app.vault.getFileByPath(path),originals[at]);await app.workspace.changeLayout(JSON.parse(${JSON.stringify(layout)}));return true;})()`,
      );
    });
    await obEval(
      vaultId,
      `(async()=>{const set=(path,props)=>app.fileManager.processFrontMatter(app.vault.getFileByPath(path),fm=>Object.assign(fm,props));await set(${JSON.stringify(notePath(tieFirst))},{'zt-status':'unread','zt-done':false,'zt-projects':['a'],'zt-rank':1,'zt-due':'2024-05-01'});await set(${JSON.stringify(notePath(tieSecond))},{'zt-done':true,'zt-rank':2});await app.vault.create(${JSON.stringify(path)},${JSON.stringify(viewText(""))});return true;})()`,
    );
    const noteIndex = "app.plugins.plugins.zotlit.services.noteIndex";
    let indexed = "";
    expect(
      await waitFor(async () => {
        indexed = await obEval(
          vaultId,
          `JSON.stringify([${JSON.stringify(tieFirst)},${JSON.stringify(tieSecond)}].map(key=>[key,${noteIndex}.getNotesByItemKey(key).map(file=>file.path),app.metadataCache.getCache('literatures/'+key+'.md')?.frontmatter?.['zt-rank']??null]))`,
        );
        return (JSON.parse(indexed) as [string, string[], unknown][]).every(
          ([key, paths, rank]) =>
            paths.join() === notePath(key) && rank !== null,
        );
      }),
      indexed,
    ).toBe(true);
    await obEval(
      vaultId,
      `(async()=>{const leaf=app.workspace.getLeaf('tab');await leaf.openFile(app.vault.getFileByPath(${JSON.stringify(path)}));app.workspace.setActiveLeaf(leaf,{focus:true});return true;})()`,
    );
    await raiseWindow(vaultId);
    const tab = "app.workspace.getLeavesOfType('zotlit-query-file')[0].view";
    /** The rows of the Table, and the state and text of each vault cell. */
    const readTable = `(async()=>{const view=${tab};if(!view)return 'null';await view.query.settled;const el=view.contentEl;return JSON.stringify({rows:[...el.querySelectorAll('[data-query-table-row="item"]')].map(n=>n.getAttribute('data-query-key')),editing:!!el.querySelector('[data-query-vault-input]'),cells:Object.fromEntries([...el.querySelectorAll('[data-query-vault-cell]')].map(n=>[n.closest('tr').getAttribute('data-query-key')+'/'+n.getAttribute('data-query-vault-name'),n.textContent]))});})()`;
    interface Table {
      rows: string[];
      editing: boolean;
      cells: Record<string, string>;
    }
    const tableWhen = async (ready: (table: Table) => boolean) => {
      let table: Table | null = null;
      const settled = await waitFor(async () => {
        table = JSON.parse(await obEval(vaultId, readTable)) as Table | null;
        return table !== null && ready(table);
      }, 80);
      if (!settled) throw new Error(`Vault Table: ${JSON.stringify(table)}`);
      return table!;
    };
    await tableWhen((table) => table.rows.length === 3);
    const frontmatter = async (path: string) =>
      JSON.parse(
        await obEval(
          vaultId,
          `JSON.stringify(app.metadataCache.getFileCache(app.vault.getFileByPath(${JSON.stringify(path)}))?.frontmatter??null)`,
        ),
      ) as Record<string, unknown> | null;
    const frontmatterWhen = async (
      path: string,
      ready: (properties: Record<string, unknown>) => boolean,
    ) => {
      let properties: Record<string, unknown> | null = null;
      const settled = await waitFor(async () => {
        properties = await frontmatter(path);
        return properties !== null && ready(properties);
      }, 80);
      if (!settled)
        throw new Error(`${path} frontmatter: ${JSON.stringify(properties)}`);
      return properties!;
    };
    const cell = (key: string, name: string) =>
      `${tab}.contentEl.querySelector('[data-query-key="${key}"] [data-query-vault-cell][data-query-vault-name="${name}"]')`;
    /** A trusted click, of the `button` given, at the centre of the element `target` evaluates to. */
    const click = async (target: string, button: "left" | "right" = "left") =>
      expect(
        await obEval(
          vaultId,
          `(function(){const target=${target};if(!target)return 'missing';target.scrollIntoView({block:"center",inline:"nearest",behavior:"instant"});const rect=target.getBoundingClientRect();const zoom=require('electron').webFrame.getZoomFactor();const x=Math.round((rect.left+rect.width/2)*zoom),y=Math.round((rect.top+rect.height/2)*zoom);const contents=require('@electron/remote').getCurrentWebContents();contents.sendInputEvent({type:'mouseMove',x,y});contents.sendInputEvent({type:'mouseDown',x,y,button:${JSON.stringify(button)},clickCount:1});contents.sendInputEvent({type:'mouseUp',x,y,button:${JSON.stringify(button)},clickCount:1});return 'clicked';})()`,
        ),
      ).toBe("clicked");
    /** A trusted key press, with the modifiers held. */
    const key = async (keyCode: string, modifiers: string[] = []) =>
      obEval(
        vaultId,
        `(function(){const contents=require('@electron/remote').getCurrentWebContents();contents.sendInputEvent({type:'keyDown',keyCode:${JSON.stringify(keyCode)},modifiers:${JSON.stringify(modifiers)}});contents.sendInputEvent({type:'keyUp',keyCode:${JSON.stringify(keyCode)},modifiers:${JSON.stringify(modifiers)}});return true;})()`,
      );
    /** Text typed into the focused field, as the keyboard types it. */
    const typeText = async (text: string) =>
      obEval(
        vaultId,
        `(function(){require('@electron/remote').getCurrentWebContents().insertText(${JSON.stringify(text)});return true;})()`,
      );
    const focusedInput = `String(activeDocument.activeElement?.matches('[data-query-vault-input]')??false)`;

    // An empty cell is a click target across the whole cell, so the first
    // value of a property goes in with one click (bug A).
    await click(`${cell(tieSecond, "zt-status")}.closest('td')`);
    expect(await obEvalUntil(vaultId, focusedInput, { expected: "true" })).toBe(
      true,
    );
    await typeText("to-read");
    await key("Enter");
    await frontmatterWhen(
      notePath(tieSecond),
      (properties) => properties["zt-status"] === "to-read",
    );

    // A cell edits its value in place, its first line where it was at rest,
    // for each type of property (#1531).
    /**
     * The top of the first line of a vault cell, from the top of its row: of
     * its first item for a list, of the field's content box for a field
     * (and a date at rest, a native field too), else of its first text.
     */
    const firstLine = (name: string) =>
      `(function(){const el=${cell(tieFirst, name)};const row=el.closest('tr').getBoundingClientRect().top;const editor=el.querySelector('[data-query-vault-editor]');const chip=(editor??el).querySelector('[data-query-vault-chip]');if(chip)return String(chip.getBoundingClientRect().top-row);const field=editor?editor.querySelector('textarea,input'):el.querySelector('[data-query-vault-date]');if(field){const style=getComputedStyle(field);return String(field.getBoundingClientRect().top+parseFloat(style.borderTopWidth)+parseFloat(style.paddingTop)-row);}const walker=activeDocument.createTreeWalker(el,NodeFilter.SHOW_TEXT,{acceptNode:n=>n.textContent.trim()?1:3});const text=walker.nextNode();const range=activeDocument.createRange();range.selectNodeContents(text);const rect=range.getClientRects()[0];return String(rect.top-(parseFloat(getComputedStyle(text.parentElement).lineHeight)-rect.height)/2-row);})()`;
    const editing = `String(!!activeDocument.querySelector('[data-query-vault-editor]'))`;
    /** Open the edit of the cell `name`, and compare its first line with the cell's at rest. */
    const sameLine = async (name: string) => {
      const restLine = Number(await obEval(vaultId, firstLine(name)));
      await click(cell(tieFirst, name));
      expect(
        await obEvalUntil(vaultId, focusedInput, { expected: "true" }),
      ).toBe(true);
      const editLine = Number(await obEval(vaultId, firstLine(name)));
      expect(
        Math.abs(editLine - restLine),
        `${name}: first line ${restLine} at rest, ${editLine} editing`,
      ).toBeLessThan(0.5);
    };
    // A number, a date and a list, each left unchanged: Escape closes the
    // suggestions of a list first, then ends the edit, writing nothing.
    expect(
      await obEval(
        vaultId,
        `${JSON.stringify(["zt-rank", "zt-due", "zt-projects"])}.map(name=>${tab}.contentEl.querySelector('[data-query-key="${tieFirst}"] [data-query-vault-name="'+name+'"]')?.getAttribute('data-query-vault-type')).join()`,
      ),
    ).toBe("number,date,multitext");
    for (const name of ["zt-rank", "zt-due", "zt-projects"]) {
      await sameLine(name);
      await key("Escape");
      if (await obEvalUntil(vaultId, editing, { expected: "false", tries: 5 }))
        continue;
      await key("Escape");
      expect(await obEvalUntil(vaultId, editing, { expected: "false" })).toBe(
        true,
      );
    }
    await sameLine("zt-status");
    // The vault's values for the property show as the edit starts, before
    // a key is typed, as in a Bases cell (#1531): those that match the text.
    expect(
      await obEvalUntil(
        vaultId,
        `[...activeDocument.querySelectorAll('.suggestion-container .suggestion-item')].map(item=>item.textContent).join('|')`,
        { expected: "unread" },
      ),
    ).toBe(true);
    // The field's text, selected, is replaced by what is typed; it matches
    // vault values, and Shift+Enter keeps the text over the highlighted one.
    await obEval(
      vaultId,
      "(()=>{activeDocument.activeElement.select();return true;})()",
    );
    await typeText("read");
    await key("Enter", ["shift"]);
    await frontmatterWhen(
      notePath(tieFirst),
      (properties) => properties["zt-status"] === "read",
    );

    // A checkbox toggles with one click on it.
    await click(
      `${cell(tieFirst, "zt-done")}.querySelector('[data-query-vault-checkbox]')`,
    );
    await frontmatterWhen(
      notePath(tieFirst),
      (properties) => properties["zt-done"] === true,
    );

    // A list commits when focus leaves the editor from an item, as a click
    // outside the Table takes it (bug B). Backspace in the empty field
    // selects the last item, as in a Bases list cell.
    await click(cell(tieFirst, "zt-projects"));
    expect(await obEvalUntil(vaultId, focusedInput, { expected: "true" })).toBe(
      true,
    );
    await typeText("c");
    await key("Enter");
    await key("Backspace");
    expect(
      await obEvalUntil(
        vaultId,
        `String(activeDocument.activeElement?.matches('[data-query-vault-chip="c"]')??false)`,
        { expected: "true" },
      ),
    ).toBe(true);
    // A chip edits in place from its menu, as in a Bases list cell: a
    // right click opens it, Edit makes the chip's text a field, and a comma
    // stays inside the item.
    await click(
      `${cell(tieFirst, "zt-projects")}.querySelector('[data-query-vault-chip="c"]')`,
      "right",
    );
    const editEntry = `[...activeDocument.querySelectorAll('body > .menu .menu-item')].find(entry=>entry.textContent===${JSON.stringify(m.query_view_vault_chip_edit())})`;
    expect(
      await obEvalUntil(vaultId, `String(!!${editEntry})`, {
        expected: "true",
      }),
    ).toBe(true);
    expect(await obEval(vaultId, MENU_READY)).toBe("ready");
    await click(editEntry);
    expect(
      await obEvalUntil(
        vaultId,
        `String(activeDocument.activeElement?.matches('[data-query-vault-chip-input]')??false)`,
        { expected: "true" },
      ),
    ).toBe(true);
    await typeText(", d");
    expect(
      await obEvalUntil(
        vaultId,
        `String(activeDocument.activeElement?.matches('[data-query-vault-chip-input]')&&activeDocument.activeElement.value)`,
        { expected: "c, d" },
      ),
    ).toBe(true);
    await key("Enter");
    expect(
      await obEvalUntil(
        vaultId,
        `String(activeDocument.activeElement?.matches('[data-query-vault-chip="c, d"]')??false)`,
        { expected: "true" },
      ),
    ).toBe(true);
    // A click on an empty spot of the view, outside the Table.
    expect(
      await obEval(
        vaultId,
        `(function(){const el=${tab}.contentEl;const table=el.querySelector('[data-query-table]');const box=el.getBoundingClientRect();let x=0,y=0,found=false;for(let dy=8;dy<box.height&&!found;dy+=8)for(let dx=8;dx<box.width&&!found;dx+=16){x=box.left+dx;y=box.bottom-dy;const hit=activeDocument.elementFromPoint(x,y);found=!!hit&&el.contains(hit)&&!table.contains(hit)&&!hit.closest('button,input,select,a,[role],[tabindex],[popover]');}if(!found)return 'no empty space';const zoom=require('electron').webFrame.getZoomFactor();const point={x:Math.round(x*zoom),y:Math.round(y*zoom)};const contents=require('@electron/remote').getCurrentWebContents();contents.sendInputEvent({type:'mouseMove',...point});contents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...point});contents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...point});return 'clicked';})()`,
      ),
    ).toBe("clicked");
    await frontmatterWhen(notePath(tieFirst), (properties) =>
      ["a", "c, d"].every((item) =>
        (properties["zt-projects"] as string[] | undefined)?.includes(item),
      ),
    );
    await tableWhen((table) => !table.editing);

    // The first edit of a row with no note creates the note, then writes
    // the value to it.
    await click(`${cell(fresh, "zt-status")}.closest('td')`);
    expect(await obEvalUntil(vaultId, focusedInput, { expected: "true" })).toBe(
      true,
    );
    await typeText("queued");
    await key("Enter");
    // Where several Profiles fit the Item, the prompt asks; its first
    // choice takes it.
    let createdPath: string | null = null;
    expect(
      await waitFor(async () => {
        const found = await obEval(
          vaultId,
          `(()=>{const note=${noteIndex}.getNotesByItemKey(${JSON.stringify(fresh)})[0];if(note)return note.path;const prompt=activeDocument.querySelector('.prompt input');if(prompt)prompt.dispatchEvent(new activeWindow.KeyboardEvent('keydown',{key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true}));return 'none';})()`,
        );
        if (found !== "none") createdPath = found;
        return found !== "none";
      }, 80),
    ).toBe(true);
    created.push(createdPath!);
    await frontmatterWhen(
      createdPath!,
      (properties) => properties["zt-status"] === "queued",
    );

    // A vault filter keeps the Items whose note passes it, and a vault sort
    // breaks the tie of their dates: the higher rank first.
    await obEval(
      vaultId,
      `(async()=>{await app.vault.modify(app.vault.getFileByPath(${JSON.stringify(path)}),${JSON.stringify(viewText(["        - 'vault[\"zt-done\"] == true'", "    sort:", "      - property: date", "        direction: ASC", "      - property: vault.zt-rank", "        direction: DESC"].join("\n")))});return true;})()`,
    );
    const sorted = await tableWhen(
      (table) =>
        table.rows.length === 2 &&
        table.rows.join() === [tieSecond, tieFirst].join(),
    );
    expect(sorted.rows).toEqual([tieSecond, tieFirst]);
  }, 180000);

  // A List or Cards view of Items gathers its rows by a grouping whose
  // fields it does not show, as the Table does (#1495).
  it("groups a List and Cards view of Items by item type, Collection and tag, as the Table does", async () => {
    const layout = await obEval(
      vaultId,
      "JSON.stringify(app.workspace.getLayout())",
    );
    const paths: string[] = [];
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await obEval(
        vaultId,
        `(async()=>{for(const leaf of app.workspace.getLeavesOfType('zotlit-query-file'))leaf.detach();for(const path of ${JSON.stringify(paths)}){const file=app.vault.getFileByPath(path);if(file)await app.vault.delete(file);}await app.workspace.changeLayout(JSON.parse(${JSON.stringify(layout)}));return true;})()`,
      );
    });
    const itemTypes = [
      "Book",
      "Book Section",
      "Conference Paper",
      "Journal Article",
      "Letter",
      "Preprint",
      "Thesis",
    ];
    const none = m.query_view_group_none();
    const cases: {
      name: string;
      type: "list" | "cards" | "table";
      group: string;
      order?: string[];
      headings: string[];
      unused?: string;
    }[] = [
      {
        name: "List by item type",
        type: "list",
        group: "itemType",
        order: ["title"],
        headings: itemTypes,
      },
      {
        name: "Cards by Collection",
        type: "cards",
        group: "collections[]",
        headings: [
          "Personal only",
          "Personal only/Personal child",
          "Shared key",
          none,
        ],
      },
      {
        name: "List by tag",
        type: "list",
        group: "tags[]",
        headings: [
          "fixture-core",
          "methodology",
          "read-later",
          "research-practice",
          "visualization",
          none,
        ],
      },
      {
        name: "List by tag showing tags",
        type: "list",
        group: "tags[]",
        order: ["title", "tags"],
        headings: [
          "fixture-core",
          "methodology",
          "read-later",
          "research-practice",
          "visualization",
          none,
        ],
        unused: m.query_view_unshown({
          dataset: m.query_view_dataset_items(),
          properties: m.query_view_property_tag(),
        }),
      },
      {
        name: "Table by item type",
        type: "table",
        group: "itemType",
        order: ["title"],
        headings: itemTypes,
      },
    ];
    for (const { name, type, group, order, headings, unused } of cases) {
      const path = `query-files/${name}.zotquery`;
      paths.push(path);
      const text = [
        "views:",
        `  - type: ${type}`,
        `    name: ${name}`,
        "    from: items",
        "    groupBy:",
        `      property: ${group}`,
        "      direction: ASC",
        ...(order ? ["    order:", ...order.map((p) => `      - ${p}`)] : []),
        "    limit: 100",
        "",
      ].join("\n");
      await obEval(
        vaultId,
        `(async()=>{const file=await app.vault.create(${JSON.stringify(path)},${JSON.stringify(text)});const leaf=app.workspace.getLeaf('tab');await leaf.openFile(file);app.workspace.setActiveLeaf(leaf,{focus:true});return true;})()`,
      );
      const read = `(async()=>{const view=app.workspace.getMostRecentLeaf().view;if(view.getViewType()!=='zotlit-query-file'||view.file?.path!==${JSON.stringify(path)})return 'null';await view.query.settled;const el=view.contentEl;return JSON.stringify({rows:el.querySelectorAll('[data-query-row], [data-query-table-row="item"]').length,headings:[...el.querySelectorAll('[data-query-group]')].map(n=>n.textContent),unused:el.querySelector('[data-query-unused]')?.textContent??null});})()`;
      let shown: {
        rows: number;
        headings: string[];
        unused: string | null;
      } | null = null;
      const settled = await waitFor(async () => {
        shown = JSON.parse(await obEval(vaultId, read)) as typeof shown;
        return shown !== null && shown.rows > 0;
      }, 120);
      if (!settled) throw new Error(`${name}: ${JSON.stringify(shown)}`);
      expect({ name, ...shown! }).toMatchObject({
        name,
        headings,
        unused: unused ?? null,
      });
    }
  }, 180000);

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
        `(async()=>{${PAGE}
          await using cleanup=new AsyncDisposableStack();
          const leaf=cleanup.adopt(app.workspace.getRightLeaf(true),leaf=>leaf.detach());
          await leaf.setViewState({type:'zotero-annotation-view',state:{followMode:'pinned',pinnedItemKey:${JSON.stringify(annotationItem.key)}}});
          const view=leaf.view;await view.read;
          const button=await until('Annotation card menu missing',()=>view.contentEl.querySelector('.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(copiedAnnotation.key)}] [aria-label=${JSON.stringify(m.annot_view_more_tooltip())}]'),5000);
          const clipboard=require('electron').clipboard;
          const saved={text:clipboard.readText(),html:clipboard.readHTML(),rtf:clipboard.readRTF(),image:clipboard.readImage()};
          const bookmark=clipboard.readBookmark();if(bookmark.title)saved.bookmark=bookmark.title;
          cleanup.defer(()=>clipboard.write(saved));
          const write=navigator.clipboard.writeText;
          cleanup.defer(()=>{navigator.clipboard.writeText=write;});
          clipboard.writeText('');
          if(${refuse})navigator.clipboard.writeText=()=>Promise.reject(new Error('Clipboard write refused'));
          press(button,'card More options');
          const item=await until('Copy citation missing from the card menu',()=>Array.from(activeDocument.querySelectorAll('.menu .menu-item')).find(e=>e.textContent.trim()===${JSON.stringify(m.annot_view_menu_copy_citation())}),2500);
          press(item,'Copy citation');
          let text='';
          await until('citation on the clipboard',()=>(text=clipboard.readText())===${JSON.stringify(citation)},5000).catch(()=>{});
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
    // The default Profile shows Annotations in a Query Block; a Profile that
    // lists them in the note renders their excerpts.
    await useListingProfile(id);
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
    // A default Profile that lists the Annotations in the note puts one
    // callout for each of them in the body, where the customized callout
    // must arrive.
    await useListingProfile(freshId);
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
    // The Default document already exists, so the workbench shows its file
    // before Customize sets the note it came from.
    expect(
      await obEvalUntil(
        freshId,
        `(function(){const view=${editor};return String(view.contentEl.textContent.includes(${JSON.stringify(m.template_workbench_shared_template({ name: m.settings_profile_default_name() }))})&&view.store.getState().item?.id==='RUGIER24');})()`,
        { expected: "true" },
      ),
    ).toBe(true);
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
          `(function(){${PAGE}const view=${editor};press(view.contentEl.querySelector('button[aria-label=${JSON.stringify(m.workbench_help())}]'),'Help');return true;})()`,
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
      `(function(){${PAGE}const view=${editor};press(Array.from(view.contentEl.querySelectorAll('button')).find(button=>button.innerText.trim()===${JSON.stringify(m.template_workbench_update_this_note())}),'Update this note');return true;})()`,
    );
    expect(
      await obEvalUntil(freshId, `String(!(${editor}).updatingNote)`, {
        expected: "true",
      }),
    ).toBe(true);
    expect(
      await waitFor(async () =>
        /^collections:/m.test(
          (await readFile(join(freshPath, note.path!), "utf-8")).split(
            "---",
          )[1]!,
        ),
      ),
    ).toBe(true);
    // The update puts the customized callout in the body, one for each
    // Annotation.
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
    // A Profile with no Match shows one placeholder row.
    await shapeCondition(0, "item-type", "book");
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

  it("checks a Profile Match against a chosen Item and marks a mistake on its row", async () => {
    const bookItem = ITEMS.find((item) => item.itemID === 61)!;
    const articleItem = ITEMS.find((item) => item.itemID === 1)!;
    const documentPath = join(e2eVaultPath, "templates", booksProfile.document);
    const original = await readFile(documentPath, "utf-8");
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await obEval(
        vaultId,
        "for(const type of ['zotlit-template-workbench','zotlit-template-data-explorer','zotlit-note-preview'])app.workspace.detachLeavesOfType(type);true",
      );
      await writeFile(documentPath, original);
    });
    await writeMatch(booksProfile, bookMatch);
    await openMatchEditor();
    /** The Match tab's result once it tests the Item `key` and settles. */
    const resultFor = async (key: string) => {
      let text = "";
      await waitFor(async () => {
        text = await obEval(
          vaultId,
          `(async()=>{const view=app.workspace.activeLeaf.view;if(view.getState().itemIndexedKey!==${JSON.stringify(key)})await view.setState({...view.getState(),itemIndexedKey:${JSON.stringify(key)}},{history:false});const result=view.contentEl.querySelector('[data-part="result"]');return result?.getAttribute('data-state')==='loading'?'loading':(result?.textContent??'loading');})()`,
        );
        return text !== "loading";
      });
      return text;
    };
    // ZotLit Query tests a real Item, as creation does.
    expect(await resultFor(bookItem.key)).toBe(m.workbench_match_result_yes());
    expect(await resultFor(articleItem.key)).toBe(
      m.workbench_match_result_no(),
    );
    // A mistake in one condition shows on that row, with the reason ZotLit
    // Query gives.
    await writeMatch(booksProfile, {
      and: ['itemType == "book"', 'tags.contain("Read")'],
    });
    let rows: (string | null)[] = [];
    expect(
      await waitFor(async () => {
        rows = JSON.parse(
          await obEval(
            vaultId,
            `(function(){return JSON.stringify(Array.from((${activeWorkbenchContent})?.querySelectorAll('[data-condition-row]')??[]).map(row=>row.querySelector('[role=alert]')?.textContent??null));})()`,
          ),
        ) as (string | null)[];
        return rows.length === 2 && rows[1] !== null;
      }),
    ).toBe(true);
    expect(rows[0]).toBeNull();
    expect(rows[1]).toContain("contain");
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
        "(function(){var services=app.plugins.plugins.zotlit.services;var settings=services.settings.current;return JSON.stringify({hostname:settings['server.hostname'],port:services.localServer.effectivePort,sourceId:services.zoteroPref.sourceId});})()",
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
      `(()=>{${PAGE}press(Array.from(activeDocument.querySelectorAll('.modal')).at(-1).querySelector('[data-profile-choice-scope=unresolved] [data-profile-choice]'),'unresolved Profile choice');return true;})()`,
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
        kind: "collection",
        operator: "within",
        value: parent.name,
      }),
    ).toBe(true);
    await obEval(
      vaultId,
      `(async()=>{${PAGE}var editor=${activeWorkbenchContent};await pick(editor.querySelector('[data-condition-row] select[aria-label=${JSON.stringify(m.workbench_filter_operator())}]'),'contains','Operator');return true;})()`,
    );
    expect(
      await conditionReady({
        kind: "collection",
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
        `(function(){${PAGE}var settings=${settingsContent};var row=Array.from(settings.querySelectorAll('.setting-item')).find(row=>row.querySelector('.setting-item-name')?.textContent===${JSON.stringify(booksProfile.label)});var button=row&&(Array.from(row.querySelectorAll('button')).find(button=>button.getAttribute('aria-label')===${JSON.stringify(m.workbench_more_actions())})??row.querySelector('.extra-setting-button'));if(!button)return false;press(button,'More actions');return true;})()`,
        { expected: "true" },
      ),
    ).toBe(true);
    expect(
      await obEvalUntil(
        vaultId,
        `(function(){${PAGE}var doc=(${settingsContent}).ownerDocument;var title=Array.from(doc.querySelectorAll('.menu-item-title')).find(title=>title.textContent.trim()===${JSON.stringify(m.settings_profile_delete())});var item=title?.closest('.menu-item');if(!item)return false;press(item,'Delete');return true;})()`,
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
        `(function(){${PAGE}var doc=(${settingsContent}).ownerDocument;var label=Array.from(doc.querySelectorAll('.modal label')).find(label=>label.textContent===${JSON.stringify(m.settings_profile_delete_move_files({ folder: "literatures/" }))});var checkbox=label?.querySelector('input[type=checkbox]');if(!checkbox||checkbox.checked)return false;press(label,'Move files');return checkbox.checked;})()`,
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
    expect(managedRegion(updated)).toBe(
      [
        "%%zt-managed%%",
        "## Annotations",
        "",
        "```zotquery",
        "views:",
        "  - type: annotations",
        "    name: Annotations",
        "    from: annotations",
        "    filters: item == this.item",
        "    sort:",
        "      - property: attachment.dateAdded",
        "        direction: ASC",
        "      - property: sortIndex",
        "        direction: ASC",
        "```",
        "",
        "%%/zt-managed%%",
      ].join("\n"),
    );
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
      await using cleanup = new AsyncDisposableStack();
      cleanup.defer(async () => {
        await obEval(vaultId, "app.setting.close();true");
      });
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
          `(function(){var names=Array.from((${settingsContent}).querySelectorAll('.setting-item-name'),el=>el.textContent);return String(names.includes(${JSON.stringify(m.settings_local_server_enabled_name())})&&!names.includes(${JSON.stringify(m.settings_local_server_workbench_name())})&&!names.includes(${JSON.stringify(m.template_workbench_preference_name())})&&!app.commands.commands['zotlit:open-profile-web-workbench']);})()`,
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
          `(function(){${PAGE}var radio=document.querySelector('input[name="zotlit-customize-destination"][value="native"]');if(!radio)return false;press(radio.closest('label')??radio,'Native destination');var row=Array.from(document.querySelectorAll('.modal .setting-item')).find(el=>el.querySelector('.setting-item-name')?.textContent===${JSON.stringify(m.modal_workbench_launch_remember())});var toggle=row?.querySelector('.checkbox-container');if(!toggle)return false;press(toggle,'Remember');return true;})()`,
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
          `(function(){${PAGE}var row=Array.from(document.querySelectorAll('.setting-item')).find(el=>el.querySelector('.setting-item-name')?.textContent===${JSON.stringify(m.settings_local_server_workbench_connection_name())});if(!row||!row.textContent.includes(${JSON.stringify(new URL(origin).host)}))return false;var button=Array.from(row.querySelectorAll('button')).find(el=>el.textContent===${JSON.stringify(m.settings_local_server_workbench_disconnect())});if(!button)return false;press(button,'Disconnect');return true;})()`,
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

    // An earlier case leaves the settings modal open over the workspace.
    await obEval(
      vaultId,
      "(async function(){app.setting.close();var type='zotero-annotation-view';var leaf=app.workspace.getLeavesOfType(type)[0];if(!leaf){leaf=app.workspace.getRightLeaf(false);await leaf.setViewState({type:type,active:true});}app.workspace.revealLeaf(leaf);return true;})()",
    );
    expect(
      await obEvalUntil(vaultId, `String(!!${trigger})`, { expected: "true" }),
    ).toBe(true);
    await obEval(
      vaultId,
      `(function(){${PAGE}press(${trigger},'Annotation View header');return true;})()`,
    );
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
    await obEval(
      vaultId,
      `(function(){${PAGE}press(${trigger},'Annotation View header');return true;})()`,
    );
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
    it("lists the Child Notes of each paper across the Fixture Libraries", async () => {
      const answer = await query({
        library: "all",
        filter: "!notes.isEmpty()",
        fields: "notes[].title",
        sort: "indexedKey",
      });
      expect(answer.ok).toBe(true);
      expect(
        answer.rows!.map((row) => [
          row.indexedKey,
          row.values["notes[].title"],
        ]),
      ).toEqual([
        ["AAAAAAAA", ["Reading notes on the personal alpha"]],
        ["AAAAAAAAg4200309", ["Reading notes on the shared alpha"]],
        ["EEEE5555", ["Reading notes on the unkeyed personal item"]],
        ["HHHH8888g118", ["Reading notes on the lab archive alpha"]],
        ["IIII9999g990117", ["Reading notes on the consortium alpha"]],
        ["PREPRNT2", ["Reading notes on the preprint"]],
      ]);
      const paper = await query({
        filter: 'key == "AAAAAAAA"',
        fields: "notes",
      });
      expect(paper).toMatchObject({
        ok: true,
        rows: [
          {
            indexedKey: "AAAAAAAA",
            values: {
              notes: [
                {
                  indexedKey: "NNNNAAAA",
                  title: "Reading notes on the personal alpha",
                },
              ],
            },
          },
        ],
      });
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

  it("reads the Diagnostic Report of a failed zotlit:template-check", async () => {
    const answer = JSON.parse(
      await cliCommand(vaultId, "zotlit:template-check", {
        args: { mode: "sideways" },
      }),
    ) as {
      contractVersion: number;
      ok: boolean;
      diagnostic: {
        code: string;
        message: string;
        hint: string;
        report: string[];
      };
    };
    expect(answer.contractVersion).toBe(8);
    expect(answer.ok).toBe(false);
    expect(answer.diagnostic.code).toBe("INVALID_SELECTOR");
    expect(answer.diagnostic.report[0]).toBe(answer.diagnostic.message);
    expect(answer.diagnostic.report.at(-1)).toBe(answer.diagnostic.hint);
  });

  it("answers zotlit:query over the Library Scope and over named Libraries with the Fixture's Indexed Keys", async () => {
    const [myLibrary, sharedReading] = LIBRARIES;
    const wireOf = (library: (typeof LIBRARIES)[number]) =>
      library.groupID === null
        ? { type: "personal" }
        : { type: "group", groupID: library.groupID, name: library.name };
    const selectorOf = (library: (typeof LIBRARIES)[number]) =>
      library.groupID === null ? "personal" : `group:${library.groupID}`;

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
      itemsByModified(inScope).slice(0, 3),
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
      itemsByModified([myLibrary!, sharedReading!]),
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
      itemsByModified([sharedReading!]),
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
      return itemsByModified([myLibrary!]).filter((key) => keys.has(key));
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

  it("binds this to an Item and an Attachment through zotlit:query", async () => {
    const parents = ATTACHMENTS.filter(
      (attachment) => attachment.parentItemID === annotationItem.itemID,
    );
    const query = async (args: Record<string, string>) =>
      JSON.parse(
        await cliCommand(vaultId, "zotlit:query", {
          args: { fields: "[]", limit: "all", library: "personal", ...args },
        }),
      ) as ItemQueryReport;
    const keysOf = (report: ItemQueryReport) =>
      report.rows!.map((row) => row.indexedKey).toSorted();

    const marks = await query({
      from: "annotations",
      filter: "item == this.item",
      "this-item": annotationItem.key,
    });
    expect(marks).toMatchObject({
      ok: true,
      request: { context: { item: annotationItem.key } },
      warnings: [],
    });
    expect(keysOf(marks)).toEqual(
      ANNOTATIONS.filter((annotation) =>
        parents.some((parent) => parent.itemID === annotation.parentItemID),
      )
        .map((annotation) => annotation.key)
        .toSorted(),
    );

    const attachment = parents[0]!;
    const attachmentMarks = await query({
      from: "annotations",
      filter: "attachment == this.attachment",
      "this-attachment": attachment.key,
    });
    expect(keysOf(attachmentMarks)).toEqual(
      ANNOTATIONS.filter(
        (annotation) => annotation.parentItemID === attachment.itemID,
      )
        .map((annotation) => annotation.key)
        .toSorted(),
    );

    const files = await query({
      from: "attachments",
      filter: "item == this.item",
      "this-item": annotationItem.key,
    });
    expect(keysOf(files)).toEqual(
      parents.map((parent) => parent.key).toSorted(),
    );

    const item = await query({
      filter: "indexedKey == this.item.indexedKey",
      "this-item": annotationItem.key,
    });
    expect(keysOf(item)).toEqual([annotationItem.key]);

    const unbound = await query({
      from: "annotations",
      filter: "item == this.item",
    });
    expect(unbound).toMatchObject({
      ok: false,
      diagnostic: {
        code: "unbound-context",
        location: { argument: "filter", span: { from: 8, to: 17 } },
      },
    });
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

  it("exports papers per year as CSV and every paper as TSV through zotlit:query", async () => {
    const args = {
      group: "date.year",
      limit: "1",
      library: "personal",
      fields: "title,date.year",
    };
    const report = JSON.parse(
      await cliCommand(vaultId, "zotlit:query", { args }),
    ) as ItemQueryReport;
    expect(report.groups!.length).toBeGreaterThan(1);
    const quote = (text: string, separator: string) =>
      text.includes(separator) || /["\n]/.test(text)
        ? `"${text.replaceAll('"', '""')}"`
        : text;
    // Each cell here is a scalar: a title, a year, or an Indexed Key.
    const line = (cells: unknown[], separator: string) =>
      cells
        .map((value) =>
          quote(
            value == null
              ? ""
              : typeof value === "string"
                ? value
                : JSON.stringify(value),
            separator,
          ),
        )
        .join(separator);
    const csvPath = join(e2eFixture.root, "query-per-year.csv");
    const tsvPath = join(e2eFixture.root, "query-papers.tsv");
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(() => rm(csvPath, { force: true }));
    cleanup.defer(() => rm(tsvPath, { force: true }));

    // A grouped CSV export: the group value first, a byte order mark, CRLF.
    const receipt = JSON.parse(
      await cliCommand(vaultId, "zotlit:query", {
        args: { ...args, format: "csv", output: csvPath },
      }),
    );
    const csv = await readFile(csvPath);
    expect(receipt).toMatchObject({
      ok: true,
      returnedCount: report.returnedCount,
      file: { path: csvPath, bytes: csv.byteLength, format: "csv" },
    });
    expect(receipt).not.toHaveProperty("groups");
    expect(new TextDecoder("utf-8", { ignoreBOM: true }).decode(csv)).toBe(
      BYTE_ORDER_MARK +
        [
          "group,indexedKey,title,date.year",
          ...report.groups!.flatMap((group) =>
            group.rows.map((row) =>
              line(
                [
                  group.value,
                  row.indexedKey,
                  row.values.title,
                  row.values["date.year"],
                ],
                ",",
              ),
            ),
          ),
        ]
          .map((text) => `${text}\r\n`)
          .join(""),
    );

    // A TSV export of every paper: no byte order mark, LF.
    const papers = JSON.parse(
      await cliCommand(vaultId, "zotlit:query", {
        args: { library: "personal", fields: "title", limit: "all" },
      }),
    ) as ItemQueryReport;
    await cliCommand(vaultId, "zotlit:query", {
      args: {
        library: "personal",
        fields: "title",
        limit: "all",
        format: "tsv",
        output: tsvPath,
      },
    });
    expect(await readFile(tsvPath, "utf8")).toBe(
      [
        "indexedKey\ttitle",
        ...papers.rows!.map((row) =>
          line([row.indexedKey, row.values.title], "\t"),
        ),
      ]
        .map((text) => `${text}\n`)
        .join(""),
    );

    // The answer itself is JSON: CSV without a file is refused.
    expect(
      JSON.parse(
        await cliCommand(vaultId, "zotlit:query", {
          args: { ...args, format: "csv" },
        }),
      ),
    ).toMatchObject({
      ok: false,
      diagnostic: {
        code: "invalid-argument",
        details: { parameter: "format" },
      },
    });
  });

  it("computes Formulas on a Fixture Item through ZotLit Query", async () => {
    const query = async (args: Record<string, string>) =>
      JSON.parse(
        await cliCommand(vaultId, "zotlit:query", {
          args: { library: "personal", ...args },
        }),
      ) as ItemQueryReport;

    const computed = await query({
      filter: `indexedKey == "${annotationItem.key}"`,
      formulas: JSON.stringify({
        next: "date.year + 1",
        lower: "title.lower()",
        unused: "title",
      }),
      fields: "title,formula.next,formula.lower",
    });
    expect(computed).toMatchObject({
      ok: true,
      request: {
        formulas: {
          next: "date.year + 1",
          lower: "title.lower()",
          unused: "title",
        },
        fields: ["title", "formula.next", "formula.lower"],
      },
      warnings: [
        {
          code: "unused-formula",
          severity: "warning",
          location: { argument: "formulas", path: "unused" },
        },
      ],
      rows: [
        {
          indexedKey: annotationItem.key,
          values: {
            title: annotationItem.title,
            "formula.next": Number(annotationItem.date.slice(0, 4)) + 1,
            "formula.lower": annotationItem.title.toLowerCase(),
          },
        },
      ],
    });

    // A value that the Item cannot compute is an Error Value cell; a filter
    // that meets one excludes the Item.
    const failed = await query({
      filter: `indexedKey == "${annotationItem.key}"`,
      formulas: JSON.stringify({ volumes: "number(title)" }),
      fields: "formula.volumes",
    });
    expect(failed).toMatchObject({
      ok: true,
      rows: [
        {
          indexedKey: annotationItem.key,
          values: {
            "formula.volumes": {
              kind: "error",
              code: "unparseable-text",
              message: `number() cannot read ${JSON.stringify(annotationItem.title)} as a number.`,
            },
          },
        },
      ],
    });
    const excluded = await query({
      filter: `indexedKey == "${annotationItem.key}" && number(title) > 0`,
    });
    expect(excluded).toMatchObject({ ok: true, rows: [] });

    const arithmetic = await query({
      formulas: JSON.stringify({ twice: "title * 2" }),
      fields: "formula.twice",
    });
    expect(arithmetic).toMatchObject({
      ok: false,
      diagnostic: {
        code: "wrong-operand-type",
        location: { argument: "formulas", path: "twice" },
      },
    });

    const wrong = await query({
      formulas: JSON.stringify({ short: "title.nope()" }),
      fields: "formula.short",
    });
    expect(wrong).toMatchObject({
      ok: false,
      diagnostic: {
        code: "unknown-function",
        location: { argument: "formulas", path: "short" },
      },
    });
    expect(wrong.diagnostic!.report.join("\n")).toContain("formula.short");

    const undefinedFormula = await query({ fields: "formula.year" });
    expect(undefinedFormula).toMatchObject({
      ok: false,
      diagnostic: {
        code: "unknown-formula",
        location: { argument: "fields", index: 0 },
      },
    });
  });

  it("filters by a Formula and reads a dependent Formula through ZotLit Query", async () => {
    const query = async (args: Record<string, string>) =>
      JSON.parse(
        await cliCommand(vaultId, "zotlit:query", {
          args: { library: "personal", ...args },
        }),
      ) as ItemQueryReport;
    const yearOf = (item: FixtureItem) => Number(item.date.slice(0, 4));
    const recent = ITEMS.filter(
      (item) => item.libraryID === 1 && yearOf(item) >= 2020,
    );
    expect(recent.length).toBeGreaterThan(1);

    const report = await query({
      formulas: JSON.stringify({
        year: "date.year",
        next: "formula.year + 1",
      }),
      filter: "formula.year >= 2020",
      fields: "formula.next",
      limit: "100",
    });
    expect(report).toMatchObject({ ok: true, warnings: [] });
    expect(report.rows).toHaveLength(recent.length);
    expect(report.rows).toEqual(
      expect.arrayContaining(
        recent.map((item) => ({
          indexedKey: item.key,
          values: { "formula.next": yearOf(item) + 1 },
        })),
      ),
    );

    const cycle = await query({
      formulas: JSON.stringify({ a: "formula.b + 1", b: "formula.a" }),
      fields: "formula.a",
    });
    expect(cycle).toMatchObject({
      ok: false,
      diagnostic: {
        code: "formula-cycle",
        location: { argument: "formulas", path: "b" },
      },
    });
    expect(cycle.diagnostic!.report.join("\n")).toContain(
      "formula.a → formula.b → formula.a",
    );
  });

  it("groups papers per tag and per Collection through zotlit:query", async () => {
    const papers = ITEMS.filter((item) => item.libraryID === 1);
    /** Each group value with the keys of its papers, from the Fixture Spec. */
    const expectedGroups = (values: (paper: FixtureItem) => string[]) => {
      const groups = new Map<string | null, string[]>();
      for (const paper of papers) {
        const distinct = [...new Set(values(paper))];
        for (const value of distinct.length ? distinct : [null])
          groups.set(value, [...(groups.get(value) ?? []), paper.key]);
      }
      return groups;
    };
    const groupsOf = (report: ItemQueryReport) =>
      new Map(
        report.groups!.map(({ value, count, rows }) => [
          value,
          { count, keys: rows.map((row) => row.indexedKey).toSorted() },
        ]),
      );
    const query = async (args: Record<string, string>) =>
      JSON.parse(
        await cliCommand(vaultId, "zotlit:query", {
          args: { library: "personal", limit: "all", fields: "[]", ...args },
        }),
      ) as ItemQueryReport;

    const byTag = await query({ group: "tags[].name" });
    const tags = expectedGroups((paper) =>
      (paper.tags ?? []).map((tag) => tag.name),
    );
    expect(tags.size).toBeGreaterThan(2);
    expect(byTag).toMatchObject({
      ok: true,
      request: { group: "tags[].name" },
      totalCount: papers.length,
      truncated: false,
    });
    expect(groupsOf(byTag)).toEqual(
      new Map(
        [...tags].map(([value, keys]) => [
          value,
          { count: keys.length, keys: keys.toSorted() },
        ]),
      ),
    );
    expect(byTag.groups!.at(-1)!.value).toBeNull();
    // A paper with two Tags is in two groups, so the counts add up to more.
    expect(byTag.returnedCount).toBe(
      [...tags.values()].reduce((sum, keys) => sum + keys.length, 0),
    );
    expect(byTag.returnedCount).toBeGreaterThan(papers.length);

    const pathOf = (collectionID: number): string => {
      const collection = COLLECTIONS.find(
        (entry) => entry.collectionID === collectionID,
      )!;
      return collection.parentCollectionID === undefined
        ? collection.name
        : `${pathOf(collection.parentCollectionID)}/${collection.name}`;
    };
    const parent = COLLECTIONS.find(({ key }) => key === "PERSNAL2")!;
    const byCollection = await query({
      group: "collections[]",
      filter: `collections.within(${JSON.stringify(parent.name)})`,
    });
    const filed = papers.filter((paper) =>
      paper.collectionIDs.some((id) => pathOf(id).startsWith(parent.name)),
    );
    const collections = expectedGroups((paper) =>
      filed.includes(paper) ? paper.collectionIDs.map(pathOf) : [],
    );
    collections.delete(null);
    expect(byCollection).toMatchObject({
      ok: true,
      request: { group: "collections[]" },
      totalCount: filed.length,
    });
    expect(groupsOf(byCollection)).toEqual(
      new Map(
        [...collections].map(([value, keys]) => [
          value,
          { count: keys.length, keys: keys.toSorted() },
        ]),
      ),
    );
    expect(collections.has(`${parent.name}/Personal child`)).toBe(true);
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
    const query = async (filter: string) =>
      JSON.parse(
        await cliCommand(vaultId, "zotlit:query", {
          args: { filter, fields: "[]", limit: "1" },
        }),
      ) as ItemQueryReport;
    for (const probe of [
      {
        filter: 'itemType == "book" AND date.year > 2010',
        code: "invalid-filter",
        at: "AND",
        suggestion: 'itemType == "book" && date.year > 2010',
      },
      {
        filter: "year > 2015",
        code: "unknown-field",
        at: "year",
        suggestion: "date.year",
      },
    ]) {
      const answer = await query(probe.filter);
      expect(answer).toMatchObject({
        contractVersion: 3,
        command: "zotlit:query",
        ok: false,
      });
      expectQueryDiagnostic(answer.diagnostic, { ...probe, severity: "error" });
    }

    const probe = {
      filter: 'tags == "bulk"',
      code: "never-true",
      at: 'tags == "bulk"',
      suggestion: 'tags.contains("bulk")',
    };
    const answer = await query(probe.filter);
    expect(answer).toMatchObject({
      contractVersion: 3,
      command: "zotlit:query",
      ok: true,
      returnedCount: 0,
      rows: [],
      truncated: false,
    });
    expect(answer.warnings).toHaveLength(1);
    expectQueryDiagnostic(answer.warnings?.[0], {
      ...probe,
      severity: "warning",
    });
    expect(Object.keys(answer).indexOf("warnings")).toBeLessThan(
      Object.keys(answer).indexOf("rows"),
    );
  });

  it("reports zotlit:query from=annotations syntax, unknown names, and never-true warnings", async () => {
    const query = async (filter: string) =>
      JSON.parse(
        await cliCommand(vaultId, "zotlit:query", {
          args: { from: "annotations", filter, fields: "[]", limit: "1" },
        }),
      ) as ItemQueryReport;
    for (const probe of [
      {
        filter: 'type == "image" AND item.date.year > 2010',
        code: "invalid-filter",
        at: "AND",
        suggestion: 'type == "image" && item.date.year > 2010',
      },
      {
        filter: "pageLable == 1",
        code: "unknown-field",
        at: "pageLable",
        suggestion: "pageLabel",
      },
    ]) {
      const answer = await query(probe.filter);
      expect(answer).toMatchObject({
        contractVersion: 3,
        command: "zotlit:query",
        ok: false,
      });
      expectQueryDiagnostic(answer.diagnostic, { ...probe, severity: "error" });
    }

    const probe = {
      filter: 'tags == "bulk"',
      code: "never-true",
      at: 'tags == "bulk"',
      suggestion: 'tags.contains("bulk")',
    };
    const answer = await query(probe.filter);
    expect(answer).toMatchObject({
      contractVersion: 3,
      command: "zotlit:query",
      ok: true,
      returnedCount: 0,
      rows: [],
      truncated: false,
    });
    expect(answer.warnings).toHaveLength(1);
    expectQueryDiagnostic(answer.warnings?.[0], {
      ...probe,
      severity: "warning",
    });
    expect(Object.keys(answer).indexOf("warnings")).toBeLessThan(
      Object.keys(answer).indexOf("rows"),
    );
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
        `(async()=>{${PAGE}
          await using cleanup=new AsyncDisposableStack();
          const leaf=cleanup.adopt(app.workspace.getRightLeaf(true),leaf=>leaf.detach());
          await leaf.setViewState({type:'zotero-annotation-view',state:{followMode:'pinned',pinnedItemKey:${JSON.stringify(annotationItem.key)}}});
          const view=leaf.view;await view.read;
          const count=()=>view.contentEl.querySelectorAll('.zt-annot-card').length;
          await until('sidebar cards',()=>count()>0,5000).catch(()=>{});
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
    // found. The new Items show once it completes. The 10 ms pause is the
    // sampling cadence of the measurement, not a wait for a state.
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

  it("removes every ZotLit vault and metadata cache handler as ZotLit is disabled, while its database worker still closes", async () => {
    // ZotLit's handlers are the entries its enable adds to the listener
    // lists. The worker may take seconds to close; the handlers go at once.
    const survivors = await obJson<string[]>(
      vaultId,
      `(async()=>{
        const listed=()=>[app.vault,app.metadataCache].flatMap(e=>Object.entries(e._??{}).flatMap(([name,entries])=>entries.map(entry=>[name,entry])));
        try{
          await app.plugins.disablePlugin('zotlit');
          const before=new Set(listed().map(([,entry])=>entry));
          await app.plugins.enablePlugin('zotlit');
          await app.plugins.plugins.zotlit.services.zoteroReads.ready;
          const added=listed().filter(([,entry])=>!before.has(entry));
          if(added.length===0)throw new Error('ZotLit added no handler');
          await app.plugins.disablePlugin('zotlit');
          const end=Date.now()+1000;
          let left=added;
          while(true){
            const now=new Set(listed().map(([,entry])=>entry));
            left=added.filter(([,entry])=>now.has(entry));
            if(left.length===0||Date.now()>end)break;
            await new Promise(r=>setTimeout(r,20));
          }
          return JSON.stringify(left.map(([name,entry])=>name+': '+String(entry.fn).slice(0,120)));
        }finally{
          if(!app.plugins.plugins.zotlit)await app.plugins.enablePlugin('zotlit');
        }
      })()`,
    );
    expect(survivors).toEqual([]);
  }, 120_000);

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
        await obEval(vaultId, workers("String(record.spawned.length)")),
      ).toBe("1");
      expect(
        await obEvalUntil(
          vaultId,
          "String(app.plugins.plugins.zotlit.services.zoteroReads.state)",
          { expected: "ready" },
        ),
      ).toBe(true);
      expect(
        await obEvalUntil(
          vaultId,
          `app.plugins.plugins.zotlit.services.citationLookup.read({indexedKeys:[${JSON.stringify(targetItem.key)}]}).then(function(answer){return String(answer.citekeyOf(${JSON.stringify(targetItem.key)}));})`,
          { expected: targetItem.citationKey! },
        ),
      ).toBe(true);
      // Termination emits no browser error event: liveness must detect it.
      await obEval(
        vaultId,
        workers(
          "(record.spawned.find(function(entry){return entry.name==='zotlit-zotero-reads';}).worker.terminate(),true)",
        ),
      );
      expect(
        await obEvalUntil(
          vaultId,
          "String(app.plugins.plugins.zotlit.services.citationLookup.status)",
          { expected: "failed", tries: 160 },
        ),
      ).toBe(true);
      await obEval(
        vaultId,
        "app.plugins.plugins.zotlit.services.zoteroReads.refresh().then(function(){return true;})",
      );
      expect(
        await obEvalUntil(
          vaultId,
          "String(app.plugins.plugins.zotlit.services.zoteroReads.state)",
          { expected: "ready" },
        ),
      ).toBe(true);
      // SearchItems hydrates its hits from SQLite in the interactive worker.
      const hits = JSON.parse(
        await obEval(
          vaultId,
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
          vaultId,
          "String(app.plugins.plugins.zotlit.services.citationLookup.status)",
          { expected: "fresh" },
        ),
      ).toBe(true);
      expect(
        await obEvalUntil(
          vaultId,
          `app.plugins.plugins.zotlit.services.citationLookup.whenResolved().then(function(){return app.plugins.plugins.zotlit.services.citationLookup.read({indexedKeys:[${JSON.stringify(targetItem.key)}]}).then(function(answer){return String(answer.citekeyOf(${JSON.stringify(targetItem.key)}));});})`,
          { expected: targetItem.citationKey! },
        ),
      ).toBe(true);
      // Hold the lookup request so unload must cancel the pending worker read.
      await obEval(
        vaultId,
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
        await obEvalUntil(vaultId, workers("String(record.heldSnapshot)"), {
          expected: "true",
        }),
      ).toBe(true);
      // Unload ends the recovered worker and its pending citation read.
      await obEval(
        vaultId,
        "app.plugins.disablePlugin('zotlit').then(function(){return true;})",
      );
      const ended = await obEvalUntil(
        vaultId,
        workers(
          "String(record.spawned.filter(function(entry){return entry.name==='zotlit-zotero-reads';}).every(function(entry){return record.ended.has(entry.worker);}))",
        ),
        { expected: "true", tries: 120 },
      );
      expect(
        ended,
        await obEval(
          vaultId,
          workers(
            "JSON.stringify(record.spawned.map(function(entry){return {name:entry.name,ended:record.ended.has(entry.worker)};}))",
          ),
        ),
      ).toBe(true);
    }
  }, 120_000);
});

/** The `zotlit:query` reply shape this suite reads (see
 *  apps/obsidian/src/services/item-query/contract.ts and answer.ts). */
/**
 * Rows with `item.title`, grouped by Item as a Query View groups them: the
 * groups from A to Z by the Item's title, the rows of a group in query order.
 */
/**
 * The Indexed Keys of the Fixture's Items in `libraries`, most recently
 * modified first, as ZotLit Query orders them by `-dateModified`.
 */
function itemsByModified(
  libraries: readonly (typeof LIBRARIES)[number][],
): string[] {
  return libraries
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
}

function byItem(rows: NonNullable<ItemQueryReport["rows"]>): {
  cards: string[];
  headings: string[];
} {
  const groups = Map.groupBy(rows, (row) => row.itemIndexedKey);
  const title = (key: string | undefined) =>
    String(groups.get(key)![0]!.values["item.title"]);
  const order = [...groups.keys()].toSorted(
    (a, b) =>
      title(a).localeCompare(title(b), "en") ||
      String(a).localeCompare(String(b), "en"),
  );
  return {
    cards: order.flatMap((key) =>
      groups.get(key)!.map((row) => row.indexedKey),
    ),
    headings: order.map(title),
  };
}

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
  rows?: {
    indexedKey: string;
    itemIndexedKey?: string;
    values: Record<string, unknown>;
  }[];
  diagnostic?: ItemQueryDiagnostic;
  warnings?: ItemQueryDiagnostic[];
}

/** Asserts one `zotlit:query` diagnostic of a syntax or name probe. */
function expectQueryDiagnostic(
  diagnostic: ItemQueryDiagnostic | undefined,
  probe: {
    code: string;
    severity: ItemQueryDiagnostic["severity"];
    at: string;
    suggestion: string;
  },
): void {
  expect(diagnostic).toMatchObject({
    code: probe.code,
    severity: probe.severity,
    excerpt: { at: probe.at },
  });
  expect(diagnostic!.suggestions[0]).toBe(probe.suggestion);
  expect(diagnostic!.message).not.toBe("");
  expect(diagnostic!.hint).not.toBe("");
  expect(diagnostic!.report[0]).toBe(diagnostic!.message);
  expect(diagnostic!.report.at(-1)).toBe(diagnostic!.hint);
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
    expect(original).toContain("```zotquery");
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
          `(function(){${PAGE}var settings=${settingsContent};var button=Array.from(settings.querySelectorAll('[aria-label],button')).find(el=>el.getAttribute('aria-label')===${JSON.stringify(m.settings_profile_add())}||el.textContent.trim()===${JSON.stringify(m.settings_profile_add())});if(!button||button.disabled)return false;press(button,'Add profile');return true;})()`,
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
    `(function(){${PAGE}var doc=${documentExpression};var modal=Array.from(doc.querySelectorAll('.modal')).at(-1);var button=modal&&Array.from(modal.querySelectorAll('button')).find(button=>button.textContent.trim()===${JSON.stringify(label)});if(!button||button.disabled)return false;press(button,${JSON.stringify(label)});return true;})()`,
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
      "(function(){var services=app.plugins.plugins.zotlit.services;var settings=services.settings.current;return JSON.stringify({hostname:settings['server.hostname'],port:services.localServer.effectivePort,sourceId:services.zoteroPref.sourceId});})()",
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
