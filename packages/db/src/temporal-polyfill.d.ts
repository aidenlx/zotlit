/// <reference lib="esnext.temporal" />
/// <reference lib="esnext.date" />
/// <reference lib="esnext.intl" />

declare module "@js-temporal/polyfill" {
  export import Temporal = globalThis.Temporal;
  export import Intl = globalThis.Intl;
  export function toTemporalInstant(this: Date): Temporal.Instant;
}
