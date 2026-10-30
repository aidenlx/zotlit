import { Effect, Layer } from "effect";
import { Rpc, RpcGroup, RpcServer } from "effect/rpc";
import { expect, it, vi } from "vitest";

import { launchWorker } from "./worker-launch";
import type { WorkerScope } from "./worker-launch";
import { WORKER_CLOSED } from "./worker-signal";

const Group = RpcGroup.make(Rpc.make("Ping"));

/**
 * A dedicated worker's global scope: the renderer's messages arrive as
 * `message` events. It records what the worker posts and when it closes,
 * since a closed worker scope runs no task queued after it.
 */
function fakeScope() {
  const target = new EventTarget();
  const events: unknown[] = [];
  const scope: WorkerScope = {
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
    postMessage: (data: unknown) => events.push(data),
    close: () => events.push("scope closed"),
  };
  const send = (data: unknown) =>
    target.dispatchEvent(new MessageEvent("message", { data }));
  return { scope, events, send };
}

it("answers the renderer's close message once its cleanup ran, and closes its scope last", async () => {
  const { scope, events, send } = fakeScope();
  const cleanup = Layer.effectDiscard(
    Effect.addFinalizer(() => Effect.sync(() => events.push("cleanup"))),
  );
  launchWorker(
    scope,
    RpcServer.layer(Group).pipe(
      Layer.provide(Group.toLayer({ Ping: () => Effect.void })),
      Layer.provide(cleanup),
    ),
  );
  // The runner announces itself with `[0]` once it listens.
  await vi.waitFor(() => expect(events).toContainEqual([0]));

  send([1]);

  await vi.waitFor(() => expect(events).toContain("scope closed"));
  expect(events.filter((event) => typeof event === "string")).toEqual([
    "cleanup",
    WORKER_CLOSED,
    "scope closed",
  ]);
});
