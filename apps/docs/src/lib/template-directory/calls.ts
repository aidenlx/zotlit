// Which Shared Partials a Liquid template calls, directly or through the partials it calls.

import { regex } from "arkregex";

/** A `render` or `include` tag that names its template in quotes. */
const PARTIAL_CALL = regex(
  "\\{%-?\\s*(?:render|include)\\s+(?<quote>[\"'])(?<name>[^\"']+)\\k<quote>",
  "g",
);

/**
 * The Profile's own Annotation Section answers this name, so a call to it is
 * never a Shared Partial.
 */
const ANNOTATION_SECTION = "annotation";

/** The names the given sources call directly, excluding the Annotation Section. */
export function directCalls(sources: readonly string[]): string[] {
  return [
    ...new Set(
      sources.flatMap((source) =>
        [...source.matchAll(PARTIAL_CALL)].flatMap(({ groups }) =>
          groups?.name && groups.name !== ANNOTATION_SECTION
            ? [groups.name]
            : [],
        ),
      ),
    ),
  ].sort(byName);
}

/**
 * Every partial the sources reach, sorted: the ones they call and, through
 * `partials`, the ones those call. A name `partials` does not answer is still
 * reached; nothing past it is.
 */
export function reachableCalls(
  sources: readonly string[],
  partials: ReadonlyMap<string, string>,
): string[] {
  const reached = new Set<string>();
  const pending = directCalls(sources);
  while (pending.length > 0) {
    const name = pending.pop()!;
    if (reached.has(name)) continue;
    reached.add(name);
    const source = partials.get(name);
    if (source !== undefined) pending.push(...directCalls([source]));
  }
  return [...reached].sort(byName);
}

function byName(a: string, b: string): number {
  return a.localeCompare(b);
}
