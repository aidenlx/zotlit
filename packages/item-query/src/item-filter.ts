// One Filter Expression over Items held in memory: planned once, as a query
// plans it, then tested on each Item with the evaluator a query uses.
import type { Diagnostic } from "./diagnose";
import { ItemQueryError } from "./error";
import type { ItemQueryErrorCode } from "./error";
import type { QueryItem } from "./fields";
import { matches } from "./filter-evaluate";
import { planFilter } from "./filter-plan";
import { queryItemFrom } from "./item-seed";
import type { QueryItemSeed } from "./item-seed";
import type { QueryClock } from "./query-clock";
import { ITEMS } from "./query-items";
import { missingCustomField } from "./query-sources";

/** A planned filter over Items. */
export interface ItemFilter {
  /**
   * Whether the filter selects `item`. Dates read `clock`; by default, the
   * instant and the time zone of the call.
   */
  readonly matches: (item: QueryItem, clock?: QueryClock) => boolean;
}

/**
 * Plan `text` as the filter of the Items dataset, with no Query Context and
 * no Formulas.
 * @returns The planned filter, or the Diagnostic of its first mistake, as a
 * query with this filter reports it.
 */
export function planItemFilter(
  text: string,
): ItemFilter | Diagnostic<ItemQueryErrorCode> {
  const planned = plan(text);
  if ("code" in planned) return planned;
  return {
    matches: (item, clock = nowClock()) => matches(planned.root, item, clock),
  };
}

function plan(text: string) {
  const planned = planFilter(text);
  if ("kind" in planned)
    return new ItemQueryError({
      dataset: ITEMS,
      fault: planned,
      location: {
        argument: "filter",
        span:
          planned.kind === "syntax"
            ? { from: planned.fault.from, to: planned.fault.to }
            : planned.at,
      },
      argumentText: text,
    }).diagnostic;
  return planned;
}

/**
 * The answer of a filter for an Item held as its seed:
 * - `result`: whether the filter selects the Item, as a query would.
 * - `problem`: the Diagnostic a query with this filter reports, such as a
 *   custom field the source of the Item lacks.
 * - `unavailable`: the filter reads Attachments, Annotations, or Notes,
 *   which a seed does not keep.
 */
export type SeedTest =
  | { readonly kind: "result"; readonly matched: boolean }
  | {
      readonly kind: "problem";
      readonly diagnostic: Diagnostic<ItemQueryErrorCode>;
    }
  | { readonly kind: "unavailable" };

/** Test the filter `text` on the Item of `seed`, in memory. */
export function testItemSeed(
  text: string,
  seed: QueryItemSeed,
  clock: QueryClock = nowClock(),
): SeedTest {
  const planned = plan(text);
  if ("code" in planned) return { kind: "problem", diagnostic: planned };
  const missing = missingCustomField(planned, seed.customFieldNames);
  if (missing)
    return {
      kind: "problem",
      diagnostic: new ItemQueryError({
        dataset: ITEMS,
        fault: missing.fault,
        location: { argument: "filter", span: missing.at },
        argumentText: text,
      }).diagnostic,
    };
  if (
    planned.needs.some(
      (needs) =>
        needs.attachments !== undefined ||
        needs.annotations !== undefined ||
        needs.notes !== undefined,
    )
  )
    return { kind: "unavailable" };
  return {
    kind: "result",
    matched: matches(planned.root, queryItemFrom(seed), clock),
  };
}

function nowClock(): QueryClock {
  return { now: Temporal.Now.instant(), timeZone: Temporal.Now.timeZoneId() };
}
