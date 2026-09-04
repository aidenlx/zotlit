import type { App, Plugin } from "obsidian";

import "./style.css";
import * as m from "@/lib/i18n/generated/messages";
import { revealSetting } from "@/lib/open-settings";
import type { CitationIndex } from "@/services/citation-index/service";
import type { CitationText } from "@/services/citation-text/service";
import type { CitekeyEditor } from "@/services/citekey-editor/service";
import type { DatabaseService } from "@/services/database/service";
import type { LibraryScopeService } from "@/services/library-scope/service";
import type { BibliographyRenderCache } from "@/services/pandoc/render-cache";
import type { PandocEngineService } from "@/services/pandoc/service";
import type { ProfileReader } from "@/services/profile/service";

import { REFERENCES_VIEW_TYPE, ReferencesView } from "./view";
import type { ReferencesViewDeps } from "./view";

type ReferencesPlugin = Pick<
  Plugin,
  "registerView" | "addCommand" | "app" | "manifest"
>;

export interface ReferencesRegistrationDeps {
  profile: ProfileReader;
  app: App;
  db: DatabaseService;
  citationIndex: CitationIndex;
  libraryScope: LibraryScopeService;
  citationText: CitationText;
  citekeyEditor: CitekeyEditor;
  pandocEngine: PandocEngineService;
  bibliographyRender: BibliographyRenderCache;
}

export function registerReferencesView(
  plugin: ReferencesPlugin,
  deps: ReferencesRegistrationDeps,
): void {
  const viewDeps: ReferencesViewDeps = {
    app: deps.app,
    profile: deps.profile,
    db: deps.db,
    citationIndex: deps.citationIndex,
    libraryScope: deps.libraryScope,
    citationText: deps.citationText,
    citekeyEditor: deps.citekeyEditor,
    pandocEngine: deps.pandocEngine,
    bibliographyRender: deps.bibliographyRender,
    openSettings: () => {
      revealSetting(
        plugin.app,
        plugin.manifest.id,
        m.settings_citation_engine_name(),
      );
    },
    openStyleSettings: () => {
      revealSetting(
        plugin.app,
        plugin.manifest.id,
        m.settings_citation_references_style_name(),
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
