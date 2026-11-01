/**
 * Maps between page IDs and page numbers, allowing bidirectional conversion
 * between the two representations. This is useful when the page numbering
 * in the PDF document doesn't match the default sequential ordering.
 *
 * When #pageNumberToId is null the mapping is the identity (page N has ID N).
 */
export class PagesMapper {
    set pagesNumber(n: number);
    get pagesNumber(): number;
    /**
     * Move a set of pages to a new position.
     *
     * @param {Set<number>} selectedPages - Page numbers being moved (1-indexed).
     * @param {number[]} pagesToMove - Ordered list of page numbers to move.
     * @param {number} index - Zero-based insertion index in the page-number list.
     */
    movePages(selectedPages: Set<number>, pagesToMove: number[], index: number): void;
    /**
     * Deletes a set of pages.
     * @param {Array<number>} pagesToDelete - Page numbers to delete (1-indexed),
     *   unique and sorted ascending.
     */
    deletePages(pagesToDelete: Array<number>): void;
    cancelDelete(): void;
    cleanSavedData(): void;
    /**
     * Records which pages are being copied so that pastePages can insert them.
     * @param {Uint32Array} pagesToCopy - Page numbers to copy (1-indexed).
     */
    copyPages(pagesToCopy: Uint32Array): void;
    cancelCopy(): void;
    /**
     * Inserts the previously copied pages at the given position.
     * @param {number} index - Zero-based insertion index in the page-number list.
     */
    pastePages(index: number): void;
    /**
     * Checks if the page mappings have been altered from their initial state.
     * @returns {boolean}
     */
    hasBeenAltered(): boolean;
    /**
     * Gets the current page mapping suitable for saving.
     * @param {Map<number, Array<number>>} [idToPageNumber]
     * @returns {Array<Object>}
     */
    getPageMappingForSaving(idToPageNumber?: Map<number, Array<number>>): Array<Object>;
    extractPages(extractedPageNumbers: any): Object[];
    /**
     * Gets the previous page number for a given page number.
     * Negative values indicate a copied page (the absolute value is the source).
     * @param {number} pageNumber
     * @returns {number}
     */
    getPrevPageNumber(pageNumber: number): number;
    /**
     * Gets the first page number that currently maps to the given page ID.
     * @param {number} id - The page ID (1-indexed).
     * @returns {number} The page number, or 0 if not found.
     */
    getPageNumber(id: number): number;
    /**
     * Gets the page ID for a given page number.
     * @param {number} pageNumber - The page number (1-indexed).
     * @returns {number} The page ID, or the page number itself if no mapping
     *   exists.
     */
    getPageId(pageNumber: number): number;
    getMapping(): Uint32Array<ArrayBufferLike> | undefined;
    #private;
}
