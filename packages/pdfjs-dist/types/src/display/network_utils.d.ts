export function createHeaders(isHttp: any, httpHeaders: any): Headers;
export function createResponseError(status: any, url: any): ResponseException;
export function ensureResponseOrigin(rangeOrigin: any, origin: any): void;
export function extractFilenameFromHeader(responseHeaders: any): string | null;
export function getResponseOrigin(url: any): string | null;
export function validateRangeRequestCapabilities({ responseHeaders, isHttp, rangeChunkSize, disableRange, }: {
    responseHeaders: any;
    isHttp: any;
    rangeChunkSize: any;
    disableRange: any;
}): {
    contentLength: number;
    isRangeSupported: boolean;
};
import { ResponseException } from "../shared/util.js";
