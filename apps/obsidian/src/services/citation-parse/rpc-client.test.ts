import { RpcClient, RpcServer } from "effect/rpc";
import { expect } from "vitest";

import { Context, Deferred, Effect, Exit, Fiber, Schema } from "@/lib/effect";
import { makeInMemoryRpcProtocols } from "@/lib/effect-rpc-in-process";
import { it } from "@/lib/effect-vitest";

import { layerParseHandlers } from "./handlers";
import { CitationParseRpc } from "./rpc";
import { makeParseRpcClient } from "./rpc-client";

class CodecReady extends Context.Service<CodecReady, Effect.Effect<void>>()(
  "zotlit/citation-parse/CodecReady",
) {}

const serve = Effect.gen(function* () {
  const protocols = yield* makeInMemoryRpcProtocols;
  yield* RpcServer.make(CitationParseRpc, { disableTracing: true }).pipe(
    Effect.provide(layerParseHandlers),
    Effect.provideService(RpcServer.Protocol, protocols.server),
    Effect.forkScoped,
  );
  return protocols;
});

it.effect(
  "measures eager encoding and its completion before posting (#1705)",
  () =>
    Effect.gen(function* () {
      const protocols = yield* makeInMemoryRpcProtocols;
      yield* RpcServer.make(CitationParseRpc, { disableTracing: true }).pipe(
        Effect.provide(layerParseHandlers),
        Effect.provideService(RpcServer.Protocol, protocols.server),
        Effect.forkScoped,
      );
      let now = 0;
      let elapsed = 0;
      let elapsedAtPost = 0;
      const client = yield* makeParseRpcClient(() => {
        const start = now;
        return () => {
          elapsed = now - start;
        };
      }).pipe(
        Effect.provideService(RpcClient.Protocol, {
          ...protocols.client,
          codecFor: <S extends Schema.Top>(schema: S) => {
            const codec = protocols.client.codecFor(schema);
            return codec.pipe(
              Schema.middlewareEncoding<typeof codec, S["EncodingServices"]>(
                (encoded) => {
                  now += 7;
                  return encoded.pipe(
                    Effect.tap(() =>
                      Effect.sync(() => {
                        now += 11;
                      }),
                    ),
                  );
                },
              ),
            );
          },
          send: (id, request) => {
            elapsedAtPost = elapsed;
            return protocols.client.send(id, request);
          },
        }),
      );
      yield* client.Parse({ path: "draft.md", generation: 1, text: "" });
      expect(elapsedAtPost).toBe(18);
    }),
);

it.effect(
  "uses the caller's context for deferred request and reply codecs (#1705)",
  () =>
    Effect.gen(function* () {
      const protocols = yield* serve;
      const ready = yield* Deferred.make<void>();
      const encoding = yield* Deferred.make<void>();
      const client = yield* makeParseRpcClient().pipe(
        Effect.provideService(RpcClient.Protocol, {
          ...protocols.client,
          codecFor: <S extends Schema.Top>(schema: S) =>
            protocols.client.codecFor(schema).pipe(
              Schema.middlewareEncoding((encoded) =>
                Effect.gen(function* () {
                  yield* Deferred.succeed(encoding, undefined);
                  yield* yield* CodecReady;
                  return yield* encoded;
                }),
              ),
              Schema.middlewareDecoding((decoded) =>
                Effect.gen(function* () {
                  yield* yield* CodecReady;
                  return yield* decoded;
                }),
              ),
            ),
        }),
      );
      const pending = yield* client
        .Parse({ path: "context.md", generation: 2, text: "" })
        .pipe(
          Effect.provideService(CodecReady, Deferred.await(ready)),
          Effect.forkChild,
        );
      yield* Deferred.await(encoding);
      yield* Deferred.succeed(ready, undefined);
      expect(JSON.parse(yield* Fiber.join(pending))).toMatchObject({
        path: "context.md",
        generation: 2,
      });
    }),
);

it.effect(
  "rejects an encoding failure, closes its stopwatch, and accepts the next request (#1705)",
  () =>
    Effect.gen(function* () {
      const protocols = yield* serve;
      let reject = true;
      let measurements = 0;
      let posts = 0;
      const client = yield* makeParseRpcClient(() => () => {
        measurements++;
      }).pipe(
        Effect.provideService(RpcClient.Protocol, {
          ...protocols.client,
          codecFor: <S extends Schema.Top>(schema: S) => {
            const codec = protocols.client.codecFor(schema);
            return codec.pipe(
              Schema.middlewareEncoding<typeof codec, S["EncodingServices"]>(
                (encoded) => (reject ? Effect.die("Encoding failed") : encoded),
              ),
            );
          },
          send: (id, message) => {
            if (message._tag === "Request") posts++;
            return protocols.client.send(id, message);
          },
        }),
      );
      const request = { path: "draft.md", generation: 1, text: "" };
      expect(Exit.isFailure(yield* Effect.exit(client.Parse(request)))).toBe(
        true,
      );
      expect(measurements).toBe(1);
      expect(posts).toBe(0);
      reject = false;
      expect(JSON.parse(yield* client.Parse(request))).toMatchObject({
        path: "draft.md",
      });
      expect(measurements).toBe(2);
    }),
);
