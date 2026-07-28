import { type DropdownComponent, Setting } from "obsidian";

import { getLibraries, type Library } from "@zotlit/db";

import * as m from "@/lib/i18n/generated/messages";
import { getLogger } from "@/lib/log";
import { type DatabaseService } from "@/services/database/service";
import { defaultPlaceholder } from "@/setting-tab/placeholder";

import { type CompatContext } from "./context";

const logger = getLogger(["setting-tab", "compat", "general"]);

/**
 * Main-tab settings (no heading, per Obsidian style): default-library picker,
 * literature-note folder, and the two citation-suggester toggles.
 */
export function generalSection(
  containerEl: HTMLElement,
  ctx: CompatContext,
): void {
  renderLibraryRow(containerEl, ctx);

  // Pre-1.13 has no declarative `folder` control; a plain text input is the
  // faithful imperative fallback (loses the folder suggester autocomplete).
  new Setting(containerEl)
    .setName(m.settings_note_folder_name())
    .setDesc(m.settings_note_folder_desc())
    .addText((text) =>
      text
        .setPlaceholder(defaultPlaceholder("note.literature-folder"))
        .setValue(ctx.settings.current?.["note.literature-folder"] ?? "")
        .onChange((value) =>
          ctx.settings.update({ "note.literature-folder": value }),
        ),
    );

  new Setting(containerEl)
    .setName(m.settings_citation_suggester_name())
    .setDesc(m.settings_citation_suggester_desc())
    .addToggle((toggle) =>
      toggle
        .setValue(ctx.settings.current?.["citation.editor-suggester"] ?? true)
        .onChange((value) =>
          ctx.settings.update({ "citation.editor-suggester": value }),
        ),
    );

  const atTriggerSetting = new Setting(containerEl)
    .setName(m.settings_citation_at_trigger_name())
    .setDesc(m.settings_citation_at_trigger_desc())
    .addToggle((toggle) =>
      toggle
        .setValue(ctx.settings.current?.["citation.at-trigger"] ?? false)
        .onChange((value) =>
          ctx.settings.update({ "citation.at-trigger": value }),
        ),
    );
  // Pre-1.13 has no declarative `visible` hook, so mirror it by toggling
  // display in response to setting changes, same as the status row in
  // compat/database.ts.
  const applyAtTriggerVisibility = (): void => {
    const visible = ctx.settings.current?.["citation.editor-suggester"] ?? true;
    atTriggerSetting.settingEl.style.display = visible ? "" : "none";
  };
  applyAtTriggerVisibility();
  ctx.defer(ctx.settings.subscribe(applyAtTriggerVisibility));

  new Setting(containerEl)
    .setName(m.settings_citation_show_citekey_name())
    .setDesc(m.settings_citation_show_citekey_desc())
    .addToggle((toggle) =>
      toggle
        .setValue(
          ctx.settings.current?.["citation.show-citekey-in-suggester"] ?? false,
        )
        .onChange((value) =>
          ctx.settings.update({
            "citation.show-citekey-in-suggester": value,
          }),
        ),
    );

  new Setting(containerEl)
    .setName(m.settings_update_notices_name())
    .setDesc(m.settings_update_notices_desc())
    .addToggle((toggle) =>
      toggle
        .setValue(ctx.settings.current?.["release.notices-enabled"] ?? true)
        .onChange((value) =>
          ctx.settings.update({ "release.notices-enabled": value }),
        ),
    );
}

function renderLibraryRow(containerEl: HTMLElement, ctx: CompatContext): void {
  let dropdown: DropdownComponent | undefined;
  const repopulate = (): void => {
    if (!dropdown) return;
    const current = ctx.settings.current?.["zotero.citation-library"] ?? 1;
    fillLibraryDropdown(dropdown, loadLibrariesSafe(ctx.db), current);
  };

  new Setting(containerEl)
    .setName(m.settings_db_library_name())
    .setDesc(
      ctx.db.state === "ready"
        ? m.settings_db_library_desc()
        : m.settings_db_library_unavailable(),
    )
    .addDropdown((d) => {
      dropdown = d;
      d.onChange((value) => {
        const id = Number(value);
        if (!Number.isFinite(id)) return;
        ctx.settings.update({ "zotero.citation-library": id });
      });
      repopulate();
    });

  if (ctx.db.state === "loading") {
    void ctx.db.ready.then(() => {
      if (dropdown?.selectEl.isConnected) repopulate();
    });
  }

  ctx.defer(
    ctx.settings.subscribe((value) => {
      if (value === null || !dropdown) return;
      const current = String(value["zotero.citation-library"]);
      if (dropdown.getValue() === current) return;
      ensureLibraryOption(dropdown, value["zotero.citation-library"]);
      dropdown.setValue(current);
    }),
  );
  ctx.defer(ctx.db.on("changed", repopulate));
  ctx.defer(ctx.db.on("degraded", repopulate));
}

function loadLibrariesSafe(db: DatabaseService): Library[] {
  if (db.state !== "ready") return [];
  try {
    return getLibraries(db.client);
  } catch (error) {
    logger.warn("Failed to load Zotero libraries", { error });
    return [];
  }
}

function libraryLabel(lib: Library): string {
  if (lib.type === "user") return m.settings_db_library_user();
  return (
    lib.name ?? m.settings_db_library_unknown({ libraryID: lib.libraryID })
  );
}

function fillLibraryDropdown(
  dropdown: DropdownComponent,
  libraries: readonly Library[],
  current: number,
): void {
  dropdown.selectEl.replaceChildren();
  for (const lib of libraries) {
    dropdown.addOption(String(lib.libraryID), libraryLabel(lib));
  }
  ensureLibraryOption(dropdown, current);
  dropdown.setValue(String(current));
  dropdown.setDisabled(libraries.length === 0);
}

function ensureLibraryOption(
  dropdown: DropdownComponent,
  libraryID: number,
): void {
  const key = String(libraryID);
  const exists = Array.from(dropdown.selectEl.options).some(
    (opt) => opt.value === key,
  );
  if (!exists) {
    dropdown.addOption(key, m.settings_db_library_unknown({ libraryID }));
  }
}
