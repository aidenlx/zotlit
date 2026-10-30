import { onTestFinished } from "vitest";

import { Layer } from "effect";
import { buildRuntime } from "@/lib/effect-layer";

/** A test-owned runtime for a legacy consumer of fixture Streams. */
export function testRuntime() {
  const stack = new AsyncDisposableStack();
  onTestFinished(() => stack.disposeAsync());
  return buildRuntime(Layer.empty, stack);
}
