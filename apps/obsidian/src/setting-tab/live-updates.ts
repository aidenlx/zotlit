import { type SettingDefinitionItem } from "obsidian";

import * as m from "@/paraglide/messages";

import { type SettingsKey, type SettingTabContext } from "./context";

/** Items for the "Live updates" sub-page. */
export function liveUpdatesPageItems(
  ctx: SettingTabContext,
): SettingDefinitionItem<SettingsKey>[] {
  const enabled = (): boolean =>
    ctx.settings.current?.["server.enabled"] ?? false;
  return [
    {
      name: m.settings_live_updates_enabled_name(),
      desc: m.settings_live_updates_enabled_desc(),
      control: { type: "toggle", key: "server.enabled" },
    },
    {
      name: m.settings_live_updates_port_name(),
      desc: m.settings_live_updates_port_desc(),
      visible: enabled,
      control: {
        type: "number",
        key: "server.port",
        placeholder: "9091",
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
            placeholder: "127.0.0.1",
          },
        },
      ],
    },
  ];
}
