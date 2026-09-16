// A `fetch` over Node's HTTP stack, for requests that must leave the renderer.

import { request as httpRequest } from "node:http";
import type { IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";

import { AbortError } from "@/lib/abort-error";

/**
 * What {@link nodeFetch} reads from a `RequestInit`. The options left out —
 * `mode`, `credentials`, `cache`, `redirect`, `referrer` — describe a browser
 * network stack that Node does not have.
 */
export interface NodeFetchInit {
  /** @default "GET" */
  method?: string;
  headers?: HeadersInit;
  body?: string | Uint8Array;
  signal?: AbortSignal;
}

/** The `fetch`-shaped seam: {@link nodeFetch}, or a test's stand-in for it. */
export type FetchLike = (
  input: string | URL,
  init?: NodeFetchInit,
) => Promise<Response>;

/** Statuses the `Response` constructor refuses a body for. */
const NULL_BODY_STATUS: ReadonlySet<number> = new Set([
  101, 103, 204, 205, 304,
]);

/**
 * One HTTP round trip over Node's stack, so the request leaves the process
 * without Chromium: no `Origin`, no user agent, and no CORS check. A server
 * that refuses resolves with its status; a connection that fails rejects.
 *
 * The body is read to the end before this resolves, so nothing streams and
 * `Response.url` stays empty. A redirect comes back as the redirect response.
 *
 * @throws {AbortError} when `init.signal` aborts.
 * @throws {TypeError} carrying the Node error as its `cause`, when the
 *   connection fails.
 */
export function nodeFetch(
  input: string | URL,
  { method = "GET", headers, body, signal }: NodeFetchInit = {},
): Promise<Response> {
  const url = new URL(input);
  const send = url.protocol === "https:" ? httpsRequest : httpRequest;
  return new Promise<Response>((resolve, reject) => {
    const client = send(
      url,
      { method, headers: requestHeaders(headers, body), signal },
      (message) => {
        readBody(message).then(
          (bytes) => resolve(toResponse(message, bytes)),
          (error: unknown) => reject(asFetchError(error)),
        );
      },
    );
    client.on("error", (error) => reject(asFetchError(error)));
    if (body !== undefined) client.write(body);
    client.end();
  });
}

/**
 * Node frames a body it was given no length for as chunked, and Zotero's HTTP
 * server answers `400 Content-length not provided` to that. `fetch` measures a
 * body itself, so this does too.
 */
function requestHeaders(
  headers: HeadersInit | undefined,
  body: string | Uint8Array | undefined,
): Record<string, string> {
  const merged = new Headers(headers);
  if (body !== undefined && !merged.has("Content-Length")) {
    merged.set("Content-Length", String(byteLength(body)));
  }
  return Object.fromEntries(merged);
}

function byteLength(body: string | Uint8Array): number {
  return typeof body === "string" ? Buffer.byteLength(body) : body.byteLength;
}

async function readBody(
  message: IncomingMessage,
): Promise<Buffer<ArrayBuffer>> {
  const chunks: Buffer[] = [];
  for await (const chunk of message) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

function toResponse(
  message: IncomingMessage,
  body: Buffer<ArrayBuffer>,
): Response {
  const status = message.statusCode!;
  return new Response(NULL_BODY_STATUS.has(status) ? null : body, {
    status,
    statusText: message.statusMessage,
    headers: responseHeaders(message.rawHeaders),
  });
}

/** Raw pairs, not `message.headers`, so a repeated header keeps every value. */
function responseHeaders(raw: readonly string[]): Headers {
  const headers = new Headers();
  for (let i = 0; i + 1 < raw.length; i += 2) {
    headers.append(raw[i]!, raw[i + 1]!);
  }
  return headers;
}

/** `fetch` rejects with an `AbortError` or a `TypeError`; Node has its own. */
function asFetchError(error: unknown): Error {
  return error instanceof Error && error.name === "AbortError"
    ? new AbortError(error.message)
    : new TypeError("fetch failed", { cause: error });
}
