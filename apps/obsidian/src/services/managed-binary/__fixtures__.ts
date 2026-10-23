// A Managed Binary layer over fake device ports, with the same adapter as the plugin.
import { Context, Layer } from "@/lib/effect";
import { buildRuntime } from "@/lib/effect-layer";

import { plainManagedBinary } from "./plain";
import { managedBinaryPorts } from "./platform";
import { layerManagedBinary, ManagedBinaryPlatform } from "./service";
import type {
  ManagedBinary,
  ManagedBinaryApi,
  ManagedBinaryHostPorts,
} from "./service";

/** Build one binary for a plain-interface test; the caller's stack owns it. */
export async function buildManagedBinary<
  Engine extends Disposable | AsyncDisposable,
>(
  binary: ManagedBinary<Engine>,
  ports: ManagedBinaryHostPorts,
  stack: AsyncDisposableStack,
) {
  const tag = Context.Service<ManagedBinaryApi<Engine>>(
    "zotlit/managed-binary/TestBinary",
  );
  const runtime = buildRuntime(
    layerManagedBinary(tag, binary).pipe(
      Layer.provide(
        Layer.succeed(ManagedBinaryPlatform, managedBinaryPorts(ports)),
      ),
    ),
    stack,
  );
  await runtime.context();
  const service = runtime.runSync(tag);
  return plainManagedBinary(runtime, service);
}

/** A disposable test owner around the plain adapter, which has no lifecycle API. */
export async function openManagedBinary<
  Engine extends Disposable | AsyncDisposable,
>(binary: ManagedBinary<Engine>, ports: ManagedBinaryHostPorts) {
  await using stack = new AsyncDisposableStack();
  const adapter = await buildManagedBinary(binary, ports, stack);
  const owned = stack.move();
  return Object.assign(adapter, {
    [Symbol.asyncDispose]: () => owned.disposeAsync(),
  });
}
