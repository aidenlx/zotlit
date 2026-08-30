// The single consent surface for changing a Literature Note's Profile.
import { ConfirmationModal } from "obsidian";
import type { App, TFile } from "obsidian";

import { normalizeFolderPath } from "@/lib/ensure-folder";
import * as m from "@/lib/i18n/generated/messages";
import { getLogger } from "@/lib/log";
import { BaseNotice } from "@/lib/notice";
import * as toast from "@/lib/toast";
import { listInstalledStyles } from "@/services/pandoc/styles";
import type { ZoteroPrefService } from "@/services/zotero-pref/service";
import { chooseLiteratureNoteProfile } from "@/views/quick-switch/profile-picker";

import type { NoteFeature } from "./operations";
import { noteOperationDiagnosticNotice } from "./update-single";

const logger = getLogger("note-feature");

export interface InteractiveProfileSwitchDeps {
  app: App;
  noteFeature: Pick<NoteFeature, "prepareProfileSwitch" | "switchNoteProfile">;
  zoteroPref: Pick<ZoteroPrefService, "dataDir">;
}

export interface ProfileSwitchConsent {
  confirmed: boolean;
  move: boolean;
  importedNotes: boolean;
}

export async function switchNoteProfileInteractively(
  deps: InteractiveProfileSwitchDeps,
  file: TFile,
  indexedKey: string,
): Promise<void> {
  try {
    const [plan, styles] = await Promise.all([
      deps.noteFeature.prepareProfileSwitch(file, indexedKey),
      deps.zoteroPref.dataDir
        ? listInstalledStyles(deps.zoteroPref.dataDir)
        : [],
    ]);
    const choice = await chooseLiteratureNoteProfile(deps.app, {
      previews: plan.profiles,
      preselected: plan.current.selector,
      current: plan.current.selector,
      styles,
    });
    if (!choice || choice.id === plan.current.selector) {
      logger.debug("Profile switch dismissed without a change", {
        path: file.path,
      });
      return;
    }
    const target = plan.profiles.find(
      ({ selector }) => selector === choice.id,
    )!;
    const consent = await confirmProfileSwitch(deps.app, {
      current: plan.current.label ?? m.settings_profile_default_name(),
      requested: choice.label,
      moveFolder: target.path === file.path ? undefined : target.folder,
      importedCount: plan.importedNotes.length,
    });
    if (!consent.confirmed) {
      logger.debug("Cancelled Literature Note Profile switch", {
        path: file.path,
      });
      return;
    }
    await toast.promise(
      deps.noteFeature.switchNoteProfile(file, {
        profile: choice.id,
        move: consent.move,
        importedNotes: consent.importedNotes ? plan.importedNotes : [],
      }),
      {
        loading: m.notice_profile_switching(),
        success: (result) =>
          result.diagnostic
            ? noteOperationDiagnosticNotice(result.diagnostic)
            : m.notice_profile_switched({ label: choice.label }),
        error: () => m.notice_profile_switch_failed(),
      },
    );
  } catch (error) {
    logger.error("Failed to prepare Literature Note Profile switch", {
      path: file.path,
      error,
    });
    new BaseNotice(m.notice_profile_switch_failed());
  }
}

/** All consequences and opt-ins are visible before any note is changed. */
export function confirmProfileSwitch(
  app: App,
  options: {
    current: string;
    requested: string;
    moveFolder?: string;
    importedCount: number;
  },
): Promise<ProfileSwitchConsent> {
  const { promise, resolve } = Promise.withResolvers<ProfileSwitchConsent>();
  const modal = new ConfirmationModal(app);
  modal.contentEl.addClass("zt-root");
  let move = false;
  let importedNotes = false;
  modal.setTitle(m.modal_profile_switch_title({ label: options.requested }));
  modal.setContent(m.modal_profile_switch_desc(options));
  if (options.moveFolder !== undefined) {
    const folder = normalizeFolderPath(options.moveFolder);
    modal.addCheckbox(
      m.modal_profile_switch_move({
        folder: folder === "/" ? "/" : `${folder}/`,
      }),
      (checked) => {
        move = checked;
      },
    );
  }
  modal.addCheckbox(
    m.modal_profile_switch_imported_notes({ count: options.importedCount }),
    (checked) => {
      importedNotes = checked;
    },
  );
  modal.addButton((button) => {
    button
      .setButtonText(
        m.modal_profile_switch_confirm({ label: options.requested }),
      )
      .setCta()
      .onClick(() => resolve({ confirmed: true, move, importedNotes }));
  });
  modal.addCancelButton(m.modal_cancel());
  modal.setCloseCallback(() =>
    resolve({ confirmed: false, move: false, importedNotes: false }),
  );
  modal.open();
  return promise;
}
