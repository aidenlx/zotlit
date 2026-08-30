// Declarative settings for the "Note import" sub-page.
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

import type { SettingsKey, SettingTabContext } from "./context";
import { defaultPlaceholder } from "./placeholder";

/** Items for the "Note import" sub-page. */
export function noteImportPageItems(
  ctx: SettingTabContext,
): SettingDefinitionItem<SettingsKey>[] {
  return [
    {
      name: m.settings_note_import_folder_name(),
      desc: m.settings_note_import_folder_desc(),
      control: {
        type: "folder",
        key: "note.import-folder",
        placeholder: defaultPlaceholder("note.import-folder"),
      },
    },
    {
      name: m.settings_note_import_colored_highlights_name(),
      desc: m.settings_note_import_colored_highlights_desc(),
      control: {
        type: "toggle",
        key: "note.import-colored-highlights",
      },
    },
    {
      type: "page",
      name: m.settings_note_import_highlight_mappings_name(),
      desc: m.settings_note_import_highlight_mappings_desc(),
      visible: () =>
        ctx.settings.current?.["note.import-colored-highlights"] ?? false,
      items: highlightMappingItems(ctx),
    },
    {
      name: m.settings_note_import_annotations_template_name(),
      desc: m.settings_note_import_annotations_template_desc(),
      control: {
        type: "toggle",
        key: "note.import-annotations-as-template",
      },
    },
  ];
}

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

function highlightMappingItems(
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
