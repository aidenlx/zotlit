export type PDFViewer = import("./pdf_viewer").PDFViewer;
export type PDFThumbnailViewer = import("./pdf_thumbnail_viewer").PDFThumbnailViewer;
export type RenderableView = import("./renderable_view").RenderableView;
/**
 * Controls rendering of the views for pages and thumbnails.
 */
export class PDFRenderingQueue {
    isThumbnailViewEnabled: boolean;
    onIdle: null;
    printing: boolean;
    /**
     * @param {PDFViewer} pdfViewer
     */
    setViewer(pdfViewer: PDFViewer): void;
    /**
     * @param {PDFThumbnailViewer} pdfThumbnailViewer
     */
    setThumbnailViewer(pdfThumbnailViewer: PDFThumbnailViewer): void;
    /**
     * @param {RenderableView} view
     * @returns {boolean}
     */
    isHighestPriority(view: RenderableView): boolean;
    /**
     * @param {Object} currentlyVisiblePages
     */
    renderHighestPriority(currentlyVisiblePages: Object): void;
    /**
     * @param {Object} visible
     * @param {Array} views
     * @param {boolean} scrolledDown
     * @param {boolean} [preRenderExtra]
     * @param {boolean} [ignoreDetailViews]
     */
    getHighestPriority(visible: Object, views: any[], scrolledDown: boolean, preRenderExtra?: boolean, ignoreDetailViews?: boolean): any;
    /**
     * @param {RenderableView} view
     * @returns {boolean}
     */
    isViewFinished(view: RenderableView): boolean;
    /**
     * Render a page or thumbnail view. This calls the appropriate function
     * based on the views state. If the view is already rendered it will return
     * `false`.
     *
     * @param {RenderableView} view
     */
    renderView(view: RenderableView): boolean;
    #private;
}
