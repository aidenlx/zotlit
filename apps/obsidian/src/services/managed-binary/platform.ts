import { requestUrl } from "obsidian";
import type { App } from "obsidian";

import { Context, Effect, Layer } from "@/lib/effect";
import { ObsidianApp } from "@/lib/obsidian-app";

import { createOpfsBinaryStore } from "./store";
import type { BinaryStore } from "./store";

/** Host APIs adapted at the platform boundary. */
export interface ManagedBinaryHostPorts {
  openStore(directory: string): BinaryStore;
  download(url: string): Promise<Uint8Array<ArrayBuffer>>;
  consent: Pick<App, "loadLocalStorage" | "saveLocalStorage">;
}

export interface EffectBinaryStore {
  list(): Effect.Effect<string[], Error>;
  read(name: string): Effect.Effect<Blob | undefined, Error>;
  write(
    name: string,
    bytes: Uint8Array<ArrayBuffer>,
  ): Effect.Effect<void, Error>;
  rename(from: string, to: string): Effect.Effect<void, Error>;
  remove(name: string): Effect.Effect<void, Error>;
  clear(): Effect.Effect<void, Error>;
}

export interface ManagedBinaryPorts {
  openStore(directory: string): Effect.Effect<EffectBinaryStore>;
  download(url: string): Effect.Effect<Uint8Array<ArrayBuffer>, Error>;
  consent: {
    loadLocalStorage(key: string): Effect.Effect<unknown>;
    saveLocalStorage(key: string, value: unknown): Effect.Effect<void>;
  };
}

/** OS and network operations use the caller's Effect context and Clock. */
export class ManagedBinaryPlatform extends Context.Service<
  ManagedBinaryPlatform,
  ManagedBinaryPorts
>()("zotlit/managed-binary/ManagedBinaryPlatform") {}

export const layerManagedBinaryPlatform = Layer.effect(
  ManagedBinaryPlatform,
  Effect.map(ObsidianApp, (app) =>
    managedBinaryPorts({
      openStore: createOpfsBinaryStore,
      download: async (url) =>
        new Uint8Array(await requestUrl({ url }).arrayBuffer),
      consent: app,
    }),
  ),
);

const attempt = <A>(run: () => Promise<A>): Effect.Effect<A, Error> =>
  Effect.tryPromise({
    try: run,
    catch: (error) =>
      error instanceof Error ? error : new Error(String(error)),
  });

/** Wrap Promise and synchronous host APIs once, at their boundary. */
export function managedBinaryPorts(
  host: ManagedBinaryHostPorts,
): ManagedBinaryPorts {
  return {
    openStore: Effect.fn("ManagedBinaryPlatform.openStore")(function* (
      directory: string,
    ) {
      const store = yield* Effect.sync(() => host.openStore(directory));
      return {
        list: () => attempt(() => store.list()),
        read: (name) => attempt(() => store.read(name)),
        write: (name, bytes) => attempt(() => store.write(name, bytes)),
        rename: (from, to) => attempt(() => store.rename(from, to)),
        remove: (name) => attempt(() => store.remove(name)),
        clear: () => attempt(() => store.clear()),
      } satisfies EffectBinaryStore;
    }),
    download: (url) => attempt(() => host.download(url)),
    consent: {
      loadLocalStorage: (key) =>
        Effect.sync(() => host.consent.loadLocalStorage(key)),
      saveLocalStorage: (key, value) =>
        Effect.sync(() => host.consent.saveLocalStorage(key, value)),
    },
  };
}
