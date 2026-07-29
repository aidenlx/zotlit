import {
  annotationToTemplateData,
  type TemplateAnnotation,
} from "@/lib/context/zt-template-annot";
import {
  resolveTemplateAttachment,
  type TemplateAttachment,
} from "@/lib/context/zt-template-attach";
import {
  itemToTemplateBaseData,
  resolveItemCore,
  withItemPreview,
  type FallibleTemplateLink,
  type ResolvedItemCore,
  type TemplateFilenameItemData,
  type TemplateItemBaseData,
  type TemplateItemData,
  type TemplateItemResolvers,
  type TemplateLink,
} from "@/lib/context/zt-template-item";
import { defineToString } from "@/lib/to-string";
import { type Annotation } from "@/lib/zt-annot";
import { type Attachment } from "@/lib/zt-attach";
import { type TemplateCollection } from "@/lib/zt-collection";
import { type ItemTag } from "@/lib/zt-tag";
import { type Item } from "@/queries/items";
import { type ChildNote } from "@/queries/notes";

/**
 * A single entry in {@link NoteTemplateContext.relatedItems}: the related
 * item's own {@link TemplateItemData}, flattened with its backlink and author
 * conveniences. Depth-1 — its own `annotations`, `attachments`, and
 * `relatedItems` are deliberately absent (resolving them would require a
 * per-related-item DB fan-out), marking the boundary of the relation graph.
 */
export interface TemplateRelatedItem
  extends TemplateItemData, ResolvedItemCore {}

/**
 * A child note exposed on {@link NoteTemplateContext.notes} as a link only —
 * the imported note's Markdown body lives in its own file, never inlined here.
 * Carries a non-enumerable `toString` rendering its {@link title} (falling back
 * to {@link key}), so it stringifies to a title in string contexts and previews.
 */
export interface TemplateNoteLink {
  /** Bare Zotero key (not scoped). */
  key: string;
  /** {@link key} for the personal library, `KEYgGROUPID` for a group library. */
  indexedKey: string;
  /** Note title as Zotero stores it; `null` when the row carries none. */
  title: string | null;
  /**
   * Renders the Obsidian link; default alias is the live title. Rendering it
   * queues the child note for import — a link never rendered creates no file,
   * and an already-imported note links to the existing file without
   * re-importing.
   *
   * @ztFilter note_link
   */
  noteLink: TemplateLink;
}

export function withNotePreview(note: TemplateNoteLink): TemplateNoteLink {
  return defineToString(note, function () {
    return this.title ?? this.key;
  });
}

/**
 * The `zt` root for the `note` template: {@link TemplateItemData} plus the
 * runtime-computed fields assembled at the app layer (backlinks, resolved
 * attachment links, flattened annotations, author conveniences).
 */
export interface NoteTemplateContext
  extends TemplateItemData, ResolvedItemCore {
  /**
   * Flat annotation list across all (or scoped) attachments. Entries carry
   * every annotation property except `citation`, which only a single-annotation
   * render resolves.
   */
  annotations: TemplateAnnotation[];
  /** All attachments for the item. */
  attachments: TemplateAttachment[];
  /**
   * Items from Zotero's "Related" panel (`dc:relation`), sorted by title.
   * Same-library, forward-only, depth-1.
   *
   * @example
   * ```liquid
   * {{ zt.relatedItems | note_links | join: ", " }}
   * ```
   */
  relatedItems: TemplateRelatedItem[];
  /** Imported child notes as link-only entries; `[]` when the item has none. */
  notes: TemplateNoteLink[];
}

/**
 * Resolvers for attachment file paths and annotation rendering (comment
 * conversion, excerpt images). Shared by {@link buildNoteContext}'s
 * {@link NoteContextInput} and `fetchAnnotationsTemplateData` (`./note-context`),
 * so both render annotations identically.
 */
