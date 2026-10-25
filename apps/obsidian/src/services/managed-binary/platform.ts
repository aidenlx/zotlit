import { Context, Effect, Layer, Schema } from "effect";
import { HttpClient, HttpClientError } from "effect/http";
import type { App } from "obsidian";

import { layerRequestUrlHttpClient } from "@/lib/http-client";
import { ObsidianApp } from "@/lib/obsidian-app";

import { createOpfsBinaryStore } from "./store";
import type { BinaryStore } from "./store";

/**
 * A managed binary step failed: the store, the download, the engine, or the
 * install. `message` is the original's, which the failure status and the logs
 * show; `cause` holds the original where there is one.
 */
export class ManagedBinaryError extends Schema.TaggedError<
  ManagedBinaryError,
  { readonly brand: unique symbol }
>()("ManagedBinaryError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}

/** What a host API threw, as a {@link ManagedBinaryError} with its message. */
export function managedBinaryError(cause: unknown): ManagedBinaryError {
  return cause instanceof ManagedBinaryError
    ? cause
    : new ManagedBinaryError({
        message: Error.isError(cause) ? cause.message : String(cause),
        cause,
      });
}

/** Host APIs adapted at the platform boundary. */
export interface ManagedBinaryHostPorts {
  openStore(directory: string): BinaryStore;
  download(url: string): Promise<Uint8Array<ArrayBuffer>>;
  consent: Pick<App, "loadLocalStorage" | "saveLocalStorage">;
}

export interface EffectBinaryStore {
  list(): Effect.Effect<string[], ManagedBinaryError>;
  read(name: string): Effect.Effect<Blob | undefined, ManagedBinaryError>;
  write(
    name: string,
    bytes: Uint8Array<ArrayBuffer>,
  ): Effect.Effect<void, ManagedBinaryError>;
  rename(from: string, to: string): Effect.Effect<void, ManagedBinaryError>;
  remove(name: string): Effect.Effect<void, ManagedBinaryError>;
  clear(): Effect.Effect<void, ManagedBinaryError>;
}

export interface ManagedBinaryPorts {
  openStore(directory: string): Effect.Effect<EffectBinaryStore>;
  download(
    url: string,
  ): Effect.Effect<Uint8Array<ArrayBuffer>, ManagedBinaryError>;
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
): Effect.Effect<Uint8Array<ArrayBuffer>, ManagedBinaryError> =>
  http.get(url).pipe(
    Effect.flatMap(
      (
        response,
      ): Effect.Effect<
        ArrayBuffer,
        ManagedBinaryError | HttpClientError.HttpClientError
      > =>
        response.status >= 400
          ? Effect.fail(
              new ManagedBinaryError({
                message: `Request failed, status ${response.status}`,
              }),
            )
          : response.arrayBuffer,
    ),
    Effect.map((buffer) => new Uint8Array(buffer)),
    Effect.mapError((error) =>
      managedBinaryError(
        HttpClientError.isHttpClientError(error) &&
          error.reason.cause instanceof Error
          ? error.reason.cause
          : error,
      ),
    ),
  );

const attempt = <A>(
  run: () => Promise<A>,
): Effect.Effect<A, ManagedBinaryError> =>
  Effect.tryPromise({ try: run, catch: managedBinaryError });

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
