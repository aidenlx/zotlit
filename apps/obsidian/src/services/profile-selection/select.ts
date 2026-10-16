// The one Profile whose Match holds for an Item. One Items query of ZotLit
// Query reads the Item once and tests each Profile's Match as a Formula.
import type { Item } from "@zotlit/db";

import { getLogger } from "@/lib/log";
import type { Diagnostic } from "@/services/item-query/contract";
import type { QueryService } from "@/services/item-query/service";
import type { LiteratureNoteProfile } from "@/services/profile/service";

const logger = getLogger(["services", "profile-selection"]);

export type MatchSelection =
  | {
      outcome: "matched";
      profile: LiteratureNoteProfile;
      reason: { profile: string };
    }
  | { outcome: "overlap"; candidates: readonly LiteratureNoteProfile[] }
  | { outcome: "unmatched" }
  /** ZotLit Query could not read the Item, so no Match is known. */
  | { outcome: "failed" };

/**
 * The Profiles whose Match holds for `item`. A Match the query cannot
 * evaluate for the Item, such as one that reads a custom field the database
 * lacks, does not hold.
 */
export async function selectProfileByMatch(
  profiles: readonly LiteratureNoteProfile[],
  item: Pick<Item, "key" | "groupID">,
  query: Pick<QueryService, "run">,
): Promise<MatchSelection> {
  const tested = profiles.flatMap((profile) =>
    profile.match.state === "evaluable"
      ? [{ profile, filter: profile.match.filter }]
      : [],
  );
  let held = new Set<LiteratureNoteProfile>();
  if (tested.length > 0) {
    const answer = await testItemMatches(
      query,
      item,
      tested.map(({ filter }) => filter),
    );
    if (answer.kind !== "result") {
      logger.warn("Profile Matches could not be read for {key}", {
        key: item.key,
        answer,
      });
      return { outcome: "failed" };
    }
    if (answer.faults.some(Boolean))
      logger.debug("Some Profile Matches could not be evaluated", {
        key: item.key,
        faults: answer.faults,
      });
    held = new Set(
      tested.flatMap(({ profile }, index) =>
        answer.matched[index] ? [profile] : [],
      ),
    );
  }
  const candidates = profiles.filter(
    (profile) => profile.match.state === "all" || held.has(profile),
  );
  if (candidates.length === 0) return { outcome: "unmatched" };
  if (candidates.length > 1) return { outcome: "overlap", candidates };
  const profile = candidates[0]!;
  return { outcome: "matched", profile, reason: { profile: profile.label } };
}

/**
 * The test of one Item against each of `filters`, in one Items query:
 * - `result`: whether each filter holds, and the Diagnostic of each filter
 *   that cannot be evaluated for the Item, which does not hold.
 * - `missing`: the query finds no such Item.
 * - `failed`: the query failed, with its Diagnostic where it gives one.
 */
export async function testItemMatches(
  query: Pick<QueryService, "run">,
  item: Pick<Item, "key" | "groupID">,
  filters: readonly string[],
): Promise<
  | {
      kind: "result";
      matched: readonly boolean[];
      faults: readonly (Diagnostic | undefined)[];
    }
  | { kind: "missing" }
  | { kind: "failed"; diagnostic?: Diagnostic }
> {
  // `!!` gives the truth a filter reads: null and an Error Value are false.
  const formulas = Object.fromEntries(
    filters.map((filter, index) => [`match${index}`, `!!(${filter})`]),
  );
  const outcome = await query.run(
    {
      from: "items",
      filter: `key == ${JSON.stringify(item.key)}`,
      fields: Object.keys(formulas).map((name) => `formula.${name}`),
      formulas,
      limit: 1,
      libraries: {
        mode: "selected",
        libraries: [
          item.groupID === null
            ? { type: "personal" }
            : { type: "group", groupID: item.groupID },
        ],
      },
    },
    new AbortController().signal,
  );
  if (outcome.kind === "cancelled") return { kind: "failed" };
  if (outcome.kind === "failed")
    return { kind: "failed", diagnostic: outcome.diagnostic };
  const row = outcome.result.rows?.[0];
  if (!row) return { kind: "missing" };
  const faults: Readonly<Record<string, Diagnostic | undefined>> =
    outcome.result.formulaDiagnostics ?? {};
  return {
    kind: "result",
    matched: filters.map(
      (_, index) => row.values[`formula.match${index}`] === true,
    ),
    faults: filters.map((_, index) => faults[`match${index}`]),
  };
}
