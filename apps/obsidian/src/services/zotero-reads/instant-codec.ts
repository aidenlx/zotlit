// The row date seam: `@zotlit/db` rows carry Temporal.Instant, the date type
// of the template contract, so the ZoteroReads wire codes it here.
import { Schema, SchemaGetter } from "effect";

/**
 * `Temporal.Instant` is not structured-cloneable; it crosses the wire as its
 * ISO string and arrives as an `Instant`.
 */
export const Instant = Schema.String.pipe(
  Schema.decodeTo(Schema.instanceOf(Temporal.Instant), {
    decode: SchemaGetter.transform((s: string) => Temporal.Instant.from(s)),
    encode: SchemaGetter.transform((i: Temporal.Instant) => i.toString()),
  }),
);
