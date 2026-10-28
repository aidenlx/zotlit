import type { ItemSnapshot } from "#/snapshot/types";
import {
  Context,
  Data,
  Effect,
  Layer,
  PubSub,
  Stream,
  SubscriptionRef,
} from "effect";
import { HttpBody, HttpClient, HttpClientRequest } from "effect/http";
import * as v from "valibot";

import {
  bridgeErrorResponseSchema,
  citationStylesResponseSchema,
  codeBootstrapRequestSchema,
  CONNECT_FRAGMENT_CODE,
  CONNECT_FRAGMENT_PORT,
  connectionGrantSchema,
  disconnectRequestSchema,
  disconnectResponseSchema,
  itemSnapshotSchema,
  LOCAL_BRIDGE_PATHS,
  localBridgeOrigin,
  saveSelectedProfileRequestSchema,
  saveSelectedProfileResponseSchema,
  selectedCitationStyleRequestSchema,
  selectedCitationStyleResponseSchema,
  selectedItemRequestSchema,
  selectedProfileResponseSchema,
  sessionResumeResponseSchema,
  templateDependenciesRequestSchema,
  templateDependenciesResponseSchema,
  templateSchemaResponseSchema,
} from "./contracts";
import type {
  BridgeCompatibility,
  ConnectionGrant,
  InstalledCitationStyle,
  SaveSelectedProfileRequest,
  SaveSelectedProfileResponse,
  SelectedCitationStyleRequest,
  SelectedCitationStyleResponse,
  SelectedProfileResponse,
  TemplateDependenciesRequest,
  TemplateDependenciesResponse,
  TemplateSchemaResponse,
} from "./contracts";

const CREDENTIAL_STORAGE_KEY = "zotlit.local-bridge.credential";

/** The highest port a Local Server can have bound. */
const MAX_TCP_PORT = 65_535;

/**
 * What the tab keeps: the grant, and the port the launch URL named. The port is
 * kept beside the credential because a Local Server binds the first free port
 * of its range, so a reload resumes where this connection was made rather than
 * on a port another vault may now hold.
 */
const keptConnectionSchema = v.object({
  grant: connectionGrantSchema,
  port: v.number(),
});

export type LocalBridgeConnection =
  | { readonly state: "disconnected" }
  | ({ readonly state: "connected" } & Omit<ConnectionGrant, "credential">)
  | {
      readonly state: "unavailable";
      readonly reason: "connection-lost" | "revoked";
    }
  | {
      readonly state: "unavailable";
      readonly reason: "version-mismatch";
      readonly expected: BridgeCompatibility;
      readonly received: BridgeCompatibility;
    };

/** What the page shows of the client. */
export interface LocalBridgeState {
  readonly connection: LocalBridgeConnection;
  /**
   * Whether a kept credential and its port are still here to present. A page
   * with none has nothing to reconnect to and shows the Open-from-Obsidian
   * guidance instead, because a Connection starts in Obsidian only.
   */
  readonly resumable: boolean;
}

/**
 * A request or an answer its schema refused, an answer that is not JSON, or a
 * launch fragment the page cannot connect from.
 */
export class LocalBridgeDecodeError extends Data.TaggedError(
  "LocalBridgeDecodeError",
)<{ readonly message: string; readonly cause?: unknown }> {}

/** The bridge answered with an error status, its own code and message. */
export class LocalBridgeStatusError extends Data.TaggedError(
  "LocalBridgeStatusError",
)<{
  readonly status: number;
  readonly code: string;
  readonly message: string;
}> {}

/** The request never reached a bridge: ZotLit is not reachable. */
export class LocalBridgeConnectionError extends Data.TaggedError(
  "LocalBridgeConnectionError",
)<{ readonly message: string; readonly cause: unknown }> {}

/**
 * The page holds no connection to send over: none was made, no port was
 * recorded, or the bridge revoked the credential.
 */
export class LocalBridgeUnavailableError extends Data.TaggedError(
  "LocalBridgeUnavailableError",
)<{
  readonly reason: "not-connected" | "no-port" | "revoked";
  readonly message: string;
}> {}

export type LocalBridgeError =
  | LocalBridgeDecodeError
  | LocalBridgeStatusError
  | LocalBridgeConnectionError
  | LocalBridgeUnavailableError;

/** Where the tab keeps its grant: the tab's session storage in a browser. */
export class LocalBridgeStorage extends Context.Service<
  LocalBridgeStorage,
  {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
  }
>()("zotlit/workbench/LocalBridgeStorage") {}

