import type { Plugin } from "obsidian";

import * as m from "@/lib/i18n/generated/messages";

import type { ReleaseService } from "./service";

/** Register the command that reopens the Release Note for the current version. */
export function addReleaseActions(
  plugin: Pick<Plugin, "addCommand">,
  services: { release: ReleaseService },
): void {
  plugin.addCommand({
    id: "open-release-note",
    name: m.command_open_release_note_name(),
    callback: () => void services.release.openReleaseNote(),
  });
}
