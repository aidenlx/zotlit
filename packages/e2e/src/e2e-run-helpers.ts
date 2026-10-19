import { readFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { expect } from "vitest";

import type { FixtureItem } from "@zotlit/scripts/fixture";

import { readingState } from "./e2e-run-fixture.ts";
import { obEval, obEvalUntil, waitFor } from "./obsidian-cli.ts";
import { PAGE } from "./page-gestures.ts";

export async function availableLoopbackPort(): Promise<number> {
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

export function unreadOf(
  items: readonly FixtureItem[],
  noted: (item: FixtureItem) => boolean = readingState.noted,
): FixtureItem[] {
  return items.filter(
    (item) =>
      !readingState.read(item) && !readingState.annotated(item) && !noted(item),
  );
}

export async function openProfilesSettings(
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

export async function changeNativeAnnotationCallout(
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

export interface ActiveTab {
  type: string | null;
  path: string | null;
  key: string | null;
  opening: boolean;
}

export async function activeTab(vaultId: string): Promise<ActiveTab> {
  return JSON.parse(
    await obEval(
      vaultId,
      "(()=>{const view=app.workspace.activeLeaf?.view;const file=view?.file??null;return JSON.stringify({type:view?.getViewType()??null,path:file?.path??null,key:file?app.metadataCache.getFileCache(file)?.frontmatter?.['zotero-key']??null:null,opening:!!app.workspace.activeLeaf?.working});})()",
    ),
  ) as ActiveTab;
}

export function pdfOpened(vaultId: string, path: string): Promise<boolean> {
  return obEvalUntil(
    vaultId,
    `(()=>{const view=app.workspace.activeLeaf?.view;return String(view?.getViewType()==='pdf'&&view.file?.path===${JSON.stringify(path)}&&(view.viewer?.child?.pdfViewer?.pdfViewer?.pagesCount??0)>0);})()`,
    { expected: "true", tries: 120 },
  );
}
