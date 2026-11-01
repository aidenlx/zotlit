export type PDFDocumentProxy = import("../src/display/api").PDFDocumentProxy;
export type PDFPageProxy = import("../src/display/api").PDFPageProxy;
export type EventBus = import("./event_utils").EventBus;
export type PDFRenderingQueue = import("./pdf_rendering_queue").PDFRenderingQueue;
export type PDFLinkService = import("./pdf_link_service.js").PDFLinkService;
export type PDFThumbnailViewerOptions = {
    /**
     * - The container for the thumbnail
     * elements.
     */
    container: HTMLDivElement;
    /**
     * - The application event bus.
     */
    eventBus: EventBus;
    /**
     * - The navigation/linking service.
     */
    linkService: PDFLinkService;
    /**
     * - The rendering queue object.
     */
    renderingQueue: PDFRenderingQueue;
    /**
     * - The maximum supported canvas size in
     * total pixels, i.e. width * height. Use `-1` for no limit, or `0` for
     * CSS-only zooming. The default value is 4096 * 8192 (32 mega-pixels).
     */
    maxCanvasPixels?: number | undefined;
    /**
     * - The maximum supported canvas dimension,
     * in either width or height. Use `-1` for no limit.
     * The default value is 32767.
     */
    maxCanvasDim?: number | undefined;
    /**
     * - Overwrites background and foreground colors
     * with user defined ones in order to improve readability in high contrast
     * mode.
     */
    pageColors?: Object | undefined;
    /**
     * - The AbortSignal for the window
     * events.
     */
    abortSignal?: AbortSignal | undefined;
    /**
     * - Enables the "new" badge for the split
     * and merge features.
     */
    enableNewBadge?: boolean | undefined;
    /**
     * - Enables the merge feature.
     * The default value is `false`.
     */
    enableMerge?: boolean | undefined;
    /**
     * - Enables split and merge features.
     * The default value is `false`.
     */
    enableSplitMerge?: boolean | undefined;
    /**
     * - The status bar elements to manage the status
     * label and action when editing pages.
     */
    statusBar?: Object | undefined;
    /**
     * - The undo bar elements to manage the undo
     * action.
     */
    undoBar?: Object | undefined;
    /**
     * - The menu elements to manage saving edited
     * PDF.
     */
    manageMenu?: Object | undefined;
    /**
     * - The waiting bar elements shown during
     * long-running operations.
     */
    waitingBar?: Object | undefined;
    /**
     * - The file picker and button used to
     * add a PDF file to merge with the current one.
     */
    addFileComponent?: Object | undefined;
};
/**
 * @typedef {Object} PDFThumbnailViewerOptions
 * @property {HTMLDivElement} container - The container for the thumbnail
 *   elements.
 * @property {EventBus} eventBus - The application event bus.
 * @property {PDFLinkService} linkService - The navigation/linking service.
 * @property {PDFRenderingQueue} renderingQueue - The rendering queue object.
 * @property {number} [maxCanvasPixels] - The maximum supported canvas size in
 *   total pixels, i.e. width * height. Use `-1` for no limit, or `0` for
 *   CSS-only zooming. The default value is 4096 * 8192 (32 mega-pixels).
 * @property {number} [maxCanvasDim] - The maximum supported canvas dimension,
 *   in either width or height. Use `-1` for no limit.
 *   The default value is 32767.
 * @property {Object} [pageColors] - Overwrites background and foreground colors
 *   with user defined ones in order to improve readability in high contrast
 *   mode.
 * @property {AbortSignal} [abortSignal] - The AbortSignal for the window
 *   events.
 * @property {boolean} [enableNewBadge] - Enables the "new" badge for the split
 *   and merge features.
 * @property {boolean} [enableMerge] - Enables the merge feature.
 *   The default value is `false`.
 * @property {boolean} [enableSplitMerge] - Enables split and merge features.
 *   The default value is `false`.
 * @property {Object} [statusBar] - The status bar elements to manage the status
 *   label and action when editing pages.
 * @property {Object} [undoBar] - The undo bar elements to manage the undo
 *   action.
 * @property {Object} [manageMenu] - The menu elements to manage saving edited
 *   PDF.
 * @property {Object} [waitingBar] - The waiting bar elements shown during
 *   long-running operations.
 * @property {Object} [addFileComponent] - The file picker and button used to
 *   add a PDF file to merge with the current one.
 */
/**
 * Viewer control to display thumbnails for pages in a PDF document.
 */
export class PDFThumbnailViewer {
    static "__#private@#draggingScaleFactor": number;
    static "__#private@#getScaleFactor"(image: any): number;
    /**
     * @param {PDFThumbnailViewerOptions} options
     */
    constructor({ container, eventBus, linkService, renderingQueue, maxCanvasPixels, maxCanvasDim, pageColors, abortSignal, enableMerge, enableSplitMerge, enableNewBadge, statusBar, undoBar, waitingBar, manageMenu, addFileComponent, }: PDFThumbnailViewerOptions);
    scrollableContainer: HTMLElement | null;
    container: HTMLDivElement;
    eventBus: import("./event_utils").EventBus;
    linkService: import("./pdf_link_service.js").PDFLinkService;
    renderingQueue: import("./pdf_rendering_queue").PDFRenderingQueue;
    maxCanvasPixels: number | undefined;
    maxCanvasDim: number | undefined;
    pageColors: Object | null;
    _manageMenu: Menu | undefined;
    scroll: {
        right: boolean;
        down: boolean;
        lastX: any;
        lastY: any;
        _eventHandler: (evt: any) => void;
    };
    getThumbnail(index: any): any;
    _currentPageNumber: any;
    scrollThumbnailIntoView(pageNumber: any): void;
    set pagesRotation(rotation: any);
    get pagesRotation(): any;
    _pagesRotation: any;
    cleanup(): void;
    _thumbnails: any[] | undefined;
    _pageLabels: any[] | null | undefined;
    /**
     * @param {PDFDocumentProxy} pdfDocument
     */
    setDocument(pdfDocument: PDFDocumentProxy): void;
    pdfDocument: import("../src/display/api").PDFDocumentProxy | undefined;
    /**
     * @param {Array|null} labels
     */
    setPageLabels(labels: any[] | null): void;
    forceRendering(): boolean;
    hasStructuralChanges(): any;
    getStructuralChanges(): any;
    #private;
}
import { Menu } from "./menu.js";
