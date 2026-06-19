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
  query: ProtocolQuery,
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
