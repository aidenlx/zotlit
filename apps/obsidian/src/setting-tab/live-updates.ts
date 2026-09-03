import type { SettingDefinitionItem } from "obsidian";

import { DOCS_COMPANION, DOCS_SITE_URL } from "@/lib/constants";
import * as m from "@/lib/i18n/generated/messages";

import type { SettingsKey, SettingTabContext } from "./context";
import { defaultPlaceholder } from "./placeholder";

/** Items for the "Live updates" sub-page. */
export function liveUpdatesPageItems(
  ctx: SettingTabContext,
): SettingDefinitionItem<SettingsKey>[] {
  const enabled = (): boolean =>
    ctx.settings.current?.["server.enabled"] ?? false;
  return [
    {
      name: m.settings_live_updates_enabled_name(),
      desc: enabledDescription(),
      control: { type: "toggle", key: "server.enabled" },
    },
    {
      name: m.settings_live_updates_port_name(),
      desc: m.settings_live_updates_port_desc({
        label: m["zotero.prefs_notify_url"](),
      }),
      visible: enabled,
      control: {
        type: "number",
        key: "server.port",
        placeholder: defaultPlaceholder("server.port"),
        min: 1024,
        max: 65535,
      },
    },
    {
      type: "group",
      heading: m.settings_live_updates_advanced(),
      visible: enabled,
      items: [
        {
          name: m.settings_live_updates_hostname_name(),
          desc: m.settings_live_updates_hostname_desc(),
          control: {
            type: "text",
            key: "server.hostname",
            placeholder: defaultPlaceholder("server.hostname"),
          },
        },
      ],
    },
  ];
}

function enabledDescription(): DocumentFragment {
  const frag = createFragment();
  frag.append(m.settings_live_updates_enabled_desc());

  const hint = createDiv({ cls: "zt:mt-2 zt:text-(--text-warning)" });
  hint.append(
    m.settings_live_updates_companion_desc({
      section: m["zotero.prefs_notify_section"](),
      label: m["zotero.prefs_notify_enable.label"](),
    }),
    " ",
    createEl("a", {
      href: DOCS_COMPANION,
      text: m.settings_live_updates_companion_install(),
      attr: { target: "_blank", rel: "noopener" },
    }),
    " · ",
    createEl("a", {
      href: `${DOCS_SITE_URL}/docs/how-to/set-up-live-updates`,
      text: m.settings_live_updates_companion_setup(),
      attr: { target: "_blank", rel: "noopener" },
    }),
  );
  frag.append(hint);
  return frag;
}
