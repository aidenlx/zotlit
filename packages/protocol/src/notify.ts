import * as v from "valibot";

/**
 * Optional diagnostic dirs merged into every event. The source identity itself
 * travels in the {@link SOURCE_ID_HEADER} header; these raw paths are present
 * only when the companion's debug logging is on, to make a source-id mismatch
 * diagnosable. They stay in the JSON body (not a header) because filesystem
 * paths can be non-ASCII.
 * @see sourceIdFromUris
 */
const debugDirs = v.object({
  profilePath: v.optional(v.string()),
  dataPath: v.optional(v.string()),
});

/**
 * The Freshness Signal: the Zotero database changed and the main database
 * file is as current as the companion can make it. Carries no item identity —
 * the receiver treats it as a refresh trigger, never as data.
 */
export const dbUpdatedSchema = v.object({
  ...debugDirs.entries,
  event: v.literal("db/updated"),
});

/** The full set of annotation items currently selected in a reader. */
export const readerAnnotSelectSchema = v.object({
  ...debugDirs.entries,
  event: v.literal("reader/annot-select"),
  itemID: v.number(),
  attachmentID: v.number(),
  selected: v.array(v.number()),
});

/** The Zotero reader switched to a different attachment. */
export const readerActiveSchema = v.object({
  ...debugDirs.entries,
  event: v.literal("reader/active"),
  itemID: v.number(),
  attachmentID: v.number(),
  /** Item IDs of the annotations selected in the newly-active reader. */
  selected: v.array(v.number()),
});

export type DbUpdated = v.InferOutput<typeof dbUpdatedSchema>;
export type ReaderAnnotSelect = v.InferOutput<typeof readerAnnotSelectSchema>;
export type ReaderActive = v.InferOutput<typeof readerActiveSchema>;

/**
 * Events pushed from the Zotero companion to the Obsidian plugin's HTTP
 * listener (`POST {host}/notify`, JSON body). Discriminated on `event`.
 */
export const notifyEventSchema = v.variant("event", [
  dbUpdatedSchema,
  readerAnnotSelectSchema,
  readerActiveSchema,
]);

export type NotifyEvent = v.InferOutput<typeof notifyEventSchema>;
