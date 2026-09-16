// Reads Zotero's data live, from the local API a running Zotero serves on loopback.

import { parseIndexedKey } from "@zotlit/db";
import { createNanoEvents } from "@zotlit/shared/nanoevents";

import { AbortError } from "@/lib/abort-error";
import { getLogger } from "@/lib/log";
import { zoteroOrigin } from "@/lib/zotero-http";
import type { ZoteroTransport } from "@/lib/zotero-http";
import type { LocalServerService } from "@/services/local-server/service";
import { Service } from "@/services/service-base";
import type { ZoteroPrefService } from "@/services/zotero-pref/service";

import {
  API_VERSION,
  AUTHORIZE_PATH,
  classifyReply,
  CLIENT_NAME,
  invalid,
  isServerID,
  NO_CACHE_HEADERS,
  readAnnotationPage,
  readGrant,
  totalResults,
} from "./wire";
import type {
  AuthorizationGrant,
  LocalApiAnnotation,
  LocalApiFailure,
  LocalApiResult,
  ZoteroReply,
} from "./wire";
import type { WriteAuthorizationStore } from "./write-authorization";

export type {
  AuthorizationGrant,
  LocalApiAnnotation,
  LocalApiFailure,
  LocalApiResult,
} from "./wire";
export type {
  SecretStore,
  WriteAuthorizationStore,
} from "./write-authorization";

const logger = getLogger("zotero-local-api");

/** How many Annotations one page of the list route asks for. */
const PAGE_SIZE = 100;

/**
 * How long the Capability Probe waits for Zotero. A Zotero that has not
 * answered by then is not answering: the probe is time-bounded so a hung
 * server cannot hold the Annotation Source undecided.
 */
const PROBE_TIMEOUT = Temporal.Duration.from({ seconds: 5 });

/**
 * The Annotation Source the Zotero Local API is, carrying the server id that
 * partitions its read cache. A record set from one server never joins one from
 * another, and the id is the only place a server is named.
 *
 * @see apps/obsidian/docs/adr/0033-zotero-object-identity-is-the-indexed-key-server-id-is-source-data.md
 */
export interface LocalApiSource {
  kind: "zotero-local-api";
  /** Zotero's 12-character per-database id, from the Capability Probe. */
  serverID: string;
}

/**
 * What the Capability Probe knows, which is everything this client alone can
 * say about a session. The Editing Capability is computed from it by the
 * annotation repository, where one Attachment's other facts are.
 *
 * @see apps/obsidian/src/services/annotation-repository/capability.ts
 */
export type LocalApiState =
  /** No probe has answered yet — none has run, or one is running now. */
  | { kind: "probing" }
  | {
      kind: "available";
      source: LocalApiSource;
      /**
       * Whether a Write Authorization is in hand for {@link source}: a
       * Remembered one in Obsidian's Keychain, or a One-time Authorization this
       * session was granted and has not spent.
       */
      authorized: boolean;
    }
  | { kind: "unavailable"; failure: LocalApiFailure };

/**
 * What the write path knows about one Attachment beside the Capability Probe.
 * The repository folds it into that Attachment's Editing Capability; none of it
 * outlives the session.
 *
 * @see apps/obsidian/docs/adr/0038-write-authorization-starts-only-from-a-user-gesture.md
 */
export interface WriteAuthorizationState {
  /** A gesture is at Zotero's dialog now. */
  authorizing: boolean;
  /** Zotero refused a write to this Attachment's library this session. */
  libraryReadOnly: boolean;
  /** When Zotero's dialog rate limit lifts, or null while none is running. */
  cooldownUntil: Temporal.Instant | null;
}

/** What one authorization gesture ended with. */
export interface Authorization {
  /**
   * Whether the grant outlives the write that spends it — Always Allow, or a
   * Remembered Authorization that was already in hand. `false` is a One-time
   * Authorization, good for one authenticated request.
   */
  remembered: boolean;
}

