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

/** Annotation items toggled in the Zotero reader, with their new state. */
export const readerAnnotSelectSchema = v.object({
  event: v.literal("reader/annot-select"),
  updates: v.array(
    v.object({
      itemID: v.number(),
      selected: v.boolean(),
    }),
  ),
});

/** The Zotero reader switched to a different attachment. */
export const readerActiveSchema = v.object({
  event: v.literal("reader/active"),
  itemID: v.number(),
  attachmentID: v.number(),
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
