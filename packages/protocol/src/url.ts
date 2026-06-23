import * as v from "valibot";

import { PROTOCOL_VERSION, PROTOCOL_VERSION_PARAM } from "./version";

/**
 * Obsidian protocol namespace ZotLit owns. Each action is registered as
 * `"zotlit/<action>"` following Obsidian's URI convention
 * ({@link https://help.obsidian.md/Extending+Obsidian/Obsidian+URI}).
 */
export const PROTOCOL_NAMESPACE = "zotlit";

/** Literature-note actions, following Obsidian's one-handler-per-verb convention. */
export type ProtocolAction = "open" | "update";

export const protocolActions = [
  "open",
  "update",
] as const satisfies readonly ProtocolAction[];

/** Full Obsidian action string for `registerObsidianProtocolHandler`. */
export function protocolActionId(
  action: ProtocolAction,
): `${typeof PROTOCOL_NAMESPACE}/${ProtocolAction}` {
  return `${PROTOCOL_NAMESPACE}/${action}`;
}

/**
 * Batch literature-note action. Kept out of {@link protocolActions} because it
 * carries a different query shape (an `items` list, not a single `item`) and a
 * different handler.
 */
const PROTOCOL_BATCH_ACTION = "update-many";

/** Full Obsidian action string for the batch handler. */
export const batchProtocolActionId =
  `${PROTOCOL_NAMESPACE}/${PROTOCOL_BATCH_ACTION}` as const;

/** Numeric Zotero `itemID`, carried on the wire as a decimal string. */
const itemID = v.pipe(v.string(), v.regex(/^\d+$/u), v.transform(Number));

/** 8-char hex id from {@link sourceIdFromUris}. */
const sourceIdValue = v.pipe(v.string(), v.regex(/^[0-9a-f]{8}$/u));

/** Query payload for `zotlit/{open,update}` protocol handlers. */
export const protocolQuerySchema = v.pipe(
  v.object({
    item: itemID,
    "source-id": sourceIdValue,
  }),
  v.transform(({ item, "source-id": sourceId }) => ({ item, sourceId })),
);

/** Decoded, validated query for a literature-note action. */
export type ProtocolQuery = v.InferOutput<typeof protocolQuerySchema>;

/**
 * Whether a decoded query targets the configured Zotero install. Rejects when
 * `expected` is unknown or when the query's `sourceId` differs.
 */
export function protocolSourceMatches(
  query: { sourceId: string },
  expected: string | null,
): boolean {
  return expected !== null && query.sourceId === expected;
}

/**
 * Build an `obsidian://zotlit/<action>?item=<id>&source-id=<hash>` link for
 * `Zotero.launchURL`.
 */
export function buildProtocolUrl(
  action: ProtocolAction,
  item: number,
  sourceId: string,
): string {
  const params = new URLSearchParams({
    item: String(item),
    "source-id": sourceId,
    [PROTOCOL_VERSION_PARAM]: String(PROTOCOL_VERSION),
  });
  return `obsidian://${protocolActionId(action)}?${params}`;
}

/**
 * Comma-separated decimal item ids carried by `update-many`. A trailing comma
 * is tolerated, ids are deduped, and an empty list is rejected.
 */
const batchItems = v.pipe(
  v.string(),
  v.transform((raw) => raw.split(",").filter(Boolean)),
  v.array(itemID),
  v.transform((ids) => [...new Set(ids)]),
  v.minLength(1),
);

/** Query payload for the `zotlit/update-many` protocol handler. */
export const protocolBatchQuerySchema = v.pipe(
  v.object({
    items: batchItems,
    "source-id": sourceIdValue,
  }),
  v.transform(({ items, "source-id": sourceId }) => ({ items, sourceId })),
);

/** Decoded, validated query for the batch literature-note action. */
export type ProtocolBatchQuery = v.InferOutput<typeof protocolBatchQuerySchema>;

/**
 * Parse and validate the `ObsidianProtocolData` for a `zotlit/update-many` link.
 *
 * @param data decoded query record from Obsidian
 * @returns the typed query, with deduped item ids
 * @throws {v.ValiError} when `items` is empty/malformed or `source-id` is absent
 */
export function parseProtocolBatchQuery(
  data: Record<string, unknown>,
): ProtocolBatchQuery {
  return v.parse(protocolBatchQuerySchema, data);
}

/**
 * Body for `PATCH {host}/literature-notes` — the HTTP fallback the companion
 * uses when a batch is too large to fit in an `obsidian://` URL. `items` carries
 * the same invariants as the URL path (integer ids, deduped, non-empty) so both
 * transports validate identically. The batch is gated by the
 * {@link SOURCE_ID_HEADER} header, as the URL is gated by its `source-id` query.
 */
export const batchUpdateRequestSchema = v.object({
  items: v.pipe(
    v.array(v.pipe(v.number(), v.integer())),
    v.transform((ids) => [...new Set(ids)]),
    v.minLength(1),
  ),
});

export type BatchUpdateRequest = v.InferOutput<typeof batchUpdateRequestSchema>;

/**
 * Build an `obsidian://zotlit/update-many?items=<id,id,…>&source-id=<hash>` link
 * for `Zotero.launchURL` (symmetry with {@link buildProtocolUrl}).
 */
export function buildBatchProtocolUrl(
  items: readonly number[],
  sourceId: string,
): string {
  const params = new URLSearchParams({
    items: items.join(","),
    "source-id": sourceId,
    [PROTOCOL_VERSION_PARAM]: String(PROTOCOL_VERSION),
  });
  return `obsidian://${batchProtocolActionId}?${params}`;
}

export function getProtocolUrlVersion(data: Record<string, unknown>): unknown {
  return data[PROTOCOL_VERSION_PARAM];
}

/**
 * Parse and validate the `ObsidianProtocolData` Obsidian hands a handler.
 *
 * @param data decoded query record from Obsidian
 * @returns the typed query
 * @throws {v.ValiError} when `item` or `source-id` is missing or malformed
 */
export function parseProtocolQuery(
  data: Record<string, unknown>,
): ProtocolQuery {
  return v.parse(protocolQuerySchema, data);
}
