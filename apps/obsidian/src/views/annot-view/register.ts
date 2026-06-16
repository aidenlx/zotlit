import "./style.css";
import { type App, type Plugin } from "obsidian";

import * as m from "@/paraglide/messages";
import { type AttachmentImportService } from "@/services/attachment-import/service";
import { type DatabaseService } from "@/services/database/service";
import { type NoteFeatures } from "@/services/note-feature/service";
import { type ZoteroPrefService } from "@/services/zotero-pref/service";

import { ANNOT_VIEW_TYPE, AnnotationView, type AnnotViewDeps } from "./view";

type AnnotViewPlugin = Pick<
  Plugin,
  "registerView" | "addCommand" | "addRibbonIcon" | "app"
>;

export interface AnnotViewRegistrationDeps {
  app: App;
  db: DatabaseService;
  zoteroPref: ZoteroPrefService;
  noteFeatures: NoteFeatures;
  attachmentImport: AttachmentImportService;
}

export function registerAnnotView(
  plugin: AnnotViewPlugin,
  deps: AnnotViewRegistrationDeps,
): void {
  const viewDeps: AnnotViewDeps = {
    app: deps.app,
    db: deps.db,
    zoteroPref: deps.zoteroPref,
    noteFeatures: deps.noteFeatures,
    attachmentImport: deps.attachmentImport,
  };

  plugin.registerView(
    ANNOT_VIEW_TYPE,
    (leaf) => new AnnotationView(leaf, viewDeps),
  );

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
