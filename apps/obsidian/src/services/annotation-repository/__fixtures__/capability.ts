// The Local API's date values as the capability tests hand them to plain code:
// a Duration and a DateTime.Utc, built from the plain values a test holds.
import { DateTime, Duration } from "effect";

import { fromInstant } from "@/lib/effect-clock";

/** A cooldown failure that names `seconds`, as the Local API returns it. */
export function cooldownFailureOf(seconds: number) {
  return { kind: "cooldown", retryAfter: Duration.seconds(seconds) } as const;
}

/**
 * The DateTime.Utc a cooldown capability ends at, `seconds` after `instant`:
 * a test that holds a `Temporal.Instant` builds its deadline here.
 */
export function deadlineAfter(
  instant: { readonly epochMilliseconds: number },
  seconds: number,
): DateTime.Utc {
  return DateTime.addDuration(fromInstant(instant), Duration.seconds(seconds));
}
