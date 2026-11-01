export class BaseBinaryDataFactory {
    constructor({ cMapUrl, standardFontDataUrl, wasmUrl }: {
        cMapUrl?: null | undefined;
        standardFontDataUrl?: null | undefined;
        wasmUrl?: null | undefined;
    });
    cMapUrl: any;
    standardFontDataUrl: any;
    wasmUrl: any;
    fetch({ kind, filename }: {
        kind: any;
        filename: any;
    }): Promise<Uint8Array<ArrayBufferLike>>;
    /**
     * @ignore
     * @returns {Promise<Uint8Array>}
     */
    _fetch(url: any, kind: any): Promise<Uint8Array>;
    #private;
}
export class DOMBinaryDataFactory extends BaseBinaryDataFactory {
    /**
     * @ignore
     */
    _fetch(url: any, kind: any): Promise<Uint8Array<any>>;
}
