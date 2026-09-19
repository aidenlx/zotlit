// Zotero Local API answers, and the transport that replays them.
//
// PROVENANCE, in two halves.
//
// RECORDED. A Paired Run against Zotero 10.0 (`Zotero-Schema-Version: 44`,
// `Zotero-API-Version: 3`) on 2026-09-16, started with
// `pnpm fixture open --local-api` and driven with `curl --noproxy '*'`,
// recorded the refusals and the item envelope: the header block every answer
// carries, `401`, `403 {"denied":true}`, `412` from another database, `429`
// with its `Retry-After`, the `Total-Results` and `Link` headers of a paged
// list, and the `key` / `version` / `library` fields of an item.
//
// SYNTHESISED. That run recorded **no read of this feature's own routes**:
// there is no capture of `GET /api/` and none of
// `.../items/<key>/children?itemType=annotation`. So the root-route body, every
// `annotation*` field, the paged walk, and the three answers the Fixture could
// not produce — the local API switched off, another API version, a library that
// refuses writes — are built from Zotero's source and the wire contract in the
// Fixture guide. Each builder below says which half it is in, field by field
// where it mixes the two. A capture run promotes them; the ticket's manual
// checks name the builders to promote.
//
// @see docs/fixture.md — "Trial the Zotero Local API"
// @see https://github.com/aidenlx/zotlit/issues/1143

import { vi } from "vitest";

import { createNanoEvents } from "@zotlit/shared/nanoevents";

import type { FetchLike, NodeFetchInit } from "@/lib/node-fetch";
import type { LocalServerEvents } from "@/services/local-server/service";
import type { ZoteroPrefEvents } from "@/services/zotero-pref/service";

import { ZoteroLocalApiClient } from "./service";

/**
 * The server id the recording carried. Zotero generates a fresh one for every
 * database, so a test asserts that a value travels, never that it is this one.
 */
export const SERVER_ID = "A8sf5Zsz8ySw";

/** The Attachment the Fixture's `rougier-2014.pdf` Annotations hang from. */
export const ATTACHMENT_KEY = "RGRPDF24";

/** The free port the recording ran on; the Fixture allocates one per build. */
export const PORT = 61319;

/** Recorded on every answer of the run, whatever its status. */
const API_HEADERS: Readonly<Record<string, string>> = {
  "X-Zotero-Version": "10.0",
  "X-Zotero-Connector-API-Version": "3",
  "Zotero-API-Version": "3",
  "Zotero-Schema-Version": "44",
  "Zotero-Server-ID": SERVER_ID,
};

/** One Annotation as the list route writes it, before anything believes it. */
export interface WireAnnotation {
  key: string;
  version: number;
  type: string;
  color?: string;
  comment?: string;
  text?: string;
  pageLabel?: string;
  sortIndex: string;
  position: unknown;
  parentItem?: string;
  groupID?: number;
  tags?: string[];
  /** ISO 8601 UTC, as Zotero writes it; omitted where an answer names none. */
  dateAdded?: string;
}

/**
 * The seven Annotations the Fixture builds on `rougier-2014.pdf` — one of each
 * of Zotero's six types, with two ink strokes — as the Zotero Local API would
 * describe them. SYNTHESISED: no list read was recorded. Keys, types, colours,
 * Sort Indexes and positions are the Fixture Spec's own rows, which the Zotero
 * DB source answers from as well, so the two sources are comparable record for
 * record; the versions are this fixture's own.
 *
 * RECORDED, on 2026-09-16: every `dateAdded`. A list read of this Attachment
 * against Paired Zotero 10.0 answered these seven keys in this order with these
 * seven stamps, in ISO 8601 UTC at second precision — the form the Uncertain
 * Create window is compared against.
 *
 * @see packages/scripts/lib/fixture/spec.ts — `ANNOTATIONS`
 */
