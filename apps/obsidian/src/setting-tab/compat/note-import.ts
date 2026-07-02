// "Note import" compat section for Obsidian < 1.13.
import * as m from "@/paraglide/messages";
import { defaultPlaceholder } from "@/setting-tab/placeholder";

import { type CompatContext } from "./context";
import { sectionGroup } from "./group";

export function noteImportSection(
  containerEl: HTMLElement,
  ctx: CompatContext,
): void {
  const group = sectionGroup(containerEl, m.settings_page_note_import());

  group.addSetting((setting) =>
    setting
      .setName(m.settings_note_import_folder_name())
      .setDesc(m.settings_note_import_folder_desc())
      .addText((text) =>
        text
          .setPlaceholder(defaultPlaceholder("note.import-folder"))
          .setValue(ctx.settings.current?.["note.import-folder"] ?? "")
          .onChange((value) =>
            ctx.settings.update({ "note.import-folder": value }),
          ),
      ),
  );

  group.addSetting((setting) =>
    setting
      .setName(m.settings_note_import_annotations_template_name())
      .setDesc(m.settings_note_import_annotations_template_desc())
      .addToggle((toggle) =>
        toggle
          .setValue(
            ctx.settings.current?.["note.import-annotations-as-template"] ??
              false,
          )
          .onChange((value) =>
            ctx.settings.update({
              "note.import-annotations-as-template": value,
            }),
          ),
      ),
  );
}
