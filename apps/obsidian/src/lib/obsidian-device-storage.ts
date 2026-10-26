// The vault's local storage on this device as a capability tag, without the
// Obsidian `App`. It copies the shape of ./obsidian-metadata-cache;
// policies/events.md (Capability tags) describes it.
import { Context, Effect, Layer, Schema } from "effect";
import type { App } from "obsidian";

import { ObsidianApp } from "@/lib/obsidian-app";

/** The Obsidian object the tag reads: what `app` gives. */
export type DeviceStorageSource = Pick<
  App,
  "loadLocalStorage" | "saveLocalStorage"
>;

/**
 * Obsidian's `loadLocalStorage` or `saveLocalStorage` threw. `message` is
 * Obsidian's own; `cause` holds what Obsidian threw.
 */
export class DeviceStorageError extends Schema.TaggedError<
  DeviceStorageError,
  { readonly brand: unique symbol }
>()("DeviceStorageError", {
  /** The Obsidian method that threw. */
  operation: Schema.Literals(["loadLocalStorage", "saveLocalStorage"]),
  /** The storage key the call acted on. */
  key: Schema.String,
  message: Schema.String,
  cause: Schema.Defect(),
}) {}

export interface DeviceStorageShape {
  /**
   * Obsidian's `loadLocalStorage`: the value saved under `key` for this vault
   * on this device, `null` when none is.
   */
  load(key: string): Effect.Effect<unknown, DeviceStorageError>;
  /**
   * Obsidian's `saveLocalStorage`: keep `value` under `key` for this vault on
   * this device; `null` removes it.
   */
  save(key: string, value: unknown): Effect.Effect<void, DeviceStorageError>;
}

/** The vault's local storage on this device. */
export class DeviceStorage extends Context.Service<
  DeviceStorage,
  DeviceStorageShape
>()("zotlit/obsidian/DeviceStorage") {}

const storageError =
  (operation: DeviceStorageError["operation"], key: string) =>
  (cause: unknown): DeviceStorageError =>
    new DeviceStorageError({
      operation,
      key,
      message: cause instanceof Error ? cause.message : String(cause),
      cause,
    });

/** The device storage service over `source`. */
export function makeDeviceStorage(
  source: DeviceStorageSource,
): DeviceStorage["Service"] {
  return DeviceStorage.of({
    load: Effect.fn("DeviceStorage.load")((key) =>
      Effect.try({
        try: (): unknown => source.loadLocalStorage(key),
        catch: storageError("loadLocalStorage", key),
      }),
    ),
    save: Effect.fn("DeviceStorage.save")((key, value) =>
      Effect.try({
        try: () => source.saveLocalStorage(key, value),
        catch: storageError("saveLocalStorage", key),
      }),
    ),
  });
}

/** The tag over any object of the device storage's shape, such as a test host's. */
export const layerDeviceStorageFrom = (
  source: DeviceStorageSource,
): Layer.Layer<DeviceStorage> =>
  Layer.succeed(DeviceStorage, makeDeviceStorage(source));

/** The tag over the app's local storage. */
export const layerDeviceStorage: Layer.Layer<
  DeviceStorage,
  never,
  ObsidianApp
> = Layer.effect(
  DeviceStorage,
  Effect.gen(function* () {
    return makeDeviceStorage(yield* ObsidianApp);
  }),
);
