// The one Profile whose Match holds for each Item. One Items query of ZotLit
// Query reads every Item of a batch and tests each Profile's Match as a
// Formula; the query engine slices that work in the worker.
import { formatIndexedKey } from "@zotlit/db";
import type { Item } from "@zotlit/db";

import { getLogger } from "@/lib/log";
import type { Diagnostic } from "@/services/item-query/contract";
import type { QueryHandle } from "@/services/item-query/handle";
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

type MatchItem = Pick<Item, "key" | "groupID">;

/** Whether each filter holds for one Item, and each filter's Diagnostic. */
interface ItemMatches {
  matched: readonly boolean[];
  faults: readonly (Diagnostic | undefined)[];
}

/** One query's test of many Items, by Indexed Key; a missing Item has none. */
type BatchMatches =
  | { kind: "result"; byKey: ReadonlyMap<string, ItemMatches> }
  | { kind: "failed"; diagnostic?: Diagnostic };

/**
 * The Profiles whose Match holds for each of `items`, in their order. A
 * Match the query cannot evaluate for an Item, such as one that reads a custom
 * field the database lacks, does not hold.
 */
export async function selectProfilesByMatch(
  profiles: readonly LiteratureNoteProfile[],
  items: readonly MatchItem[],
  { query, signal }: { query: Pick<QueryHandle, "run">; signal?: AbortSignal },
): Promise<readonly MatchSelection[]> {
  const tested = profiles.flatMap((profile) =>
    profile.match.state === "evaluable"
      ? [{ profile, filter: profile.match.filter }]
      : [],
  );
  const answer =
    tested.length > 0 && items.length > 0
      ? await testItemsMatches(query, items, {
          filters: tested.map(({ filter }) => filter),
          signal,
        })
      : undefined;
  if (answer?.kind === "failed") {
    logger.warn("Profile Matches could not be read for {count} Items", {
      count: items.length,
      answer,
    });
    return items.map(() => ({ outcome: "failed" }));
  }
  const missing = answer
    ? items.filter(
        ({ key, groupID }) => !answer.byKey.has(formatIndexedKey(key, groupID)),
      )
    : [];
  if (missing.length > 0)
    logger.warn("ZotLit Query did not find {count} Items to match", {
      count: missing.length,
      keys: missing.slice(0, 10).map(({ key }) => key),
    });
  const faults = answer?.byKey.values().next().value?.faults ?? [];
  if (faults.some(Boolean))
    logger.debug("Some Profile Matches could not be evaluated", { faults });
  return items.map((item): MatchSelection => {
    let held = new Set<LiteratureNoteProfile>();
    if (answer) {
      const row = answer.byKey.get(formatIndexedKey(item.key, item.groupID));
      if (!row) return { outcome: "failed" };
      held = new Set(
        tested.flatMap(({ profile }, index) =>
          row.matched[index] ? [profile] : [],
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
  });
}

/**
 * The test of one Item against each of `filters`:
 * - `result`: whether each filter holds, and the Diagnostic of each filter
 *   that cannot be evaluated for the Item, which does not hold.
 * - `missing`: the query finds no such Item.
 * - `failed`: the query failed, with its Diagnostic where it gives one.
 */
export async function testItemMatches(
  query: Pick<QueryHandle, "run">,
  item: MatchItem,
  filters: readonly string[],
): Promise<
  | ({ kind: "result" } & ItemMatches)
  | { kind: "missing" }
  | { kind: "failed"; diagnostic?: Diagnostic }
> {
  const answer = await testItemsMatches(query, [item], { filters });
  if (answer.kind === "failed") return answer;
  const row = answer.byKey.get(formatIndexedKey(item.key, item.groupID));
  return row ? { kind: "result", ...row } : { kind: "missing" };
}

/**
 * {@link testItemMatches} for many Items in one Items query over the
 * Libraries they belong to.
 */
async function testItemsMatches(
  query: Pick<QueryHandle, "run">,
  items: readonly MatchItem[],
  {
    filters,
    signal = new AbortController().signal,
  }: { filters: readonly string[]; signal?: AbortSignal },
): Promise<BatchMatches> {
  // `!!` gives the truth a filter reads: null and an Error Value are false.
  const formulas = Object.fromEntries(
    filters.map((filter, index) => [`match${index}`, `!!(${filter})`]),
  );
  const indexedKeys = items.map(({ key, groupID }) =>
    formatIndexedKey(key, groupID),
  );
  const outcome = await query.run(
    {
      from: "items",
      // A literal list of Indexed Keys plans as a key lookup, not a scan.
      filter: `${JSON.stringify(indexedKeys)}.contains(indexedKey)`,
      fields: Object.keys(formulas).map((name) => `formula.${name}`),
      formulas,
      libraries: {
        mode: "selected",
        libraries: [...new Set(items.map(({ groupID }) => groupID))].map(
          (groupID) =>
            groupID === null
              ? { type: "personal" as const }
              : { type: "group" as const, groupID },
        ),
      },
    },
    signal,
  );
  signal.throwIfAborted();
  if (outcome.kind === "cancelled") return { kind: "failed" };
  if (outcome.kind === "failed")
    return { kind: "failed", diagnostic: outcome.diagnostic };
  const faultsByName: Readonly<Record<string, Diagnostic | undefined>> =
    outcome.result.formulaDiagnostics ?? {};
  const faults = filters.map((_, index) => faultsByName[`match${index}`]);
  return {
    kind: "result",
    byKey: new Map(
      (outcome.result.rows ?? []).map((row) => [
        row.indexedKey,
        {
          matched: filters.map(
            (_, index) => row.values[`formula.match${index}`] === true,
          ),
          faults,
        },
      ]),
    ),
  };
}
