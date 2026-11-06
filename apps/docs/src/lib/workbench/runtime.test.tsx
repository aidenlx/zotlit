// @vitest-environment happy-dom
import { Effect, Layer } from "effect";
import { FetchHttpClient } from "effect/http";
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import { layerTabStorage } from "@zotlit/workbench/bridge";

import { layerPage, PageRuntime, usePageBridge } from "./runtime";

it("interrupts a read still running when the page closes", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let interrupted = false;
  // A read the page keeps in its registry, so only the page's close ends it.
  function Reader() {
    const { registry, runtime } = usePageBridge();
    useState(() =>
      registry.mount(
        runtime.atom(
          Effect.never.pipe(
            Effect.onInterrupt(() =>
              Effect.sync(() => {
                interrupted = true;
              }),
            ),
          ),
        ),
      ),
    );
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
  expect(interrupted).toBe(false);
  act(() => root.unmount());
  // The page closes once the commit that let go of it has passed.
  await vi.waitFor(() => expect(interrupted).toBe(true));
  vi.unstubAllGlobals();
});
