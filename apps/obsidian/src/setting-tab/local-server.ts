// The Advanced page's Local server group: the one loopback listener, the
// toggle of each service it hosts, and the port it actually bound.
import type { SettingGroupItem } from "obsidian";

import { DOCS_COMPANION, DOCS_SITE_URL } from "@/lib/constants";
import * as m from "@/lib/i18n/generated/messages";

import type { SettingsKey, SettingTabContext } from "./context";
import { defaultPlaceholder } from "./placeholder";

function serverEnabled(ctx: SettingTabContext): () => boolean {
  return () => ctx.settings.current?.["server.enabled"] ?? false;
}

/**
 * The Local server rows: the listener toggle, one toggle per hosted service,
 * the configured address, and the port in use.
 */
export function localServerItems(
  ctx: SettingTabContext,
): SettingGroupItem<SettingsKey>[] {
  const enabled = serverEnabled(ctx);
  const port = ctx.localServer.effectivePort;
  return [
    {
      name: m.settings_local_server_enabled_name(),
      desc: m.settings_local_server_enabled_desc(),
      control: { type: "toggle", key: "server.enabled" },
    },
    {
      name: m.settings_live_updates_enabled_name(),
      desc: liveUpdateDescription(),
      visible: enabled,
      control: { type: "toggle", key: "server.live-update" },
    },
    ...(ctx.webWorkbenchEnabled
      ? [
          {
            name: m.settings_local_server_workbench_name(),
            desc: m.settings_local_server_workbench_desc(),
            visible: enabled,
            control: {
              type: "toggle" as const,
              key: "server.workbench" as const,
            },
          },
          ...workbenchConnectionRows(ctx, enabled),
        ]
      : []),
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
      name: m.settings_local_server_active_port_name(),
      desc:
        port === null
          ? m.settings_local_server_active_port_none()
          : m.settings_local_server_active_port_desc({ port }),
      visible: enabled,
    },
    {
      name: m.settings_live_updates_hostname_name(),
      desc: m.settings_live_updates_hostname_desc(),
      visible: enabled,
      control: {
        type: "text",
        key: "server.hostname",
        placeholder: defaultPlaceholder("server.hostname"),
      },
    },
  ];
}

/**
 * The live Workbench Connection, named under the toggle that allows it: which
 * website holds it, which template it may save, and the one way to end it from
 * Obsidian. Included structurally — there is no row at all while none stands.
 */
function workbenchConnectionRows(
  ctx: SettingTabContext,
  enabled: () => boolean,
): SettingGroupItem<SettingsKey>[] {
  const connection = ctx.localBridge.connection;
  if (connection === null) return [];
  return [
    {
      name: m.settings_local_server_workbench_connection_name(),
      desc: m.settings_local_server_workbench_connection_desc({
        website: new URL(connection.origin).host,
        profile: connection.profileName,
      }),
      visible: enabled,
      render: (setting) => {
        setting.addButton((button) =>
          button
            .setButtonText(m.settings_local_server_workbench_disconnect())
            .onClick(() => ctx.localBridge.disconnect()),
        );
      },
    },
  ];
}

function liveUpdateDescription(): DocumentFragment {
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
