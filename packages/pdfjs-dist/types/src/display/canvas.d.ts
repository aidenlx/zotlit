export class CanvasGraphics {
    constructor(canvasCtx: any, commonObjs: any, objs: any, canvasFactory: any, filterFactory: any, { optionalContentConfig, markedContentStack }: {
        optionalContentConfig: any;
        markedContentStack?: null | undefined;
    }, annotationCanvasMap: any, pageColors: any, dependencyTracker: any, imagesTracker: any);
    ctx: any;
    current: CanvasExtraState;
    stateStack: any[];
    pendingClip: {} | {} | null;
    pendingEOFill: boolean;
    commonObjs: any;
    objs: any;
    canvasFactory: any;
    filterFactory: any;
    groupStack: any[];
    baseTransform: any;
    baseTransformStack: any[];
    groupLevel: number;
    smaskStack: any[];
    tempSMask: any;
    smaskGroupCanvases: any[];
    smaskPreparedEntry: any;
    smaskPreparedFor: any;
    smaskPreparedOffsetX: number;
    smaskPreparedOffsetY: number;
    suspendedCtx: any;
    contentVisible: boolean;
    markedContentStack: never[];
    optionalContentConfig: any;
    cachedPatterns: Map<any, any>;
    annotationCanvasMap: any;
    viewportScale: number;
    outputScaleX: number;
    outputScaleY: number;
    pageColors: any;
    _cachedScaleForStroking: number[];
    _cachedGetSinglePixelWidth: number | null;
    _cachedBitmapsMap: Map<any, any>;
    dependencyTracker: any;
    imagesTracker: any;
    getObject(opIdx: any, data: any, fallback?: null): any;
    beginDrawing({ transform, viewport, transparency, background, }: {
        transform: any;
        viewport: any;
        transparency?: boolean | undefined;
        background?: null | undefined;
    }): void;
    blender: Blender | null | undefined;
    transparentCanvasEntry: any;
    compositeCtx: any;
    executeOperatorList(operatorList: any, executionStartIdx: any, continueCallback: any, stepper: any, operationsFilter: any): any;
    transparentCanvas: any;
    endDrawing(): void;
    _scaleImage(img: any, inverseTransform: any): {
        img: any;
        paintWidth: any;
        paintHeight: any;
        tmpCanvas: any;
    };
    _createMaskCanvas(opIdx: any, img: any): {
        canvas: any;
        offsetX: number;
        offsetY: number;
        canvasEntry?: undefined;
    } | {
        canvas: any;
        canvasEntry: any;
        offsetX: number;
        offsetY: number;
    };
    setLineWidth(opIdx: any, width: any): void;
    setLineCap(opIdx: any, style: any): void;
    setLineJoin(opIdx: any, style: any): void;
    setMiterLimit(opIdx: any, limit: any): void;
    setDash(opIdx: any, dashArray: any, dashPhase: any): void;
    setRenderingIntent(opIdx: any, intent: any): void;
    setFlatness(opIdx: any, flatness: any): void;
    setGState(opIdx: any, states: any): void;
    get inSMaskMode(): boolean;
    _clearPreparedSMask(): void;
    _ensurePreparedSMask(smask: any, width: any, height: any): void;
    checkSMaskState(opIdx: any): void;
    /**
     * Backdrop cases use a layer-sized canvas so that the backdrop color
     * correctly extends to pixels outside the mask canvas bounds.
     * Filter-only cases use a mask-sized canvas to avoid a large allocation when
     * the mask is small relative to the page; `composeSMask` then uses
     * `smaskPreparedOffsetX/Y` to translate dirty-box coordinates into the
     * smaller canvas's coordinate space. Plain-alpha masks with no backdrop or
     * transfer map need no canvas at all.
     */
    _prepareSMaskCanvas(smask: any, width: any, height: any): void;
    /**
     * Replaces the current drawing canvas with a temporary scratch canvas and
     * suspends the main context. Drawing operations on the scratch canvas are
     * composited back via `compose()`. The scratch canvas mirrors many operations
     * onto the suspended canvas to keep their graphics-state stacks in sync, so
     * that clipping paths and transformations remain correct when soft mask mode
     * ends.
     */
    beginSMaskMode(opIdx: any): void;
    smaskScratchCanvas: any;
    endSMaskMode(): void;
    compose(dirtyBox: any): void;
    composeSMask(ctx: any, smask: any, layerCtx: any, layerBox: any): void;
    genericComposeSMask(maskCtx: any, layerCtx: any, width: any, height: any, layerOffsetX: any, layerOffsetY: any, maskOffsetX: any, maskOffsetY: any): void;
    save(opIdx: any): void;
    restore(opIdx: any): void;
    transform(opIdx: any, a: any, b: any, c: any, d: any, e: any, f: any): void;
    constructPath(opIdx: any, op: any, data: any, minMax: any): void;
    _pathStartIdx: any;
    closePath(opIdx: any): void;
    stroke(opIdx: any, path: any, consumePath?: boolean): void;
    closeStroke(opIdx: any, path: any): void;
    fill(opIdx: any, path: any, consumePath?: boolean): void;
    eoFill(opIdx: any, path: any): void;
    fillStroke(opIdx: any, path: any): void;
    eoFillStroke(opIdx: any, path: any): void;
    closeFillStroke(opIdx: any, path: any): void;
    closeEOFillStroke(opIdx: any, path: any): void;
    endPath(opIdx: any, path: any): void;
    rawFillPath(opIdx: any, path: any): void;
    clip(opIdx: any): void;
    eoClip(opIdx: any): void;
    beginText(opIdx: any): void;
    endText(opIdx: any): void;
    setCharSpacing(opIdx: any, spacing: any): void;
    setWordSpacing(opIdx: any, spacing: any): void;
    setHScale(opIdx: any, scale: any): void;
    setLeading(opIdx: any, leading: any): void;
    setFont(opIdx: any, fontRefName: any, size: any): void;
    setTextRenderingMode(opIdx: any, mode: any): void;
    setTextRise(opIdx: any, rise: any): void;
    moveText(opIdx: any, x: any, y: any): void;
    setLeadingMoveText(opIdx: any, x: any, y: any): void;
    setTextMatrix(opIdx: any, matrix: any): void;
    nextLine(opIdx: any): void;
    paintChar(opIdx: any, character: any, x: any, y: any, patternFillTransform: any, patternStrokeTransform: any): void;
    get isFontSubpixelAAEnabled(): any;
    showText(opIdx: any, glyphs: any): undefined;
    showType3Text(opIdx: any, glyphs: any): void;
    setCharWidth(opIdx: any, xWidth: any, yWidth: any): void;
    setCharWidthAndBounds(opIdx: any, xWidth: any, yWidth: any, llx: any, lly: any, urx: any, ury: any): void;
    getColorN_Pattern(opIdx: any, IR: any): any;
    setStrokeColorN(opIdx: any, ...args: any[]): void;
    setFillColorN(opIdx: any, ...args: any[]): void;
    setStrokeRGBColor(opIdx: any, color: any): void;
    setStrokeTransparent(opIdx: any): void;
    setFillRGBColor(opIdx: any, color: any): void;
    setFillTransparent(opIdx: any): void;
    _getPattern(opIdx: any, objId: any, matrix?: null): any;
    shadingFill(opIdx: any, objId: any): void;
    beginInlineImage(): void;
    beginImageData(): void;
    paintFormXObjectBegin(opIdx: any, matrix: any, bbox: any): void;
    paintFormXObjectEnd(opIdx: any): void;
    beginGroup(opIdx: any, group: any): void;
    endGroup(opIdx: any, group: any): void;
    beginAnnotation(opIdx: any, id: any, rect: any, transform: any, matrix: any, hasOwnCanvas: any): void;
    annotationCanvas: any;
    endAnnotation(opIdx: any): void;
    paintImageMaskXObject(opIdx: any, img: any): void;
    paintImageMaskXObjectRepeat(opIdx: any, img: any, scaleX: any, skewX: number | undefined, skewY: number | undefined, scaleY: any, positions: any): void;
    paintImageMaskXObjectGroup(opIdx: any, images: any): void;
    paintImageXObject(opIdx: any, objId: any): void;
    paintImageXObjectRepeat(opIdx: any, objId: any, scaleX: any, scaleY: any, positions: any): void;
    applyTransferMapsToCanvas(ctx: any): any;
    applyTransferMapsToBitmap(imgData: any): {
        img: any;
        canvasEntry: any;
    };
    paintInlineImageXObject(opIdx: any, imgData: any): void;
    paintInlineImageXObjectGroup(opIdx: any, imgData: any, map: any): void;
    paintSolidColorImageMask(opIdx: any): void;
    markPoint(opIdx: any, tag: any): void;
    markPointProps(opIdx: any, tag: any, properties: any): void;
    beginMarkedContent(opIdx: any, tag: any): void;
    beginMarkedContentProps(opIdx: any, tag: any, properties: any): void;
    endMarkedContent(opIdx: any): void;
    beginCompat(opIdx: any): void;
    endCompat(opIdx: any): void;
    consumePath(opIdx: any, path: any, clipBox: any): void;
    getSinglePixelWidth(): number;
    getScaleForStroking(): number[];
    rescaleAndStroke(path: any, saveRestore: any): void;
    isContentVisible(): boolean;
    #private;
}
declare class CanvasExtraState {
    constructor(width: any, height: any);
    alphaIsShape: boolean;
    fontSize: number;
    fontSizeScale: number;
    textMatrix: null;
    textMatrixScale: number;
    fontMatrix: number[];
    leading: number;
    x: number;
    y: number;
    lineX: number;
    lineY: number;
    charSpacing: number;
    wordSpacing: number;
    textHScale: number;
    textRenderingMode: number;
    textRise: number;
    fillColor: string;
    strokeColor: string;
    tilingPatternDims: null;
    patternFill: boolean;
    patternStroke: boolean;
    fillAlpha: number;
    strokeAlpha: number;
    lineWidth: number;
    activeSMask: null;
    transferMaps: string;
    minMax: Float32Array<ArrayBuffer>;
    clipBox: Float32Array<ArrayBuffer>;
    clone(): any;
    getPathBoundingBox(pathType?: string, transform?: null): Float32Array<ArrayBuffer>;
    updateClipFromPath(): void;
    isEmptyClip(): boolean;
    startNewPathAndClipBox(box: any): void;
    getClippedPathBoundingBox(pathType?: string, transform?: null): number[] | null;
}
import { Blender } from './blender/blender.js';
export {};
