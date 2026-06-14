import { getLogger } from "@logtape/logtape";

const logger = getLogger(["zotlit", "db", "tags"]);

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
