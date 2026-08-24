// Resolves what a collections-pane context menu click covers, across the Zotero 9 and Zotero 10 context shapes.

type LibraryMenuContext = _ZoteroTypes.MenuManager.LibraryMenuContext;

/**
 * What a batch action covers: a whole library, or one collection within it.
 * `groupID` is `0` for the personal library and a positive integer for a group;
 * `collectionKey` is present on collection rows only.
 */
export interface RowScope {
  groupID: number;
  collectionKey?: string;
}

/**
 * The clicked collections-pane row, or `undefined` when the click covers
 * anything other than exactly one row.
 *
 * Zotero 10 removed the singular getter and passes the selection as
 * `collectionTreeRows`; the singular name survives as a property that throws on
 * read. Zotero 9 supplies the singular value only. So the branch tests for
 * presence of the plural key — a read of the singular throws on Zotero 10.
 *
 * Zotero 10 also allows a multi-row selection, which the batch actions don't
 * cover, so more than one row resolves to `undefined` and hides the submenu.
 *
 * @see https://github.com/zotero/zotero/blob/10.0.0/chrome/content/zotero/zoteroPane.js#L4113
 * @see https://github.com/zotero/zotero/blob/9.0.3/chrome/content/zotero/zoteroPane.js#L3713
 */
function contextRow(
  context: LibraryMenuContext,
): Zotero.CollectionTreeRow | undefined {
  if ("collectionTreeRows" in context) {
    const rows = context.collectionTreeRows;
    return rows?.length === 1 ? rows[0] : undefined;
  }
  return context.collectionTreeRow as Zotero.CollectionTreeRow | undefined;
}

/**
 * Scope of the clicked row, or `null` when the row names something the batch
 * actions can't cover — a saved search, feed, the trash, duplicates, unfiled,
 * retracted, or publications.
 *
 * `Zotero.Groups.getGroupIDFromLibraryID` throws for the personal library, so
 * the group id resolves off the row's library id only when it names a group.
 */
export function contextScope(context: LibraryMenuContext): RowScope | null {
  const row = contextRow(context);
  if (row?.isCollection()) {
    return {
      groupID: groupIDFromLibrary(row.ref.libraryID as number),
      collectionKey: row.ref.key as string,
    };
  }
  if (row?.isGroup()) {
    return { groupID: groupIDFromLibrary(row.ref.libraryID as number) };
  }
  return row?.isLibrary() ? { groupID: 0 } : null;
}

function groupIDFromLibrary(libraryID: number): number {
  if (libraryID === Zotero.Libraries.userLibraryID) return 0;
  return Zotero.Groups.getGroupIDFromLibraryID(libraryID);
}
