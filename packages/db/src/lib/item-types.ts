// Zotero item-type categories shared by query and contract generation.

/** Child rows excluded from regular Item contracts and queries. */
export const CHILD_ITEM_TYPES = ["attachment", "note", "annotation"] as const;

export type ChildItemType = (typeof CHILD_ITEM_TYPES)[number];