export const ROUGIER_ANNOTATIONS: readonly WireAnnotation[] = [
  {
    key: "PUPR5FG5",
    dateAdded: "2026-08-23T16:17:50Z",
    version: 11,
    type: "highlight",
    text: "Identify Your Message",
    color: "#2ea8e5",
    pageLabel: "1",
    sortIndex: "00000|002041|00170",
    position: { pageIndex: 0, rects: [[265.833, 611.202, 374.503, 620.019]] },
  },
  {
    key: "FDRFQ7C2",
    dateAdded: "2026-08-23T16:18:01Z",
    version: 12,
    type: "image",
    color: "#ffd400",
    pageLabel: "2",
    sortIndex: "00001|001860|00047",
    position: { pageIndex: 1, rects: [[48.75, 395.509, 570, 743.723]] },
  },
  {
    key: "K3JRFLFQ",
    dateAdded: "2026-08-23T16:18:11Z",
    version: 13,
    type: "underline",
    text: "Scientific visualization is classically defined as the process of graphically displaying scientific data.",
    color: "#ff6666",
    pageLabel: "1",
    sortIndex: "00000|000434|00180",
    position: {
      pageIndex: 0,
      rects: [
        [67.011, 612.638, 211.485, 620.77],
        [58.054, 601.98, 211.489, 610.112],
        [58.054, 591.321, 153.781, 599.454],
      ],
    },
  },
  {
    key: "HRK7BG32",
    dateAdded: "2026-08-23T16:18:18Z",
    version: 14,
    type: "text",
    comment: "Making figures is hard :(",
    color: "#a28ae5",
    pageLabel: "1",
    sortIndex: "00000|000191|00088",
    position: {
      pageIndex: 0,
      fontSize: 14,
      rotation: 0,
      rects: [[398.804, 685.107, 560.804, 702.107]],
    },
  },
  {
    key: "C94NJNYG",
    dateAdded: "2026-08-23T16:19:19Z",
    version: 15,
    type: "note",
    comment: "some text comment",
    color: "#ffd400",
    pageLabel: "1",
    sortIndex: "00000|003354|00170",
    position: { pageIndex: 0, rects: [[566.901, 598.393, 588.901, 620.393]] },
  },
  {
    key: "TYY6Z6ZF",
    dateAdded: "2026-08-23T16:20:09Z",
    version: 16,
    type: "ink",
    color: "#5fb236",
    pageLabel: "1",
    sortIndex: "00000|000040|00100",
    position: {
      pageIndex: 0,
      width: 2,
      paths: [[66.964, 674.348, 66.629, 673.26, 66.629, 672.214]],
    },
  },
  {
    key: "4PE492KU",
    dateAdded: "2026-08-23T16:20:12Z",
    version: 17,
    type: "ink",
    color: "#f19837",
    pageLabel: "1",
    sortIndex: "00000|000067|00104",
    position: {
      pageIndex: 0,
      width: 2,
      paths: [[203.571, 673.009, 204.45, 672.256, 205.266, 671.628]],
    },
  },
];

/** What one request carried, so an assertion reads the wire. */
export interface ZoteroRequest {
  url: URL;
  headers: Headers;
  method: string;
  body: string | null;
}

/** The children route a list read walks, as its parts. */
export interface ChildrenRequest {
  /** The Attachment's bare item key, from the path. */
  key: string;
  /** Group library id, or null for the `users/0` route. */
  groupID: number | null;
  start: number;
}

export interface ZoteroAnswers {
  /** `GET /api/` — the Capability Probe. @default a Zotero that answers */
  root?: () => Response | Promise<Response>;
  /**
   * The list route. An answer held as a promise stays in flight until it
   * resolves, or until the caller's signal aborts it.
   *
   * @default an Attachment with no Annotations
   */
  children?: (request: ChildrenRequest) => Response | Promise<Response>;
  /**
   * `POST /api/local/authorize` — Zotero's Write Authorization dialog, as the
   * endpoint reports whichever button the user pressed.
   *
   * @default Allow, a One-time Authorization
   */
  authorize?: (request: ZoteroRequest) => Response | Promise<Response>;
  /**
   * `GET /api/{library}/items/{key}` — the single-item route a write reads the
   * Annotation back through once Zotero has taken it.
   *
   * @default the {@link ZoteroAnswers.write} answer, so a test that never
   *   names it sees whatever that route gives.
   */
  item?: (request: ZoteroRequest) => Response | Promise<Response>;
  /** Every other route: what an authenticated write answers. @default `204` */
  write?: (request: ZoteroRequest) => Response | Promise<Response>;
}

