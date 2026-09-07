// The Customize entries on a Literature Note: the command and the file-menu
// item. Both resolve the same pair — the Profile the note is stamped with, and
// the paper the note is about — and hand it to the shared Customize flow, so
// the launch sheet and the unsupported-Profile refusal come with them.

import { TFile } from "obsidian";
import type { App, Plugin, TAbstractFile } from "obsidian";

import * as m from "@/lib/i18n/generated/messages";
import { BaseNotice } from "@/lib/notice";
import { profileRecoveryNotice } from "@/lib/profile-recovery";
import { unknownProfileDiagnostic } from "@/lib/profile-stamp";
import {
  isLiteratureNote,
  itemKeyFromFrontmatter,
} from "@/services/note-index/service";
import type { ProfileService } from "@/services/profile/service";
import type { SettingsService } from "@/services/settings/service";

import { workbenchEnabled } from "./customize";
import type { CustomizeAction } from "./customize";

export interface CustomizeActionDeps {
  app: App;
  settings: Pick<SettingsService, "current">;
  /** The stamp reader: which Profile this note belongs to, if any. */
  profile: Pick<ProfileService, "loaded" | "profileOf">;
  /** The shared Customize flow, the same one the settings rows open. */
  customize: CustomizeAction;
}

export function addCustomizeActions(
  plugin: Pick<Plugin, "addCommand" | "registerEvent" | "app">,
  deps: CustomizeActionDeps,
): void {
  plugin.addCommand({
    id: "customize-note-template",
    name: m.command_customize_note_template_name(),
    checkCallback: (checking) => {
      const file = plugin.app.workspace.getActiveFile();
      if (!customizable(file, deps)) return false;
      if (checking) return true;
      void customizeNote(file, deps);
      return true;
    },
  });

  plugin.registerEvent(
    plugin.app.workspace.on("file-menu", (menu, file, source) => {
      // A multi-file selection acts on files, not on the one note a template
      // is customized for.
      if (source === "files-menu") return;
      if (!customizable(file, deps)) return;
      menu.addItem((item) =>
        item
          .setSection("zotlit")
          .setTitle(m.command_customize_note_template_name())
          .setIcon("paintbrush")
          .onClick(() => void customizeNote(file, deps)),
      );
    }),
  );
}

/**
 * A Literature Note, while the web Template Workbench is on and the Profile
 * registry can answer which Profile the note carries.
 */
function customizable(
  file: TAbstractFile | null,
  deps: CustomizeActionDeps,
): file is TFile {
  return (
    file instanceof TFile &&
    file.extension === "md" &&
    workbenchEnabled(deps.settings) &&
    deps.profile.loaded &&
    isLiteratureNote(file, deps.app)
  );
}

/**
 * The note's own template, in the Workbench. A stamp naming a Profile the
 * vault no longer holds ends here with the diagnostic that names it, so the
 * researcher learns what is wrong in Obsidian rather than in a browser tab.
 */
function customizeNote(file: TFile, deps: CustomizeActionDeps): Promise<void> {
  const note = deps.profile.profileOf(file);
  if (!note.ok) {
    new BaseNotice(
      profileRecoveryNotice(
        deps.app,
        unknownProfileDiagnostic(note.stamped.stamp, { path: file.path }),
      ),
    );
    return Promise.resolve();
  }
  const key = itemKeyFromFrontmatter(deps.app.metadataCache.getFileCache(file));
  return deps.customize({
    profileId: note.profile.selector,
    item: key === null ? null : { key, title: file.basename },
  });
}
