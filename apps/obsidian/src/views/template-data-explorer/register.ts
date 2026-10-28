import { Effect } from "effect";
import type { App, PaneType, Plugin } from "obsidian";

import type { EffectBridge } from "@/lib/effect-bridge";
import * as m from "@/lib/i18n/generated/messages";

import "./style.css";
import { MENU_SECTION } from "@/lib/menu-section";
import { Workspace } from "@/lib/obsidian-workspace";
import type { ViewRegistryHandle } from "@/lib/view-atoms";
import type { FileMenuSegment } from "@/services/file-menu";
import type { ItemLookupHandle } from "@/services/item-lookup/handle";
import type { PluginSettings } from "@/services/settings/service";
import { inLayoutTurn, openProfileExplorer } from "@/views/note-preview/layout";
import { activeTemplateWorkbench } from "@/views/note-preview/register";
import { startTemplateWorkbenchAction } from "@/views/template-workbench/actions";
import type { WorkbenchActionDeps } from "@/views/template-workbench/actions";

import { EXPLORER_VIEW_TYPE, TemplateDataExplorerView } from "./view";

type ExplorerPlugin = Pick<
  Plugin,
  "registerView" | "addCommand" | "app" | "manifest"
>;

export interface ExplorerRegistrationDeps {
  app: App;
  registry: ViewRegistryHandle;
  itemLookup: ItemLookupHandle;
  settings: Pick<PluginSettings["Service"], "current" | "changes">;
  bridge: Pick<EffectBridge, "runSync" | "runAndForget">;
}

export function registerTemplateDataExplorer(
  plugin: ExplorerPlugin,
  deps: ExplorerRegistrationDeps & WorkbenchActionDeps,
): void {
  plugin.registerView(
    EXPLORER_VIEW_TYPE,
    (leaf) =>
      new TemplateDataExplorerView(leaf, {
        ...deps,
        pluginVersion: plugin.manifest.version,
      }),
  );

  plugin.addCommand({
    id: "open-template-data-explorer",
    name: m.command_open_template_data_explorer_name(),
    callback: () =>
      startTemplateWorkbenchAction(
        deps,
        "open-template-data-explorer",
        openTemplateDataExplorer(plugin.app),
      ),
  });
}

/**
 * Every in-vault entry point delegates to this function. Two opens at once
 * open one pane.
 *
 * @param options.paneType a pane the caller asks for, in Obsidian's URI
 *   vocabulary. Absent keeps the explorer's usual placement: the reusable
 *   sidebar leaf.
 */
export const openTemplateDataExplorer = Effect.fn("TemplateDataExplorer.open")(
  function* (
    app: App,
    state?: { itemIndexedKey: string; anchorAnnotationKey?: string },
    options: { paneType?: PaneType } = {},
  ) {
    const editor = activeTemplateWorkbench(app);
    if (!state && editor) return yield* openProfileExplorer(editor);
    yield* inLayoutTurn(openExplorerLeaf(state, options.paneType));
  },
);

const openExplorerLeaf = Effect.fn("TemplateDataExplorer.openLeaf")(function* (
  state: { itemIndexedKey: string; anchorAnnotationKey?: string } | undefined,
  paneType: PaneType | undefined,
) {
  const workspace = yield* Workspace;
  const launch = state ? { ...state, zotlitLaunch: true } : undefined;
  // A named pane always gets a fresh leaf; without one the explorer reuses the
  // free sidebar leaf it already has.
  const reused = paneType
    ? undefined
    : (yield* workspace.leavesOfType(EXPLORER_VIEW_TYPE)).find(
        (leaf) => !leaf.group && !leaf.pinned,
      );
  const leaf =
    reused ??
    (paneType
      ? yield* workspace.getLeaf(paneType)
      : yield* workspace.getRightLeaf(true));
  if (!leaf) return;
  if (!reused || launch) {
    yield* Effect.tryPromise(() =>
      leaf.setViewState({
        type: EXPLORER_VIEW_TYPE,
        active: true,
        state: launch,
      }),
    );
  }
  yield* workspace.revealLeaf(leaf);
});

/** "Explore template data" on a Literature Note's file menu. */
export function explorerFileMenu(
  app: App,
  deps: WorkbenchActionDeps,
): FileMenuSegment {
  return (menu, { itemKey }) => {
    if (!itemKey) return;
    menu.addItem((item) =>
      item
        .setSection(MENU_SECTION.view)
        .setTitle(m.template_data_explorer_menu_explore())
        .setIcon("braces")
        .onClick(() => {
          startTemplateWorkbenchAction(
            deps,
            "open-template-data-explorer",
            openTemplateDataExplorer(app, { itemIndexedKey: itemKey }),
          );
        }),
    );
  };
}
