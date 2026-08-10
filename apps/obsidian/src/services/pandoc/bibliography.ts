// Live bibliography data for the built-in export: Better BibTeX when its
// endpoint answers, else Zotero's local HTTP API, else a guided error.
//
// Both sources speak to the same Zotero HTTP server, so a connection failure
// means Zotero is closed rather than that one source is unavailable. Failure
// codes name the situation; the export UI owns the wording that guides the user
// out of it.

import { formatIndexedKey } from "@zotlit/db";
import type { CslItemData } from "@zotlit/db";

import { getLogger } from "@/lib/log";

const logger = getLogger(["pandoc", "bibliography"]);

/** Zotero's `httpServer.port` default — ascii "ZO". */
export const ZOTERO_HTTP_PORT = 23119;

/** Where Zotero's HTTP server listens. */
const ZOTERO_ORIGIN = `http://127.0.0.1:${ZOTERO_HTTP_PORT}`;

/** Pref that opens Zotero's local HTTP API; Zotero ships it off. */
export const LOCAL_API_PREF = "httpServer.localAPI.enabled";

/** Endpoint Better BibTeX registers on Zotero's HTTP server. */
const JSON_RPC_PATH = "/better-bibtex/json-rpc";

/** Better BibTeX's Better CSL JSON translator, which writes `id` from the citation key. */
const BETTER_CSL_JSON = "f4b52ab0-f878-4556-85a0-c7aeedd09dfc";

/**
 * Zotero refuses requests it reads as browser traffic — and Obsidian's
 * `requestUrl` carries a Chromium user agent — unless they carry this header.
 */
const ALLOWED_REQUEST: Readonly<Record<string, string>> = {
  "Zotero-Allowed-Request": "1",
};

/** Which source answered, or produced, a result. */
export type BibliographySource = "better-bibtex" | "local-api";

/** One Zotero Item to cite, in the identities the two sources address it by. */
export interface BibliographyItemRef {
  /** Bare Zotero item key. */
  itemKey: string;
  /** Numeric Zotero library ID — how Better BibTeX names a library. */
  libraryID: number;
  /** Group library ID, or `null` for the personal library — the local API route. */
  groupID: number | null;
}

export interface BibliographyHttpRequest {
  url: string;
  method: "GET" | "POST";
  headers: Record<string, string>;
  body?: string;
}

export interface BibliographyHttpResponse {
  status: number;
  text: string;
}

/**
 * One HTTP round trip. Resolves with whatever status Zotero answered, however
 * unhappy; rejects only when the connection itself failed, which is how a
 * closed Zotero announces itself.
 */
export type BibliographyTransport = (
  request: BibliographyHttpRequest,
) => Promise<BibliographyHttpResponse>;

export interface BibliographyPorts {
  request: BibliographyTransport;
  /**
   * Zotero's {@link LOCAL_API_PREF} pref, read from `prefs.js` before any
   * request, so a disabled local API is reported as such instead of as a
   * refused read.
   */
  localApiEnabled: boolean;
}

export type BibliographyFailure =
  /** Nothing answered on Zotero's port. Guidance: start Zotero. */
  | { code: "zotero-not-running"; port: number }
  /** Zotero runs with its local API off. Guidance: turn {@link pref} on. */
  | { code: "local-api-disabled"; pref: string }
  /** The chosen source answered, and refused. */
  | { code: "source-failed"; source: BibliographySource; detail: string }
  /** Items the source returned nothing for, as Indexed Keys. */
  | { code: "items-missing"; source: BibliographySource; indexedKeys: string[] }
  /** Items Better BibTeX holds no citation key for, as Indexed Keys. */
  | { code: "citation-key-missing"; indexedKeys: string[] };

/**
 * Every requested item as CSL-JSON, keyed by Indexed Key, or the one failure
 * that stopped the export. `source` is `null` only when nothing was requested.
 */
export type BibliographyResult =
  | {
      source: BibliographySource | null;
      items: ReadonlyMap<string, CslItemData>;
    }
  | { error: BibliographyFailure };

/**
 * Fetch bibliographic data for the Items an export cites, live from Zotero.
 *
 * Better BibTeX wins when its endpoint answers, so its citation keys and Extra
 * overrides are honored; Zotero's local API is the baseline. Each item keeps
 * the CSL `id` its source gave it — the native citation key when populated, the
 * item URI otherwise — so a wikilink can cite an Item that has no citation key.
 *
 * All-or-nothing: one unresolved item fails the whole request, and no partial
 * bibliography is returned.
 */
