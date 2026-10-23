// CitationParse's unary codecs over Effect's public request/cancellation engine.
import { Rpc, RpcClient, RpcMessage } from "effect/rpc";
import type { RpcClientError } from "effect/rpc";

import { Effect, Exit, Fiber, Schema } from "@/lib/effect";
import type { Context } from "@/lib/effect";
import { isRpcCodecSuccess, observeRpcEncoding } from "@/lib/effect-rpc-codec";

import { CitationParseRpc } from "./rpc";
import type { ParseError } from "./rpc";

/** One client per private protocol, as in the worker and in-process pair. */
export const makeParseRpcClient = Effect.fnUntraced(function* (
  measureEncoding?: () => () => void,
) {
  const { codecFor, run, send, supportsAck } = yield* RpcClient.Protocol;
  const rpc = CitationParseRpc.requests.get("Parse")!;
  const encode = Schema.encodeEffect(codecFor(rpc.payloadSchema));
  const encodePayload = measureEncoding
    ? observeRpcEncoding(encode, measureEncoding)
    : encode;
  const decodeExit = Schema.decodeUnknownEffect(codecFor(Rpc.exitSchema(rpc)));
  const decodeDefect = Schema.decodeSync(codecFor(Schema.Defect()));
  const contexts = new Map<RpcMessage.RequestId, Context.Context<never>>();
  const clientId = 0;

  // makeNoSerialization retains its send fiber, ID map and interrupt cleanup.
  // Only this transport's codec handling is specialized; the server is unchanged.
  const { client, write } = yield* RpcClient.makeNoSerialization(
    CitationParseRpc,
    {
      disableTracing: true,
      supportsAck,
      onFromClient({
        message,
      }): Effect.Effect<void, RpcClientError.RpcClientError> {
        switch (message._tag) {
          case "Request": {
            const context = Fiber.getCurrent()!.context;
            contexts.set(message.id, context);
            const encoded = encodePayload(message.payload);
            const post = (payload: unknown) =>
              send(clientId, {
                ...message,
                payload,
                headers: Object.entries(message.headers),
              });
            // Schema evaluates service-free codecs eagerly, just as on RpcServer.
            if (isRpcCodecSuccess(encoded)) return post(encoded.value);
            return encoded.pipe(
              Effect.provideContext(context),
              Effect.orDie,
              Effect.flatMap(post),
            );
          }
          case "Interrupt": {
            if (!contexts.delete(message.requestId)) return Effect.void;
            return send(clientId, {
              _tag: "Interrupt",
              requestId: message.requestId,
            });
          }
          case "Ack": {
            return contexts.has(message.requestId)
              ? send(clientId, { _tag: "Ack", requestId: message.requestId })
              : Effect.void;
          }
          case "Eof":
            return Effect.void;
        }
      },
    },
  );

  yield* run(clientId, (message) => {
    switch (message._tag) {
      case "Exit": {
        const requestId = RpcMessage.RequestId(message.requestId);
        const context = contexts.get(requestId);
        if (!context) return Effect.void;
        contexts.delete(requestId);
        const complete = (exit: Exit.Exit<string, ParseError>) =>
          write({ _tag: "Exit", clientId, requestId, exit });
        const decoded = decodeExit(message.exit);
        if (isRpcCodecSuccess(decoded)) return complete(decoded.value);
        return decoded.pipe(
          Effect.provideContext(context),
          Effect.orDie,
          Effect.matchCauseEffect({
            onSuccess: complete,
            onFailure: (cause) => complete(Exit.failCause(cause)),
          }),
        );
      }
      case "Defect": {
        contexts.clear();
        return write({
          _tag: "Defect",
          clientId,
          defect: decodeDefect(message.defect),
        });
      }
      case "ClientProtocolError": {
        const ids = [...contexts.keys()];
        contexts.clear();
        // The RPC wire type contains handler errors only. The client also fails
        // calls with transport errors, as RpcClient.make does at this boundary.
        const exit = Exit.fail(message.error) as unknown as Exit.Exit<
          string,
          ParseError
        >;
        return Effect.forEach(
          ids,
          (requestId) => write({ _tag: "Exit", clientId, requestId, exit }),
          { discard: true },
        );
      }
      default:
        return Effect.void;
    }
  }).pipe(
    Effect.catchCause(Effect.logError),
    Effect.interruptible,
    Effect.forkScoped,
  );
  yield* Effect.addFinalizer(() => Effect.sync(() => contexts.clear()));
  return client;
});
