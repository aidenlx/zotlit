import { getLogger } from "@logtape/logtape";

import { defineToString } from "./to-string";

const logger = getLogger(["zotlit", "db", "tags"]);

/**
 * `itemTags.type`: 0 (default) is a manual tag, 1 is an automatic tag.
 *
 * @see https://github.com/zotero/zotero/blob/9.0.3/chrome/content/zotero/xpcom/data/item.js#L4508-L4518 — `Zotero.Item.prototype.addTag`
 */
const TAG_TYPE = {
  0: "manual",
  1: "auto",
} as const;

export type TagType = keyof typeof TAG_TYPE;
export type TagTypeName = (typeof TAG_TYPE)[TagType];

export interface Tag {
  tagID: number;
  name: string;
}

export interface ItemTag {
  itemID: number;
  tag: Tag;
  /** Raw `itemTags.type` int; resolve names via {@link tagTypeToName}. */
  type: TagType;
}

export function tagTypeToName(type: TagType): TagTypeName | "unknown" {
  const name = TAG_TYPE[type];
  if (name) return name;

  logger.warn("Unknown tag type {type}", { type });
  return "unknown";
}

/**
 * A Tag in the template vocabulary. Coerces to `name` in string contexts (like a
 * collection coerces to its name), so `{{ zt.tags | join: ", " }}` renders tag
 * names directly. Zotero-internal IDs are dropped; `type` is the resolved name
 * rather than {@link ItemTag}'s raw int.
 */
export interface TemplateTag {
  /** Tag name as shown in Zotero. */
  name: string;
  /**
   * `"manual"` for a hand-added tag, `"auto"` for an automatic one (a
   * translator or plugin attached it while saving or importing); `"unknown"`
   * for a type id Zotero added after this mapping was written.
   */
  type: TagTypeName | "unknown";
  /** {@link TemplateTag.name} verbatim. */
  toString(): string;
}

export function toTemplateTag(tag: ItemTag): TemplateTag {
  return defineToString(
    { name: tag.tag.name, type: tagTypeToName(tag.type) },
    function () {
      return this.name;
    },
  );
}
