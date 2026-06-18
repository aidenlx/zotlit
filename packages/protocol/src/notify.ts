import * as v from "valibot";

/** Reference to a Zotero item by id within its library. */
const itemRef = v.object({
  itemID: v.number(),
  libraryID: v.number(),
});

/** Regular items added / modified / trashed in Zotero. */
export const itemUpdateSchema = v.object({
  event: v.literal("item/update"),
  add: v.array(itemRef),
  modify: v.array(itemRef),
  trash: v.array(itemRef),
});

/** The full set of annotation items currently selected in a reader. */
export const readerAnnotSelectSchema = v.object({
  event: v.literal("reader/annot-select"),
  itemID: v.number(),
  attachmentID: v.number(),
  selected: v.array(v.number()),
});

/** The Zotero reader switched to a different attachment. */
export const readerActiveSchema = v.object({
  event: v.literal("reader/active"),
  itemID: v.number(),
  attachmentID: v.number(),
  /** Item IDs of the annotations selected in the newly-active reader. */
  selected: v.array(v.number()),
});

export type ItemUpdate = v.InferOutput<typeof itemUpdateSchema>;
export type ReaderAnnotSelect = v.InferOutput<typeof readerAnnotSelectSchema>;
export type ReaderActive = v.InferOutput<typeof readerActiveSchema>;

/**
 * Events pushed from the Zotero companion to the Obsidian plugin's HTTP
 * listener (`POST {host}/notify`, JSON body). Discriminated on `event`.
 */
export const notifyEventSchema = v.variant("event", [
  itemUpdateSchema,
  readerAnnotSelectSchema,
  readerActiveSchema,
]);

export type NotifyEvent = v.InferOutput<typeof notifyEventSchema>;
