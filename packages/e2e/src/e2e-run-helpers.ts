import { readFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { expect } from "vitest";

import type { FixtureItem } from "@zotlit/scripts/fixture";

import { readingState } from "./e2e-run-fixture.ts";
import { obRun, obRunUntil } from "./obsidian-cli.ts";
import { waitFor } from "./obsidian-cli.ts";
import type { CodeMirrorElement, PagePdfView } from "./page-notes-types.ts";
import { withWorkbenchSurfaces } from "./workbench-surfaces.ts";

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
  await obRun(
    vaultId,
    async ({ app }) => {
      app.vault.setConfig("settingsPopoutWindow", false);
      app.setting.open();
    },
    undefined,
  );
  await obRun(
    vaultId,
    async ({ app }) => {
      app.setting.openTabById("zotlit");
    },
    undefined,
  );
  await obRun(
    vaultId,
    async ({ app }, { pageId }) => {
      app.setting.navigateToSearchResult({
        tab: app.setting.activeTab!,
        pagePath: [pageId],
      });
    },
    { pageId },
  );
}

export async function changeNativeAnnotationCallout(
  vaultId: string,
  options: {
    view: { path?: string; originatingNote?: string };
    vaultPath: string;
    tabLabel: string;
    beforeEdit?: () => Promise<void>;
  },
): Promise<void> {
  const { view, vaultPath, tabLabel } = options;
  await withWorkbenchSurfaces(
    vaultId,
    obRunUntil(
      vaultId,
      ({ page }, { view, tabLabel }) => {
        const host = page.workbench(view);
        const tab = Array.from(
          host?.contentEl.querySelectorAll<HTMLElement>("[role=tab]") ?? [],
        ).find((element) => element.textContent.trim() === tabLabel);
        if (!tab) return false;
        page.press(tab, tabLabel);
        return true;
      },
      { view, tabLabel },
      { what: "annotation template tab" },
    ),
  );
  await obRunUntil(
    vaultId,
    ({ page }, { view }) => {
      const host = page.workbench(view);
      const editor = Array.from(
        host?.contentEl.querySelectorAll<CodeMirrorElement>(".cm-content") ??
          [],
      ).find((element) => element.textContent.includes("[!note]"))?.cmTile?.root
        ?.view;
      return !!editor?.state.doc.toString().includes("[!note]");
    },
    { view },
    { what: "annotation callout editor" },
  );
  await options.beforeEdit?.();
  const templatePath = await obRun(
    vaultId,
    ({ page }, { view }) => page.workbench(view)!.file!.path,
    { view },
  );
  await obRun(
    vaultId,
    ({ page }, { view }) => {
      const editor = Array.from(
        page
          .workbench(view)!
          .contentEl.querySelectorAll<CodeMirrorElement>(".cm-content"),
      ).find((element) => element.textContent.includes("[!note]"))!.cmTile!.root
        .view;
      const from = editor.state.doc.toString().indexOf("[!note]");
      editor.dispatch({
        changes: { from, to: from + 7, insert: "[!quote]" },
        userEvent: "input.type",
      });
    },
    { view },
  );
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
  return (await obRun(
    vaultId,
    async ({ app }) => {
      const view = app.workspace.activeLeaf?.view as
        | import("obsidian").FileView
        | undefined;
      const file = view?.file ?? null;
      return {
        type: view?.getViewType() ?? null,
        path: file?.path ?? null,
        key: file
          ? (app.metadataCache.getFileCache(file)?.frontmatter?.[
              "zotero-key"
            ] ?? null)
          : null,
        opening: !!(
          app.workspace.activeLeaf as
            | (import("obsidian").WorkspaceLeaf & { working?: boolean })
            | null
        )?.working,
      };
    },
    undefined,
  )) as ActiveTab;
}

export function pdfOpened(vaultId: string, path: string): Promise<boolean> {
  return obRunUntil(
    vaultId,
    async ({ app }, { expectedPath }) => {
      const view = app.workspace.activeLeaf?.view as PagePdfView | undefined;
      return (
        view?.getViewType() === "pdf" &&
        view.file?.path === expectedPath &&
        (view.viewer?.child?.pdfViewer?.pdfViewer?.pagesCount ?? 0) > 0
      );
    },
    { expectedPath: path },
    {
      tries: 120,
      what: "the expected PDF to be the active leaf with pages loaded",
    },
  );
}
