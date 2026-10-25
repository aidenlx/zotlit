// The frontmatter date seam: Obsidian's YAML parser can hand in a JS `Date`
// for a timestamp value, so it converts to a Temporal.Instant here.

/** `value` as an Instant when YAML parsed it as a timestamp `Date`. */
export function frontmatterInstant(
  value: unknown,
): Temporal.Instant | undefined {
  return value instanceof Date
    ? Temporal.Instant.fromEpochMilliseconds(value.getTime())
    : undefined;
}
