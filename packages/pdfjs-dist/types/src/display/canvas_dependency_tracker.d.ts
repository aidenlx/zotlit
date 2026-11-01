export type SimpleDependency = "lineWidth" | "lineCap" | "lineJoin" | "miterLimit" | "dash" | "strokeAlpha" | "fillColor" | "fillAlpha" | "globalCompositeOperation" | "path" | "filter" | "font" | "fontObj";
export type IncrementalDependency = "transform" | "moveText" | "sameLineText";
export type InternalIncrementalDependency = IncrementalDependency | typeof FORCED_DEPENDENCY_LABEL;
export class CanvasBBoxTracker {
    constructor(canvas: any, operationsCount: any);
    _pendingBBoxIdx: number;
    _savesStack: any[];
    _markedContentStack: any[];
    growOperationsCount(operationsCount: any): void;
    get clipBox(): number[];
    save(opIdx: any): this;
    restore(opIdx: any, onSavePopped: any): this;
    /**
     * @param {number} idx
     */
    recordOpenMarker(idx: number): this;
    getOpenMarker(): any;
    recordCloseMarker(opIdx: any, onSavePopped: any): this;
    beginMarkedContent(opIdx: any): this;
    endMarkedContent(opIdx: any, onSavePopped: any): this;
    pushBaseTransform(ctx: any): this;
    popBaseTransform(): this;
    resetBBox(idx: any): this;
    recordClipBox(idx: any, ctx: any, minX: any, maxX: any, minY: any, maxY: any): this;
    recordBBox(idx: any, ctx: any, minX: any, maxX: any, minY: any, maxY: any): this;
    recordFullPageBBox(idx: any): this;
    /**
     * @param {number} idx
     */
    recordOperation(idx: number, preserve: boolean | undefined, dependencyLists: any): this;
    bboxToClipBoxDropOperation(idx: any): this;
    take(): BBoxReader;
    takeDebugMetadata(): void;
    recordSimpleData(name: any, idx: any): this;
    recordIncrementalData(name: any, idx: any): this;
    resetIncrementalData(name: any, idx: any): this;
    recordNamedData(name: any, idx: any): this;
    recordSimpleDataFromNamed(name: any, depName: any, fallbackIdx: any): this;
    recordFutureForcedDependency(name: any, idx: any): this;
    inheritSimpleDataAsFutureForcedDependencies(names: any): this;
    inheritPendingDependenciesAsFutureForcedDependencies(): this;
    recordCharacterBBox(idx: any, ctx: any, font: any, scale: number | undefined, x: number | undefined, y: number | undefined, getMeasure: any): this;
    getSimpleIndex(dependencyName: any): undefined;
    recordDependencies(idx: any, dependencyNames: any): this;
    recordNamedDependency(idx: any, name: any): this;
    recordShowTextOperation(idx: any, preserve?: boolean): this;
    #private;
}
/**
 * @typedef {"lineWidth" | "lineCap" | "lineJoin" | "miterLimit" | "dash" |
 * "strokeAlpha" | "fillColor" | "fillAlpha" | "globalCompositeOperation" |
 * "path" | "filter" | "font" | "fontObj"} SimpleDependency
 */
/**
 * @typedef {"transform" | "moveText" | "sameLineText"} IncrementalDependency
 */
/**
 * @typedef {IncrementalDependency |
 * typeof FORCED_DEPENDENCY_LABEL} InternalIncrementalDependency
 */
export class CanvasDependencyTracker {
    constructor(bboxTracker: any, recordDebugMetadata?: boolean);
    get clipBox(): any;
    growOperationsCount(operationsCount: any): void;
    save(opIdx: any): this;
    restore(opIdx: any): this;
    recordOpenMarker(opIdx: any): this;
    getOpenMarker(): any;
    recordCloseMarker(opIdx: any): this;
    /**
     * @param {number} opIdx
     */
    beginMarkedContent(opIdx: number): this;
    endMarkedContent(opIdx: any): this;
    pushBaseTransform(ctx: any): this;
    popBaseTransform(): this;
    /**
     * @param {SimpleDependency} name
     * @param {number} idx
     */
    recordSimpleData(name: SimpleDependency, idx: number): this;
    /**
     * @param {IncrementalDependency} name
     * @param {number} idx
     */
    recordIncrementalData(name: IncrementalDependency, idx: number): this;
    /**
     * @param {IncrementalDependency} name
     * @param {number} idx
     */
    resetIncrementalData(name: IncrementalDependency, idx: number): this;
    recordNamedData(name: any, idx: any): this;
    /**
     * @param {SimpleDependency} name
     * @param {string} depName
     * @param {number} fallbackIdx
     */
    recordSimpleDataFromNamed(name: SimpleDependency, depName: string, fallbackIdx: number): void;
    recordFutureForcedDependency(name: any, idx: any): this;
    inheritSimpleDataAsFutureForcedDependencies(names: any): this;
    inheritPendingDependenciesAsFutureForcedDependencies(): this;
    resetBBox(idx: any): this;
    recordClipBox(idx: any, ctx: any, minX: any, maxX: any, minY: any, maxY: any): this;
    recordBBox(idx: any, ctx: any, minX: any, maxX: any, minY: any, maxY: any): this;
    recordCharacterBBox(idx: any, ctx: any, font: any, scale: number | undefined, x: number | undefined, y: number | undefined, getMeasure: any): this;
    recordFullPageBBox(idx: any): this;
    getSimpleIndex(dependencyName: any): any;
    recordDependencies(idx: any, dependencyNames: any): this;
    recordNamedDependency(idx: any, name: any): this;
    /**
     * @param {number} idx
     */
    recordOperation(idx: number, preserve?: boolean): this;
    recordShowTextOperation(idx: any, preserve?: boolean): this;
    bboxToClipBoxDropOperation(idx: any, preserve?: boolean): this;
    take(): any;
    takeDebugMetadata(): Map<any, any> | undefined;
    #private;
}
/**
 * Track the locations of images in the canvas. For each image it computes
 * a bounding box as a potentially rotated rectangle, matching the rotation of
 * the current canvas transform.
 */
