export type PDFThumbnailViewOptions = {
    /**
     * - The viewer element.
     */
    container: HTMLDivElement;
    /**
     * - The application event bus.
     */
    eventBus: EventBus;
    /**
     * - The thumbnail's unique ID (normally its number).
     */
    id: number;
    /**
     * - The page viewport.
     */
    defaultViewport: PageViewport;
    /**
     * -
     * A promise that is resolved with an {@link OptionalContentConfig} instance.
     * The default value is `null`.
     */
    optionalContentConfigPromise?: Promise<import("../src/display/optional_content_config").OptionalContentConfig> | undefined;
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
};
export type OptionalContentConfig = import("../src/display/optional_content_config").OptionalContentConfig;
export type PageViewport = import("../src/display/display_utils").PageViewport;
export type EventBus = import("./event_utils").EventBus;
export type PDFRenderingQueue = import("./pdf_rendering_queue").PDFRenderingQueue;
export class PDFThumbnailView extends RenderableView {
    /**
     * @param {PDFThumbnailViewOptions} options
     */
    constructor({ container, eventBus, id, defaultViewport, optionalContentConfigPromise, linkService, renderingQueue, maxCanvasPixels, maxCanvasDim, pageColors, enableSplitMerge, }: PDFThumbnailViewOptions);
    id: number;
    pageLabel: string | null;
    pdfPage: any;
    rotation: number;
    viewport: import("../src/display/display_utils").PageViewport;
    pdfPageRotate: number;
    _optionalContentConfigPromise: Promise<import("../src/display/optional_content_config").OptionalContentConfig> | null;
    maxCanvasPixels: any;
    maxCanvasDim: any;
    pageColors: Object | null;
    eventBus: import("./event_utils").EventBus;
    linkService: PDFLinkService;
    renderingQueue: import("./pdf_rendering_queue").PDFRenderingQueue;
    placeholder: any;
    div: HTMLDivElement;
    imageContainer: HTMLDivElement;
    image: HTMLImageElement;
    checkbox: HTMLInputElement | undefined;
    pasteButton: HTMLButtonElement | null;
    clone(container: any, id: any): PDFThumbnailView;
    addPasteButton(pasteCallback: any): void;
    prevPasteButton: Node | null | undefined;
    removePasteButton(): void;
    toggleSelected(isSelected: any): void;
    updateId(newId: any): void;
    canvasWidth: number | undefined;
    canvasHeight: number | undefined;
    scale: number | undefined;
    setPdfPage(pdfPage: any): void;
    reset(): void;
    destroy(): void;
    update({ rotation }: {
        rotation?: null | undefined;
    }): void;
    toggleCurrent(isCurrent: any): void;
    /**
     * PLEASE NOTE: Most likely you want to use the `this.reset()` method,
     *              rather than calling this one directly.
     */
    cancelRendering(): void;
    draw(): Promise<void>;
    setImage(pageView: any): void;
    /**
     * @param {string|null} label
     */
    setPageLabel(label: string | null): void;
    #private;
}
import { RenderableView } from "./renderable_view.js";
