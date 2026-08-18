import type {
  DropdownComponent,
  Setting,
  SettingDefinitionItem,
  SettingDefinitionPage,
} from "obsidian";

import * as m from "@/lib/i18n/generated/messages";
import { isLanguageTag } from "@/lib/language-tag";
import { listInstalledStyles } from "@/services/pandoc/styles";
import type { InstalledCslStyle } from "@/services/pandoc/styles";
import type { HoverAction } from "@/services/settings/schema";
import { RESET_SETTING } from "@/services/settings/service";

import type { SettingsKey, SettingTabContext } from "./context";
import { pandocEngineDefinition } from "./pandoc-engine";
import { pandocIntegrationDefinition } from "./pandoc-integration";

/** Items for the "Citations" sub-page. */
export function citationsPageItems(
  ctx: SettingTabContext,
): SettingDefinitionItem<SettingsKey>[] {
  return [
    {
      type: "group",
      heading: m.settings_citation_suggestions_heading(),
      items: [
        {
          name: m.settings_citation_suggester_name(),
          desc: m.settings_citation_suggester_desc(),
          control: { type: "toggle", key: "citation.editor-suggester" },
        },
        {
          name: m.settings_citation_at_trigger_name(),
          desc: m.settings_citation_at_trigger_desc(),
          visible: () =>
            ctx.settings.current?.["citation.editor-suggester"] ?? true,
          control: { type: "toggle", key: "citation.at-trigger" },
        },
        {
          name: m.settings_citation_show_citekey_name(),
          desc: m.settings_citation_show_citekey_desc(),
          control: {
            type: "toggle",
            key: "citation.show-citekey-in-suggester",
          },
        },
      ],
    },
    {
      type: "group",
      heading: m.settings_citation_sources_heading(),
      items: [
        {
          name: m.settings_citation_pandoc_citations_name(),
          desc: m.settings_citation_pandoc_citations_desc(),
          control: { type: "toggle", key: "citation.pandoc-citations" },
        },
        {
          name: m.settings_citation_wikilink_citations_name(),
          desc: m.settings_citation_wikilink_citations_desc(),
          control: { type: "toggle", key: "citation.wikilink-citations" },
        },
      ],
    },
    {
      type: "group",
      heading: m.settings_citation_editor_heading(),
      items: [
        {
          name: m.settings_citation_show_formatted_name(),
          desc: m.settings_citation_show_formatted_desc(),
          control: { type: "toggle", key: "citation.show-formatted" },
        },
        {
          name: m.settings_citation_open_as_links_name(),
          desc: m.settings_citation_open_as_links_desc(),
          control: { type: "toggle", key: "citation.open-as-links" },
        },
      ],
    },
    {
      type: "group",
      heading: m.settings_citation_hover_heading(),
      items: [
        {
          name: m.settings_citation_hover_action_name(),
          desc: m.settings_citation_hover_action_desc(),
          control: {
            type: "dropdown",
            key: "citation.hover-action",
            options: hoverActionOptions(),
          },
        },
        requireModPage(ctx),
      ],
    },
    {
      type: "group",
      heading: m.settings_citation_references_heading(),
      items: [
        {
          name: m.settings_citation_references_style_name(),
          desc: referencesStyleDescription(false),
          render: (setting) => renderReferencesStyleRow(setting, ctx),
        },
        {
          name: m.settings_citation_locale_name(),
          desc: m.settings_citation_locale_desc(),
          control: {
            type: "text",
            key: "citation.locale",
            // Empty leaves the selected style's own default locale in charge.
            defaultValue: "",
            placeholder: m.settings_citation_locale_default(),
            validate: citationLocaleError,
          },
        },
        pandocEngineDefinition(ctx),
      ],
    },
    pandocIntegrationDefinition(ctx),
  ];
}

/** The Hover Action choices, in the order the select offers them. */
function hoverActionOptions(): Record<HoverAction, string> {
  return {
    off: m.settings_citation_hover_action_off(),
    popover: m.settings_citation_hover_action_popover(),
    "page-preview": m.settings_citation_hover_action_page_preview(),
  };
}

/** The Require Mod toggle of each editing mode, in editing-mode order. */
const REQUIRE_MOD_KEYS = [
  [
    "citation.hover-require-mod-source",
    m.settings_citation_hover_mod_source_name,
  ],
  [
    "citation.hover-require-mod-live-preview",
    m.settings_citation_hover_mod_live_preview_name,
  ],
  [
    "citation.hover-require-mod-reading",
    m.settings_citation_hover_mod_reading_name,
  ],
] as const satisfies readonly (readonly [SettingsKey, () => string])[];

/**
 * The Require Mod toggles, on a sub-page of their own that lists one editing
 * mode per row, like the Page preview plugin lists one hover source per row.
 * The page's own title names the list, so the rows carry the requirement in the
 * page description instead of repeating it three times.
 *
 * The toggles gate the Citation Popover alone — under Page preview the Page
 * preview plugin's own settings own that gate, and under Off there is nothing
 * to gate — so the entry appears under the Citation Popover alone.
 */