/** `/api/users/0/items/RGRPDF24` and its group form, but not the list routes. */
const ITEM_PATH = /^\/api\/(?:users|groups)\/\d+\/items\/[^/]+$/;

/**
 * The transport seam under the client: a `fetch` that replays answers, and
 * every request it was given.
 */
export function fakeZotero(answers: ZoteroAnswers = {}): {
  fetch: FetchLike;
  requests: ZoteroRequest[];
} {
  const requests: ZoteroRequest[] = [];
  const fetch = vi.fn((input: string | URL, init?: NodeFetchInit) => {
    const url = new URL(input);
    const request: ZoteroRequest = {
      url,
      headers: new Headers(init?.headers),
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? init.body : null,
    };
    requests.push(request);
    init?.signal?.throwIfAborted();
    if (url.pathname === "/api/") {
      return untilAborted((answers.root ?? rootOk)(), init?.signal);
    }
    if (url.pathname === "/api/local/authorize") {
      const authorize = answers.authorize ?? (() => authorized());
      return untilAborted(authorize(request), init?.signal);
    }
    if (url.pathname.endsWith("/children")) {
      const children = answers.children ?? (() => annotationPage([]));
      return untilAborted(children(childrenRequest(url)), init?.signal);
    }
    const write = answers.write ?? (() => writeAccepted());
    if (
      answers.item &&
      request.method === "GET" &&
      ITEM_PATH.test(url.pathname)
    ) {
      return untilAborted(answers.item(request), init?.signal);
    }
    return untilAborted(write(request), init?.signal);
  });
  return { fetch, requests };
}

/** A request in flight fails the moment its caller abandons it, as Node's does. */
function untilAborted(
  answer: Response | Promise<Response>,
  signal: AbortSignal | undefined,
): Promise<Response> {
  if (!signal || answer instanceof Response) return Promise.resolve(answer);
  return Promise.race([
    answer,
    new Promise<never>((_, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), {
        once: true,
      });
    }),
  ]);
}

/**
 * `GET /api/`, the Capability Probe. SYNTHESISED: no probe was recorded. The
 * header block is the recorded one; the body is the literal Zotero's root
 * endpoint returns. That route is the one endpoint that serves a caller asking
 * for another API version, so its `Zotero-API-Version` header is the gate.
 *
 * @see https://github.com/zotero/zotero/blob/22f08d1ceddc8bad5718b3bc6eee9d3ae5dccc2c/chrome/content/zotero/xpcom/server/server_localAPI.js#L803-L811
 */
export function rootOk(
  headers: Readonly<Record<string, string>> = {},
): Response {
  return new Response("Nothing to see here.", {
    status: 200,
    headers: { ...API_HEADERS, "Content-Type": "text/plain", ...headers },
  });
}

/**
 * One page of the list route. RECORDED: the header block, `Total-Results`, and
 * the `Link` a paged answer carries — replayed because Zotero sends it, though
 * the page walk ends on `Total-Results` and never reads it. SYNTHESISED: the
 * items, and the paging arithmetic of a route no capture covers.
 *
 * @param options.total the whole count the search matched. @default the page length
 * @param options.start where this page begins, which its `Link` names.
 * @param options.serverID the database answering. @default {@link SERVER_ID}
 */
export function annotationPage(
  annotations: readonly WireAnnotation[],
  options: {
    total?: number;
    start?: number;
    parentItem?: string;
    serverID?: string;
  } = {},
): Response {
  const { total = annotations.length, start = 0 } = options;
  const parentItem = options.parentItem ?? ATTACHMENT_KEY;
  const next = start + annotations.length;
  const base = "http://127.0.0.1:61319/api/users/0/items/RGRPDF24/children";
  return new Response(
    JSON.stringify(annotations.map((it) => wireItem(it, parentItem))),
    {
      status: 200,
      headers: {
        ...API_HEADERS,
        ...(options.serverID !== undefined && {
          "Zotero-Server-ID": options.serverID,
        }),
        "Content-Type": "application/json",
        "Last-Modified-Version": "4",
        "Total-Results": String(total),
        Link: `<${base}?start=${next}>; rel="next"`,
      },
    },
  );
}

