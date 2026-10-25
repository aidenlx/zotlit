// The Zotero loopback client over Node's own HTTP stack, for desktop only.

import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient";

import { Layer } from "@/lib/effect";
import { layerZoteroHttp } from "@/lib/zotero-http";
import type { ZoteroHttp } from "@/lib/zotero-http";

/**
 * {@link ZoteroHttp} over `node:http`, so a request leaves the process without
 * Chromium: no `Origin`, no user agent, no CORS check, and no proxy read from
 * the environment. An interrupt destroys the request.
 *
 * The agents keep connections alive, as Node's global agent did for the
 * `fetch` this replaces, so the `Connection` header on the wire is unchanged.
 * Never `layerUndici`: undici reads a proxy from the environment and stays out
 * of the bundle.
 */
export const layerZoteroHttpNode: Layer.Layer<ZoteroHttp> =
  layerZoteroHttp.pipe(
    Layer.provide(NodeHttpClient.layerNodeHttpNoAgent),
    Layer.provide(NodeHttpClient.layerAgentOptions({ keepAlive: true })),
  );
