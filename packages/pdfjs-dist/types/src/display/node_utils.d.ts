export function fetchData(url: any): Promise<Uint8Array<ArrayBuffer>>;
export class NodeBinaryDataFactory extends BaseBinaryDataFactory {
    /**
     * @ignore
     */
    _fetch(url: any, kind: any): Promise<Uint8Array<ArrayBuffer>>;
}
export class NodeCanvasFactory extends BaseCanvasFactory {
    /**
     * @ignore
     */
    _createCanvas(width: any, height: any): import("@napi-rs/canvas").Canvas;
}
export class NodeFilterFactory extends BaseFilterFactory {
}
import { BaseBinaryDataFactory } from "./binary_data_factory.js";
import { BaseCanvasFactory } from "./canvas_factory.js";
import { BaseFilterFactory } from "./filter_factory.js";