export class CanvasImagesTracker {
    static "__#private@#CoordsArray": Float32ArrayConstructor | Float16ArrayConstructor;
    constructor(canvas: any);
    record(ctx: any, width: any, height: any, clipBox: any): void;
    take(): Float32Array<ArrayBuffer> | Float16Array<ArrayBuffer>;
    #private;
}
/**
 * Used to track dependencies of nested operations list, that
 * should actually all map to the index of the operation that
 * contains the nested list.
 *
 * @implements {CanvasDependencyTracker}
 */
export class CanvasNestedDependencyTracker implements CanvasDependencyTracker {
    constructor(dependencyTracker: any, opIdx: any, ignoreBBoxes: any);
    get clipBox(): any;
    growOperationsCount(): void;
    save(opIdx: any): this;
    restore(opIdx: any): this;
    recordOpenMarker(idx: any): this;
    getOpenMarker(): any;
    recordCloseMarker(idx: any): this;
    beginMarkedContent(opIdx: any): this;
    endMarkedContent(opIdx: any): this;
    pushBaseTransform(ctx: any): this;
    popBaseTransform(): this;
    /**
     * @param {SimpleDependency} name
     * @param {number} idx
     */
    recordSimpleData(name: SimpleDependency, idx: number): this;
    /**
     * @param {IncrementalDependency} name
     * @param {number} idx
     */
    recordIncrementalData(name: IncrementalDependency, idx: number): this;
    /**
     * @param {IncrementalDependency} name
     * @param {number} idx
     */
    resetIncrementalData(name: IncrementalDependency, idx: number): this;
    recordNamedData(name: any, idx: any): this;
    /**
     * @param {SimpleDependency} name
     * @param {string} depName
     * @param {number} fallbackIdx
     */
    recordSimpleDataFromNamed(name: SimpleDependency, depName: string, fallbackIdx: number): this;
    recordFutureForcedDependency(name: any, idx: any): this;
    inheritSimpleDataAsFutureForcedDependencies(names: any): this;
    inheritPendingDependenciesAsFutureForcedDependencies(): this;
    resetBBox(idx: any): this;
    recordClipBox(idx: any, ctx: any, minX: any, maxX: any, minY: any, maxY: any): this;
    recordBBox(idx: any, ctx: any, minX: any, maxX: any, minY: any, maxY: any): this;
    recordCharacterBBox(idx: any, ctx: any, font: any, scale: any, x: any, y: any, getMeasure: any): this;
    recordFullPageBBox(idx: any): this;
    getSimpleIndex(dependencyName: any): any;
    recordDependencies(idx: any, dependencyNames: any): this;
    recordNamedDependency(idx: any, name: any): this;
    /**
     * @param {number} idx
     * @param {SimpleDependency[]} dependencyNames
     */
    recordOperation(idx: number): this;
    recordShowTextOperation(idx: any): this;
    bboxToClipBoxDropOperation(idx: any): this;
    take(): void;
    takeDebugMetadata(): void;
    #private;
}
export namespace Dependencies {
    let stroke: string[];
    let fill: string[];
    let imageXObject: string[];
    let rawFillPath: string[];
    let showText: string[];
    let transform: string[];
    let transformAndFill: string[];
}
declare const FORCED_DEPENDENCY_LABEL: "__forcedDependency";
declare class BBoxReader {
    constructor(bboxes: any, coords: any);
    get length(): any;
    isEmpty(i: any): boolean;
    minX(i: any): number;
    minY(i: any): number;
    maxX(i: any): number;
    maxY(i: any): number;
    #private;
}
export {};
