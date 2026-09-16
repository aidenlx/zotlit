// The Zotero Local API's wire format: what one answer means, and what a record
// must satisfy before anything believes it.

import * as v from "valibot";

import {
  formatIndexedKey,
  isItemKey,
  parseAnnotationPosition,
} from "@zotlit/db";
import type {
  AnnotationPosition,
  AnnotationPositionRaw,
  ResolvedAnnotationTypeName,
} from "@zotlit/db";

import { parseJson, ZOTERO_ALLOWED_REQUEST } from "@/lib/zotero-http";

/**
 * The one API version this client speaks. A data route answers `501` to any
 * other, and the root route answers its own version in a header — those two are
 * the whole compatibility gate, and the schema version is only logged.
 *
 * @see https://github.com/zotero/zotero/blob/22f08d1ceddc8bad5718b3bc6eee9d3ae5dccc2c/chrome/content/zotero/xpcom/server/server_localAPI.js#L271-L278
 */
export const API_VERSION = "3";

/**
 * Added to every version-sensitive read, so a repeated `GET` reaches Zotero
 * rather than a cache that cannot know the library moved — beside the header
 * that gets the call past Zotero's browser-traffic guard, and the version gate.
 */
export const NO_CACHE_HEADERS: Readonly<Record<string, string>> = {
  ...ZOTERO_ALLOWED_REQUEST,
  "Zotero-API-Version": API_VERSION,
  "Cache-Control": "no-cache",
};

/**
 * Zotero's 12-character per-database server id, `Zotero.Utilities.randomString`
 * over an alphanumeric alphabet.
 *
 * @see https://github.com/zotero/zotero/blob/22f08d1ceddc8bad5718b3bc6eee9d3ae5dccc2c/chrome/content/zotero/xpcom/server/server_localAPI.js#L770-L789
 */
const SERVER_ID_RE = /^[0-9A-Za-z]{12}$/;

/** Zotero's own colour rule, anchored and lower case as the client applies it. */
const COLOR_RE = /^#[0-9a-f]{6}$/;

/**
 * The three Sort Index formats Zotero validates a write against: PDF, EPUB, and
 * HTML snapshot. Each is zero-padded so that text order is reading order.
 *
 * @see https://github.com/zotero/zotero/blob/22f08d1ceddc8bad5718b3bc6eee9d3ae5dccc2c/chrome/content/zotero/xpcom/data/item.js#L4521-L4544
 */
const SORT_INDEX_RE = /^(?:\d{5}\|\d{6}\|\d{5}|\d{5}\|\d{8}|\d{7,8})$/;

/** Zotero's six annotation types, as the API spells them. */
const ANNOTATION_TYPES = [
  "highlight",
  "underline",
  "note",
  "image",
  "ink",
  "text",
] as const;

/**
 * Every outcome a call can have that is not the answer asked for. The client
 * returns one of these as a value; nothing here is thrown.
 *
 * @see https://github.com/aidenlx/zotlit/issues/1139 — "Zotero Local API contract"
 */
export type LocalApiFailure =
  /** Nothing answered on Zotero's HTTP port. */
  | { kind: "unreachable" }
  /** Zotero runs with `httpServer.localAPI.enabled` off. */
  | { kind: "local-api-disabled" }
  /** `401` — no key, or one Zotero has invalidated. */
  | { kind: "unauthorized" }
  /** `403 {"denied":true}` — the user refused the authorization dialog. */
  | { kind: "denied" }
  /** `403 Write access denied` — the target library is not editable. */
  | { kind: "library-read-only" }
  /** `412` from this server: the object moved since it was read. */
  | { kind: "conflict" }
  /** `412` from this server: the write token was replayed inside 12 hours. */
  | { kind: "write-token-used" }
  /** Another Zotero database answers on this port than the session holds. */
  | { kind: "server-changed" }
  /** `429` — Zotero's authorization dialog rate limit. */
  | { kind: "cooldown"; retryAfter: Temporal.Duration }
  /** `501`, or an API version that is not {@link API_VERSION}. */
  | { kind: "incompatible-zotero" }
  /** Zotero answered something this client cannot believe. */
  | { kind: "invalid-response"; issue: string }
  /** The request left and its answer never arrived: an abort, or a timeout. */
  | { kind: "unknown-outcome" };

/** An answer, or the one failure that stopped it. */
export type LocalApiResult<T> = { value: T } | { failure: LocalApiFailure };

/**
 * Zotero's authorization-dialog window, which is also the `Retry-After` it
 * sends. Used when an answer carries no parsable one.
 *
 * @see https://github.com/zotero/zotero/blob/22f08d1ceddc8bad5718b3bc6eee9d3ae5dccc2c/chrome/content/zotero/xpcom/server/server_localAPI.js#L205-L221
 */
