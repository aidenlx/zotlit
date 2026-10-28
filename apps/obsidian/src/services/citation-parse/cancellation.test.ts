import { it } from "@effect/vitest";
import { Effect, Exit, Fiber, Queue } from "effect";
import { expect, vi } from "vitest";

import { cancellableParse, makeParseHarness } from "./__fixtures__";
import { ParseFailed } from "./client";

vi.mock("virtual:citation-parse-worker", () => ({ default: "" }));

it.effect(
  "rejects a parse with the domain error after the whole runtime is disposed (#1705)",
  () =>
    Effect.gen(function* () {
      const { runtime, parser } = yield* makeParseHarness();
      yield* runtime.disposeEffect;
      expect(
        yield* Effect.flip(
          parser.parse({ path: "draft.md", generation: 1, text: "" }),
        ),
      ).toBeInstanceOf(ParseFailed);
    }),
);

it.effect(
  "aborts an in-flight parse through the native service without terminating the worker (#1705)",
  () =>
    Effect.gen(function* () {
      const spawned = yield* Queue.make<
        EventTarget & {
          terminated: boolean;
        }
      >();
      const sent = yield* Queue.make<void>();
      vi.stubGlobal(
        "Worker",
        class extends EventTarget {
          terminated = false;

          constructor() {
            super();
            queueMicrotask(() =>
              Queue.offerUnsafe(
                spawned,
                this as EventTarget & {
                  terminated: boolean;
                },
              ),
            );
          }

          postMessage() {
            Queue.offerUnsafe(sent, undefined);
          }

          terminate() {
            this.terminated = true;
          }
        },
      );
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => vi.unstubAllGlobals()),
      );
      const { parser, layoutReady } = yield* makeParseHarness();
      layoutReady();
      const worker = yield* Queue.take(spawned);
      worker.dispatchEvent(new MessageEvent("message", { data: [0] }));
      const pending = yield* cancellableParse(parser, {
        path: "draft.md",
        generation: 1,
        text: "",
      });
      yield* Queue.take(sent);
      yield* Fiber.interrupt(pending);
      const exit = yield* Fiber.await(pending);
      expect(Exit.hasInterrupts(exit)).toBe(true);
      expect(worker.terminated).toBe(false);
    }),
);
