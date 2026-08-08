import type { SettingDefinitionItem } from "obsidian";

import { DOCS_SITE_URL } from "@/lib/constants";
import * as m from "@/lib/i18n/generated/messages";

import type { SettingsKey, SettingTabContext } from "./context";
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
  ];
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
