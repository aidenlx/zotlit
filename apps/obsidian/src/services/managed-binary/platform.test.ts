import type { RequestUrlResponse } from "obsidian";
import { describe, expect } from "vitest";

import { Effect } from "@/lib/effect";
import { it } from "@/lib/effect-vitest";
import { requestUrlHttpClient } from "@/lib/http-client";

import { downloadBytes } from "./platform";

const ASSET_URL = "https://example.com/pandoc.wasm";

/** A `requestUrl` that answers `status` with `body`. */
function fakeRequestUrl(status: number, body = "") {
  const bytes = new TextEncoder().encode(body);
  return (): Promise<RequestUrlResponse> =>
    Promise.resolve({
      status,
      headers: {},
      arrayBuffer: bytes.buffer,
      json: undefined,
      text: body,
    });
}

describe("downloadBytes", () => {
  it.effect(
    "fails a status of 400 or more with the message requestUrl threw",
    () =>
      Effect.gen(function* () {
        const client = requestUrlHttpClient(fakeRequestUrl(404));

        const error = yield* Effect.flip(downloadBytes(client, ASSET_URL));

        expect(error.message).toBe("Request failed, status 404");
      }),
  );

  it.effect("fails a failed connection with the transport's own error", () =>
    Effect.gen(function* () {
      const client = requestUrlHttpClient(() =>
        Promise.reject(new Error("net::ERR_INTERNET_DISCONNECTED")),
      );

      const error = yield* Effect.flip(downloadBytes(client, ASSET_URL));

      expect(error.message).toBe("net::ERR_INTERNET_DISCONNECTED");
    }),
  );

  it.effect("resolves the bytes of a success", () =>
    Effect.gen(function* () {
      const client = requestUrlHttpClient(fakeRequestUrl(200, "wasm"));

      const bytes = yield* downloadBytes(client, ASSET_URL);

      expect(new TextDecoder().decode(bytes)).toBe("wasm");
    }),
  );
});
