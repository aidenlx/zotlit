// Duplicate a Profile and open the copy through the shared workbench flow.
import * as m from "@/lib/i18n/generated/messages";
import { BaseNotice } from "@/lib/notice";
import type { ProfileSelector } from "@/lib/profile-stamp";

import type { SettingTabContext } from "./context";

export async function duplicateProfileToWorkbench(
  ctx: Pick<SettingTabContext, "app" | "profile" | "customize">,
  selector: ProfileSelector,
  options: { label?: string } = {},
): Promise<void> {
  const source = ctx.profile.resolveProfile(selector);
  if (!source) throw new Error(`Unknown Profile: ${selector}`);
  const copy = await ctx.profile.duplicate(selector, options);
  ctx.app.setting.close();
  await ctx.customize({ profileId: copy.id });
  new BaseNotice(
    m.notice_profile_duplicated({
      label: source.label ?? m.settings_profile_default_name(),
    }),
  );
}