/** The tab's session storage, or a storage that keeps nothing when the tab has none. */
export const layerTabStorage = Layer.sync(LocalBridgeStorage, () => {
  try {
    const storage = globalThis.sessionStorage;
    if (storage) return storage;
  } catch {}
  return LocalBridgeStorage.of({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  });
});

type Request<A> = Effect.Effect<A, LocalBridgeError>;

export class LocalBridgeClient extends Context.Service<
  LocalBridgeClient,
  {
    readonly current: Effect.Effect<LocalBridgeState>;
    /** The state now, then each state that replaces it. */
    readonly changes: Stream.Stream<LocalBridgeState>;
    /**
     * Exchanges the launch fragment Obsidian opened this tab with: the
     * Connection code, against the Local Server port that same fragment
     * carried.
     */
    connectFromFragment(fragment: string): Request<LocalBridgeConnection>;
    /**
     * Takes the kept credential back up and presents it to the bridge running
     * now, which answers with its current versions and capabilities. A
     * transport failure leaves the grant intact, so an in-page Reconnect costs
     * no fresh approval; a restarted or upgraded bridge is still measured
     * against this page rather than against the versions the grant was issued
     * under. Answers null when the tab kept no grant, which leaves the caller
     * to bootstrap.
     */
    readonly resume: Request<LocalBridgeConnection | null>;
    /** Ends the connection. The kept grant goes even when the request fails. */
    readonly disconnect: Request<void>;
    readonly readTemplateSchema: Request<TemplateSchemaResponse>;
    readonly loadSelectedItem: Request<ItemSnapshot>;
    readonly readSelectedProfile: Request<SelectedProfileResponse>;
    saveSelectedProfile(
      request: SaveSelectedProfileRequest,
    ): Request<SaveSelectedProfileResponse>;
    readTemplateDependencies(
      request: TemplateDependenciesRequest,
    ): Request<TemplateDependenciesResponse>;
    readonly listCitationStyles: Request<InstalledCitationStyle[]>;
    readSelectedCitationStyle(
      request: SelectedCitationStyleRequest,
    ): Request<SelectedCitationStyleResponse>;
  }
>()("zotlit/workbench/LocalBridgeClient") {}

/** What the client holds: the connection, and the grant it sends with. */
interface Held {
  readonly connection: LocalBridgeConnection;
  readonly credential: string | undefined;
  readonly port: number | undefined;
}

const view = ({ connection, credential, port }: Held): LocalBridgeState => ({
  connection,
  resumable: credential !== undefined && port !== undefined,
});

const decode = <TSchema extends v.GenericSchema>(
  schema: TSchema,
  value: unknown,
): Effect.Effect<v.InferOutput<TSchema>, LocalBridgeDecodeError> => {
  const parsed = v.safeParse(schema, value);
  if (parsed.success) return Effect.succeed(parsed.output);
  const cause = new v.ValiError(parsed.issues);
  return Effect.fail(
    new LocalBridgeDecodeError({ message: cause.message, cause }),
  );
};

/**
 * One client for the page, restored from the grant the tab kept when it is
 * built, and measured against `compatibility`.
 */
