import {
  type DropdownComponent,
  type Setting,
  type SettingDefinitionItem,
} from "obsidian";

import { DOCS_SITE_URL } from "@/lib/constants";
import * as m from "@/lib/i18n/generated/messages";
import {
  listInstalledStyles,
  type InstalledCslStyle,
} from "@/services/pandoc/styles";
import { RESET_SETTING } from "@/services/settings/service";

import { type SettingsKey, type SettingTabContext } from "./context";
import { pandocEngineDefinition } from "./pandoc-engine";
import { defaultPlaceholder } from "./placeholder";

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
      heading: m.settings_citation_key_links_name(),
      items: [
        {
          name: m.settings_citation_key_links_name(),
          desc: citationKeyLinksDescription(),
          control: { type: "toggle", key: "citation.key-links" },
        },
        {
          name: m.settings_citation_key_property_name(),
          desc: m.settings_citation_key_property_desc(),
          visible: () => ctx.settings.current?.["citation.key-links"] ?? false,
          control: {
            type: "text",
            key: "citation.key-links-frontmatter-key",
            placeholder: defaultPlaceholder(
              "citation.key-links-frontmatter-key",
            ),
            validate: (value) =>
              value.length > 0 && value === value.trim()
                ? undefined
                : m.settings_citation_key_property_required(),
          },
        },
      ],
    },
    {
      type: "group",
      heading: m.settings_citation_references_heading(),
      items: [
        {
          name: m.settings_citation_references_style_name(),
          desc: m.settings_citation_references_style_desc(),
          render: (setting) => renderReferencesStyleRow(setting, ctx),
        },
        pandocEngineDefinition(ctx),
      ],
    },
  ];
}

/** Dropdown sentinel for the embedded default style; a style ID is never empty. */
export const STYLE_DEFAULT = "";

/** One entry of the References style picker. */
export interface ReferencesStyleOption {
  value: string;
  label: string;
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
 * References style picker, listing the styles installed in the Zotero data
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
  let disposed = false;
  stack.defer(() => {
    disposed = true;
  });

  const selectedValue = (): string =>
    ctx.settings.current?.["citation.references-style"] ?? STYLE_DEFAULT;

  const repopulate = (): void => {
    if (!dropdown) return;
    const current = selectedValue();
    dropdown.selectEl.replaceChildren();
    for (const { value, label } of referencesStyleOptions(styles, current)) {
      dropdown.addOption(value, label);
    }
    dropdown.setValue(current);
  };

  /** The read outlives the row only until disposal, so a live row always fills. */
  const reload = (): void => {
    void listInstalledStyles(ctx.zoteroPref.dataDir).then((installed) => {
      if (disposed) return;
      styles = installed;
      repopulate();
    });
  };

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

function citationKeyLinksDescription(): DocumentFragment {
  const desc = createFragment();
  desc.append(`${m.settings_citation_key_links_desc()} `);
  const link = createEl("a");
  link.href = `${DOCS_SITE_URL}/docs/concepts/how-citekey-links-work`;
  link.textContent = m.settings_citation_key_links_docs();
  link.target = "_blank";
  link.rel = "noopener";
  desc.append(link);
  return desc;
}