const AUTHORIZE_RATE_LIMIT_WINDOW = Temporal.Duration.from({ seconds: 60 });

/** One answer, read the way every transport presents it: header names lower case. */
export interface ZoteroReply {
  status: number;
  headers: Headers;
  text: string;
}

/**
 * One Annotation as the Zotero Local API describes it, once every field has
 * been believed: Indexed Key, type name, narrowed position, and the object
 * version a write sends as its precondition.
 */
export interface LocalApiAnnotation {
  key: string;
  type: ResolvedAnnotationTypeName;
  color: string | null;
  comment: string | null;
  text: string | null;
  position: AnnotationPosition;
  version: number;
  /** Zotero's reading-order key, zero-padded so that text order is it. */
  sortIndex: string;
  /** The Attachment's Indexed Key — the `parentItem` this Annotation hangs from. */
  parentKey: string;
  /** Zotero's printed-page label, as Zotero stored it. */
  pageLabel: string | null;
  /** The Annotation's Zotero tags, by name, in the order Zotero answered them. */
  tags: string[];
}

/**
 * What an answer means, or `null` where it is the answer that was asked for.
 *
 * An answer this client would read records out of must name the session's
 * server: Zotero stamps every answer with the current one, so an id that
 * differs is another database and an id that is absent is not this one either.
 * A refusal is classified by its status first, because Zotero's `401` carries
 * no server id at all.
 *
 * A `404` is deliberately left to the generic branch: no read can produce one —
 * the children route answers an empty list for a key Zotero does not hold — and
 * the write path reads it as "deleted in Zotero" before classifying.
 *
 * @param serverID the server id the session holds, or `null` before a probe has
 *   answered one, which is the one call that may be answered by any database.
 */
export function classifyReply(
  reply: ZoteroReply,
  serverID: string | null,
): LocalApiFailure | null {
  const answered = reply.headers.get("zotero-server-id");
  if (serverID !== null && answered !== null && answered !== serverID) {
    return { kind: "server-changed" };
  }
  const version = reply.headers.get("zotero-api-version");
  if (version !== null && version !== API_VERSION) {
    return { kind: "incompatible-zotero" };
  }

  const body = reply.text.trim();
  switch (reply.status) {
    case 200:
    case 204:
      return serverID !== null && answered !== serverID
        ? invalid(`server id ${answered ?? "absent"}`)
        : null;
    case 401:
      return { kind: "unauthorized" };
    case 403:
      if (body.includes("Local API is not enabled")) {
        return { kind: "local-api-disabled" };
      }
      if (body.includes("Write access denied")) {
        return { kind: "library-read-only" };
      }
      return isDenial(body) ? { kind: "denied" } : invalid(`403 ${body}`);
    case 412:
      if (body.includes("Write token already used")) {
        return { kind: "write-token-used" };
      }
      return body.includes("Zotero-Server-ID does not match")
        ? { kind: "server-changed" }
        : { kind: "conflict" };
    case 429:
      return { kind: "cooldown", retryAfter: retryAfter(reply.headers) };
    case 501:
      return { kind: "incompatible-zotero" };
    default:
      return invalid(`${reply.status} ${body}`);
  }
}

/**
 * The Annotations of one page of the children route, in the order Zotero listed
 * them, or the first record that cannot be believed.
 *
 * Validation runs here rather than at the cache, so nothing unvalidated is ever
 * a record: key alphabet and length, parent key, colour, Sort Index format,
 * type-to-position pairing, and the version a write will send back.
 *
 * @param attachmentKey the Attachment's Indexed Key, which every record must
 *   name as its parent.
 */
export function readAnnotationPage(
  body: string,
  attachmentKey: string,
): LocalApiResult<LocalApiAnnotation[]> {
  const parsed = v.safeParse(itemPageSchema, parseJson(body));
  if (!parsed.success) {
    return { failure: invalid(`annotation list: ${issueOf(parsed.issues)}`) };
  }

  const annotations: LocalApiAnnotation[] = [];
  for (const item of parsed.output) {
    const record = toAnnotation(item, attachmentKey);
    if ("failure" in record) return record;
    annotations.push(record.value);
  }
  return { value: annotations };
}

/**
 * How many Annotations the whole search holds, which every page of it carries,
 * or `null` where the answer named none — the count a page walk ends on.
 *
 * @see https://github.com/zotero/zotero/blob/22f08d1ceddc8bad5718b3bc6eee9d3ae5dccc2c/chrome/content/zotero/xpcom/server/server_localAPI.js#L388-L410
 */
export function totalResults(headers: Headers): number | null {
  const total = Number(headers.get("total-results"));
  return Number.isSafeInteger(total) && total >= 0 ? total : null;
}

/** Whether `value` is Zotero's 12-character server id. */
export function isServerID(value: string): boolean {
  return SERVER_ID_RE.test(value);
}

