// Unique Profile Match selection over the active registry and an Item's facts.
import { USER_LIBRARY_ID } from "@zotlit/db";
import type { Item } from "@zotlit/db";

import type { LiteratureNoteProfile } from "@/services/profile/service";

import { matchCondition } from "./condition";
import type { MatchItemFacts } from "./condition";

export type MatchSelection =
  | {
      outcome: "matched";
      profile: LiteratureNoteProfile;
      reason: { profile: string };
    }
  | { outcome: "overlap"; candidates: readonly LiteratureNoteProfile[] }
  | { outcome: "unmatched" };

export function matchItem(
  item: Pick<Item, "libraryID" | "groupID" | "fields">,
  memberships: Pick<MatchItemFacts, "tags" | "collections">,
): MatchItemFacts {
  return {
    library:
      item.libraryID === USER_LIBRARY_ID
        ? { type: "personal" }
        : item.groupID === null
          ? null
          : { type: "group", groupID: item.groupID },
    itemType: item.fields.itemType,
    ...memberships,
  };
}

export function selectProfileByMatch(
  profiles: readonly LiteratureNoteProfile[],
  item: MatchItemFacts,
): MatchSelection {
  const candidates = profiles.filter(
    ({ match }) =>
      (match.state === "all" || match.state === "evaluable") &&
      matchCondition(match.condition, item),
  );
  if (candidates.length === 0) return { outcome: "unmatched" };
  if (candidates.length > 1) return { outcome: "overlap", candidates };
  const profile = candidates[0]!;
  return { outcome: "matched", profile, reason: { profile: profile.label } };
}
