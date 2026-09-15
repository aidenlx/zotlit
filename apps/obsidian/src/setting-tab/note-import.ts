// The Imported notes page: how imported notes render, and the shared highlight
// output mappings every Profile uses.
import type { SettingDefinitionItem } from "obsidian";

import type { AnnotationColorName } from "@zotlit/db";

import {
  getHighlightMapping,
  HIGHLIGHT_COLORS,
  HIGHLIGHT_EMOJI,
  isHighlightEmoji,
} from "@/lib/highlight-mapping";
import type { HighlightMapping } from "@/lib/highlight-mapping";
import * as m from "@/lib/i18n/generated/messages";

import type {
  SettingsControlKey,
  SettingsKey,
  SettingTabContext,
} from "./context";
import { profileControlKey } from "./profiles";

const colorLabels = {
  red: m.annot_view_color_red,
  orange: m.annot_view_color_orange,
  yellow: m.annot_view_color_yellow,
  green: m.annot_view_color_green,
  blue: m.annot_view_color_blue,
  purple: m.annot_view_color_purple,
  magenta: m.annot_view_color_magenta,
  gray: m.annot_view_color_gray,
  plum: m.annot_view_color_plum,
} satisfies Record<AnnotationColorName, () => string>;

/**
 * The Imported notes page: the default Profile's rendering bindings, with the
 * shared mappings one page deeper.
 */
export function noteImportPageItems(
  ctx: SettingTabContext,
): SettingDefinitionItem<SettingsControlKey>[] {
  return [
    {
      id: "settings_note_import_colored_highlights",
      name: m.settings_note_import_colored_highlights_name(),
      desc: m.settings_note_import_colored_highlights_desc(),
      control: {
        type: "toggle",
        key: profileControlKey("default", "colored-highlights"),
      },
    },
    {
      type: "page",
      id: "settings_note_import_highlight_mappings",
      name: m.settings_note_import_highlight_mappings_name(),
      desc: m.settings_note_import_highlight_mappings_desc(),
      items: highlightMappingItems(ctx),
    },
    {
      id: "settings_note_import_annotations_template",
      name: m.settings_note_import_annotations_template_name(),
      desc: m.settings_note_import_annotations_template_desc(),
      control: {
        type: "toggle",
        key: profileControlKey("default", "annotations-as-template"),
      },
    },
  ];
}

export function highlightMappingItems(
  ctx: SettingTabContext,
): SettingDefinitionItem<SettingsKey>[] {
  return HIGHLIGHT_COLORS.flatMap<SettingDefinitionItem<SettingsKey>>(
    (color) => {
      const current = () =>
        getHighlightMapping(
          ctx.settings.current?.["note.import-highlight-mappings"] ?? {},
          color,
        );
      return [
        {
          id: `settings_note_import_highlight:${color}`,
          name: colorLabels[color](),
          render: (setting) => {
            setting.addDropdown((dropdown) => {
              dropdown.addOption(
                "mark",
                m.settings_note_import_highlight_mark(),
              );
              for (const emoji of HIGHLIGHT_EMOJI)
                dropdown.addOption(emoji, emoji);
              dropdown
                .addOption("custom", m.settings_note_import_highlight_custom())
                .setValue(current().output)
                .onChange((output) => {
                  updateMapping(ctx, color, {
                    output: output as HighlightMapping["output"],
                  });
                  ctx.requestUpdate();
                });
            });
          },
        },
        {
          id: `settings_note_import_custom_emoji:${color}`,
          name: m.settings_note_import_custom_emoji_name({
            color: colorLabels[color](),
          }),
          visible: () => current().output === "custom",
          render: (setting) => {
            const showError = (value: string) =>
              setting.setErrorMessage(
                isHighlightEmoji(value)
                  ? null
                  : m.settings_note_import_custom_emoji_invalid(),
              );
            showError(current().customEmoji);
            setting.addText((text) => {
              text.setValue(current().customEmoji).onChange((customEmoji) => {
                updateMapping(ctx, color, { customEmoji });
                showError(customEmoji);
              });
            });
          },
        },
      ];
    },
  );
}

function updateMapping(
  ctx: SettingTabContext,
  color: AnnotationColorName,
  patch: Partial<HighlightMapping>,
): void {
  ctx.settings.update((settings) => {
    const mappings = settings["note.import-highlight-mappings"];
    return {
      "note.import-highlight-mappings": {
        ...mappings,
        [color]: { ...getHighlightMapping(mappings, color), ...patch },
      },
    };
  });
}
