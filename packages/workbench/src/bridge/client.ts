import type { ItemSnapshot } from "#/snapshot/types";
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

interface CredentialStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface LocalBridgeClientOptions {
  readonly fetch?: typeof globalThis.fetch;
  readonly storage?: CredentialStorage;
  readonly compatibility: BridgeCompatibility;
}

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

export class LocalBridgeUnavailableError extends Error {
  constructor(message = "Local Bridge operations are unavailable.") {
    super(message);
    this.name = "LocalBridgeUnavailableError";
  }
}

export class LocalBridgeProtocolError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "LocalBridgeProtocolError";
    this.status = status;
    this.code = code;
  }
}

export class LocalBridgeClient {
  readonly #fetch: typeof globalThis.fetch;
  readonly #storage: CredentialStorage | undefined;
  readonly #compatibility: BridgeCompatibility;
  #connection: LocalBridgeConnection = { state: "disconnected" };
  #credential: string | undefined;
  #port: number | undefined;

  constructor(options: LocalBridgeClientOptions) {
    this.#fetch = (options.fetch ?? globalThis.fetch).bind(globalThis);
    this.#storage = options.storage ?? browserSessionStorage();
    this.#compatibility = options.compatibility;
    this.#restoreConnection();
  }

  get connection(): LocalBridgeConnection {
    return this.#connection;
  }

  /**
   * Whether a kept credential and its port are still here to present. A page
   * with none has nothing to reconnect to and shows the Open-from-Obsidian
   * guidance instead, because a Connection starts in Obsidian only.
   */
  get resumable(): boolean {
    return this.#credential !== undefined && this.#port !== undefined;
  }

