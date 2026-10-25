import type { App, PaneType, Plugin } from "obsidian";

import type { EffectBridge } from "@/lib/effect-bridge";
import type { SubscriptionRuntime } from "@/lib/effect-stream";
import * as m from "@/lib/i18n/generated/messages";

import "./style.css";
import { MENU_SECTION } from "@/lib/menu-section";
import type { FileMenuSegment } from "@/services/file-menu";
import type { ItemLookup } from "@/services/item-lookup/service";
import type { PlainNoteIndex } from "@/services/note-index/plain";
import type { PluginSettings } from "@/services/settings/service";
import type { PlainTemplate } from "@/services/template/plain";
import type { PlainZoteroPref } from "@/services/zotero-pref/plain";
import type { PlainZoteroReads } from "@/services/zotero-reads/plain";
import {
  activeTemplateWorkbench,
  openProfileExplorer,
} from "@/views/note-preview/register";

import { EXPLORER_VIEW_TYPE, TemplateDataExplorerView } from "./view";

type ExplorerPlugin = Pick<
  Plugin,
  "registerView" | "addCommand" | "app" | "manifest"
>;

export interface ExplorerRegistrationDeps {
  runtime: SubscriptionRuntime;
  app: App;
  zoteroReads: Pick<
    PlainZoteroReads,
    | "acquireRead"
    | "reads"
    | "state"
    | "changed"
    | "degraded"
    | "refresh-failed"
    | "refreshing"
    | "db-file-missing"
    | "refresh-requested"
  >;
  noteIndex: Pick<
    PlainNoteIndex,
    "whenIndexed" | "getNotesByItemKey" | "getImportedNoteByNoteKey"
  >;
  zoteroPref: Pick<PlainZoteroPref, "dataDir" | "baseAttachmentPath">;
  itemLookup: ItemLookup;
  settings: Pick<PluginSettings["Service"], "current" | "changes">;
  bridge: Pick<EffectBridge, "runSync">;
  templates: Pick<
    PlainTemplate,
    "javascriptTemplatesEnabled" | "render" | "renderCitation"
  >;
}

export function registerTemplateDataExplorer(
  plugin: ExplorerPlugin,
  deps: ExplorerRegistrationDeps,
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
    callback: () => void openTemplateDataExplorer(plugin.app),
  });
}

/**
 * Every in-vault entry point delegates to this function.
 *
 * @param options.paneType a pane the caller asks for, in Obsidian's URI
 *   vocabulary. Absent keeps the explorer's usual placement: the reusable
 *   sidebar leaf.
 */
export async function openTemplateDataExplorer(
  app: App,
  state?: { itemIndexedKey: string; anchorAnnotationKey?: string },
  options: { paneType?: PaneType } = {},
): Promise<void> {
  const { paneType } = options;
  const editor = activeTemplateWorkbench(app);
  if (!state && editor) return openProfileExplorer(app, editor);
  const { workspace } = app;
  const launch = state ? { ...state, zotlitLaunch: true } : undefined;
  // A named pane always gets a fresh leaf; without one the explorer reuses the
  // free sidebar leaf it already has.
  const reused = paneType
    ? undefined
    : workspace
        .getLeavesOfType(EXPLORER_VIEW_TYPE)
        .find((leaf) => !leaf.group && !leaf.pinned);
  const leaf =
    reused ??
    (paneType ? workspace.getLeaf(paneType) : workspace.getRightLeaf(true));
  if (!leaf) return;
  if (!reused || launch) {
    await leaf.setViewState({
      type: EXPLORER_VIEW_TYPE,
      active: true,
      state: launch,
    });
  }
  void workspace.revealLeaf(leaf);
}

/** "Explore template data" on a Literature Note's file menu. */
export function explorerFileMenu(app: App): FileMenuSegment {
  return (menu, { itemKey }) => {
    if (!itemKey) return;
    menu.addItem((item) =>
      item
        .setSection(MENU_SECTION.view)
        .setTitle(m.template_data_explorer_menu_explore())
        .setIcon("braces")
        .onClick(() => {
          void openTemplateDataExplorer(app, { itemIndexedKey: itemKey });
        }),
    );
  };
}