/**
 * One Annotation from the single-item route. SYNTHESISED, on the same terms as
 * {@link annotationPage}: the envelope is the recorded one, the
 * `annotation*` fields are not.
 */
export function annotationItem(
  annotation: WireAnnotation,
  options: { parentItem?: string } = {},
): Response {
  const parentItem = options.parentItem ?? ATTACHMENT_KEY;
  return new Response(JSON.stringify(wireItem(annotation, parentItem)), {
    status: 200,
    headers: { ...API_HEADERS, "Content-Type": "application/json" },
  });
}

/**
 * CONTRACT-DERIVED — `200` from the multi-object write route, the indexed
 * result a create answers with. The envelope is the one Zotero's own handler
 * builds; the Annotation inside it is this fixture's.
 *
 * @param options.parentItem the Attachment the answer says it hangs from.
 * @see https://github.com/zotero/zotero/blob/22f08d1ceddc8bad5718b3bc6eee9d3ae5dccc2c/chrome/content/zotero/xpcom/server/server_localAPI.js#L1919-L1972
 */
export function createAccepted(
  annotation: WireAnnotation,
  options: { parentItem?: string } = {},
): Response {
  const parentItem = options.parentItem ?? ATTACHMENT_KEY;
  return new Response(
    JSON.stringify({
      successful: { 0: wireItem(annotation, parentItem) },
      success: { 0: annotation.key },
      unchanged: {},
      failed: {},
    }),
    {
      status: 200,
      headers: {
        ...API_HEADERS,
        "Content-Type": "application/json",
        "Last-Modified-Version": String(annotation.version),
      },
    },
  );
}

/**
 * CONTRACT-DERIVED — `200` whose one object Zotero refused. A multi-object
 * write reports each object's own outcome, so a `200` is not a success.
 */
export function createRefused(
  code = 400,
  message = "Invalid annotationSortIndex",
): Response {
  return new Response(
    JSON.stringify({
      successful: {},
      success: {},
      unchanged: {},
      failed: { 0: { key: "", code, message } },
    }),
    {
      status: 200,
      headers: { ...API_HEADERS, "Content-Type": "application/json" },
    },
  );
}

/**
 * RECORDED — `404 Not found`, which a `DELETE` and a single-item `GET` both
 * answer for an object Zotero no longer holds. Driven against Paired Zotero
 * 10.0 on 2026-09-16 by erasing `R25HRAM9` in Zotero and writing to it.
 *
 * Two corrections the same probe established, both recorded rather than
 * inferred: the **list** route answers an empty list, but the **single-item**
 * route answers this, so a read can meet a `404` after all; and a `PATCH` of a
 * deleted object answers `400 itemType property not provided` rather than
 * `404`, because Zotero's single-object patch route treats a missing object as
 * a new one.
 *
 * @see https://github.com/zotero/zotero/blob/22f08d1ceddc8bad5718b3bc6eee9d3ae5dccc2c/chrome/content/zotero/xpcom/server/server_localAPI.js#L2305-L2312
 */
export function notFound(): Response {
  return new Response("Not found", {
    status: 404,
    headers: { ...API_HEADERS, "Content-Type": "text/plain" },
  });
}

/** RECORDED — `412`, the answer a read gets when another database holds the port. */
export function serverChanged(serverID = "Zzzz11119999"): Response {
  return new Response("Zotero-Server-ID does not match this server", {
    status: 412,
    headers: {
      ...API_HEADERS,
      "Zotero-Server-ID": serverID,
      "Content-Type": "text/plain",
    },
  });
}

/** RECORDED — `401`, which carries no server id and no API version. */
export function unauthorized(): Response {
  return new Response(
    "API key required -- POST /api/local/authorize to obtain one",
    {
      status: 401,
      headers: {
        "X-Zotero-Version": "10.0",
        "Content-Type": "text/plain",
        "WWW-Authenticate": 'Zotero-API-Key realm="Zotero Local API"',
      },
    },
  );
}

