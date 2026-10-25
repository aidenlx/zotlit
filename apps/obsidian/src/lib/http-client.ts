// The Effect `HttpClient` over Obsidian's `requestUrl`, for remote calls.

import { Effect, Layer } from "effect";
import { HttpClient, HttpClientError, HttpClientResponse } from "effect/http";
import type { HttpClientRequest } from "effect/http";
import { requestUrl } from "obsidian";
import type { RequestUrlParam, RequestUrlResponse } from "obsidian";

/** Statuses the `Response` constructor refuses a body for. */
const NULL_BODY_STATUS: ReadonlySet<number> = new Set([
  101, 103, 204, 205, 304,
]);

/** The `requestUrl` call the client makes; a test hands in its own. */
export type RequestUrl = (
  request: RequestUrlParam,
) => Promise<RequestUrlResponse>;

/**
 * An `HttpClient` over Obsidian's `requestUrl`, for remote calls. The request
 * leaves through Obsidian's own network stack, past the renderer's CORS check.
 *
 * Any status is an answer, as with every `HttpClient`: `throw: false` keeps
 * `requestUrl` from rejecting at `400` and up. Only a failed connection fails.
 * `requestUrl` takes no signal, so an interrupt stops the wait but not the
 * transfer.
 */
export function requestUrlHttpClient(
  send: RequestUrl = requestUrl,
): HttpClient.HttpClient {
  return HttpClient.make((request, url) =>
    Effect.tryPromise({
      try: async () => {
        const response = await send({
          url: url.href,
          method: request.method,
          headers: { ...request.headers },
          body: requestBody(request),
          throw: false,
        });
        return HttpClientResponse.fromWeb(
          request,
          webResponse(response.status, response.headers, response.arrayBuffer),
        );
      },
      catch: (cause) => transportError(request, cause),
    }),
  );
}

/** {@link requestUrlHttpClient} as the plugin's remote `HttpClient`. */
export const layerRequestUrlHttpClient: Layer.Layer<HttpClient.HttpClient> =
  Layer.sync(HttpClient.HttpClient, () => requestUrlHttpClient());

function requestBody(
  request: HttpClientRequest.HttpClientRequest,
): string | ArrayBuffer | undefined {
  const { body } = request;
  switch (body._tag) {
    case "Raw":
      return typeof body.body === "string" ? body.body : undefined;
    case "Uint8Array":
      // A copy: a text body is a view into Node's shared Buffer pool.
      return new Uint8Array(body.body).buffer;
    default:
      return undefined;
  }
}

function webResponse(
  status: number,
  headers: Readonly<Record<string, string>>,
  body: ArrayBuffer,
): Response {
  return new Response(NULL_BODY_STATUS.has(status) ? null : body, {
    status,
    headers,
  });
}

function transportError(
  request: HttpClientRequest.HttpClientRequest,
  cause: unknown,
): HttpClientError.HttpClientError {
  return new HttpClientError.HttpClientError({
    reason: new HttpClientError.TransportError({ request, cause }),
  });
}