export async function fetchBibliography(
  refs: readonly BibliographyItemRef[],
  ports: BibliographyPorts,
): Promise<BibliographyResult> {
  if (refs.length === 0) return { source: null, items: new Map() };

  const probe = await callJsonRpc(ports, "api.ready", []);
  if (probe.ok) return fromBetterBibtex(refs, ports);
  if (probe.reason === "unreachable") return { error: notRunning() };
  logger.debug("Better BibTeX did not answer; falling back to the local API");
  return fromLocalApi(refs, ports);
}

/**
 * `item.citationkey` maps the item keys to citation keys, then one
 * `item.export` per library renders those keys as Better CSL JSON. The export
 * is indexed by library and citation key, which is the `id` Better CSL JSON
 * writes.
 */
async function fromBetterBibtex(
  refs: readonly BibliographyItemRef[],
  ports: BibliographyPorts,
): Promise<BibliographyResult> {
  const lookup = await callJsonRpc(ports, "item.citationkey", [
    refs.map(rpcItemKey),
  ]);
  if (!lookup.ok) return { error: rpcFailure(lookup) };

  const table = asRecord(lookup.result);
  const cited: { ref: BibliographyItemRef; citationKey: string }[] = [];
  const keyless: string[] = [];
  for (const ref of refs) {
    const citationKey = table[rpcItemKey(ref)];
    if (typeof citationKey === "string" && citationKey) {
      cited.push({ ref, citationKey });
    } else {
      keyless.push(indexedKeyOf(ref));
    }
  }
  if (keyless.length > 0) {
    return { error: { code: "citation-key-missing", indexedKeys: keyless } };
  }

  const entries = new Map<string, CslItemData>();
  for (const [libraryID, group] of groupBy(cited, (c) => c.ref.libraryID)) {
    const exported = await callJsonRpc(ports, "item.export", [
      group.map((c) => c.citationKey),
      BETTER_CSL_JSON,
      libraryID,
    ]);
    if (!exported.ok) return { error: rpcFailure(exported) };
    for (const item of asCslItems(exported.result)) {
      entries.set(citationAddress(libraryID, item.id), item);
    }
  }

  return join(
    "better-bibtex",
    cited.map((c) => [
      indexedKeyOf(c.ref),
      entries.get(citationAddress(c.ref.libraryID, c.citationKey)),
    ]),
  );
}

/**
 * One multi-item read per library: `users/0` for the personal library, the
 * group route for a group library.
 */
async function fromLocalApi(
  refs: readonly BibliographyItemRef[],
  ports: BibliographyPorts,
): Promise<BibliographyResult> {
  if (!ports.localApiEnabled) return { error: localApiDisabled() };

  const entries = new Map<string, CslItemData>();
  for (const [groupID, group] of groupBy(refs, (ref) => ref.groupID)) {
    const query = new URLSearchParams({
      itemKey: group.map((ref) => ref.itemKey).join(","),
      include: "csljson",
    });
    const library = groupID === null ? "users/0" : `groups/${groupID}`;
    const response = await send(ports, {
      url: `${ZOTERO_ORIGIN}/api/${library}/items?${query.toString()}`,
      method: "GET",
      headers: { ...ALLOWED_REQUEST },
    });
    if (!response) return { error: notRunning() };
    if (response.status === 403) return { error: localApiDisabled() };
    if (response.status !== 200) {
      return {
        error: {
          code: "source-failed",
          source: "local-api",
          detail: `${response.status} ${response.text.trim()}`,
        },
      };
    }
    for (const entry of asArray(parseJson(response.text))) {
      const key = asRecord(entry)["key"];
      if (typeof key !== "string") continue;
      const [item] = asCslItems(asRecord(entry)["csljson"]);
      if (item) entries.set(formatIndexedKey(key, groupID), item);
    }
  }

  return join(
    "local-api",
    refs.map((ref) => [indexedKeyOf(ref), entries.get(indexedKeyOf(ref))]),
  );
}

/**
 * Re-index the source's answer by Indexed Key. An item the source returned
 * nothing for fails the whole request, so no partial bibliography escapes.
 */
