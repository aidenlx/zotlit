// The Zotero Local API's dates as plain code reads them: the Temporal of the
// Editing Capability, from the DateTime and Duration the service carries.

import {
  fromTemporalDuration,
  toInstant,
  toTemporalDuration,
} from "@/lib/effect-clock";

import type { WriteAuthorizationState } from "./service";
import type { LocalApiFailure } from "./wire";

/** When Zotero's dialog rate limit lifts, or null while none is running. */
export function cooldownDeadline(
  writes: WriteAuthorizationState,
): Temporal.Instant | null {
  return writes.cooldownUntil === null ? null : toInstant(writes.cooldownUntil);
}

/** How long a cooldown failure says to wait. */
export function cooldownSpan(
  failure: Extract<LocalApiFailure, { kind: "cooldown" }>,
): Temporal.Duration {
  return toTemporalDuration(failure.retryAfter);
}

/** The cooldown failure for a wait of `span`. */
export function cooldownFailure(
  span: Temporal.Duration,
): Extract<LocalApiFailure, { kind: "cooldown" }> {
  return { kind: "cooldown", retryAfter: fromTemporalDuration(span) };
}
