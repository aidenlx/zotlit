// A Managed Binary layer over fake device ports, with the same adapter as the plugin.
import { Context, Layer, Stream } from "@/lib/effect";
import { buildRuntime } from "@/lib/effect-layer";

import { plainManagedBinary } from "./plain";
import { layerManagedBinary, ManagedBinaryPlatform } from "./service";
import type {
  ManagedBinary,
  ManagedBinaryApi,
  ManagedBinaryPorts,
} from "./service";

/** Build one binary for a plain-interface test; the caller's stack owns it. */
export async function buildManagedBinary<
  Engine extends Disposable | AsyncDisposable,
>(
  binary: ManagedBinary<Engine>,
  ports: ManagedBinaryPorts,
  stack: AsyncDisposableStack,
) {
  const tag = Context.Service<ManagedBinaryApi<Engine>>(
    "zotlit/managed-binary/TestBinary",
  );
  const runtime = buildRuntime(
    layerManagedBinary(tag, binary).pipe(
      Layer.provide(Layer.succeed(ManagedBinaryPlatform, ports)),
    ),
    stack,
  );
  const service = runtime.runSync(tag);
  // A restored binary arrives through the same Stream a UI subscribes to.
  const names = await ports
    .openStore(binary.id)
    .list()
    .catch((): string[] => []);
  if (names.includes(`${binary.pin.sha256}.wasm`)) {
    await runtime.runPromise(
      Stream.runHead(
        service.changes.pipe(
          Stream.filter((status) => status.kind === "installed"),
        ),
      ),
    );
  }
  return plainManagedBinary(runtime, service);
}

/** A disposable test owner around the plain adapter, which has no lifecycle API. */
export async function openManagedBinary<
  Engine extends Disposable | AsyncDisposable,
>(binary: ManagedBinary<Engine>, ports: ManagedBinaryPorts) {
  await using stack = new AsyncDisposableStack();
  const adapter = await buildManagedBinary(binary, ports, stack);
  const owned = stack.move();
  return Object.assign(adapter, {
    [Symbol.asyncDispose]: () => owned.disposeAsync(),
  });
}
