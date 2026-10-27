import type { App, Plugin } from "obsidian";

// Registration and the explicit command for the Cited By Sidebar.
import "./style.css";
import * as m from "@/lib/i18n/generated/messages";
import type { ViewRegistryHandle } from "@/lib/view-atoms";

import { CITED_BY_VIEW_TYPE, CitedByView } from "./view";
import type { CitedByViewDeps } from "./view";

type CitedByPlugin = Pick<Plugin, "registerView" | "addCommand" | "app">;

export interface CitedByRegistrationDeps {
  app: App;
  registry: ViewRegistryHandle;
}

export function registerCitedByView(
  plugin: CitedByPlugin,
  deps: CitedByRegistrationDeps,
): void {
  const viewDeps: CitedByViewDeps = {
    app: deps.app,
    registry: deps.registry,
  };
  plugin.registerView(
    CITED_BY_VIEW_TYPE,
    (leaf) => new CitedByView(leaf, viewDeps),
  );
  plugin.addCommand({
    id: "show-cited-by",
    name: m.command_show_cited_by_name(),
    callback: () => void openCitedByView(plugin.app),
  });
}

export async function openCitedByView(app: App): Promise<void> {
  const { workspace } = app;
  let leaf = workspace.getLeavesOfType(CITED_BY_VIEW_TYPE)[0];
  if (!leaf) {
    const right = workspace.getRightLeaf(false);
    if (!right) return;
    leaf = right;
    await leaf.setViewState({ type: CITED_BY_VIEW_TYPE, active: true });
  }
  void workspace.revealLeaf(leaf);
}
