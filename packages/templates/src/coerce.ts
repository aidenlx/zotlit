// Output-value coercion shared by the Eta and Liquid engines' auto-filter/outputEscape hooks.

import { Temporal } from "@zotlit/shared/temporal";

/**
 * Coerces a rendered value to Markdown-safe text.
 *
 * @returns `""` for `null`/`undefined`; `toISOString()` for `Date`; the local
 *   date (via {@link Temporal.Now.timeZoneId}) for `Temporal.Instant`;
 *   otherwise `String(value)`.
 */
export function coerceOutput(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Temporal.Instant) {
    return value
      .toZonedDateTimeISO(Temporal.Now.timeZoneId())
      .toPlainDate()
      .toString();
  }
  // Coercing arbitrary values via their `toString` is this filter's job — e.g.
  // ItemDate / creators carry a custom `toString`.
  // oxlint-disable-next-line no-base-to-string
  return String(value);
}
