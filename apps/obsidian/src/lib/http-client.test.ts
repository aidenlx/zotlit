import { HttpClientRequest } from "effect/http";
import type { RequestUrlParam, RequestUrlResponse } from "obsidian";
import { describe, expect, vi } from "vitest";

import { Effect } from "@/lib/effect";
import { it } from "@/lib/effect-vitest";
import { requestUrlHttpClient } from "@/lib/http-client";

/** A `requestUrl` that answers `status` with `body`, and records each call. */
function fakeRequestUrl(status: number, body = "") {
  const bytes = new TextEncoder().encode(body);
  return vi.fn((): Promise<RequestUrlResponse> =>
    Promise.resolve({
      status,
      headers: { "content-type": "text/plain" },
      arrayBuffer: bytes.buffer,
      json: undefined,
      text: body,
    }),
  );
}

function sent(send: ReturnType<typeof fakeRequestUrl>): RequestUrlParam {
  return (send.mock.calls[0] as unknown as [RequestUrlParam])[0];
}

describe("requestUrlHttpClient", () => {
  it.effect(
    "answers a refusal as a status, and keeps requestUrl from throwing",
    () =>
      Effect.gen(function* () {
        const send = fakeRequestUrl(404, "Not Found");
        const client = requestUrlHttpClient(send);

        const response = yield* client.get("https://example.com/asset");

        expect(response.status).toBe(404);
        expect(yield* response.text).toBe("Not Found");
        expect(sent(send)).toMatchObject({
          url: "https://example.com/asset",
          method: "GET",
          throw: false,
        });
      }),
  );

  it.effect(
    "sends the method, the headers, and the body, with no trace context",
    () =>
      Effect.gen(function* () {
        const send = fakeRequestUrl(200);
        const client = requestUrlHttpClient(send);

        yield* client.execute(
          HttpClientRequest.post("https://example.com/rpc").pipe(
            HttpClientRequest.bodyText('{"a":1}', "application/json"),
            HttpClientRequest.setHeader("X-Key", "k"),
          ),
        );

        const param = sent(send);
        expect(param.method).toBe("POST");
        expect(new TextDecoder().decode(param.body as ArrayBuffer)).toBe(
          '{"a":1}',
        );
        expect(param.headers).toMatchObject({
          "x-key": "k",
          "content-type": "application/json",
        });
        expect(Object.keys(param.headers ?? {})).not.toContain("traceparent");
        expect(Object.keys(param.headers ?? {})).not.toContain("b3");
      }),
  );

  it.effect("fails with a transport error when the connection fails", () =>
    Effect.gen(function* () {
      const client = requestUrlHttpClient(() =>
        Promise.reject(new Error("net::ERR_CONNECTION_REFUSED")),
      );

      const error = yield* Effect.flip(client.get("https://example.com/"));

      expect(error.reason._tag).toBe("TransportError");
    }),
  );
});
