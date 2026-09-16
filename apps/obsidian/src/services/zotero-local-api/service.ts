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
  classifyReply,
  invalid,
  isServerID,
  NO_CACHE_HEADERS,
  readAnnotationPage,
  totalResults,
} from "./wire";
import type {
  LocalApiAnnotation,
  LocalApiFailure,
  LocalApiResult,
  ZoteroReply,
} from "./wire";

export type {
  LocalApiAnnotation,
  LocalApiFailure,
  LocalApiResult,
} from "./wire";

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
      /** Whether a Remembered Write Authorization exists for {@link source}. */
      authorized: boolean;
    }
  | { kind: "unavailable"; failure: LocalApiFailure };

export interface ZoteroLocalApiEvents {
  /**
   * What this source answers may have moved: a probe that changed the
   * capability, a Zotero database swapped under the port, or the Companion's
   * Freshness Signal. A consumer drops what it holds from this source and
   * reads again; nothing here says which records changed.
   */
  changed: () => void;
}

/**
 * The Remembered Write Authorization, read fresh on every probe rather than
 * held, so a grant cleared in Zotero is noticed. aidenlx/zotlit#1144 owns the
 * record, its storage, and everything that writes one.
 *
 * @see apps/obsidian/docs/adr/0037-a-remembered-authorization-is-a-per-device-secret-bound-to-the-zotero-server-id.md
 */
export interface WriteAuthorizationStore {
  /**
   * @param serverID the Zotero database the key must be bound to.
   * @returns the remembered key, or null where none is remembered for it.
   */
  read(serverID: string): Promise<string | null>;
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
  readonly #emitter = createNanoEvents<ZoteroLocalApiEvents>();

  #state: ProbeState = { kind: "unprobed" };
  /** The probe in flight, so concurrent demands cost one request. */
  #probing: Promise<void> | null = null;
  /** A Freshness Signal that arrived while that probe ran, still to announce. */
  #moved = false;

  ready: Promise<void>;

  constructor({
    fetch,
    zoteroPref,
    localServer,
    credentials,
    probeDeadline = () =>
      AbortSignal.timeout(PROBE_TIMEOUT.total("milliseconds")),
  }: ZoteroLocalApiDeps) {
    super();
    this.#fetch = fetch;
    this.#zoteroPref = zoteroPref;
    this.#localServer = localServer;
    this.#credentials = credentials;
    this.#deadline = probeDeadline;
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
    const library =
      parsed.groupID === null ? "users/0" : `groups/${parsed.groupID}`;

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
    return {
      kind: "available",
      source: { kind: "zotero-local-api", serverID },
      authorized: (await this.#credentials.read(serverID)) !== null,
    };
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
   */
  async #send(
    path: string,
    options: {
      serverID: string | null;
      signal?: AbortSignal;
    },
  ): Promise<LocalApiResult<ZoteroReply>> {
    const port = this.#zoteroPref.httpPort;
    if (port === null) {
      logger.debug("Zotero runs on a port its profile cannot disclose");
      return { failure: { kind: "unreachable" } };
    }
    const url = `${zoteroOrigin(port)}${path}`;
    const { serverID, signal } = options;
    try {
      const response = await this.#fetch(url, {
        headers: {
          ...NO_CACHE_HEADERS,
          ...(serverID !== null && { "Zotero-Server-ID": serverID }),
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
