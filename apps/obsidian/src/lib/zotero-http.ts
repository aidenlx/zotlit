// What every call to Zotero's own HTTP server shares: the header that gets past
// its browser-traffic guard, the loopback origin it binds, and a body reader.

import type { FetchLike } from "@/lib/node-fetch";

/**
 * Zotero refuses requests it reads as browser traffic: a `Mozilla/` user agent,
 * or any `Origin` header. It closes the connection, so the caller sees a
 * network failure with no status. This header is the documented opt-out, and
 * every ZotLit call to Zotero carries it.
 *
 * @see docs/fixture.md — "Trial the Zotero Local API"
 */
export const ZOTERO_ALLOWED_REQUEST: Readonly<Record<string, string>> = {
  "Zotero-Allowed-Request": "1",
};

/**
 * One HTTP round trip to Zotero. Resolves with whatever status Zotero answered,
 * however unhappy; rejects only when the connection itself failed, which is how
 * a closed Zotero announces itself.
 *
 * Production fills this with `nodeFetch`, which reaches Zotero over Node's own
 * stack: no `Origin`, no user agent, no CORS check on the answer, and no proxy
 * read from the environment, so a loopback call arrives as Zotero requires it.
 */
export type ZoteroTransport = FetchLike;

/**
 * Zotero's HTTP server binds `127.0.0.1` — never `localhost`, never a hostname.
 *
 * @see https://github.com/zotero/zotero/blob/22f08d1ceddc8bad5718b3bc6eee9d3ae5dccc2c/chrome/content/zotero/xpcom/server.js#L48-L89
 */
export function zoteroOrigin(port: number): string {
  return `http://127.0.0.1:${port}`;
}

/** @returns the parsed value, or undefined for a body that is not JSON. */
export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}
