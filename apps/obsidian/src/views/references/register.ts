import "./style.css";
import { type App, type Plugin } from "obsidian";

import * as m from "@/lib/i18n/generated/messages";
import { type CitationScanner } from "@/services/citation-scan/service";
import { type DatabaseService } from "@/services/database/service";
import { type PandocEngineService } from "@/services/pandoc/service";
import { type SettingsService } from "@/services/settings/service";
import { type ZoteroPrefService } from "@/services/zotero-pref/service";

import {
  REFERENCES_VIEW_TYPE,
  ReferencesView,
  type ReferencesViewDeps,
} from "./view";

type ReferencesPlugin = Pick<
  Plugin,
  "registerView" | "addCommand" | "app" | "manifest"
>;

export interface ReferencesRegistrationDeps {
  app: App;
  db: DatabaseService;
  citationScanner: CitationScanner;
  pandocEngine: PandocEngineService;
  zoteroPref: ZoteroPrefService;
  settings: SettingsService;
}

export function registerReferencesView(
  plugin: ReferencesPlugin,
  deps: ReferencesRegistrationDeps,
): void {
  const viewDeps: ReferencesViewDeps = {
    app: deps.app,
    db: deps.db,
    citationScanner: deps.citationScanner,
    pandocEngine: deps.pandocEngine,
    zoteroPref: deps.zoteroPref,
    settings: deps.settings,
    openSettings: () => {
      plugin.app.setting.open();
      plugin.app.setting.openTabById(plugin.manifest.id);
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
