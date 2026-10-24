// What every call to Zotero's own HTTP server shares: the header that gets past
// its browser-traffic guard, the loopback origin it binds, the client that
// carries both, and a body reader.

import {
  HttpBody,
  HttpClient,
  HttpClientError,
  HttpClientRequest,
} from "effect/http";
import type { HttpMethod } from "effect/http";

import { AbortError } from "@/lib/abort-error";
import { Cause, Context, Effect, Exit, Layer, Option } from "@/lib/effect";

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

/**
 * The loopback `HttpClient` for Zotero's own HTTP server, apart from the
 * remote client so the two cannot be mixed up. Every request it sends carries
 * {@link ZOTERO_ALLOWED_REQUEST}.
 *
 * Production builds it over Node's own stack (`zotero-http-node.ts`): no
 * `Origin`, no user agent, no CORS check on the answer, and no proxy read from
 * the environment, so a loopback call arrives as Zotero requires it. Desktop
 * only.
 */
export class ZoteroHttp extends Context.Service<
  ZoteroHttp,
  HttpClient.HttpClient
>()("zotlit/zotero-http/ZoteroHttp") {}

/**
 * The client a {@link ZoteroHttp} consumer holds, named here so Promise code
 * that takes one imports nothing from Effect.
 */
export type ZoteroClient = HttpClient.HttpClient;

/** `client` with {@link ZOTERO_ALLOWED_REQUEST} added to each request. */
export function withZoteroHeaders(
  client: HttpClient.HttpClient,
): HttpClient.HttpClient {
  return HttpClient.mapRequest(
    client,
    HttpClientRequest.setHeaders(ZOTERO_ALLOWED_REQUEST),
  );
}

/** {@link ZoteroHttp} over the `HttpClient` below it, through {@link withZoteroHeaders}. */
export const layerZoteroHttp: Layer.Layer<
  ZoteroHttp,
  never,
  HttpClient.HttpClient
> = Layer.effect(
  ZoteroHttp,
  Effect.map(HttpClient.HttpClient, withZoteroHeaders),
);

/** One request to Zotero's HTTP server. */
export interface ZoteroRequest {
  /** Zotero's HTTP port; the request goes to {@link zoteroOrigin} of it. */
  readonly port: number;
  /** The path and query, from the leading `/`. */
  readonly path: string;
  /** @default "GET" */
  readonly method?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
  readonly signal?: AbortSignal;
}

/** What Zotero answered, read to the end. */
export interface ZoteroAnswer {
  readonly status: number;
  readonly headers: Headers;
  readonly text: string;
}

/**
 * One round trip to Zotero over {@link ZoteroHttp}, for the Promise code that
 * calls it. Resolves with whatever status Zotero answered, however unhappy;
 * rejects only when the connection itself failed, which is how a closed Zotero
 * announces itself.
 *
 * The body is read to the end before this resolves, and it is measured, so no
 * request arrives without a `Content-Length`: Zotero answers `400` to a
 * chunked one.
 *
 * @throws {AbortError} when `signal` aborts, before the answer or mid-body.
 * @throws {TypeError} carrying the transport failure as its `cause`, when the
 *   connection fails.
 */
export async function exchangeWithZotero(
  http: HttpClient.HttpClient,
  { port, path, method = "GET", headers = {}, body, signal }: ZoteroRequest,
): Promise<ZoteroAnswer> {
  let request = HttpClientRequest.make(method as HttpMethod.HttpMethod)(
    `${zoteroOrigin(port)}${path}`,
  );
  if (body !== undefined) {
    // A raw body leaves the content type to the caller's headers.
    request = HttpClientRequest.setBody(
      request,
      HttpBody.raw(body, { contentLength: Buffer.byteLength(body) }),
    );
  }
  request = HttpClientRequest.setHeaders(request, headers);
  const exit = await Effect.runPromiseExit(
    Effect.flatMap(http.execute(request), (response) =>
      Effect.map(response.text, (text) => ({
        status: response.status,
        headers: new Headers(response.headers),
        text,
      })),
    ),
    { signal },
  );
  if (Exit.isSuccess(exit)) return exit.value;
  if (signal?.aborted) throw new AbortError();
  const error = Option.getOrElse(Exit.findErrorOption(exit), () =>
    Cause.squash(exit.cause),
  );
  const reason = HttpClientError.isHttpClientError(error)
    ? error.reason
    : error;
  // The transport's own abort, as `fetch` reports one.
  if (isAbort(reason) || isAbort((reason as { cause?: unknown })?.cause)) {
    throw new AbortError();
  }
  throw new TypeError("fetch failed", { cause: reason });
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
