// The one place ZotLit reads the values Obsidian's metadata cache gathers
// across the vault: every value a frontmatter property holds, and every tag,
// as the Properties panel and a Bases cell suggest them while a value is
// typed. A build without these reads suggests nothing; editing still works.
//
// @see apps/obsidian/docs/adr/0068-query-files-are-a-zotlit-file-type-embedded-through-the-private-embed-registry.md
import type { App } from "obsidian";

import { getLogger } from "@/lib/log";

const logger = getLogger(["obsidian-private", "property-values"]);

/** The apps already warned of a missing read, by member, so each warns once. */
const warned = new WeakMap<App, Set<string>>();

type Member = "getFrontmatterPropertyValuesForKey" | "getTags";

function cache(app: App, member: Member) {
  const metadataCache = app.metadataCache as App["metadataCache"] | undefined;
  if (typeof metadataCache?.[member] === "function") return metadataCache;
  const members = warned.get(app) ?? new Set<string>();
  if (!members.has(member)) {
    members.add(member);
    warned.set(app, members);
    logger.warn(
      "Obsidian's metadata cache has no read of vault values; vault properties suggest none",
      { missing: member },
    );
  }
  return null;
}

/**
 * The text values the frontmatter property `name` holds across the vault,
 * each once, as the Properties panel suggests them; none where this
 * Obsidian build has no read of them.
 */
export function propertyValues(app: App, name: string): string[] {
  const values = cache(app, "getFrontmatterPropertyValuesForKey")
    ?.getFrontmatterPropertyValuesForKey!(name);
  return Array.isArray(values)
    ? values.filter((value): value is string => typeof value === "string")
    : [];
}

/**
 * The tags of the vault, without their `#`; none where this Obsidian build
 * has no read of them.
 */
export function vaultTags(app: App): string[] {
  const tags = cache(app, "getTags")?.getTags!();
  if (tags === null || typeof tags !== "object") return [];
  return Object.keys(tags).map((tag) => tag.replace(/^#/, ""));
}