export interface ZoteroLocalApiEvents {
  /**
   * What this source answers may have moved: a probe that changed the
   * capability, a Zotero database swapped under the port, or the Companion's
   * Freshness Signal. A consumer drops what it holds from this source and
   * reads again; nothing here says which records changed.
   */
  changed: () => void;
  /**
   * What a surface may do to this source moved: a probe landed, a gesture
   * started or ended, Zotero granted or refused a key, or a library turned out
   * to be read-only. A consumer re-reads the Editing Capability; no record set
   * is affected.
   */
  "capability-changed": () => void;
}

export interface ZoteroLocalApiDeps {
  fetch: ZoteroTransport;
  /** Zotero's HTTP port, and the signal that the resolved paths moved. */
  zoteroPref: Pick<ZoteroPrefService, "httpPort" | "on">;
  /** The Companion's Freshness Signal. */
  localServer: Pick<LocalServerService, "on">;
  credentials: WriteAuthorizationStore;
  /**
   * The deadline one Capability Probe runs under, as the signal that ends it.
   *
   * @default a signal that aborts after {@link PROBE_TIMEOUT}
   */
  probeDeadline?: () => AbortSignal;
  /** The clock Zotero's dialog cooldown is measured against. */
  now?: () => Temporal.Instant;
}

/** {@link LocalApiState}, plus the state before anything has asked. */
type ProbeState = LocalApiState | { kind: "unprobed" };

/**
 * Zotero's local API, as far as reading goes: a Capability Probe that decides
 * whether this source answers at all, and the Annotations of one Attachment.
 *
 * The probe is the sole authority on "local API disabled" — Zotero's preference
 * file supplies the port and nothing else — and it runs lazily on the first
 * demand, again on the Companion's Freshness Signal, and again when the
 * resolved Zotero paths move.
 *
 * Reads need no key: an unauthorized session still reads every Annotation.
 * Authorization gates writes alone, and this client asks the credential store
 * only to tell a session that could write from one that must ask first.
 *
 * @see apps/obsidian/docs/adr/0034-the-annotation-source-is-atomic-per-attachment.md
 * @see apps/obsidian/docs/adr/0036-local-api-enablement-is-a-guided-manual-step-in-zotero.md
 */
export class ZoteroLocalApiClient extends Service<void> {
  readonly #fetch;
  readonly #zoteroPref;
  readonly #localServer;
  readonly #credentials;
  readonly #deadline;
  readonly #now;
  readonly #emitter = createNanoEvents<ZoteroLocalApiEvents>();

