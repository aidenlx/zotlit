import { HttpClient, HttpClientError } from "effect/http";
import type { App } from "obsidian";

import { Context, Effect, Layer } from "@/lib/effect";
import { layerRequestUrlHttpClient } from "@/lib/http-client";
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

/** The platform over the remote `HttpClient` the caller provides. */
const layerManagedBinaryPlatformWith = Layer.effect(
  ManagedBinaryPlatform,
  Effect.gen(function* () {
    const app = yield* ObsidianApp;
    const http = yield* HttpClient.HttpClient;
    return {
      ...devicePorts({ openStore: createOpfsBinaryStore, consent: app }),
      download: (url) => downloadBytes(http, url),
    } satisfies ManagedBinaryPorts;
  }),
);

/** The platform, downloading over Obsidian's `requestUrl`. */
export const layerManagedBinaryPlatform = layerManagedBinaryPlatformWith.pipe(
  Layer.provide(layerRequestUrlHttpClient),
);

/**
 * The asset at `url`, as `requestUrl` gave it before: a status of `400` or more
 * fails with the message `requestUrl` throws, and a failed connection fails
 * with the error the transport raised, so the failure detail stays the same.
 */
export const downloadBytes = (
  http: HttpClient.HttpClient,
  url: string,
): Effect.Effect<Uint8Array<ArrayBuffer>, Error> =>
  http.get(url).pipe(
    Effect.flatMap((response) =>
      response.status >= 400
        ? Effect.fail(new Error(`Request failed, status ${response.status}`))
        : response.arrayBuffer,
    ),
    Effect.map((buffer) => new Uint8Array(buffer)),
    Effect.mapError((error) =>
      HttpClientError.isHttpClientError(error) &&
      error.reason.cause instanceof Error
        ? error.reason.cause
        : error,
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
    ...devicePorts(host),
    download: (url) => attempt(() => host.download(url)),
  };
}

function devicePorts(
  host: Omit<ManagedBinaryHostPorts, "download">,
): Omit<ManagedBinaryPorts, "download"> {
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
    consent: {
      loadLocalStorage: (key) =>
        Effect.sync(() => host.consent.loadLocalStorage(key)),
      saveLocalStorage: (key, value) =>
        Effect.sync(() => host.consent.saveLocalStorage(key, value)),
    },
  };
}
