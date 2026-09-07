// Profile import has one shared UI entry from the command palette.
import type { Plugin } from "obsidian";

import * as m from "@/lib/i18n/generated/messages";
import type { ImportProfile } from "@/setting-tab/profiles";

export function addProfileActions(
  plugin: Pick<Plugin, "addCommand">,
  deps: { importProfile: ImportProfile },
): void {
  plugin.addCommand({
    id: "import-profile",
    name: m.command_import_profile_name(),
    callback: () => {
      void deps.importProfile();
    },
  });
}