export interface AnnotationResolvers {
  /** Resolve an attachment to its absolute on-disk path; `null` when unresolvable. */
  filePath: (attachment: Attachment) => string | null;
  /**
   * Build an attachment's file-link helper. Pass a 1-based `page` to default the
   * helper's subpath to `#page=N` (annotation-level links anchor to their page);
   * the helper returns `null` when the file is unresolvable.
   */
  fileLink: (
    attachment: Attachment,
    page?: number | null,
  ) => FallibleTemplateLink;
  /**
   * Build an annotation's excerpt-image link helper, or `null` when the
   * annotation type has no cached image. Prefix `!` to the rendered link for an
   * embed.
   */
  annotationImageLink: (annotation: Annotation) => TemplateLink | null;
  /**
   * Convert an annotation's raw comment HTML to Markdown. Called lazily, only
   * when a template reads `zt.comment`, so the conversion is skipped otherwise.
   */
  commentToMarkdown: (html: string) => string;
  /** Short author summary (e.g. `"Smith et al."`) for the annotation's parent item. */
  authorsShort: (item: Item) => string;
}

export type NoteContextInput = AnnotationResolvers &
  TemplateItemResolvers & {
    item: Item;
    /** The signed-in account username, resolved once per batch; `null` when unknown/never-synced. */
    username: string | null;
    /** The item's attachments, in display order. */
    attachments: readonly Attachment[];
    /** Annotations keyed by their parent attachment's `itemID`. */
    annotationsByAttachment: ReadonlyMap<number, readonly Annotation[]>;
    /** Tag applications keyed by Zotero itemID. */
    tagsByItemID: ReadonlyMap<number, readonly ItemTag[]>;
    /**
     * Resolved collections keyed by Zotero itemID, for the main item and related
     * items only — annotations are never collection members, so they are absent.
     */
    collectionsByItemID: ReadonlyMap<number, readonly TemplateCollection[]>;
    /**
     * Items related to {@link item} via Zotero's "Related" panel, already
     * resolved (trashed / unresolvable relations omitted). Each is mapped to a
     * {@link TemplateRelatedItem} and title-sorted.
     */
    relatedItems: readonly Item[];
    /**
     * Item's child notes, eagerly listed by the caller. Each is mapped through
     * {@link resolveChildNote} into {@link NoteTemplateContext.notes}; omitting
     * either (the annotation/filename paths) leaves `notes` empty.
     */
    childNotes?: readonly ChildNote[];
    /** Map a child note to its link-only template shape. */
    resolveChildNote?: (note: ChildNote) => TemplateNoteLink;
  };

/**
 * The minimal `zt` root for the **note-filename** template: an item's own
 * {@link TemplateFilenameItemData} and nothing else. Unlike {@link buildNoteContext}
 * this resolves no attachments, annotations, related items, or app-layer
 * resolvers, so a filename query stays a single-item read. `notePath` /
 * `noteLink` are empty stubs (a name is resolved before the note exists) —
 * present so a filename template referencing them renders `""` instead of
 * throwing. Pure: the caller passes the item's tags and collections in.
 */
export function buildFilenameContext(input: {
  item: Item;
  tags: readonly ItemTag[];
  collections: readonly TemplateCollection[];
}): TemplateFilenameItemData {
  return toFilenameItemData(
    itemToTemplateBaseData({ item: input.item, tags: input.tags }),
    input.collections,
  );
}

/** Stub `notePath`/`noteLink` as inert empty values; see {@link TemplateFilenameItemData}. */
function toFilenameItemData(
  baseData: TemplateItemBaseData,
  collections: readonly TemplateCollection[],
): TemplateFilenameItemData {
  return { ...baseData, notePath: "", noteLink: () => "", collections };
}

/**
 * Assemble the {@link NoteTemplateContext} from raw DB rows plus the runtime
 * resolvers the query layer deliberately omits. Pure: all I/O (DB fetch, path
 * resolution) is done by the caller and passed in.
 */
