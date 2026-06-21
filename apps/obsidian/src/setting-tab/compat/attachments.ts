import * as m from "@/paraglide/messages";

import { type CompatContext } from "./context";
import { sectionGroup } from "./group";

/**
 * Attachments page: the import toggle and, while import is enabled, the
 * attachment-folder path. Pre-1.13 has no declarative `visible` predicate, so
 * the folder row is built conditionally and the toggle re-renders the tab.
 */
export function attachmentsSection(
  containerEl: HTMLElement,
  ctx: CompatContext,
): void {
  const group = sectionGroup(containerEl, m.settings_page_attachments());

  const importEnabled = ctx.settings.current?.["attachment.import"] ?? true;

  group.addSetting((setting) =>
    setting
      .setName(m.settings_attachment_import_name())
      .setDesc(m.settings_attachment_import_desc())
      .addToggle((toggle) =>
        toggle.setValue(importEnabled).onChange((value) => {
          ctx.settings.update({ "attachment.import": value });
          ctx.rerender();
        }),
      ),
  );

  if (!importEnabled) return;

  // Pre-1.13 has no declarative `folder` control; a plain text input is the
  // faithful imperative fallback (loses the folder suggester autocomplete).
  // Empty value falls back to Obsidian's default attachment folder.
  group.addSetting((setting) =>
    setting
      .setName(m.settings_attachment_folder_name())
      .setDesc(m.settings_attachment_folder_desc())
      .addText((text) =>
        text
          .setValue(ctx.settings.current?.["attachment.folder-path"] ?? "")
          .onChange((value) =>
            ctx.settings.update({ "attachment.folder-path": value }),
          ),
      ),
  );
}
