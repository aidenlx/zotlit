// The one Profile whose Match holds for each Item. One Items query of ZotLit
// Query reads up to a slice of Items at once and tests each Profile's Match as
// a Formula, so a batch costs a query per slice rather than one per Item.
import { chunk } from "@std/collections/chunk";

import { formatIndexedKey } from "@zotlit/db";
import type { Item } from "@zotlit/db";

import { getLogger } from "@/lib/log";
import type { Diagnostic } from "@/services/item-query/contract";
import type { QueryService } from "@/services/item-query/service";
import type { LiteratureNoteProfile } from "@/services/profile/service";

const logger = getLogger(["services", "profile-selection"]);

/** Items one query tests; it bounds the filter text and the reply. */
const ITEMS_PER_QUERY = 500;

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

/** The test of one Item against each filter. */
type ItemMatches =
  | {
      kind: "result";
      matched: readonly boolean[];
      faults: readonly (Diagnostic | undefined)[];
    }
  | { kind: "missing" }
  | { kind: "failed"; diagnostic?: Diagnostic };

/**
 * The Profiles whose Match holds for each of `items`, in their order. A
 * Match the query cannot evaluate for an Item, such as one that reads a custom
 * field the database lacks, does not hold.
 */
export async function selectProfilesByMatch(
  profiles: readonly LiteratureNoteProfile[],
  items: readonly MatchItem[],
  { query, signal }: { query: Pick<QueryService, "run">; signal?: AbortSignal },
): Promise<readonly MatchSelection[]> {
  const tested = profiles.flatMap((profile) =>
    profile.match.state === "evaluable"
      ? [{ profile, filter: profile.match.filter }]
      : [],
  );
  const answers =
    tested.length > 0
      ? await testItemsMatches(query, items, {
          filters: tested.map(({ filter }) => filter),
          signal,
        })
      : undefined;
  return items.map((item): MatchSelection => {
    let held = new Set<LiteratureNoteProfile>();
    const answer = answers?.get(formatIndexedKey(item.key, item.groupID));
    if (answer) {
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
  query: Pick<QueryService, "run">,
  item: MatchItem,
  filters: readonly string[],
): Promise<ItemMatches> {
  const answers = await testItemsMatches(query, [item], { filters });
  return answers.get(formatIndexedKey(item.key, item.groupID))!;
}

/**
 * {@link testItemMatches} for many Items, by Indexed Key: one Items query per
 * slice of {@link ITEMS_PER_QUERY} Items, over the Libraries the slice holds.
 */
async function testItemsMatches(
  query: Pick<QueryService, "run">,
  items: readonly MatchItem[],
  {
    filters,
    signal = new AbortController().signal,
  }: { filters: readonly string[]; signal?: AbortSignal },
): Promise<ReadonlyMap<string, ItemMatches>> {
  // `!!` gives the truth a filter reads: null and an Error Value are false.
  const formulas = Object.fromEntries(
    filters.map((filter, index) => [`match${index}`, `!!(${filter})`]),
  );
  const fields = Object.keys(formulas).map((name) => `formula.${name}`);
  const answers = new Map<string, ItemMatches>();
  for (const slice of chunk(items, ITEMS_PER_QUERY)) {
    const indexedKeys = slice.map(({ key, groupID }) =>
      formatIndexedKey(key, groupID),
    );
    const groupIDs = new Set(slice.map(({ groupID }) => groupID));
    const outcome = await query.run(
      {
        from: "items",
        // A literal list of Indexed Keys plans as a key lookup, not a scan.
        filter: `${JSON.stringify(indexedKeys)}.contains(indexedKey)`,
        fields,
        formulas,
        libraries: {
          mode: "selected",
          libraries: [...groupIDs].map((groupID) =>
            groupID === null
              ? { type: "personal" as const }
              : { type: "group" as const, groupID },
          ),
        },
      },
      signal,
    );
    signal.throwIfAborted();
    if (outcome.kind !== "result") {
      const failed: ItemMatches =
        outcome.kind === "failed"
          ? { kind: "failed", diagnostic: outcome.diagnostic }
          : { kind: "failed" };
      for (const indexedKey of indexedKeys) answers.set(indexedKey, failed);
      continue;
    }
    const faultsByName: Readonly<Record<string, Diagnostic | undefined>> =
      outcome.result.formulaDiagnostics ?? {};
    const faults = filters.map((_, index) => faultsByName[`match${index}`]);
    const rows = new Map(
      (outcome.result.rows ?? []).map((row) => [row.indexedKey, row]),
    );
    for (const indexedKey of indexedKeys) {
      const row = rows.get(indexedKey);
      answers.set(
        indexedKey,
        row
          ? {
              kind: "result",
              matched: filters.map(
                (_, index) => row.values[`formula.match${index}`] === true,
              ),
              faults,
            }
          : { kind: "missing" },
      );
    }
  }
  return answers;
}
