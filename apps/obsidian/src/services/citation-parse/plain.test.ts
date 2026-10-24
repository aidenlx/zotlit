import { expect, vi } from "vitest";

import { Effect, Queue } from "@/lib/effect";
import { it } from "@/lib/effect-vitest";

import { makeParseHarness } from "./__fixtures__";
import { ParseFailed } from "./client";

vi.mock("virtual:citation-parse-worker", () => ({ default: "" }));

it.effect(
  "rejects a parse with the domain error after the whole runtime is disposed (#1705)",
  () =>
    Effect.gen(function* () {
      const { runtime, parser } = yield* makeParseHarness();
      yield* runtime.disposeEffect;
      yield* Effect.promise(() =>
        expect(
          parser.parse(
            { path: "draft.md", generation: 1, text: "" },
            new AbortController().signal,
          ),
        ).rejects.toBeInstanceOf(ParseFailed),
      );
    }),
);

it.effect(
  "aborts an in-flight parse through the plain facade without terminating the worker (#1705)",
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
      const controller = new AbortController();
      const pending = parser.parse(
        { path: "draft.md", generation: 1, text: "" },
        controller.signal,
      );
      yield* Queue.take(sent);
      controller.abort();
      yield* Effect.promise(() =>
        expect(pending).rejects.toMatchObject({ name: "AbortError" }),
      );
      expect(worker.terminated).toBe(false);
    }),
);
