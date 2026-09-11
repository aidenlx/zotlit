// An Item's base-field view and the Venue chain resolved over it.
import { FIELD_ALIASES } from "@zotlit/zotero-types";
import type { ItemFields } from "@zotlit/zotero-types";

/**
 * The base fields an Item resolves alongside its raw per-type `fields`. The
 * container and publisher roles feed the Venue chain; the rest are the
 * locator fields a result row shows wherever the item type records them.
 */
export const ITEM_BASE_FIELDS = [
  "publicationTitle",
  "publisher",
  "volume",
  "issue",
  "pages",
] as const;

export type ItemBaseFieldName = (typeof ITEM_BASE_FIELDS)[number];

/** An Item's fields read under their canonical Zotero base-field names. */
export type ItemBaseFields = {
  readonly [K in ItemBaseFieldName]: string | null;
};

export const EMPTY_ITEM_BASE_FIELDS: ItemBaseFields = {
  publicationTitle: null,
  publisher: null,
  volume: null,
  issue: null,
  pages: null,
};

/**
 * The Venue chain in precedence order: the container role first, then the
 * publisher role. Container wins unconditionally, so an item type recording
 * both names the work rather than the company that issued it. A further
 * fallback step appends here without touching callers.
 *
 * @see docs/adr/0026-venue-resolves-the-container-role-before-the-publisher-role.md
 */
const VENUE_CHAIN = [
  "publicationTitle",
  "publisher",
] as const satisfies readonly ItemBaseFieldName[];

/**
 * The Item's **Venue** — the journal, book, website, repository, university,
 * or publisher it appeared under. `null` for item types that record neither
 * role, such as Letter and Email.
 */
export function resolveVenue(baseFields: ItemBaseFields): string | null {
  for (const name of VENUE_CHAIN) {
    const value = baseFields[name];
    if (value) return value;
  }
  return null;
}

/**
 * The base-field view of a raw per-type `fields` object, resolved by field
 * name off Zotero's published schema.
 *
 * The queries resolve by field id against the live database instead, which is
 * what lets custom item types and custom fields resolve. This name-based form
 * is for callers holding item fields without a database — fixtures — so they
 * cannot state a view their raw fields do not support.
 */
export function itemBaseFields(fields: ItemFields): ItemBaseFields {
  const tracked = new Set<string>(ITEM_BASE_FIELDS);
  const resolved: Record<ItemBaseFieldName, string | null> = {
    ...EMPTY_ITEM_BASE_FIELDS,
  };
  for (const [name, value] of Object.entries(fields)) {
    const baseName = FIELD_ALIASES[name] ?? name;
    if (!tracked.has(baseName) || value == null) continue;
    resolved[baseName as ItemBaseFieldName] = value;
  }
  return resolved;
}
