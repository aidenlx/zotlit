// Indexed Key derivation for Zotero objects; the format rule itself lives in @zotlit/shared.
import { getLogger } from "@logtape/logtape";

import {
  formatIndexedKey,
  type ParsedIndexedKey,
} from "@zotlit/shared/indexed-key";

// Rooted category rather than `@/lib/logger`, whose import chain reaches the
// Zotero-only `Localization` global and would keep this module out of tests.
const logger = getLogger(["zotlit", "zotero", "indexed-key"]);

type KeyedObject = Pick<Zotero.Item, "key" | "libraryID">;

/**
 * The object's Indexed Key identity, or `null` when its library cannot carry
 * one — a missing library, or a feed, which the format has no notation for.
 */
export function identityForObject(
  object: KeyedObject,
): ParsedIndexedKey | null {
  const library = Zotero.Libraries.get(object.libraryID);
  if (!library) {
    logger.error("library not found for object", {
      key: object.key,
      libraryID: object.libraryID,
    });
    return null;
  }
  switch (library.libraryType) {
    case "group":
      return { key: object.key, groupID: library.libraryTypeID };
    case "user":
      return { key: object.key, groupID: null };
    default:
      logger.error("library type carries no Indexed Key", {
        key: object.key,
        libraryType: library.libraryType,
      });
      return null;
  }
}

/** One Indexed Key per line, in the order given. */
export function formatObjectKeys(identities: ParsedIndexedKey[]): string {
  return identities
    .map(({ key, groupID }) => formatIndexedKey(key, groupID))
    .join("\n");
}
