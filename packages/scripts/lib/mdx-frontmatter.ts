import { regex } from "arkregex";

/**
 * Narrow, targeted frontmatter helpers for the docs-availability fields
 * (`introduced`/`updated`) — not a general YAML frontmatter parser. Both
 * fields are always a quoted string on their own line, matching every
 * hand-authored `.mdx` page in `apps/docs/content/docs`.
 */

const INTRODUCED_LINE = regex('^introduced: "(?<value>[^"]*)"$', "m");
const UPDATED_LINE = regex('^updated: "(?<value>[^"]*)"$', "m");
const DESCRIPTION_LINE = regex('^description: ".*"$', "m");
const TITLE_LINE = regex('^title: ".*"$', "m");
const AVAILABILITY_LINE = regex('^(?:introduced|updated): ".*"\n?', "gm");

/**
 * Drop `introduced`/`updated` lines entirely. Used to compare two revisions
 * of a page for a *material* content difference — `release.ts` is the only
 * writer of these two lines, so their mere presence/absence must never
 * itself count as a change when a later scan diffs against the same
 * baseline (see ADR 0002).
 */
export function stripAvailabilityLines(content: string): string {
  return content.replace(AVAILABILITY_LINE, "");
}

/** Read a page's current `introduced`/`updated` frontmatter value, if set. */
export function getFrontmatterField(
  content: string,
  field: "introduced" | "updated",
): string | undefined {
  const line = field === "introduced" ? INTRODUCED_LINE : UPDATED_LINE;
  return line.exec(content)?.groups.value;
}

/**
 * Insert `introduced`/`updated` together for a brand-new page, right after
 * `description` (or `title` when there is no description).
 */
export function insertNewPageAvailability(
  content: string,
  version: string,
): string {
  const block = `introduced: "${version}"\nupdated: "${version}"`;
  const anchor = DESCRIPTION_LINE.test(content) ? DESCRIPTION_LINE : TITLE_LINE;
  return content.replace(anchor, (match) => `${match}\n${block}`);
}

/**
 * Set `updated` on a page that already carries `introduced`: replace an
 * existing `updated` line, or insert one right after `introduced`.
 */
export function setUpdatedRelease(content: string, version: string): string {
  const line = `updated: "${version}"`;
  if (UPDATED_LINE.test(content)) return content.replace(UPDATED_LINE, line);
  return content.replace(INTRODUCED_LINE, (match) => `${match}\n${line}`);
}