  #state: ProbeState = { kind: "unprobed" };
  /** The probe in flight, so concurrent demands cost one request. */
  #probing: Promise<void> | null = null;
  /** A Freshness Signal that arrived while that probe ran, still to announce. */
  #moved = false;
  /**
   * The one authorization request in flight, and the gestures waiting on it, so
   * an edit gesture and the settings action raise one dialog between them.
   */
  #authorizing: {
    gestures: Gestures;
    result: Promise<LocalApiResult<Authorization>>;
  } | null = null;
  /**
   * A One-time Authorization, held for the one authenticated request that
   * spends it and never written down.
   */
  #oneTime: string | null = null;
  /**
   * The libraries Zotero refused a write to this session, as the route names
   * them. Cleared by the next Capability Probe.
   */
  readonly #readOnlyLibraries = new Set<string>();
  /** When Zotero's authorization-dialog rate limit lifts. */
  #cooldownUntil: Temporal.Instant | null = null;

  ready: Promise<void>;

  constructor({
    fetch,
    zoteroPref,
    localServer,
    credentials,
    probeDeadline = () =>
      AbortSignal.timeout(PROBE_TIMEOUT.total("milliseconds")),
    now = () => Temporal.Now.instant(),
  }: ZoteroLocalApiDeps) {
    super();
    this.#fetch = fetch;
    this.#zoteroPref = zoteroPref;
    this.#localServer = localServer;
    this.#credentials = credentials;
    this.#deadline = probeDeadline;
    this.#now = now;
    this.ready = this.#load();
  }

  /**
   * The source that stands now — and, where no probe has run yet, the demand
   * that arms the first one. Answers `null` meanwhile, so the Annotation Source
   * is decided by what is known at the moment of asking and a switch is
   * announced through `changed` when the probe lands.
   *
   * @returns the source, or null while another source must answer instead.
   */
  demandSource(): LocalApiSource | null {
    if (this.#state.kind === "unprobed") void this.#reprobe("first demand");
    return this.#state.kind === "available" ? this.#state.source : null;
  }

  /**
   * What the last Capability Probe learned, for the repository that computes
   * the Editing Capability from it. Asking does not arm a probe.
   */
  get state(): LocalApiState {
    const state = this.#state;
    return state.kind === "unprobed" ? { kind: "probing" } : state;
  }

  /**
   * Run the Capability Probe now — an edit gesture, or the settings action.
   * Concurrent calls join the probe already running.
   */
  async probe(): Promise<void> {
    await this.#reprobe("asked");
  }

  /**
   * What the write path knows, for the Editing Capability the repository
   * computes.
   *
   * @param attachmentKey the Attachment being asked about, or null to ask about
   *   the session itself — what the settings row shows, where no one library
   *   can be read-only.
   */
  writeStateFor(attachmentKey: string | null): WriteAuthorizationState {
    const parsed =
      attachmentKey === null ? null : parseIndexedKey(attachmentKey);
    return {
      authorizing: this.#authorizing !== null,
      libraryReadOnly:
        parsed !== null && this.#readOnlyLibraries.has(libraryPath(parsed)),
      cooldownUntil: this.#cooldownUntil,
    };
  }

  /** Whether a Remembered Write Authorization is stored, for the settings row. */
  async remembered(): Promise<boolean> {
    return await this.#credentials.has();
  }

  /**
   * Ask Zotero for a Write Authorization, from the gesture that wants one: an
   * edit in the reader, or "Enable editing" in settings. Nothing else may call
   * this — no dialog opens without a user action.
   *
   * A Capability Probe runs first, because the probe is the sole authority on
   * whether the local API is on at all, and a session that already holds an
   * authorization is answered without a dialog. Concurrent gestures join the
   * one request in flight.
   *
   * The request itself is unbounded: Zotero's dialog waits for the user, so
   * only the gesture ends it. `signal` is that gesture; the request is aborted
   * once every gesture waiting on it has been abandoned.
   *
   * @see apps/obsidian/docs/adr/0038-write-authorization-starts-only-from-a-user-gesture.md
   */
  async authorize(
    signal?: AbortSignal,
  ): Promise<LocalApiResult<Authorization>> {
    const running = this.#authorizing;
    if (running) {
      running.gestures.join(signal);
      return await running.result;
    }
    const gestures = new Gestures();
    gestures.join(signal);
    const result = this.#authorize(gestures.signal).finally(() => {
      this.#authorizing = null;
      this.#emitter.emit("capability-changed");
    });
    this.#authorizing = { gestures, result };
    this.#emitter.emit("capability-changed");
    return await result;
  }

  /**
   * Drop the Remembered Write Authorization, from the settings row. The next
   * gesture asks Zotero again; Zotero's own "Clear Write Authorizations" is the
   * other half of the same revocation and needs no help from here.
   */
  async forgetAuthorization(): Promise<void> {
    await this.#credentials.forget();
    this.#oneTime = null;
    this.#setAuthorized(false);
  }

  /**
   * One request that spends a Write Authorization — the seam every write goes
   * through, with the method, body and preconditions its caller builds
   * (aidenlx/zotlit#1145).
   *
   * The key is read here and never held: a Remembered Authorization comes fresh
   * from the store at every call, so one the user deleted in Obsidian's Keychain
   * is simply gone. A One-time Authorization is spent by this call whatever it
   * answers — Zotero removes a single-use key at the key lookup, before the
   * endpoint runs, so a write that then fails has still consumed it.
   *
   * No dialog opens from here. A call with no key in hand is refused as
   * `unauthorized` without reaching Zotero; the gesture authorizes first.
   *
   * @param options.library the library the write targets, as the route spells
   *   it, so a refusal marks that one read-only for the session.
   */
  async authorizedSend(
    path: string,
    options: {
      library: string;
      method: string;
      body?: string;
      headers?: Readonly<Record<string, string>>;
      signal?: AbortSignal;
    },
  ): Promise<LocalApiResult<ZoteroReply>> {
    const state = this.#state;
    if (state.kind !== "available") {
      return { failure: noSessionFailure(state) };
    }
    const { library, method, body, headers, signal } = options;
    if (this.#readOnlyLibraries.has(library)) {
      return { failure: { kind: "library-read-only" } };
    }
    const { serverID } = state.source;
    const key = await this.#takeKey(serverID);
    if (key === null) return { failure: { kind: "unauthorized" } };

    const reply = await this.#send(path, {
      serverID,
      signal,
      method,
      body,
      headers: { ...headers, "Zotero-API-Key": key },
    });
    if ("failure" in reply) await this.#writeRefused(reply.failure, library);
    return reply;
  }

  /**
   * Every Annotation of one Attachment, in the order its Sort Indexes give.
   *
   * The list route is read a page at a time and followed to its end, so an
   * Attachment with more than {@link PAGE_SIZE} Annotations is whole. A key
   * Zotero does not hold answers an empty list, not a failure — the same answer
   * the Zotero DB source gives for it.
   *
   * @param attachmentKey the Attachment's Indexed Key.
   * @param signal cancels the walk; an answer already committed is discarded.
   */
  async listAnnotations(
    attachmentKey: string,
    signal?: AbortSignal,
  ): Promise<LocalApiResult<readonly LocalApiAnnotation[]>> {
    const state = this.#state;
    if (state.kind !== "available") {
      return { failure: noSessionFailure(state) };
    }
    const parsed = parseIndexedKey(attachmentKey);
    if (!parsed) return { failure: invalid(`attachment key ${attachmentKey}`) };
    const library = libraryPath(parsed);

    const annotations: LocalApiAnnotation[] = [];
    for (;;) {
      const query = new URLSearchParams({
        itemType: "annotation",
        limit: String(PAGE_SIZE),
        start: String(annotations.length),
        // dateAdded never moves, so a page boundary holds still while the walk
        // runs; Zotero's default sort is dateModified, which an edit reorders.
        sort: "dateAdded",
        direction: "asc",
      });
      const reply = await this.#send(
        `/api/${library}/items/${parsed.key}/children?${query.toString()}`,
        { serverID: state.source.serverID, signal },
      );
      if ("failure" in reply) return this.#report(reply);

      const page = readAnnotationPage(reply.value.text, attachmentKey);
      if ("failure" in page) return this.#report(page);
      annotations.push(...page.value);

      const total = totalResults(reply.value.headers);
      if (
        page.value.length < PAGE_SIZE ||
        total === null ||
        annotations.length >= total
      ) {
        logger.debug("Annotations read from the Zotero Local API", {
          attachmentKey,
          annotations: annotations.length,
          serverID: state.source.serverID,
        });
        return { value: annotations.toSorted(byReadingOrder) };
      }
    }
  }

  on<K extends keyof ZoteroLocalApiEvents>(
    event: K,
    cb: ZoteroLocalApiEvents[K],
  ): () => void {
    return this.#emitter.on(event, cb);
  }

  async #load(): Promise<void> {
    await using stack = new AsyncDisposableStack();
    stack.defer(
      this.#localServer.on("db/updated", () => {
        void this.#reprobe("freshness signal", true);
      }),
    );
    stack.defer(
      this.#zoteroPref.on("resolved-changed", () => {
        void this.#reprobe("resolved paths changed", true);
      }),
    );
    this.commit(stack.move());
  }

  /**
   * One Capability Probe, and the announcement it earns.
   *
   * A probe that leaves the same server answering has superseded nothing, so it
   * says nothing: a startup probe against a closed Zotero must not make every
   * surface re-read. What does earn the announcement is a source that appeared,
   * went, or turned out to be another database — and a signal that says the
   * data moved whatever the probe finds.
   *
   * A signal that lands while a probe is already running is coalesced into it
   * rather than dropped, so a Freshness Signal always reaches the partition it
   * invalidates however it is timed against the probe.
   *
   * @param moved whether the trigger itself says this source's records changed,
   *   which is only ever true of the source that is standing.
   */
  async #reprobe(reason: string, moved = false): Promise<void> {
    this.#moved ||= moved;
    const running = this.#probing;
    if (running) return await running;
    const before = this.#serverID;
    const probing = this.#probe(reason).finally(() => {
      this.#probing = null;
    });
    this.#probing = probing;
    await probing;
    const announce = this.#moved;
    this.#moved = false;
    const serverID = this.#serverID;
    if (serverID !== before || (announce && serverID !== null)) {
      this.#emitter.emit("changed");
    }
  }

  get #serverID(): string | null {
    return this.#state.kind === "available"
      ? this.#state.source.serverID
      : null;
  }

  async #probe(reason: string): Promise<void> {
    const previous = this.#state;
    // A re-probe keeps what the last one answered until this one lands, so the
    // Annotation Source does not swap twice for a signal that changed nothing.
    if (previous.kind === "unprobed") this.#state = { kind: "probing" };
    // A library Zotero refused a write to is a session fact the probe is
    // allowed to retire: the group's permissions may well have changed.
    this.#readOnlyLibraries.clear();
    const reply = await this.#send("/api/", {
      serverID: null,
      signal: this.#deadline(),
    });
    this.#state =
      "failure" in reply
        ? { kind: "unavailable", failure: probeFailure(reply.failure) }
        : await this.#sessionFrom(reply.value);
    logger.debug("Zotero Local API probed", {
      reason,
      was: previous.kind,
      state: this.#state,
    });
    this.#emitter.emit("capability-changed");
  }

  /** The session one `GET /api/` answered, or why there is none. */
  async #sessionFrom(reply: ZoteroReply): Promise<ProbeState> {
    const version = reply.headers.get("zotero-api-version");
    if (version !== API_VERSION) {
      return { kind: "unavailable", failure: { kind: "incompatible-zotero" } };
    }
    const serverID = reply.headers.get("zotero-server-id");
    if (serverID === null || !isServerID(serverID)) {
      return {
        kind: "unavailable",
        failure: invalid(`server id ${serverID ?? "absent"}`),
      };
    }
    logger.debug("Zotero answered its local API", {
      serverID,
      schemaVersion: reply.headers.get("zotero-schema-version"),
    });
    // A key belongs to the database that issued it, so one held for another
    // database is dropped rather than spent against this one.
    if (this.#serverID !== null && this.#serverID !== serverID) {
      this.#oneTime = null;
    }
    return {
      kind: "available",
      source: { kind: "zotero-local-api", serverID },
      authorized: await this.#hasKey(serverID),
    };
  }

  /**
   * One authorization gesture, from the probe it starts with to the grant or
   * the refusal it ends on.
   */
  async #authorize(
    signal: AbortSignal,
  ): Promise<LocalApiResult<Authorization>> {
    await this.#reprobe("authorization gesture");
    const state = this.#state;
    if (state.kind !== "available") {
      return { failure: noSessionFailure(state) };
    }
    // An authorization already in hand is the answer; raising Zotero's dialog
    // for it would cost the user a click and spend a rate-limit slot. A
    // One-time Authorization the last gesture won is in hand too, and the
    // gesture that joins it is told what it really holds.
    if (state.authorized) {
      return { value: { remembered: this.#oneTime === null } };
    }

    const cooling = this.#cooling();
    if (cooling) return { failure: cooling };

    const { serverID } = state.source;
    logger.debug("Asking Zotero for a write authorization", { serverID });
    const reply = await this.#send(AUTHORIZE_PATH, {
      serverID,
      signal,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appName: CLIENT_NAME }),
    });
    if ("failure" in reply) return { failure: this.#refused(reply.failure) };

    const grant = readGrant(reply.value.text);
    if ("failure" in grant) return grant;
    return { value: await this.#granted(serverID, grant.value) };
  }

  /**
   * What Zotero granted, kept where its lifetime says it belongs.
   *
   * A remembered grant goes to the keystore and is never held here; a one-time
   * grant is held for the one request that spends it. A keystore that refuses
   * the write leaves the grant standing rather than losing it — the session
   * spends the key once and the next gesture asks again.
   */
  async #granted(
    serverID: string,
    grant: AuthorizationGrant,
  ): Promise<Authorization> {
    if (grant.remember) {
      try {
        await this.#credentials.remember(serverID, grant.key);
        this.#oneTime = null;
        this.#setAuthorized(true);
        return { remembered: true };
      } catch (error) {
        logger.warn("The write authorization could not be remembered", {
          error,
        });
      }
    }
    logger.debug("Zotero granted a one-time write authorization", { serverID });
    this.#oneTime = grant.key;
    this.#setAuthorized(true);
    return { remembered: false };
  }

  /** What a refused authorization leaves behind, beside the failure itself. */
  #refused(failure: LocalApiFailure): LocalApiFailure {
    if (failure.kind === "cooldown") {
      this.#cooldownUntil = this.#now().add(failure.retryAfter);
      this.#emitter.emit("capability-changed");
    }
    logger.debug("Zotero granted no write authorization", {
      failure: failure.kind,
    });
    return failure;
  }

  /** Zotero's dialog cooldown, while one is running. */
  #cooling(): LocalApiFailure | null {
    const until = this.#cooldownUntil;
    if (until === null) return null;
    const now = this.#now();
    if (Temporal.Instant.compare(until, now) <= 0) {
      this.#cooldownUntil = null;
      return null;
    }
    return { kind: "cooldown", retryAfter: now.until(until) };
  }

  /**
   * The key the next authenticated request carries. A One-time Authorization is
   * spent here, by the request that is about to send it, because that is where
   * Zotero spends it too.
   */
  async #takeKey(serverID: string): Promise<string | null> {
    const oneTime = this.#oneTime;
    if (oneTime === null) return await this.#credentials.read(serverID);
    this.#oneTime = null;
    this.#setAuthorized(await this.#hasKey(serverID));
    return oneTime;
  }

  /**
   * What a refused write says about the session: a key Zotero no longer honours
   * is invalidated here and the session returns to "authorization required"; a
   * library that refuses writes is remembered until the next Capability Probe.
   * Everything else is the caller's to interpret.
   */
  async #writeRefused(
    failure: LocalApiFailure,
    library: string,
  ): Promise<void> {
    if (failure.kind === "unauthorized") {
      logger.debug("Zotero no longer honours this write authorization");
      await this.#credentials.forget();
      this.#oneTime = null;
      this.#setAuthorized(false);
      return;
    }
    if (failure.kind === "library-read-only") {
      logger.debug("Zotero refuses writes to this library", { library });
      this.#readOnlyLibraries.add(library);
      this.#emitter.emit("capability-changed");
    }
  }

  /** Whether any key is in hand for `serverID`, one-time or remembered. */
  async #hasKey(serverID: string): Promise<boolean> {
    if (this.#oneTime !== null) return true;
    return (await this.#credentials.read(serverID)) !== null;
  }

  #setAuthorized(authorized: boolean): void {
    const state = this.#state;
    if (state.kind !== "available" || state.authorized === authorized) return;
    this.#state = { ...state, authorized };
    this.#emitter.emit("capability-changed");
  }

  /**
   * A read that failed stands the session down, so the next ask lands on the
   * source that can answer it. Every failure a read can meet says this source
   * is not answering reads — they need no key, so even an authorization-shaped
   * refusal is anomalous — and a database swapped under the port is quarantined
   * rather than adopted mid-flight: the next probe decides.
   *
   * The session is stood down and the change announced before the failure is
   * handed back, so the caller that gets it is already reading a client whose
   * source has gone.
   *
   * A cancelled read says nothing about the session and leaves it standing.
   */
  #report<T>(result: { failure: LocalApiFailure }): LocalApiResult<T> {
    const { failure } = result;
    if (failure.kind === "unknown-outcome") return result;
    logger.debug("The Zotero Local API stopped answering", { failure });
    this.#state = { kind: "unavailable", failure };
    this.#emitter.emit("changed");
    return result;
  }

  /**
   * One request, with the headers every Zotero Local API call carries.
   *
   * @param options.serverID the Zotero database this call is for, sent as the
   *   precondition Zotero answers `412` to when another one holds the port.
   *   The Capability Probe sends none: it is what learns the id.
   * @param options.headers what this one call adds — the API key, a write
   *   token, a version precondition, a content type.
   */
  async #send(
    path: string,
    options: {
      serverID: string | null;
      signal?: AbortSignal;
      method?: string;
      body?: string;
      headers?: Readonly<Record<string, string>>;
    },
  ): Promise<LocalApiResult<ZoteroReply>> {
    const port = this.#zoteroPref.httpPort;
    if (port === null) {
      logger.debug("Zotero runs on a port its profile cannot disclose");
      return { failure: { kind: "unreachable" } };
    }
    const url = `${zoteroOrigin(port)}${path}`;
    const { serverID, signal, method, body } = options;
    try {
      const response = await this.#fetch(url, {
        method,
        body,
        headers: {
          ...NO_CACHE_HEADERS,
          ...(serverID !== null && { "Zotero-Server-ID": serverID }),
          ...options.headers,
        },
        signal,
      });
      const reply: ZoteroReply = {
        status: response.status,
        headers: response.headers,
        text: await response.text(),
      };
      const failure = classifyReply(reply, serverID);
      return failure ? { failure } : { value: reply };
    } catch (error) {
      if (AbortError.test(error))
        return { failure: { kind: "unknown-outcome" } };
      logger.debug("Zotero's HTTP server did not answer", { url, error });
      return { failure: { kind: "unreachable" } };
    }
  }
}

