// A Managed Binary layer over fake device ports, with the same handle as the plugin.
import { Context, Layer } from "@/lib/effect";
import { buildRuntime } from "@/lib/effect-layer";

import { bindManagedBinary } from "./handle";
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
  const handle = bindManagedBinary(runtime, service);
  return { service, handle, runtime };
}

/** A disposable test owner around the handle and its service. */
export async function openManagedBinary<
  Engine extends Disposable | AsyncDisposable,
>(binary: ManagedBinary<Engine>, ports: ManagedBinaryHostPorts) {
  await using stack = new AsyncDisposableStack();
  const built = await buildManagedBinary(binary, ports, stack);
  const owned = stack.move();
  return Object.assign(built, {
    [Symbol.asyncDispose]: () => owned.disposeAsync(),
  });
}
