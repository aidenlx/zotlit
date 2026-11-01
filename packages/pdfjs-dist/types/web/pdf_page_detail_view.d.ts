export class PDFPageDetailView extends BasePDFPageView {
    constructor({ pageView }: {
        pageView: any;
    });
    /**
     * @type {boolean} True when the last rendering attempt of the view was
     *                 cancelled due to a `.reset()` call. This will happen when
     *                 the visible area changes so much during the rendering that
     *                 we need to cancel the rendering and start over.
     */
    renderingCancelled: boolean;
    pageView: any;
    div: any;
    setPdfPage(pdfPage: any): void;
    get detailArea(): null;
    get pdfPage(): any;
    reset({ keepCanvas }?: {
        keepCanvas?: boolean | undefined;
    }): void;
    update({ visibleArea, underlyingViewUpdated }?: {
        visibleArea?: null | undefined;
        underlyingViewUpdated?: boolean | undefined;
    }): void;
    _getRenderingContext(canvas: any, transform: any): any;
    draw(): Promise<void>;
    #private;
}
import { BasePDFPageView } from "./base_pdf_page_view.js";
