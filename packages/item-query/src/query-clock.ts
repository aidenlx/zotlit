import { Context } from "effect";

/**
 * The time zone of the Query Clock: an IANA zone name that defines every
 * calendar day of one query. The instant of the Query Clock comes from the
 * Effect `Clock`. Defaults to the system zone.
 */
export const QueryTimeZone = Context.Reference<string>(
  "@zotlit/item-query/QueryTimeZone",
  { defaultValue: () => Temporal.Now.timeZoneId() },
);