function join(
  source: BibliographySource,
  resolved: readonly (readonly [
    indexedKey: string,
    item: CslItemData | undefined,
  ])[],
): BibliographyResult {
  const items = new Map<string, CslItemData>();
  const missing: string[] = [];
  for (const [indexedKey, item] of resolved) {
    if (item) items.set(indexedKey, item);
    else missing.push(indexedKey);
  }
  return missing.length > 0
    ? { error: { code: "items-missing", source, indexedKeys: missing } }
    : { source, items };
}

type RpcOutcome =
  | { ok: true; result: unknown }
  /** Nothing answered on Zotero's port. */
  | { ok: false; reason: "unreachable" }
  /** Zotero answered, but no JSON-RPC reply came back. */
  | { ok: false; reason: "absent" }
  | { ok: false; reason: "error"; message: string };

/**
 * Better BibTeX answers 200 with a JSON-RPC error body for a call it refuses,
 * so the reply shape — not the status — tells the two apart.
 */
async function callJsonRpc(
  ports: BibliographyPorts,
  method: string,
  params: readonly unknown[],
): Promise<RpcOutcome> {
  const response = await send(ports, {
    url: `${ZOTERO_ORIGIN}${JSON_RPC_PATH}`,
    method: "POST",
    headers: { ...ALLOWED_REQUEST, "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
  });
  if (!response) return { ok: false, reason: "unreachable" };
  if (response.status !== 200) return { ok: false, reason: "absent" };

  const body = asRecord(parseJson(response.text));
  if ("result" in body) return { ok: true, result: body["result"] };
  if (!("error" in body)) return { ok: false, reason: "absent" };
  const message = asRecord(body["error"])["message"];
  return {
    ok: false,
    reason: "error",
    message: typeof message === "string" ? message : "Unknown error",
  };
}

function rpcFailure(
  outcome: Extract<RpcOutcome, { ok: false }>,
): BibliographyFailure {
  if (outcome.reason === "unreachable") return notRunning();
  return {
    code: "source-failed",
    source: "better-bibtex",
    detail:
      outcome.reason === "error"
        ? outcome.message
        : "Better BibTeX stopped answering its JSON-RPC endpoint",
  };
}

/** `null` when the connection failed, which is a closed Zotero. */
async function send(
  ports: BibliographyPorts,
  request: BibliographyHttpRequest,
): Promise<BibliographyHttpResponse | null> {
  try {
    return await ports.request(request);
  } catch (error) {
    logger.debug("Zotero's HTTP server did not answer", {
      url: request.url,
      error,
    });
    return null;
  }
}

function notRunning(): BibliographyFailure {
  return { code: "zotero-not-running", port: ZOTERO_HTTP_PORT };
}

function localApiDisabled(): BibliographyFailure {
  return { code: "local-api-disabled", pref: LOCAL_API_PREF };
}

/** Better BibTeX's `[libraryID]:[itemKey]` item address. */
function rpcItemKey(ref: BibliographyItemRef): string {
  return `${ref.libraryID}:${ref.itemKey}`;
}

/**
 * Better BibTeX keeps a citation key unique within its library, so two
 * libraries can hold the same one. Address an exported item by both.
 */
function citationAddress(libraryID: number, citationKey: string): string {
  return `${libraryID}:${citationKey}`;
}

function indexedKeyOf(ref: BibliographyItemRef): string {
  return formatIndexedKey(ref.itemKey, ref.groupID);
}

/** One entry per library, so each library takes exactly one request. */
function groupBy<T, K>(items: readonly T[], key: (item: T) => K): Map<K, T[]> {
  const groups = new Map<K, T[]>();
  for (const item of items) {
    const group = groups.get(key(item));
    if (group) group.push(item);
    else groups.set(key(item), [item]);
  }
  return groups;
}

/**
 * Both sources hand back a CSL translator's own output — the JSON array text it
 * wrote — so one helper covers `item.export`'s result and the local API's
 * `csljson` field.
 */
function asCslItems(value: unknown): CslItemData[] {
  return typeof value === "string"
    ? asArray(parseJson(value)).filter(isCslItem)
    : [];
}

function isCslItem(value: unknown): value is CslItemData {
  return typeof asRecord(value)["id"] === "string";
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? (value as unknown[]) : [];
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}
