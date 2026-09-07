// The Set citation presentation action: its command-palette entry, its place in
// the active note's More options menu, and the update a confirmed dialog writes.

import { TFile } from "obsidian";
import type { App, Plugin } from "obsidian";

import * as m from "@/lib/i18n/generated/messages";
import { getLogger } from "@/lib/log";
import { BaseNotice } from "@/lib/notice";
import type { SettingsService } from "@/services/settings/service";
import type { ZoteroPrefService } from "@/services/zotero-pref/service";

import { openCitationPresentationModal } from "./modal";
import {
  applyCitationPresentation,
  declaredPresentation,
} from "./presentation";

const logger = getLogger(["views", "citation-presentation"]);

export interface CitationPresentationDeps {
  app: App;
  /** Where the installed styles the dialog lists are read from. */
  zoteroPref: Pick<ZoteroPrefService, "ready" | "dataDir">;
  /** The vault selections a note inherits where it names none of its own. */
  settings: Pick<SettingsService, "loaded">;
}

/**
 * Every note is presented one way or another, so the action asks for nothing of
 * the note but that it be a Markdown note on screen.
 */
export function registerCitationPresentation(
  plugin: Pick<Plugin, "addCommand" | "registerEvent" | "app">,
  deps: CitationPresentationDeps,
): void {
  plugin.addCommand({
    id: "set-citation-presentation",
    name: m.command_set_citation_presentation_name(),
    checkCallback: (checking) => {
      const file = plugin.app.workspace.getActiveFile();
      if (file?.extension !== "md") return false;
      if (checking) return true;
      void setCitationPresentation(file, deps);
      return true;
    },
  });

  // The note's own More options menu, which is where the note on screen is
  // configured from; every other file menu leaves the action to the palette.
  plugin.registerEvent(
    plugin.app.workspace.on("file-menu", (menu, file, source) => {
      if (source !== "more-options") return;
      if (!(file instanceof TFile) || file.extension !== "md") return;
      menu.addItem((item) =>
        item
          .setSection("zotlit")
          .setTitle(m.command_set_citation_presentation_name())
          .setIcon("quote")
          .onClick(() => void setCitationPresentation(file, deps)),
      );
    }),
  );
}

/**
 * The vault selections are awaited rather than read as they stand, so an action
 * performed while the vault is still loading opens on the selections the vault
 * holds instead of the embedded defaults.
 */
export async function setCitationPresentation(
  file: TFile,
  { app, zoteroPref, settings }: CitationPresentationDeps,
): Promise<void> {
  const [vault] = await Promise.all([settings.loaded, zoteroPref.ready]);
  const choice = await openCitationPresentationModal(app, {
    dataDir: zoteroPref.dataDir,
    vaultStyleId:
      vault["note.default-profile"].bindings["citation.references-style"],
    vaultLocale: vault["citation.locale"] ?? "",
    declared: declaredPresentation(app.metadataCache.getFileCache(file)),
  });
  if (!choice) return;

  try {
    await applyCitationPresentation(app.fileManager, file, choice);
  } catch (error) {
    logger.error("The note's Citation Presentation could not be written", {
      error,
      path: file.path,
    });
    new BaseNotice(m.notice_citation_presentation_failed());
  }
}
