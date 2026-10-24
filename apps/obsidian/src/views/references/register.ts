import type { App, Plugin } from "obsidian";

import * as m from "@/lib/i18n/generated/messages";

import "./style.css";
import { revealSetting } from "@/lib/open-settings";
import type { PlainCitationIndex } from "@/services/citation-index/plain";
import type {} from "@/services/citation-index/service";
import type { CitekeyEditor } from "@/services/citekey-editor/service";
import type { PlainLibraryScope } from "@/services/library-scope/plain";
import type { PlainPandocEngine } from "@/services/pandoc/plain";
import type { PlainBibliographyRender } from "@/services/pandoc/render-cache/plain";
import type { ProfileReader } from "@/services/profile/service";
import type { PlainZoteroReads } from "@/services/zotero-reads/plain";

import { REFERENCES_VIEW_TYPE, ReferencesView } from "./view";
import type { ReferencesViewDeps } from "./view";

type ReferencesPlugin = Pick<
  Plugin,
  "registerView" | "addCommand" | "app" | "manifest"
>;

export interface ReferencesRegistrationDeps {
  profile: ProfileReader;
  app: App;
  db: Pick<PlainZoteroReads, "acquireRead" | "reads" | "state" | "on">;
  citationIndex: PlainCitationIndex;
  citationLookup: ReferencesViewDeps["citationLookup"];
  libraryScope: Pick<PlainLibraryScope, "current">;
  citationText: ReferencesViewDeps["citationText"];
  runtime: ReferencesViewDeps["runtime"];
  citekeyEditor: CitekeyEditor;
  pandocEngine: Pick<PlainPandocEngine, "getStatus" | "subscribe" | "decline">;
  bibliographyRender: Pick<
    PlainBibliographyRender,
    "render" | "on" | "vaultPresentation"
  >;
}

export function registerReferencesView(
  plugin: ReferencesPlugin,
  deps: ReferencesRegistrationDeps,
): void {
  const viewDeps: ReferencesViewDeps = {
    runtime: deps.runtime,
    app: deps.app,
    profile: deps.profile,
    db: deps.db,
    citationIndex: deps.citationIndex,
    citationLookup: deps.citationLookup,
    libraryScope: deps.libraryScope,
    citationText: deps.citationText,
    citekeyEditor: deps.citekeyEditor,
    pandocEngine: deps.pandocEngine,
    bibliographyRender: deps.bibliographyRender,
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
