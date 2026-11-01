export class PDFNetworkStream extends BasePDFStream {
    constructor(source: any);
    _responseOrigin: null;
    url: any;
    isHttp: boolean;
    headers: Headers;
    /**
     * @ignore
     */
    _request(args: any): XMLHttpRequest;
    /**
     * Abort the request, if it's pending.
     * @ignore
     */
    _abortRequest(xhr: any): void;
    getRangeReader(begin: any, end: any): BasePDFStreamRangeReader;
    #private;
}
import { BasePDFStream } from "../shared/base_pdf_stream.js";
import { BasePDFStreamRangeReader } from "../shared/base_pdf_stream.js";
