// Message keys that no source reads. The catalogs in `messages/` hold the
// user-facing copy of every surface; a key that no source names is dead copy
// that translators still maintain.

/** One message key and the names a source reads it by. */
export interface MessageKey {
  /** The key as the catalog writes it: `query_view_filter` or `zotero.menu_item_open`. */
  readonly key: string;
  /** A source that holds one of these as a whole word reads the key. */
  readonly names: readonly string[];
}

/**
 * The keys of the base catalog. A top-level key is read by its name. A key of
 * the `zotero` object is Companion copy, read by its Fluent ID
 * (`zotlit-menu-item-open`) or as `zotero.menu_item_open`.
 */
export function messageKeys(
  catalog: Readonly<Record<string, unknown>>,
): MessageKey[] {
  const keys: MessageKey[] = [];
  for (const [key, value] of Object.entries(catalog)) {
    if (key.startsWith("$")) continue;
    if (key !== "zotero") {
      keys.push({ key, names: [key] });
      continue;
    }
    for (const name of Object.keys(value as Record<string, unknown>))
      keys.push({
        key: `zotero.${name}`,
        names: [`zotero.${name}`, `zotlit-${name.replaceAll("_", "-")}`],
      });
  }
  return keys;
}

/** The keys that none of `sources` reads, in catalog order. */
export function unusedMessageKeys(
  keys: readonly MessageKey[],
  sources: Iterable<string>,
): string[] {
  const words = new Set<string>();
  for (const source of sources)
    for (const word of source.matchAll(/[\w.-]+/g)) {
      words.add(word[0]);
      // `m.query_view_filter()` reads as one dotted word; so does a Fluent
      // ID with an attribute, `zotlit-menu-item-open.label`.
      for (const part of word[0].split(".")) words.add(part);
    }
  return keys
    .filter(({ names }) => !names.some((name) => words.has(name)))
    .map(({ key }) => key);
}

/**
 * What the check reports: keys newly unused, and baseline keys that a source
 * reads again or the catalog no longer holds. Each list must be empty.
 */
export function compareWithBaseline(
  unused: readonly string[],
  baseline: readonly string[],
  keys: readonly MessageKey[],
): { added: string[]; used: string[]; gone: string[] } {
  const known = new Set(keys.map(({ key }) => key));
  const now = new Set(unused);
  const before = new Set(baseline);
  return {
    added: unused.filter((key) => !before.has(key)),
    used: baseline.filter((key) => known.has(key) && !now.has(key)),
    gone: baseline.filter((key) => !known.has(key)),
  };
}
