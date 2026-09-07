// A settings Match action opens the document's shared Match tab.
import type { ProfileId } from "@/lib/profile-stamp";
import { openProfileEditor } from "@/views/profile-editor/register";

import type { SettingTabContext } from "./context";

export async function editProfileMatch(
  ctx: SettingTabContext,
  id: ProfileId,
): Promise<void> {
  await ctx.profile.ready;
  const profile = ctx.profile.profiles.find((entry) => entry.id === id);
  const file = profile ? ctx.app.vault.getFileByPath(profile.path) : null;
  if (file) {
    ctx.app.setting.close();
    await openProfileEditor(ctx.app, file, { tab: "match" });
  }
}
