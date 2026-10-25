// Effect's own fetch client over a test's `fetch`, in place of the network.
import { FetchHttpClient, HttpClient } from "effect/http";

import { Effect, Layer } from "effect";

/**
 * `FetchHttpClient` over `fetch`. The client merges the context it was built
 * in into each request, so every request reads this `fetch`. A throw or a
 * rejection is a connection that failed; a `Response` of any status is an
 * answer.
 */
export function layerFakeFetch(
  fetch: typeof globalThis.fetch,
): Layer.Layer<HttpClient.HttpClient> {
  return FetchHttpClient.layer.pipe(
    Layer.provide(Layer.succeed(FetchHttpClient.Fetch, fetch)),
  );
}

/** {@link layerFakeFetch} as a client value, for code that takes one. */
export function fakeFetchClient(
  fetch: typeof globalThis.fetch,
): HttpClient.HttpClient {
  return Effect.runSync(
    Effect.provide(HttpClient.HttpClient, layerFakeFetch(fetch)),
  );
}
