export function endRequests(): void;
export class PDFDataTransportStream extends BasePDFStream {
    constructor(source: any);
    _progressiveDone: boolean;
    _queuedChunks: any[];
    getRangeReader(begin: any, end: any): BasePDFStreamRangeReader;
    cancelAllRequests(reason: any): void;
    #private;
}
import { BasePDFStream } from "../shared/base_pdf_stream.js";
import { BasePDFStreamRangeReader } from "../shared/base_pdf_stream.js";
