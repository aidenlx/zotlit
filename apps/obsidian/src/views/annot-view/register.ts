import "./style.css";
import { type Plugin } from "obsidian";

import * as m from "@/paraglide/messages";

import { ANNOT_VIEW_TYPE, AnnotationView } from "./view";

type AnnotViewPlugin = Pick<
  Plugin,
  "registerView" | "addCommand" | "addRibbonIcon" | "app"
>;

export function registerAnnotView(plugin: AnnotViewPlugin): void {
  plugin.registerView(ANNOT_VIEW_TYPE, (leaf) => new AnnotationView(leaf));

  const open = () => {
    void activateView(plugin);
  };

  plugin.addCommand({
    id: "open-annot-view",
    name: m.command_open_annot_view_name(),
    callback: open,
  });
  plugin.addRibbonIcon("highlighter", m.command_open_annot_view_name(), open);
}

async function activateView(plugin: AnnotViewPlugin): Promise<void> {
  const { workspace } = plugin.app;
  let leaf = workspace.getLeavesOfType(ANNOT_VIEW_TYPE)[0];
  if (!leaf) {
    const right = workspace.getRightLeaf(false);
    if (!right) return;
    leaf = right;
    await leaf.setViewState({ type: ANNOT_VIEW_TYPE, active: true });
  }
  void workspace.revealLeaf(leaf);
}
