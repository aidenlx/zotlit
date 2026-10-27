// The name the Workbench and the launch sheet show for a Profile.

import { Effect } from "effect";

import * as m from "@/lib/i18n/generated/messages";
import { DEFAULT_PROFILE, isProfileId } from "@/lib/profile-stamp";
import { Profile } from "@/services/profile/service";

/**
 * The Profile's own label, the built-in name for Default, and the id itself
 * when the vault no longer carries that Profile.
 */
export const profileDisplayName = Effect.fnUntraced(function* (
  profileId: string,
) {
  if (profileId === DEFAULT_PROFILE) return m.settings_profile_default_name();
  const profiles = yield* Profile;
  if (!(yield* profiles.loaded) || !isProfileId(profileId)) return profileId;
  const resolved = yield* Effect.orDie(profiles.resolveProfile(profileId));
  return resolved?.label ?? profileId;
});