/**
 * RECORDED — `429` from the authorization route, which is where Zotero's dialog
 * rate limit lives; the recording carried `Retry-After: 60`, its own window.
 *
 * @param options.retryAfter seconds to name, or null to send none.
 *   @default 60, as recorded
 */
export function rateLimited(
  options: { retryAfter?: number | null } = {},
): Response {
  const { retryAfter = 60 } = options;
  return new Response("Too many authorization requests", {
    status: 429,
    headers: {
      ...API_HEADERS,
      "Content-Type": "text/plain",
      ...(retryAfter !== null && { "Retry-After": String(retryAfter) }),
    },
  });
}

/** RECORDED — `403 {"denied":true}`, the answer to a refused dialog. */
export function denied(): Response {
  return new Response('{"denied":true}', {
    status: 403,
    headers: { ...API_HEADERS, "Content-Type": "application/json" },
  });
}

/**
 * RECORDED — `200` from the authorize route, the answer to a granted dialog.
 * The recording drove all four dialog outcomes against Zotero 10.0 and found
 * three of them here: Allow (`remember: false`), Always Allow (`remember:
 * true`), and **a dismissed dialog, which answers `remember: true` as well**.
 * Gecko records slot 1 as the result of any close that is not a button press,
 * and Zotero maps slot 1 to Always Allow, so closing the dialog grants a
 * persistent key rather than refusing. Only Deny answers {@link denied}.
 *
 * @param options.remember what Zotero reported. @default false, an Allow
 * @param options.key the 32-character key. @default the recorded Allow key
 */
export function authorized(
  options: { remember?: boolean; key?: string } = {},
): Response {
  const { remember = false } = options;
  const key =
    options.key ??
    (remember
      ? "5ixBzUhQfLu8i8RIhU6OEzENW4pAITLf"
      : "zaxj2JbsV79sbQDXS7REpa3Z3kRDIory");
  return new Response(JSON.stringify({ key, remember }), {
    status: 200,
    headers: { ...API_HEADERS, "Content-Type": "application/json" },
  });
}

/**
 * RECORDED — `204`, what an accepted write answers. `Last-Modified-Version` is
 * the library version after the write, not the object's previous plus one.
 *
 * @param version the library version Zotero reported. @default 5, as recorded
 */
export function writeAccepted(version = 5): Response {
  return new Response(null, {
    status: 204,
    headers: {
      ...API_HEADERS,
      "Last-Modified-Version": String(version),
      "Content-Length": "0",
    },
  });
}

/**
 * RECORDED — the second `401` body: a key Zotero no longer holds, because it
 * was single-use and has been spent, or because the user cleared write
 * authorizations. Like {@link unauthorized} it carries no server id and no API
 * version, and unlike it there is no `WWW-Authenticate` challenge.
 */
export function keyRejected(): Response {
  return new Response("Invalid or expired API key", {
    status: 401,
    headers: {
      "X-Zotero-Version": "10.0",
      "Content-Type": "text/plain",
    },
  });
}

/**
 * RECORDED — `412` from this database: the object moved since it was read. The
 * key that carried the request is spent all the same, which is why this answer
 * appears in a test about a One-time Authorization.
 *
 * This is the **header** precondition's wording, which a `DELETE` produces. A
 * `PATCH`, whose precondition is in the body, answers `item version mismatch:
 * expected 0, found 2` — also recorded on 2026-09-16, and also a Write
 * Conflict: neither body names a server id or a write token.
 */
export function staleVersion(): Response {
  return new Response(
    "item has been modified since specified version (expected 4, found 7)",
    {
      status: 412,
      headers: { ...API_HEADERS, "Content-Type": "text/plain" },
    },
  );
}