/**
 * The gestures one authorization request serves, and the abandonment that ends
 * it. Zotero's dialog waits for the user, so nothing else may: the request runs
 * until every gesture waiting on it has been abandoned, and a gesture that
 * carries no signal keeps it alive for as long as it takes.
 *
 * @see apps/obsidian/docs/adr/0038-write-authorization-starts-only-from-a-user-gesture.md
 */
class Gestures {
  readonly #controller = new AbortController();
  #waiting = 0;

  get signal(): AbortSignal {
    return this.#controller.signal;
  }

  join(signal: AbortSignal | undefined): void {
    this.#waiting += 1;
    if (signal === undefined) return;
    if (signal.aborted) {
      this.#leave();
      return;
    }
    signal.addEventListener("abort", () => this.#leave(), { once: true });
  }

  #leave(): void {
    this.#waiting -= 1;
    if (this.#waiting > 0) return;
    logger.debug("The authorization gesture was abandoned");
    this.#controller.abort(new AbortError("Authorization gesture abandoned"));
  }
}

/** The library route one Indexed Key names — `users/0`, or one group's. */
function libraryPath({ groupID }: { groupID: number | null }): string {
  return groupID === null ? "users/0" : `groups/${groupID}`;
}

/**
 * Why a read cannot run at all, in the same union a request answers with. A
 * read asked for before any probe has answered reads as unreachable: nothing
 * has yet reached Zotero to say otherwise.
 */
function noSessionFailure(
  state: Exclude<ProbeState, { kind: "available" }>,
): LocalApiFailure {
  return state.kind === "unavailable" ? state.failure : { kind: "unreachable" };
}

/**
 * A probe that was cancelled by its own deadline has learned the same thing a
 * refused connection teaches: Zotero is not answering.
 */
function probeFailure(failure: LocalApiFailure): LocalApiFailure {
  return failure.kind === "unknown-outcome" ? { kind: "unreachable" } : failure;
}

/**
 * Zotero's reading order, which its zero-padded Sort Index sorts as text. The
 * list route sorts by date alone — its `sort` values are a closed set that the
 * Sort Index is not in — so the order is restored here.
 *
 * @see https://github.com/zotero/zotero/blob/22f08d1ceddc8bad5718b3bc6eee9d3ae5dccc2c/chrome/content/zotero/xpcom/server/server_localAPI.js#L341-L348
 */
function byReadingOrder(a: LocalApiAnnotation, b: LocalApiAnnotation): number {
  return a.sortIndex < b.sortIndex ? -1 : a.sortIndex > b.sortIndex ? 1 : 0;
}
