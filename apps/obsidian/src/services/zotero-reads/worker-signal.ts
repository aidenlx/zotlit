// The one message outside the RPC protocol between the worker and the renderer.

/**
 * Posted by the worker once its layer has shut down: every client closed and
 * every read snapshot removed. The renderer waits for it before it terminates
 * the worker, so termination never cuts a snapshot removal short.
 */
export const WORKER_CLOSED = "zotlit-zotero-reads:closed";
