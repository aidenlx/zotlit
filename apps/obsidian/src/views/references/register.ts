import type { App, Plugin } from "obsidian";

import * as m from "@/lib/i18n/generated/messages";
import { revealSetting } from "@/lib/open-settings";

import "./style.css";
import type { ViewRegistryHandle } from "@/lib/view-atoms";

import { REFERENCES_VIEW_TYPE, ReferencesView } from "./view";
import type { ReferencesViewDeps } from "./view";

type ReferencesPlugin = Pick<
  Plugin,
  "registerView" | "addCommand" | "app" | "manifest"
>;

export interface ReferencesRegistrationDeps {
  registry: ViewRegistryHandle;
  app: App;
}

export function registerReferencesView(
  plugin: ReferencesPlugin,
  deps: ReferencesRegistrationDeps,
): void {
  const viewDeps: ReferencesViewDeps = {
    registry: deps.registry,
    app: deps.app,
    openSettings: () => {
      revealSetting(plugin.app, plugin.manifest.id, "settings_citation_engine");
    },
    openStyleSettings: () => {
      revealSetting(
        plugin.app,
        plugin.manifest.id,
        "settings_citation_references_style",
      );
    },
  };

  plugin.registerView(
    REFERENCES_VIEW_TYPE,
    (leaf) => new ReferencesView(leaf, viewDeps),
  );

  plugin.addCommand({
    id: "open-references-view",
    name: m.command_open_references_view_name(),
    callback: () => void openReferencesView(plugin.app),
  });
}

export async function openReferencesView(app: App): Promise<void> {
  const { workspace } = app;
  let leaf = workspace.getLeavesOfType(REFERENCES_VIEW_TYPE)[0];
  if (!leaf) {
    const right = workspace.getRightLeaf(false);
    if (!right) return;
    leaf = right;
    await leaf.setViewState({ type: REFERENCES_VIEW_TYPE, active: true });
  }
  void workspace.revealLeaf(leaf);
}