/**
 * RECORDED — `412 Write token already used`, the third `412` body. A create was
 * sent twice on one `Zotero-Write-Token` against Paired Zotero 10.0 on
 * 2026-09-16: the first answered `200` and made `R25HRAM9`, the second answered
 * this. It distinguishes token reuse from an object-version conflict.
 *
 * @see https://github.com/zotero/zotero/blob/22f08d1ceddc8bad5718b3bc6eee9d3ae5dccc2c/chrome/content/zotero/xpcom/server/server_localAPI.js#L695-L704
 */
/**
 * RECORDED — the other `412` a moved object answers, from the **body**
 * precondition a `PATCH` sends. Driven against Paired Zotero 10.0 on
 * 2026-09-16 by recolouring `PUPR5FG5` in Zotero and patching it at version 0.
 */
export function staleVersionPatch(): Response {
  return new Response("item version mismatch: expected 0, found 2", {
    status: 412,
    headers: { ...API_HEADERS, "Content-Type": "text/plain" },
  });
}

export function writeTokenUsed(): Response {
  return new Response("Write token already used", {
    status: 412,
    headers: { ...API_HEADERS, "Content-Type": "text/plain" },
  });
}

/**
 * The Remembered Write Authorization in memory, which is what a state-machine
 * test drives the client over. It models the one rule the real record has that
 * a plain map does not: a key is bound to the database that granted it, and a
 * record naming another one is left alone rather than cleared.
 */
export function inMemoryCredentials(
  initial: { serverID: string; key: string } | null = null,
) {
  let record: { serverID: string; key?: string } | null = initial && {
    ...initial,
  };
  const writes: ({ serverID: string; key?: string } | null)[] = [];
  return {
    /** What the store holds now, as an oracle independent of the client. */
    get record() {
      return record;
    },
    /** Every write in order, so a test can see a keyless overwrite happen. */
    writes,
    read: vi.fn((serverID: string) =>
      Promise.resolve(
        record && record.serverID === serverID ? (record.key ?? null) : null,
      ),
    ),
    has: vi.fn(() => Promise.resolve(record?.key !== undefined)),
    remember: vi.fn((serverID: string, key: string) => {
      record = { serverID, key };
      writes.push({ ...record });
      return Promise.resolve();
    }),
    forget: vi.fn(() => {
      if (record !== null) {
        record = { serverID: record.serverID };
        writes.push({ ...record });
      }
      return Promise.resolve();
    }),
  };
}

/**
 * CONTRACT-DERIVED — the refusal every endpoint answers before it reads
 * anything else, while `httpServer.localAPI.enabled` is off. The Fixture opens
 * the local API, so this answer was not recorded from it.
 *
 * @see https://github.com/zotero/zotero/blob/22f08d1ceddc8bad5718b3bc6eee9d3ae5dccc2c/chrome/content/zotero/xpcom/server/server_localAPI.js#L247-L250
 */
export function localApiDisabled(): Response {
  return new Response("Local API is not enabled", {
    status: 403,
    headers: { ...API_HEADERS, "Content-Type": "text/plain" },
  });
}

/**
 * CONTRACT-DERIVED — `501`, which every data route answers to an API version
 * that is not 3.
 *
 * @see https://github.com/zotero/zotero/blob/22f08d1ceddc8bad5718b3bc6eee9d3ae5dccc2c/chrome/content/zotero/xpcom/server/server_localAPI.js#L269-L279
 */
export function incompatibleZotero(): Response {
  return new Response("API version not implemented: 4", {
    status: 501,
    headers: { ...API_HEADERS, "Content-Type": "text/plain" },
  });
}

/**
 * CONTRACT-DERIVED — `403 Write access denied`, which a library that is not
 * editable answers a write with. Reads never produce it; the client classifies
 * it so the write path (aidenlx/zotlit#1145) reads one union.
 *
 * @see https://github.com/zotero/zotero/blob/22f08d1ceddc8bad5718b3bc6eee9d3ae5dccc2c/chrome/content/zotero/xpcom/server/server_localAPI.js#L315-L318
 */
export function libraryReadOnly(): Response {
  return new Response("Write access denied", {
    status: 403,
    headers: { ...API_HEADERS, "Content-Type": "text/plain" },
  });
}

/** A connection that nothing answered, as `nodeFetch` reports one. */
export function unreachable(): never {
  throw new TypeError("fetch failed", { cause: new Error("ECONNREFUSED") });
}

