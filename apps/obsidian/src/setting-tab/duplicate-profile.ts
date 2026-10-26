// Duplicate a Profile and open the copy through the shared workbench flow.
import { Effect } from "effect";

import * as m from "@/lib/i18n/generated/messages";
import { Notifier } from "@/lib/notifier";
import { leaveSettingsFor } from "@/lib/plugin-host";
import type { ProfileSelector } from "@/lib/profile-stamp";
import { Profile, ProfileOperationError } from "@/services/profile/service";

import type { SettingTabContext } from "./context";

export const duplicateProfileToWorkbench = Effect.fn(
  "duplicateProfileToWorkbench",
)(function* (
  ctx: Pick<SettingTabContext, "customize">,
  selector: ProfileSelector,
  options: { label?: string } = {},
) {
  const profile = yield* Profile;
  const source = yield* profile.resolveProfile(selector);
  if (!source)
    return yield* new ProfileOperationError({
      message: `Unknown Profile: ${selector}`,
      cause: undefined,
    });
  const copy = yield* profile.duplicate(selector, options);
  yield* leaveSettingsFor("customize", () =>
    ctx.customize({ profileId: copy.id }),
  );
  yield* (yield* Notifier).show(
    m.notice_profile_duplicated({
      label: source.label ?? m.settings_profile_default_name(),
    }),
  );
});
