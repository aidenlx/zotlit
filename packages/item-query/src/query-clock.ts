import { Clock, Context, Effect } from "effect";

/**
 * The time zone of the Query Clock: an IANA zone name that defines every
 * calendar day of one query. The instant of the Query Clock comes from the
 * Effect `Clock`. Defaults to the system zone.
 */
export const QueryTimeZone = Context.Reference<string>(
  "@zotlit/item-query/QueryTimeZone",
  { defaultValue: () => Temporal.Now.timeZoneId() },
);

/**
 * The one instant and one time zone of an Item Query. The zone defines every
 * calendar day: `today()`, `.date()` on a timestamp, `relative()`, and a
 * comparison between a day-precision value and a timestamp.
 */
export interface QueryClock {
  readonly now: Temporal.Instant;
  /** An IANA time zone name. */
  readonly timeZone: string;
}

/**
 * Read the Query Clock once: the instant from the Effect `Clock` and the zone
 * from {@link QueryTimeZone}.
 */
export const readQueryClock: Effect.Effect<QueryClock> = Effect.gen(
  function* () {
    const millis = yield* Clock.currentTimeMillis;
    const timeZone = yield* QueryTimeZone;
    return { now: Temporal.Instant.fromEpochMilliseconds(millis), timeZone };
  },
);
