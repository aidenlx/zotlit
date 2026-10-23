import type { RpcMessage } from "effect/rpc";
import { TestClock } from "effect/testing";
import { expect, vi } from "vitest";

import { Effect, Exit, Fiber, Queue } from "@/lib/effect";
import { it } from "@/lib/effect-vitest";

import { makeParseHarness } from "./__fixtures__";
import { makeRecoveringParseClient } from "./recovering-client";
import { connectParseWorker } from "./worker-host";

vi.mock("virtual:citation-parse-worker", () => ({ default: "" }));

class WorkerPort extends EventTarget {
  terminated = false;

  constructor(readonly sent: Queue.Queue<RpcMessage.FromClientEncoded>) {
    super();
  }

  postMessage(message: [number, RpcMessage.FromClientEncoded?]) {
    if (message[0] === 0 && message[1])
      Queue.offerUnsafe(this.sent, message[1]);
  }

  reply(id: string | number, path: string, generation: number) {
    this.dispatchEvent(
      new MessageEvent("message", {
        data: [
          1,
          {
            _tag: "Exit",
            requestId: id,
            exit: {
              _tag: "Success",
              value: JSON.stringify({
                path,
                generation,
                record: { citekeys: [] },
              }),
            },
          },
        ],
      }),
    );
  }

  terminate() {
    this.terminated = true;
  }
}

const fakeWorkers = Effect.gen(function* () {
  const spawned = yield* Queue.make<WorkerPort>();
  const sent = yield* Queue.make<RpcMessage.FromClientEncoded>();
  vi.stubGlobal(
    "Worker",
    class extends WorkerPort {
      constructor() {
        super(sent);
      }
      override addEventListener(
        ...args: Parameters<EventTarget["addEventListener"]>
      ) {
        super.addEventListener(...args);
        if (args[0] === "message") Queue.offerUnsafe(spawned, this);
      }
    },
  );
  yield* Effect.addFinalizer(() => Effect.sync(() => vi.unstubAllGlobals()));
  return { spawned };
});

it.effect(
  "accepts readiness from a worker that starts before the next task (#1705)",
  () =>
    Effect.gen(function* () {
      const sent = yield* Queue.make<RpcMessage.FromClientEncoded>();
      vi.stubGlobal(
        "Worker",
        class extends WorkerPort {
          constructor() {
            super(sent);
            queueMicrotask(() =>
              this.dispatchEvent(new MessageEvent("message", { data: [0] })),
            );
          }
          override postMessage(
            message: [number, RpcMessage.FromClientEncoded?],
          ) {
            super.postMessage(message);
            const request = message[1];
            if (request?._tag === "Request")
              queueMicrotask(() => this.reply(request.id, "fast.md", 1));
          }
        },
      );
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => vi.unstubAllGlobals()),
      );
      const connection = yield* connectParseWorker("worker source");
      const reply = yield* Effect.promise((signal) =>
        connection.parse({ path: "fast.md", generation: 1, text: "" }, signal),
      );
      expect(reply).toMatchObject({ path: "fast.md", generation: 1 });
    }),
);

it.effect(
  "cancels one RPC request and rejects its stale reply while another request completes (#1705)",
  () =>
    Effect.gen(function* () {
      const { spawned } = yield* fakeWorkers;
      const connection = yield* connectParseWorker("worker source");
      const worker = yield* Queue.take(spawned);
      worker.dispatchEvent(new MessageEvent("message", { data: [0] }));
      const call = (generation: number) =>
        Effect.tryPromise({
          try: (signal) =>
            connection.parse(
              { path: "draft.md", generation, text: "" },
              signal,
            ),
          catch: (error) => error,
        });
      const first = yield* call(1).pipe(Effect.forkChild);
      const request1 = yield* Queue.take(worker.sent);
      expect(request1._tag).toBe("Request");
      if (request1._tag !== "Request")
        throw new Error("Expected parse request");
      const second = yield* call(2).pipe(Effect.forkChild);
      const request2 = yield* Queue.take(worker.sent);
      if (request2._tag !== "Request")
        throw new Error("Expected parse request");
      yield* Fiber.interrupt(first);
      expect(Exit.isFailure(yield* Fiber.await(first))).toBe(true);
      expect(yield* Queue.take(worker.sent)).toMatchObject({
        _tag: "Interrupt",
        requestId: request1.id,
      });
      worker.reply(request1.id, "draft.md", 1);
      worker.reply(request2.id, "draft.md", 2);
      expect(yield* Fiber.join(second)).toMatchObject({
        path: "draft.md",
        generation: 2,
      });
      expect(worker.terminated).toBe(false);
    }),
);

it.effect(
  "restarts after a worker death, drops the dead worker's reply, and terminates on scope close (#1705)",
  () =>
    Effect.gen(function* () {
      const { spawned } = yield* fakeWorkers;
      const workers = yield* Effect.gen(function* () {
        const client = yield* makeRecoveringParseClient(
          connectParseWorker("worker source"),
        );
        client.start();
        const pending = yield* Effect.tryPromise({
          try: (signal) =>
            client.parse({ path: "draft.md", generation: 3, text: "" }, signal),
          catch: (error) => error,
        }).pipe(Effect.forkChild);
        const first = yield* Queue.take(spawned);
        first.dispatchEvent(new MessageEvent("message", { data: [0] }));
        const request1 = yield* Queue.take(first.sent);
        if (request1._tag !== "Request")
          throw new Error("Expected parse request");
        first.dispatchEvent(
          Object.assign(new Event("error"), { message: "Worker crashed" }),
        );
        yield* TestClock.adjust(100);
        const second = yield* Queue.take(spawned);
        second.dispatchEvent(new MessageEvent("message", { data: [0] }));
        let request2 = yield* Queue.take(second.sent);
        while (request2._tag !== "Request")
          request2 = yield* Queue.take(second.sent);
        first.reply(request1.id, "stale.md", 2);
        second.reply(request2.id, "draft.md", 3);
        expect(yield* Fiber.join(pending)).toMatchObject({
          path: "draft.md",
          generation: 3,
        });
        expect(first.terminated).toBe(true);
        expect(second.terminated).toBe(false);
        return [first, second];
      }).pipe(Effect.scoped);
      expect(workers.every((worker) => worker.terminated)).toBe(true);
    }),
);

it.effect.each([false, true])(
  "starts parsing from layout readiness (%s) and closes with its runtime (#1705)",
  (ready) =>
    Effect.gen(function* () {
      const { spawned } = yield* fakeWorkers;
      const { runtime, parser, layoutReady } = yield* makeParseHarness(ready);
      if (!ready) {
        expect(yield* Queue.size(spawned)).toBe(0);
        layoutReady();
      }
      const worker = yield* Queue.take(spawned);
      worker.dispatchEvent(new MessageEvent("message", { data: [0] }));
      const pending = parser.parse(
        { path: "draft.md", generation: 1, text: "" },
        new AbortController().signal,
      );
      const request = yield* Queue.take(worker.sent);
      if (request._tag !== "Request") throw new Error("Expected parse request");
      worker.reply(request.id, "draft.md", 1);
      expect(yield* Effect.promise(() => pending)).toMatchObject({
        path: "draft.md",
        generation: 1,
      });
      yield* runtime.disposeEffect;
      expect(worker.terminated).toBe(true);
      layoutReady();
      expect(yield* Queue.size(spawned)).toBe(0);
    }),
);