export function buildNoteContext(input: NoteContextInput): NoteTemplateContext {
  const { item } = input;
  const itemResolvers: TemplateItemResolvers = {
    notePath: input.notePath,
    noteLink: input.noteLink,
    authorsShort: input.authorsShort,
  };
  const baseData = itemToTemplateBaseData({
    item,
    tags: input.tagsByItemID.get(item.itemID) ?? [],
  });

  const attachments: TemplateAttachment[] = input.attachments.map((a) =>
    resolveTemplateAttachment(a, input),
  );

  const annotations: TemplateAnnotation[] = [];
  // `result` is referenced inside annotation objects (`parentItem`); it is
  // only read after this function returns.
  let result: NoteTemplateContext;

  input.attachments.forEach((attachment, i) => {
    const tplAttachment = attachments[i]!;
    const annots = input.annotationsByAttachment.get(attachment.itemID) ?? [];
    for (const annotation of annots) {
      const data = annotationToTemplateData({
        annotation,
        tags: input.tagsByItemID.get(annotation.itemID) ?? [],
        fileLink: (page) => input.fileLink(attachment, page),
        annotationImageLink: input.annotationImageLink,
        commentToMarkdown: input.commentToMarkdown,
        getParentAttachment: () => tplAttachment,
        getParentItem: () => result,
      });
      annotations.push(data);
    }
  });

  const relatedItems = input.relatedItems
    .map((related) =>
      buildRelatedItem({
        item: related,
        tags: input.tagsByItemID.get(related.itemID) ?? [],
        collections: input.collectionsByItemID.get(related.itemID) ?? [],
        itemResolvers,
        username: input.username,
      }),
    )
    .sort(byTitle);

  const notes = input.resolveChildNote
    ? (input.childNotes ?? []).map(input.resolveChildNote).map(withNotePreview)
    : [];

  const collections = input.collectionsByItemID.get(item.itemID) ?? [];
  // The inert item-own twin the resolvers receive; see TemplateItemResolvers.
  const filenameData = toFilenameItemData(baseData, collections);

  result = withItemPreview({
    ...baseData,
    get notePath() {
      return itemResolvers.notePath(filenameData);
    },
    noteLink(alias?: string, subpath?: string) {
      return itemResolvers.noteLink(filenameData, alias, subpath);
    },
    annotations,
    attachments,
    collections,
    ...resolveItemCore({
      item,
      baseData,
      username: input.username,
      authorsShort: itemResolvers.authorsShort,
    }),
    relatedItems,
    notes,
  });
  return result;
}

function buildRelatedItem({
  item,
  tags,
  collections,
  itemResolvers,
  username,
}: {
  item: Item;
  tags: readonly ItemTag[];
  collections: readonly TemplateCollection[];
  itemResolvers: TemplateItemResolvers;
  username: string | null;
}): TemplateRelatedItem {
  const baseData = itemToTemplateBaseData({ item, tags });
  const filenameData = toFilenameItemData(baseData, collections);
  return withItemPreview({
    ...baseData,
    get notePath() {
      return itemResolvers.notePath(filenameData);
    },
    noteLink(alias?: string, subpath?: string) {
      return itemResolvers.noteLink(filenameData, alias, subpath);
    },
    ...resolveItemCore({
      item,
      baseData,
      username,
      authorsShort: itemResolvers.authorsShort,
    }),
    collections,
  });
}

/**
 * Locale-aware title sort approximating Zotero's Related panel ordering;
 * untitled items sort last. Diverges from Zotero intentionally: no
 * article-stripping or display-title fallback (`getSortTitle`).
 */
function byTitle(a: TemplateRelatedItem, b: TemplateRelatedItem): number {
  const at = a.title ?? "";
  const bt = b.title ?? "";
  if (!at && !bt) return 0;
  if (!at) return 1;
  if (!bt) return -1;
  return at.localeCompare(bt);
}