function requireModPage(
  ctx: SettingTabContext,
): SettingDefinitionPage<SettingsKey> {
  return {
    type: "page",
    name: m.settings_citation_hover_mod_page_name(),
    desc: m.settings_citation_hover_mod_desc(),
    visible: () =>
      (ctx.settings.current?.["citation.hover-action"] ?? "popover") ===
      "popover",
    items: REQUIRE_MOD_KEYS.map(([key, name]) => ({
      name: name(),
      control: { type: "toggle", key },
    })),
  };
}

/**
 * @returns why the Citation Locale was refused, or nothing for one the CSL
 *   processor reads — an empty value included, which is Style default.
 */
export function citationLocaleError(locale: string): string | undefined {
  if (locale === "" || isLanguageTag(locale)) return undefined;
  return m.settings_citation_locale_invalid();
}

/** Dropdown sentinel for the embedded default style; a style ID is never empty. */
export const STYLE_DEFAULT = "";

/** One entry of the Citation and References Style picker. */
export interface ReferencesStyleOption {
  value: string;
  label: string;
  /** An entry the picker shows and refuses to take as a selection of its own. */
  disabled?: boolean;
}

/**
 * The picker entries: the embedded default first, then the installed styles.
 * A selection Zotero no longer has keeps an entry of its own, so it stays
 * selected and visible until the user picks another style.
 */
export function referencesStyleOptions(
  styles: readonly InstalledCslStyle[],
  selected: string,
): ReferencesStyleOption[] {
  const options: ReferencesStyleOption[] = [
    {
      value: STYLE_DEFAULT,
      label: m.settings_citation_references_style_default(),
    },
    ...styles.map((style) => ({ value: style.id, label: style.title })),
  ];
  if (selected !== STYLE_DEFAULT && !styles.some((s) => s.id === selected)) {
    options.push({
      value: selected,
      label: m.settings_citation_references_style_missing({ id: selected }),
    });
  }
  return options;
}

/**
 * Citation and References Style picker, listing the styles installed in the Zotero data
 * directory. Zotero owns style installation, so the list is read-only, and the
 * row follows both the Zotero data directory and the stored setting, which
 * vault sync can rewrite while the tab is open.
 */
function renderReferencesStyleRow(
  setting: Setting,
  ctx: SettingTabContext,
): () => void {
  const stack = new DisposableStack();

  let dropdown: DropdownComponent | undefined;
  let styles: readonly InstalledCslStyle[] = [];
  let stylesLoaded = false;
  let disposed = false;
  stack.defer(() => {
    disposed = true;
  });

  const selectedValue = (): string =>
    ctx.settings.current?.["citation.references-style"] ?? STYLE_DEFAULT;

  const repopulate = (): void => {
    if (!dropdown) return;
    const current = selectedValue();
    setting.setDesc(
      referencesStyleDescription(
        stylesLoaded &&
          current !== STYLE_DEFAULT &&
          !styles.some((style) => style.id === current),
      ),
    );
    dropdown.selectEl.replaceChildren();
    for (const { value, label } of referencesStyleOptions(styles, current)) {
      dropdown.addOption(value, label);
    }
    dropdown.setValue(current);
  };

  /**
   * The read outlives the row only until disposal, so a live row always fills.
   * Only the newest read applies, so overlapping reloads cannot land stale.
   */
  let latestRead = 0;
  const reload = (): void => {
    const read = ++latestRead;
    void listInstalledStyles(ctx.zoteroPref.dataDir).then((installed) => {
      if (disposed || read !== latestRead) return;
      styles = installed;
      stylesLoaded = true;
      repopulate();
    });
  };

  // Zotero installs styles while this tab stays open, so the list re-reads the
  // data directory on demand instead of only on mount.
  setting.addExtraButton((button) =>
    button
      .setIcon("refresh-cw")
      .setTooltip(m.settings_citation_references_style_refresh())
      .onClick(reload),
  );

  setting.addDropdown((d) => {
    dropdown = d;
    d.onChange((value) => {
      ctx.settings.update({
        "citation.references-style":
          value === STYLE_DEFAULT ? RESET_SETTING : value,
      });
    });
    repopulate();
  });

  reload();
  stack.defer(ctx.zoteroPref.on("resolved-changed", reload));
  stack.defer(
    ctx.settings.subscribe(() => {
      if (dropdown && dropdown.getValue() !== selectedValue()) repopulate();
    }),
  );

  return () => stack.dispose();
}

export function referencesStyleDescription(missing: boolean): DocumentFragment {
  const desc = createFragment();
  desc.append(
    missing
      ? m.settings_citation_references_style_warning()
      : m.settings_citation_references_style_desc(),
  );
  return desc;
}