  /**
   * Exchanges the launch fragment Obsidian opened this tab with: the Connection
   * code, against the Local Server port that same fragment carried.
   */
  async connectFromFragment(fragment: string): Promise<LocalBridgeConnection> {
    const parameters = new URLSearchParams(
      fragment.startsWith("#") ? fragment.slice(1) : fragment,
    );
    const code = parameters.get(CONNECT_FRAGMENT_CODE);
    if (!code) {
      throw new LocalBridgeProtocolError(
        400,
        "missing-connection-code",
        "The URL fragment has no Connection code.",
      );
    }
    const port = Number(parameters.get(CONNECT_FRAGMENT_PORT));
    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
      throw new LocalBridgeProtocolError(
        400,
        "missing-bridge-port",
        "The URL fragment has no Local Bridge port.",
      );
    }
    this.#port = port;
    const request = v.parse(codeBootstrapRequestSchema, { code });
    const response = await this.#request(
      LOCAL_BRIDGE_PATHS.codeBootstrap,
      connectionGrantSchema,
      { body: request, authenticated: false },
    );
    return this.#acceptConnection(response);
  }

  /**
   * Takes the kept credential back up and presents it to the bridge running
   * now, which answers with its current versions and capabilities. A transport
   * failure leaves the grant intact, so an in-page Reconnect costs no fresh
   * approval; a restarted or upgraded bridge is still measured against this
   * page rather than against the versions the grant was issued under, and the
   * hydration that follows re-reads the revision. Answers null when the tab
   * kept no grant, which leaves the caller to bootstrap.
   */
  async resume(
    options: { readonly signal?: AbortSignal } = {},
  ): Promise<LocalBridgeConnection | null> {
    const kept = this.#restoreConnection();
    const credential = this.#credential;
    if (kept?.state !== "connected" || credential === undefined) return kept;
    const current = await this.#request(
      LOCAL_BRIDGE_PATHS.resumeSession,
      sessionResumeResponseSchema,
      { signal: options.signal },
    );
    return this.#acceptConnection({ ...current, credential });
  }

  async disconnect(): Promise<void> {
    if (this.#connection.state === "connected") {
      await this.#request(
        LOCAL_BRIDGE_PATHS.disconnect,
        disconnectResponseSchema,
        { body: v.parse(disconnectRequestSchema, {}) },
      );
    }
    this.#clearCredential();
    this.#connection = { state: "disconnected" };
  }

  readTemplateSchema(): Promise<TemplateSchemaResponse> {
    return this.#request(
      LOCAL_BRIDGE_PATHS.templateSchema,
      templateSchemaResponseSchema,
    );
  }

  loadSelectedItem(): Promise<ItemSnapshot> {
    return this.#request(LOCAL_BRIDGE_PATHS.selectedItem, itemSnapshotSchema, {
      body: v.parse(selectedItemRequestSchema, {}),
    });
  }

  readSelectedProfile(): Promise<SelectedProfileResponse> {
    return this.#request(
      LOCAL_BRIDGE_PATHS.selectedProfile,
      selectedProfileResponseSchema,
    );
  }

  saveSelectedProfile(
    request: SaveSelectedProfileRequest,
  ): Promise<SaveSelectedProfileResponse> {
    return this.#request(
      LOCAL_BRIDGE_PATHS.saveSelectedProfile,
      saveSelectedProfileResponseSchema,
      { body: v.parse(saveSelectedProfileRequestSchema, request) },
    );
  }

  readTemplateDependencies(
    request: TemplateDependenciesRequest,
  ): Promise<TemplateDependenciesResponse> {
    return this.#request(
      LOCAL_BRIDGE_PATHS.templateDependencies,
      templateDependenciesResponseSchema,
      { body: v.parse(templateDependenciesRequestSchema, request) },
    );
  }

  listCitationStyles(): Promise<InstalledCitationStyle[]> {
    return this.#request(
      LOCAL_BRIDGE_PATHS.citationStyles,
      citationStylesResponseSchema,
    );
  }

  readSelectedCitationStyle(
    request: SelectedCitationStyleRequest,
  ): Promise<SelectedCitationStyleResponse> {
    return this.#request(
      LOCAL_BRIDGE_PATHS.selectedCitationStyle,
      selectedCitationStyleResponseSchema,
      { body: v.parse(selectedCitationStyleRequestSchema, request) },
    );
  }

  #acceptConnection(grant: ConnectionGrant): LocalBridgeConnection {
    const received = {
      bridgeVersion: grant.bridgeVersion,
      templateDataContractVersion: grant.templateDataContractVersion,
    };
    const expected = this.#compatibility;
    if (
      received.bridgeVersion !== expected.bridgeVersion ||
      received.templateDataContractVersion !==
        expected.templateDataContractVersion
    ) {
      this.#clearCredential();
      this.#connection = {
        state: "unavailable",
        reason: "version-mismatch",
        expected,
        received,
      };
      return this.#connection;
    }

    this.#credential = grant.credential;
    if (this.#port !== undefined) {
      this.#storage?.setItem(
        CREDENTIAL_STORAGE_KEY,
        JSON.stringify({ grant, port: this.#port }),
      );
    }
    const { credential: _credential, ...connection } = grant;
    this.#connection = { state: "connected", ...connection };
    return this.#connection;
  }

  async #request<
    TSchema extends v.BaseSchema<unknown, unknown, v.BaseIssue<unknown>>,
  >(
    path: string,
    schema: TSchema,
    options: {
      readonly authenticated?: boolean;
      readonly body?: unknown;
      readonly signal?: AbortSignal;
    } = {},
  ): Promise<v.InferOutput<TSchema>> {
    const authenticated = options.authenticated ?? true;
    if (authenticated && this.#connection.state !== "connected") {
      throw new LocalBridgeUnavailableError();
    }
    const port = this.#port;
    if (port === undefined) {
      throw new LocalBridgeUnavailableError(
        "No Local Bridge port was recorded for this page.",
      );
    }
    const headers = new Headers({ Accept: "application/json" });
    if (options.body !== undefined)
      headers.set("Content-Type", "application/json");
    if (authenticated)
      headers.set("Authorization", `Bearer ${this.#credential}`);
    let response: Response;
    try {
      response = await this.#fetch(`${localBridgeOrigin(port)}${path}`, {
        method: options.body === undefined ? "GET" : "POST",
        headers,
        body:
          options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: options.signal,
      });
    } catch (error) {
      // A transport failure says nothing about the grant, so the credential
      // stays in tab storage: a reload restores it and re-checks compatibility
      // and revision, rather than asking for a fresh approval. Only a refusal
      // and a version mismatch clear it.
      if (authenticated) {
        this.#connection = { state: "unavailable", reason: "connection-lost" };
      }
      throw error;
    }

    const payload: unknown = await response.json();
    if (!response.ok) {
      if (response.status === 401 && authenticated) {
        this.#clearCredential();
        this.#connection = { state: "unavailable", reason: "revoked" };
        throw new LocalBridgeUnavailableError(
          "The Workbench Connection was revoked.",
        );
      }
      const parsed = v.safeParse(bridgeErrorResponseSchema, payload);
      throw new LocalBridgeProtocolError(
        response.status,
        parsed.success ? parsed.output.error.code : "invalid-error-response",
        parsed.success
          ? parsed.output.error.message
          : `Local Bridge returned HTTP ${response.status}.`,
      );
    }
    return v.parse(schema, payload);
  }

  #clearCredential(): void {
    this.#credential = undefined;
    this.#port = undefined;
    this.#storage?.removeItem(CREDENTIAL_STORAGE_KEY);
  }

  #restoreConnection(): LocalBridgeConnection | null {
    const stored = this.#storage?.getItem(CREDENTIAL_STORAGE_KEY);
    if (stored === null || stored === undefined) return null;
    try {
      const parsed = v.safeParse(keptConnectionSchema, JSON.parse(stored));
      if (parsed.success) {
        this.#port = parsed.output.port;
        return this.#acceptConnection(parsed.output.grant);
      }
    } catch {}
    this.#clearCredential();
    return null;
  }
}

function browserSessionStorage(): CredentialStorage | undefined {
  try {
    return globalThis.sessionStorage;
  } catch {
    return undefined;
  }
}
