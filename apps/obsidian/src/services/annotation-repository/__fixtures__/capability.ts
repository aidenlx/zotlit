// The Local API's date values as the capability tests hand them to plain code:
// a Duration and a DateTime.Utc, built from the plain numbers a test holds.
import { DateTime, Duration } from "effect";

/** A cooldown failure that names `seconds`, as the Local API returns it. */
export function cooldownFailureOf(seconds: number) {
  return { kind: "cooldown", retryAfter: Duration.seconds(seconds) } as const;
}

/** `epochMillis` as the DateTime.Utc a write authorization state carries. */
export function utcAt(epochMillis: number): DateTime.Utc {
  return DateTime.makeUnsafe(epochMillis);
}