export function invalid(issue: string): LocalApiFailure {
  return { kind: "invalid-response", issue };
}

const itemPageSchema = v.array(
  v.object({
    key: v.string(),
    version: v.pipe(v.number(), v.safeInteger(), v.minValue(0)),
    library: v.object({
      type: v.picklist(["user", "group"]),
      id: v.pipe(v.number(), v.safeInteger()),
    }),
    data: v.object({
      key: v.string(),
      itemType: v.literal("annotation"),
      parentItem: v.string(),
      annotationType: v.picklist(ANNOTATION_TYPES),
      annotationColor: v.optional(v.string()),
      annotationComment: v.optional(v.string()),
      annotationText: v.optional(v.string()),
      annotationSortIndex: v.string(),
      annotationPosition: v.string(),
      annotationPageLabel: v.optional(v.string()),
      tags: v.optional(v.array(v.object({ tag: v.string() }))),
    }),
  }),
);

type WireItem = v.InferOutput<typeof itemPageSchema>[number];

function toAnnotation(
  item: WireItem,
  attachmentKey: string,
): LocalApiResult<LocalApiAnnotation> {
  const { data } = item;
  if (!isItemKey(item.key) || item.key !== data.key) {
    return { failure: invalid(`annotation key ${item.key}`) };
  }

  const groupID = item.library.type === "group" ? item.library.id : null;
  const parent = formatIndexedKey(data.parentItem, groupID);
  if (parent !== attachmentKey) {
    return { failure: invalid(`${item.key} belongs to ${parent}`) };
  }

  const color = emptyToNull(data.annotationColor);
  if (color !== null && !COLOR_RE.test(color)) {
    return { failure: invalid(`${item.key} colour ${color}`) };
  }

  if (!SORT_INDEX_RE.test(data.annotationSortIndex)) {
    return {
      failure: invalid(`${item.key} sort index ${data.annotationSortIndex}`),
    };
  }

  const position = narrowPosition(data.annotationPosition);
  if (position.kind === "unknown") {
    return { failure: invalid(`${item.key} position`) };
  }
  if (!pairsWithType(data.annotationType, position)) {
    return {
      failure: invalid(
        `${item.key} is ${data.annotationType}, ${position.kind}`,
      ),
    };
  }

  return {
    value: {
      key: formatIndexedKey(item.key, groupID),
      type: data.annotationType,
      color,
      comment: emptyToNull(data.annotationComment),
      text: emptyToNull(data.annotationText),
      position,
      version: item.version,
      sortIndex: data.annotationSortIndex,
      parentKey: parent,
      pageLabel: emptyToNull(data.annotationPageLabel),
      tags: (data.tags ?? []).map((entry) => entry.tag),
    },
  };
}

/**
 * The stored position, narrowed by the shape it is in rather than by a content
 * type the Annotation itself does not carry: a PDF position first, then the
 * EPUB and snapshot selectors an Annotation View reads beside it.
 */
function narrowPosition(raw: string): AnnotationPosition {
  const value = parseJson(raw);
  if (typeof value !== "object" || value === null)
    return { kind: "unknown", raw };
  for (const contentType of [
    "application/pdf",
    "application/epub+zip",
    "text/html",
  ]) {
    const position = parseAnnotationPosition(
      value as AnnotationPositionRaw,
      contentType,
    );
    if (position.kind !== "unknown") return position;
  }
  return { kind: "unknown", raw };
}

/**
 * Zotero stores ink strokes and typed text in their own position shapes, and
 * every other type in rects. A non-PDF selector pairs with any type: it names a
 * place in a document that has no geometry.
 */
function pairsWithType(
  type: ResolvedAnnotationTypeName,
  position: AnnotationPosition,
): boolean {
  switch (position.kind) {
    case "pdf-ink":
      return type === "ink";
    case "pdf-text":
      return type === "text";
    case "pdf-rects":
      return type !== "ink" && type !== "text";
    default:
      return true;
  }
}

/** Zotero stores an empty annotation field as an empty string, never as null. */
function emptyToNull(value: string | undefined): string | null {
  return value === undefined || value === "" ? null : value;
}

function isDenial(body: string): boolean {
  const denied = parseJson(body);
  return typeof denied === "object" && denied !== null && "denied" in denied;
}

function retryAfter(headers: Headers): Temporal.Duration {
  const seconds = Number(headers.get("retry-after"));
  return Number.isSafeInteger(seconds) && seconds > 0
    ? Temporal.Duration.from({ seconds })
    : AUTHORIZE_RATE_LIMIT_WINDOW;
}

function issueOf(issues: readonly v.BaseIssue<unknown>[]): string {
  const [first] = issues;
  return first
    ? `${v.getDotPath(first) ?? "body"}: ${first.message}`
    : "unreadable";
}
