import { it } from "@effect/vitest";
import { Cause, Effect, Exit, Fiber, Queue } from "effect";
import type { RpcMessage } from "effect/rpc";
import { TestClock } from "effect/testing";
import { expect, vi } from "vitest";

import { cancellableParse, makeParseHarness } from "./__fixtures__";
import { ParseWorkerDied } from "./client";
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
      const reply = yield* connection.parse({
        path: "fast.md",
        generation: 1,
        text: "",
      });
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
        connection.parse({ path: "draft.md", generation, text: "" });
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
  "rejects an in-flight parse on a single connection when its worker dies (#1705)",
  () =>
    Effect.gen(function* () {
      const { spawned } = yield* fakeWorkers;
      yield* Effect.gen(function* () {
        const connection = yield* connectParseWorker("worker source");
        const pending = yield* connection
          .parse({ path: "draft.md", generation: 1, text: "" })
          .pipe(Effect.forkChild);
        const first = yield* Queue.take(spawned);
        first.dispatchEvent(new MessageEvent("message", { data: [0] }));
        const request1 = yield* Queue.take(first.sent);
        if (request1._tag !== "Request")
          throw new Error("Expected parse request");
        first.dispatchEvent(
          Object.assign(new Event("error"), { message: "Worker crashed" }),
        );
        const exit = yield* Fiber.await(pending);
        expect(Exit.isFailure(exit)).toBe(true);
        if (Exit.isFailure(exit))
          expect(Cause.squash(exit.cause)).toBeInstanceOf(ParseWorkerDied);
      }).pipe(Effect.scoped);
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
        yield* client.start;
        const pending = yield* client
          .parse({ path: "draft.md", generation: 1, text: "" })
          .pipe(Effect.forkChild);
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
      const pending = yield* cancellableParse(parser, {
        path: "draft.md",
        generation: 1,
        text: "",
      });
      const request = yield* Queue.take(worker.sent);
      if (request._tag !== "Request") throw new Error("Expected parse request");
      worker.reply(request.id, "draft.md", 1);
      expect(yield* Fiber.join(pending)).toMatchObject({
        path: "draft.md",
        generation: 1,
      });
      yield* runtime.disposeEffect;
      expect(worker.terminated).toBe(true);
      layoutReady();
      expect(yield* Queue.size(spawned)).toBe(0);
    }),
);

it.effect(
  "retries a failed worker construction before the request deadline (#1705)",
  () =>
    Effect.gen(function* () {
      const failed = yield* Queue.make<void>();
      const spawned = yield* Queue.make<WorkerPort>();
      const sent = yield* Queue.make<RpcMessage.FromClientEncoded>();
      let attempts = 0;
      vi.stubGlobal(
        "Worker",
        class extends WorkerPort {
          constructor() {
            super(sent);
            if (++attempts === 1) {
              Queue.offerUnsafe(failed, undefined);
              throw new Error("Worker construction failed");
            }
          }
          override addEventListener(
            ...args: Parameters<EventTarget["addEventListener"]>
          ) {
            super.addEventListener(...args);
            if (args[0] === "message") Queue.offerUnsafe(spawned, this);
          }
        },
      );
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => vi.unstubAllGlobals()),
      );
      const client = yield* makeRecoveringParseClient(
        connectParseWorker("worker source"),
      );
      yield* client.start;
      const pending = yield* client
        .parse({ path: "draft.md", generation: 1, text: "" })
        .pipe(Effect.forkChild);
      yield* Queue.take(failed);
      yield* TestClock.adjust(100);
      const worker = yield* Queue.take(spawned);
      worker.dispatchEvent(new MessageEvent("message", { data: [0] }));
      const request = yield* Queue.take(sent);
      if (request._tag !== "Request") throw new Error("Expected parse request");
      worker.reply(request.id, "draft.md", 1);
      expect(yield* Fiber.join(pending)).toMatchObject({
        path: "draft.md",
        generation: 1,
      });
    }),
);