export const layerLocalBridgeClient = (compatibility: BridgeCompatibility) =>
  Layer.effect(
    LocalBridgeClient,
    Effect.gen(function* () {
      const http = yield* HttpClient.HttpClient;
      const storage = yield* LocalBridgeStorage;
      const held = yield* SubscriptionRef.make<Held>({
        connection: { state: "disconnected" },
        credential: undefined,
        port: undefined,
      });
      // Ends every `changes` subscription when the page closes.
      yield* Effect.addFinalizer(() => PubSub.shutdown(held.pubsub));
      const update = (patch: Partial<Held>) =>
        SubscriptionRef.update(held, (now) => ({ ...now, ...patch }));

      const clearCredential = Effect.sync(() =>
        storage.removeItem(CREDENTIAL_STORAGE_KEY),
      ).pipe(
        Effect.andThen(update({ credential: undefined, port: undefined })),
      );

      const acceptConnection = (grant: ConnectionGrant) =>
        Effect.gen(function* () {
          const received = {
            bridgeVersion: grant.bridgeVersion,
            templateDataContractVersion: grant.templateDataContractVersion,
          };
          if (
            received.bridgeVersion !== compatibility.bridgeVersion ||
            received.templateDataContractVersion !==
              compatibility.templateDataContractVersion
          ) {
            const connection: LocalBridgeConnection = {
              state: "unavailable",
              reason: "version-mismatch",
              expected: compatibility,
              received,
            };
            yield* clearCredential;
            yield* update({ connection });
            return connection;
          }
          const { port } = yield* SubscriptionRef.get(held);
          if (port !== undefined) {
            storage.setItem(
              CREDENTIAL_STORAGE_KEY,
              JSON.stringify({ grant, port }),
            );
          }
          const { credential, ...granted } = grant;
          const connection: LocalBridgeConnection = {
            state: "connected",
            ...granted,
          };
          yield* update({ connection, credential });
          return connection;
        });

      const restoreConnection = Effect.gen(function* () {
        const stored = storage.getItem(CREDENTIAL_STORAGE_KEY);
        if (stored === null) return null;
        const kept = v.safeParse(keptConnectionSchema, parseJson(stored));
        if (!kept.success) {
          yield* clearCredential;
          return null;
        }
        yield* update({ port: kept.output.port });
        return yield* acceptConnection(kept.output.grant);
      });

      const request = <TSchema extends v.GenericSchema>(
        path: string,
        schema: TSchema,
        options: {
          readonly authenticated?: boolean;
          readonly body?: unknown;
        } = {},
      ): Request<v.InferOutput<TSchema>> =>
        Effect.gen(function* () {
          const authenticated = options.authenticated ?? true;
          const { connection, credential, port } =
            yield* SubscriptionRef.get(held);
          if (authenticated && connection.state !== "connected") {
            return yield* new LocalBridgeUnavailableError({
              reason: "not-connected",
              message: "Local Bridge operations are unavailable.",
            });
          }
          if (port === undefined) {
            return yield* new LocalBridgeUnavailableError({
              reason: "no-port",
              message: "No Local Bridge port was recorded for this page.",
            });
          }
          const url = `${localBridgeOrigin(port)}${path}`;
          const sent =
            options.body === undefined
              ? HttpClientRequest.get(url)
              : HttpClientRequest.post(url).pipe(
                  // The body leaves as the string `fetch` sends as is.
                  HttpClientRequest.setBody(
                    HttpBody.raw(JSON.stringify(options.body), {
                      contentType: "application/json",
                    }),
                  ),
                );
          const response = yield* http
            .execute(
              HttpClientRequest.acceptJson(
                authenticated
                  ? HttpClientRequest.bearerToken(sent, credential ?? "")
                  : sent,
              ),
            )
            .pipe(
              // The bridge lists only the headers the page sends for a
              // browser's preflight, so no trace header goes along.
              Effect.provideService(HttpClient.TracerPropagationEnabled, false),
              Effect.mapError(
                (cause) =>
                  new LocalBridgeConnectionError({
                    message:
                      cause.reason.cause instanceof Error
                        ? cause.reason.cause.message
                        : cause.message,
                    cause,
                  }),
              ),
              // A transport failure says nothing about the grant, so the
              // credential stays in tab storage: a reload restores it and
              // re-checks compatibility and revision, rather than asking for a
              // fresh approval. Only a refusal and a version mismatch clear it.
              Effect.tapError(() =>
                authenticated
                  ? update({
                      connection: {
                        state: "unavailable",
                        reason: "connection-lost",
                      },
                    })
                  : Effect.void,
              ),
            );
          const payload: unknown = yield* response.json.pipe(
            Effect.mapError(
              (cause) =>
                new LocalBridgeDecodeError({
                  message: `Local Bridge answered HTTP ${response.status} with no JSON.`,
                  cause,
                }),
            ),
          );
          const ok = response.status >= 200 && response.status < 300;
          if (!ok) {
            if (response.status === 401 && authenticated) {
              yield* clearCredential;
              yield* update({
                connection: { state: "unavailable", reason: "revoked" },
              });
              return yield* new LocalBridgeUnavailableError({
                reason: "revoked",
                message: "The Workbench Connection was revoked.",
              });
            }
            const parsed = v.safeParse(bridgeErrorResponseSchema, payload);
            return yield* new LocalBridgeStatusError({
              status: response.status,
              code: parsed.success
                ? parsed.output.error.code
                : "invalid-error-response",
              message: parsed.success
                ? parsed.output.error.message
                : `Local Bridge returned HTTP ${response.status}.`,
            });
          }
          return yield* decode(schema, payload);
        });

      /** A request carrying `body`, once its schema accepted it. */
      const post = <TSchema extends v.GenericSchema>(
        path: string,
        schema: TSchema,
        body: Effect.Effect<unknown, LocalBridgeDecodeError>,
      ) =>
        Effect.flatMap(body, (checked) =>
          request(path, schema, { body: checked }),
        );

      yield* restoreConnection;

      const connectFromFragment = Effect.fn(
        "LocalBridgeClient.connectFromFragment",
      )(function* (fragment: string) {
        const parameters = new URLSearchParams(
          fragment.startsWith("#") ? fragment.slice(1) : fragment,
        );
        const code = parameters.get(CONNECT_FRAGMENT_CODE);
        if (!code) {
          return yield* new LocalBridgeDecodeError({
            message: "The URL fragment has no Connection code.",
          });
        }
        const port = Number(parameters.get(CONNECT_FRAGMENT_PORT));
        if (!Number.isInteger(port) || port < 1 || port > MAX_TCP_PORT) {
          return yield* new LocalBridgeDecodeError({
            message: "The URL fragment names no usable Local Bridge port.",
          });
        }
        yield* update({ port });
        const body = yield* decode(codeBootstrapRequestSchema, { code });
        const grant = yield* request(
          LOCAL_BRIDGE_PATHS.codeBootstrap,
          connectionGrantSchema,
          { body, authenticated: false },
        );
        return yield* acceptConnection(grant);
      });

      const resume = Effect.gen(function* () {
        const kept = yield* restoreConnection;
        const { credential } = yield* SubscriptionRef.get(held);
        if (kept?.state !== "connected" || credential === undefined)
          return kept;
        const current = yield* request(
          LOCAL_BRIDGE_PATHS.resumeSession,
          sessionResumeResponseSchema,
        );
        return yield* acceptConnection({ ...current, credential });
      }).pipe(Effect.withSpan("LocalBridgeClient.resume"));

      const disconnect = Effect.gen(function* () {
        const { connection } = yield* SubscriptionRef.get(held);
        if (connection.state !== "connected") return;
        yield* post(
          LOCAL_BRIDGE_PATHS.disconnect,
          disconnectResponseSchema,
          decode(disconnectRequestSchema, {}),
        );
      }).pipe(
        // The page asked to end the connection, so the grant goes whatever the
        // request answered; a failure still reports what the request met.
        Effect.ensuring(
          clearCredential.pipe(
            Effect.andThen(
              SubscriptionRef.update(held, (now): Held =>
                now.connection.state === "connected"
                  ? { ...now, connection: { state: "disconnected" } }
                  : now,
              ),
            ),
          ),
        ),
        Effect.withSpan("LocalBridgeClient.disconnect"),
      );

      return LocalBridgeClient.of({
        current: Effect.map(SubscriptionRef.get(held), view),
        changes: Stream.map(SubscriptionRef.changes(held), view),
        connectFromFragment,
        resume,
        disconnect,
        readTemplateSchema: request(
          LOCAL_BRIDGE_PATHS.templateSchema,
          templateSchemaResponseSchema,
        ).pipe(Effect.withSpan("LocalBridgeClient.readTemplateSchema")),
        loadSelectedItem: post(
          LOCAL_BRIDGE_PATHS.selectedItem,
          itemSnapshotSchema,
          decode(selectedItemRequestSchema, {}),
        ).pipe(Effect.withSpan("LocalBridgeClient.loadSelectedItem")),
        readSelectedProfile: request(
          LOCAL_BRIDGE_PATHS.selectedProfile,
          selectedProfileResponseSchema,
        ).pipe(Effect.withSpan("LocalBridgeClient.readSelectedProfile")),
        saveSelectedProfile: Effect.fn("LocalBridgeClient.saveSelectedProfile")(
          (body: SaveSelectedProfileRequest) =>
            post(
              LOCAL_BRIDGE_PATHS.saveSelectedProfile,
              saveSelectedProfileResponseSchema,
              decode(saveSelectedProfileRequestSchema, body),
            ),
        ),
        readTemplateDependencies: Effect.fn(
          "LocalBridgeClient.readTemplateDependencies",
        )((body: TemplateDependenciesRequest) =>
          post(
            LOCAL_BRIDGE_PATHS.templateDependencies,
            templateDependenciesResponseSchema,
            decode(templateDependenciesRequestSchema, body),
          ),
        ),
        listCitationStyles: request(
          LOCAL_BRIDGE_PATHS.citationStyles,
          citationStylesResponseSchema,
        ).pipe(Effect.withSpan("LocalBridgeClient.listCitationStyles")),
        readSelectedCitationStyle: Effect.fn(
          "LocalBridgeClient.readSelectedCitationStyle",
        )((body: SelectedCitationStyleRequest) =>
          post(
            LOCAL_BRIDGE_PATHS.selectedCitationStyle,
            selectedCitationStyleResponseSchema,
            decode(selectedCitationStyleRequestSchema, body),
          ),
        ),
      });
    }),
  );

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
