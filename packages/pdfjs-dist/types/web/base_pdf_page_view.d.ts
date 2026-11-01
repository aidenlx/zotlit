export class BasePDFPageView extends RenderableView {
    constructor(options: any);
    canvas: null;
    /** @type {null | HTMLDivElement} */
    div: null | HTMLDivElement;
    enableOptimizedPartialRendering: boolean;
    imagesRightClickMinSize: number;
    eventBus: null;
    id: null;
    imageCoordinates: null;
    pageColors: null;
    recordedBBoxes: null;
    renderingQueue: null;
    minDurationToUpdateCanvas: any;
    _createCanvas(onShow: any, hideUntilComplete?: boolean): {
        canvas: HTMLCanvasElement;
        prevCanvas: null;
    };
    _resetCanvas(): void;
    _drawCanvas(options: any, onCancel: any, onFinish: any): Promise<void>;
    cancelRendering({ cancelExtraDelay }?: {
        cancelExtraDelay?: number | undefined;
    }): void;
    dispatchPageRender(): void;
    dispatchPageRendered(cssTransform: any, isDetailView: any): void;
    #private;
}
import { RenderableView } from "./renderable_view.js";
