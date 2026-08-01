// Shared pieces for the settings rows that hold Device Overrides — state kept
// per vault × device that never syncs: the folder dialog that picks a
// machine-specific folder, and the note that says the value stays here.

import * as m from "@/lib/i18n/generated/messages";
import { getLogger } from "@/lib/log";
import { requireDialog } from "@/lib/require";

const logger = getLogger(["setting-tab", "device-override"]);

/**
 * Open a folder picker and hand the chosen directory to `onPick`. `startPath`
 * seeds the dialog when the bound setting is unset.
 */
export async function browseForDir(opts: {
  title: string;
  startPath: string | undefined;
  onPick: (path: string) => void;
}): Promise<void> {
  try {
    const result = await requireDialog().showOpenDialog({
      title: opts.title,
      defaultPath: opts.startPath,
      properties: ["openDirectory"],
    });
    if (result.canceled || result.filePaths.length === 0) return;
    opts.onPick(result.filePaths[0]!);
  } catch (error) {
    logger.error("Failed to open folder dialog", { error });
  }
}

/** Append the "stored on this device only" Device Override note as a fresh description line. */
export function appendDeviceOverrideNote(frag: DocumentFragment): void {
  frag.append(document.createElement("br"));
  const note = document.createElement("small");
  note.textContent = m.settings_db_device_override_note();
  frag.append(note);
}
