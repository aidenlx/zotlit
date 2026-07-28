import * as m from "@/lib/i18n/generated/messages";
import { defaultPlaceholder } from "@/setting-tab/placeholder";

import { type CompatContext } from "./context";
import { sectionGroup } from "./group";

/**
 * "Live updates" section: the server toggle gates a port row and an advanced
 * sub-group. Pre-1.13 has no declarative `visible` predicate, so toggling
 * `server.enabled` rerenders the whole tab to add/remove the gated rows.
 */
export function liveUpdatesSection(
  containerEl: HTMLElement,
  ctx: CompatContext,
): void {
  const group = sectionGroup(containerEl, m.settings_page_live_updates());

  const enabled = ctx.settings.current?.["server.enabled"] ?? false;

  group.addSetting((setting) =>
    setting
      .setName(m.settings_live_updates_enabled_name())
      .setDesc(m.settings_live_updates_enabled_desc())
      .addToggle((toggle) =>
        toggle.setValue(enabled).onChange((value) => {
          ctx.settings.update({ "server.enabled": value });
          ctx.rerender();
        }),
      ),
  );

  if (!enabled) return;

  // Pre-1.13 has no declarative `number` control; a text input parsed and
  // range-checked by hand is the faithful imperative fallback.
  group.addSetting((setting) =>
    setting
      .setName(m.settings_live_updates_port_name())
      .setDesc(m.settings_live_updates_port_desc())
      .addText((text) =>
        text
          .setPlaceholder(defaultPlaceholder("server.port"))
          .setValue(String(ctx.settings.current?.["server.port"] ?? ""))
          .onChange((value) => {
            const n = Number(value);
            if (Number.isInteger(n) && n >= 1024 && n <= 65535) {
              ctx.settings.update({ "server.port": n });
            }
          }),
      ),
  );

  const advanced = sectionGroup(
    group.listEl,
    m.settings_live_updates_advanced(),
  );

  // Pre-1.13 has no declarative `text` control beyond a plain input here.
  advanced.addSetting((setting) =>
    setting
      .setName(m.settings_live_updates_hostname_name())
      .setDesc(m.settings_live_updates_hostname_desc())
      .addText((text) =>
        text
          .setPlaceholder(defaultPlaceholder("server.hostname"))
          .setValue(ctx.settings.current?.["server.hostname"] ?? "")
          .onChange((value) =>
            ctx.settings.update({ "server.hostname": value }),
          ),
      ),
  );
}
