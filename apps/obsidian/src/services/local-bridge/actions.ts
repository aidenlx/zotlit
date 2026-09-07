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
import type { UnknownProfileDiagnostic } from "@/lib/profile-stamp";
import { isLiteratureNote } from "@/services/note-index/service";
import type { ProfileService } from "@/services/profile/service";
import type { SettingsService } from "@/services/settings/service";

import { noteItem, workbenchEnabled } from "./customize";
import type { CustomizeAction, CustomizeRequest } from "./customize";

export interface CustomizeActionDeps {
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
  const { app } = plugin;
  plugin.addCommand({
    id: "customize-note-template",
    name: m.command_customize_note_template_name(),
    checkCallback: (checking) => {
      const file = app.workspace.getActiveFile();
      if (!customizable(file, app, deps)) return false;
      if (checking) return true;
      void customizeNote(file, app, deps);
      return true;
    },
  });

  plugin.registerEvent(
    app.workspace.on("file-menu", (menu, file, source) => {
      // A multi-file selection acts on files, not on the one note a template
      // is customized for.
      if (source === "files-menu") return;
      if (!customizable(file, app, deps)) return;
      menu.addItem((item) =>
        item
          .setSection("zotlit")
          .setTitle(m.command_customize_note_template_name())
          .setIcon("paintbrush")
          .onClick(() => void customizeNote(file, app, deps)),
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
  app: App,
  deps: CustomizeActionDeps,
): file is TFile {
  return (
    file instanceof TFile &&
    file.extension === "md" &&
    workbenchEnabled(deps.settings) &&
    deps.profile.loaded &&
    isLiteratureNote(file, app)
  );
}

/**
 * What Customize on this note opens: the note's own Profile and paper. A stamp
 * naming a Profile the vault no longer holds answers with the diagnostic that
 * names it instead, so the researcher learns what is wrong in Obsidian rather
 * than in a browser tab.
 */
export function noteCustomizeRequest(
  file: TFile,
  app: App,
  deps: Pick<CustomizeActionDeps, "profile">,
): CustomizeRequest | UnknownProfileDiagnostic {
  const note = deps.profile.profileOf(file);
  if (!note.ok)
    return unknownProfileDiagnostic(note.stamped.stamp, { path: file.path });
  return { profileId: note.profile.selector, item: noteItem(app, file) };
}

function customizeNote(
  file: TFile,
  app: App,
  deps: CustomizeActionDeps,
): Promise<void> {
  const request = noteCustomizeRequest(file, app, deps);
  if ("code" in request) {
    new BaseNotice(profileRecoveryNotice(app, request));
    return Promise.resolve();
  }
  return deps.customize(request);
}
