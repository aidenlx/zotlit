// Effect `HttpClient` layers: Obsidian's `requestUrl` for remote calls, and a
// route table that answers in place of the network in tests.

import { HttpClient, HttpClientError, HttpClientResponse } from "effect/http";
import type { HttpClientRequest } from "effect/http";
import { requestUrl } from "obsidian";
import type { RequestUrlParam, RequestUrlResponse } from "obsidian";

import { Effect, Layer, Tracer } from "@/lib/effect";

/** Statuses the `Response` constructor refuses a body for. */
const NULL_BODY_STATUS: ReadonlySet<number> = new Set([
  101, 103, 204, 205, 304,
]);

/**
 * The client with no trace context on the wire. `HttpClient.make` adds a
 * `traceparent` header to every request by default; neither Zotero nor a
 * release host asks for one, and the requests must leave as they did before.
 */
export function withoutTracePropagation(
  client: HttpClient.HttpClient,
): HttpClient.HttpClient {
  return HttpClient.transformResponse(
    client,
    Effect.provideService(Tracer.DisablePropagation, true),
  );
}

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
  return withoutTracePropagation(
    HttpClient.make((request, url) =>
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
            webResponse(
              response.status,
              response.headers,
              response.arrayBuffer,
            ),
          );
        },
        catch: (cause) => transportError(request, cause),
      }),
    ),
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

/**
 * One request as a {@link Route} receives it: the URL resolved, the headers as
 * they would go on the wire, and a text body.
 */
export interface RouteRequest {
  readonly url: URL;
  readonly method: string;
  readonly headers: Headers;
  readonly body: string | null;
  /** Aborts when the caller abandons the request. */
  readonly signal: AbortSignal;
}

/**
 * A test's network: the answer to one request. A throw is a connection that
 * failed; a returned `Response` of any status is an answer.
 */
export type Route = (request: RouteRequest) => Response | Promise<Response>;

/**
 * An `HttpClient` that answers from {@link route} in place of the network.
 * A request in flight fails the moment its caller abandons it, as Node's does.
 */
export function routeTableHttpClient(route: Route): HttpClient.HttpClient {
  return withoutTracePropagation(
    HttpClient.make((request, url, signal) =>
      Effect.tryPromise({
        try: async () => {
          signal.throwIfAborted();
          const answer = await untilAborted(
            route({
              url,
              method: request.method,
              headers: new Headers(request.headers),
              body: textBody(request),
              signal,
            }),
            signal,
          );
          return HttpClientResponse.fromWeb(request, answer);
        },
        catch: (cause) => transportError(request, cause),
      }),
    ),
  );
}

/** {@link routeTableHttpClient} as a layer, the test stand-in for either client. */
export function layerRouteTableHttpClient(
  route: Route,
): Layer.Layer<HttpClient.HttpClient> {
  return Layer.sync(HttpClient.HttpClient, () => routeTableHttpClient(route));
}

function textBody(request: HttpClientRequest.HttpClientRequest): string | null {
  const { body } = request;
  switch (body._tag) {
    case "Raw":
      return typeof body.body === "string" ? body.body : null;
    case "Uint8Array":
      return new TextDecoder().decode(body.body);
    default:
      return null;
  }
}

function untilAborted(
  answer: Response | Promise<Response>,
  signal: AbortSignal,
): Promise<Response> {
  if (answer instanceof Response) return Promise.resolve(answer);
  return Promise.race([
    answer,
    new Promise<never>((_, reject) => {
      signal.addEventListener(
        "abort",
        () => {
          reject(signal.reason);
        },
        { once: true },
      );
    }),
  ]);
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