export interface ClientOptions {
  /** A Remembered Write Authorization for the session's server, if any. */
  key?: string;
  /** The deadline a Capability Probe runs under. @default one that never fires */
  probeDeadline?: () => AbortSignal;
  /** The clock the dialog cooldown is read against. @default {@link NOW} */
  now?: () => Temporal.Instant;
}

/** The instant a test's clock stands at unless it says otherwise. */
export const NOW = Temporal.Instant.from("2026-09-16T15:52:21Z");

/**
 * The client over a fake transport, with the two event sources it subscribes to
 * in the caller's hands. The probe's own deadline never fires unless a test
 * hands one over, so no test waits on a real clock.
 */
export function localApiClient(
  answers: ZoteroAnswers = {},
  options: ClientOptions = {},
) {
  const { fetch, requests } = fakeZotero(answers);
  const prefEvents = createNanoEvents<ZoteroPrefEvents>();
  const serverEvents = createNanoEvents<LocalServerEvents>();
  const credentials = inMemoryCredentials(
    options.key === undefined
      ? null
      : { serverID: SERVER_ID, key: options.key },
  );
  const client = new ZoteroLocalApiClient({
    fetch,
    zoteroPref: {
      httpPort: PORT,
      on: <K extends keyof ZoteroPrefEvents>(
        event: K,
        cb: ZoteroPrefEvents[K],
      ) => prefEvents.on(event, cb),
    },
    localServer: {
      on: <K extends keyof LocalServerEvents>(
        event: K,
        cb: LocalServerEvents[K],
      ) => serverEvents.on(event, cb),
    },
    credentials,
    probeDeadline:
      options.probeDeadline ?? (() => new AbortController().signal),
    now: options.now ?? (() => NOW),
  });
  return { client, requests, credentials, prefEvents, serverEvents };
}

/** The Companion's Freshness Signal, as the Local Server delivers it. */
export function freshnessSignal(
  serverEvents: ReturnType<typeof localApiClient>["serverEvents"],
): void {
  serverEvents.emit("db/updated", { event: "db/updated" });
}

/**
 * One item of a list answer.
 *
 * RECORDED, from the single-item read: that an item carries `key`, `version`
 * and `library` beside its `data`, and that `library` is
 * `{ type, id, name }`. The recorded item also carries `links` and `meta`,
 * which this client never reads and this builder therefore omits — a replay of
 * the fields under test, not a copy of the answer.
 *
 * SYNTHESISED: every `data.annotation*` field, and `data.tags`, none of which
 * the recorded run's single-item read covers.
 */
function wireItem(
  annotation: WireAnnotation,
  parentItem: string,
): Record<string, unknown> {
  const library =
    annotation.groupID === undefined
      ? { type: "user", id: 0, name: "My Library" }
      : { type: "group", id: annotation.groupID, name: "Shared" };
  return {
    key: annotation.key,
    version: annotation.version,
    library,
    data: {
      key: annotation.key,
      version: annotation.version,
      itemType: "annotation",
      parentItem: annotation.parentItem ?? parentItem,
      annotationType: annotation.type,
      ...(annotation.text !== undefined && { annotationText: annotation.text }),
      annotationComment: annotation.comment ?? "",
      ...(annotation.color !== undefined && {
        annotationColor: annotation.color,
      }),
      annotationPageLabel: annotation.pageLabel ?? "",
      annotationSortIndex: annotation.sortIndex,
      annotationPosition: JSON.stringify(annotation.position),
      ...(annotation.dateAdded !== undefined && {
        dateAdded: annotation.dateAdded,
      }),
      ...(annotation.tags !== undefined && {
        tags: annotation.tags.map((tag) => ({ tag })),
      }),
    },
  };
}

function childrenRequest(url: URL): ChildrenRequest {
  const parts = url.pathname.split("/");
  return {
    key: parts[5] ?? "",
    groupID: parts[2] === "groups" ? Number(parts[3]) : null,
    start: Number(url.searchParams.get("start") ?? 0),
  };
}
