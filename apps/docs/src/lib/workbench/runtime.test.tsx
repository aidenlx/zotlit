// @vitest-environment happy-dom
import { Effect, Exit, Fiber, Layer } from "effect";
import { FetchHttpClient } from "effect/http";
import { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import { layerTabStorage } from "@zotlit/workbench/bridge";

import { layerPage, PageRuntime, usePageBridge } from "./runtime";
import type { PageBridge } from "./runtime";

it("answers an interrupted Fiber for an Effect run after the page closed", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const held: { bridge?: PageBridge } = {};
  function Reader() {
    const bridge = usePageBridge();
    useEffect(() => {
      held.bridge = bridge;
    });
    return null;
  }
  const container = document.createElement("div");
  const root = createRoot(container);
  act(() =>
    root.render(
      <PageRuntime
        layer={layerPage.pipe(
          Layer.provide([FetchHttpClient.layer, layerTabStorage]),
        )}
      >
        <Reader />
      </PageRuntime>,
    ),
  );
  act(() => root.unmount());
  // The page closes once the commit that let go of it has passed.
  await Promise.resolve();
  const exit = await Effect.runPromise(
    Fiber.await(held.bridge!.run(Effect.succeed("late"))),
  );
  expect(Exit.hasInterrupts(exit)).toBe(true);
  vi.unstubAllGlobals();
});
