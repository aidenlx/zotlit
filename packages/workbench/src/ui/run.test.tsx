import type { WorkbenchRunner } from "#/language/host-effects";
import { act, cleanup, render } from "@testing-library/react";
import { Effect, Fiber } from "effect";
import type { Fiber as FiberType } from "effect";
import { useEffect } from "react";
import { afterEach, expect, it, vi } from "vitest";

import { makeWorkbenchRunner, useFork } from "./run";

afterEach(cleanup);

/** A runner that records each Fiber it forked. */
function recordingRunner() {
  const runner = makeWorkbenchRunner();
  const forked: FiberType.Fiber<unknown, unknown>[] = [];
  const run: WorkbenchRunner = (effect) => {
    const fiber = runner.run(effect);
    forked.push(fiber);
    return fiber;
  };
  return { run, forked, close: runner.close };
}

it("leaves an Effect that ended by interrupt alone at unmount", async () => {
  const runner = recordingRunner();
  const held: { fork?: ReturnType<typeof useFork> } = {};
  function Starter() {
    const fork = useFork(runner.run);
    useEffect(() => {
      held.fork = fork;
    });
    return null;
  }
  const view = render(<Starter />);
  act(() => held.fork!(Effect.interrupt, {}));
  const [fiber] = runner.forked;
  await Effect.runPromise(Fiber.await(fiber!));
  const interrupt = vi.spyOn(fiber!, "interruptUnsafe");
  view.unmount();
  expect(interrupt).not.toHaveBeenCalled();
  runner.close();
});
