import * as v from "valibot";

import { isItemKey } from "@zotlit/db";

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

/**
 * How much of a managed note an `update` / `update-many` touches. Absent on the
 * wire means `full` (refresh frontmatter and the managed body region);
 * `metadata` refreshes managed frontmatter only.
 */
export type UpdateScope = "full" | "metadata";

const updateScopeValue = v.optional(
  v.picklist(["full", "metadata"] satisfies UpdateScope[]),
  "full",
);

const literatureNoteProfileValue = v.optional(v.pipe(v.string(), v.uuid()));

/** Query payload for `zotlit/{open,update}` protocol handlers. */
export const protocolQuerySchema = v.pipe(
  v.object({
    item: itemID,
    "source-id": sourceIdValue,
    scope: updateScopeValue,
    profile: literatureNoteProfileValue,
  }),
  v.transform(({ item, "source-id": sourceId, scope, profile }) => ({
    item,
    sourceId,
    scope,
    ...(profile === undefined ? {} : { profileId: profile }),
  })),
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
 * `Zotero.launchURL`. A non-default {@link UpdateScope} adds `&scope=<scope>`.
 * A selected literature-note Profile adds `&profile=<profileId>`.
 */
export function buildProtocolUrl(
  action: ProtocolAction,
  item: number,
  options: {
    sourceId: string;
    scope?: UpdateScope;
    profileId?: string;
  },
): string {
  const params = protocolUrlParams({ item: String(item) }, options.sourceId);
  appendScope(params, options.scope);
  appendProfile(params, options.profileId);
  return `obsidian://${protocolActionId(action)}?${params}`;
}

/**
 * `URLSearchParams` shared by every `obsidian://zotlit/*` link builder:
 * action-specific params first, then the common `source-id`. A Public URI Link
 * is unversioned, so no version param is emitted.
 */
function protocolUrlParams(
  params: Record<string, string>,
  sourceId: string,
): URLSearchParams {
  return new URLSearchParams({ ...params, "source-id": sourceId });
}

/** Append `scope` only when it diverges from the `full` default so the common
 *  link stays stable. */
function appendScope(
  params: URLSearchParams,
  scope: UpdateScope | undefined,
): void {
  if (scope && scope !== "full") params.set("scope", scope);
}

function appendProfile(
  params: URLSearchParams,
  profileId: string | undefined,
): void {
  if (profileId) params.set("profile", profileId);
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
    scope: updateScopeValue,
    profile: literatureNoteProfileValue,
  }),
  v.transform(({ items, "source-id": sourceId, scope, profile }) => ({
    items,
    sourceId,
    scope,
    ...(profile === undefined ? {} : { profileId: profile }),
  })),
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
 * Numeric Zotero item ids as sent in a request body: deduped, non-empty.
 * Shared by {@link batchUpdateRequestSchema} and {@link importNotesRequestSchema}.
 */
const dedupedItemIDs = v.pipe(
  v.array(v.pipe(v.number(), v.integer())),
  v.transform((ids) => [...new Set(ids)]),
  v.minLength(1),
);

/**
 * Body for `PUT {host}/literature-notes` — the HTTP fallback the companion
 * uses when a batch is too large to fit in an `obsidian://` URL. `items` carries
 * the same invariants as the URL path (integer ids, deduped, non-empty) so both
 * transports validate identically. The batch is gated by the
 * {@link SOURCE_ID_HEADER} header, as the URL is gated by its `source-id` query.
 */
export const batchUpdateRequestSchema = v.pipe(
  v.object({
    items: dedupedItemIDs,
    scope: updateScopeValue,
    profile: literatureNoteProfileValue,
  }),
  v.transform(({ items, scope, profile }) => ({
    items,
    scope,
    ...(profile === undefined ? {} : { profileId: profile }),
  })),
);

/** Producer-facing request body. Defaulted fields (`scope`) are optional to
 *  send; the server fills them on parse. */
export type BatchUpdateRequest = v.InferInput<typeof batchUpdateRequestSchema>;

// ---------------------------------------------------------------------------
// Note-import protocol family
// ---------------------------------------------------------------------------

/** How note-keys are gathered from the selected items. */
export type ImportMode = "note" | "child";

const importModeValue = v.picklist(["note", "child"] satisfies ImportMode[]);

/**
 * Single-item note-import action. Kept out of {@link protocolActions} (different
 * query shape with `mode`).
 */
const PROTOCOL_IMPORT_ACTION = "import-note";

/** Batch note-import action. */
const PROTOCOL_IMPORT_MANY_ACTION = "import-notes";

/** Full Obsidian action string for a single-note import. */
export const importProtocolActionId =
  `${PROTOCOL_NAMESPACE}/${PROTOCOL_IMPORT_ACTION}` as const;

/** Full Obsidian action string for the batch import handler. */
export const importManyProtocolActionId =
  `${PROTOCOL_NAMESPACE}/${PROTOCOL_IMPORT_MANY_ACTION}` as const;

/** Query payload for `zotlit/import-note`. */
export const importProtocolQuerySchema = v.pipe(
  v.object({
    item: itemID,
    mode: importModeValue,
    "source-id": sourceIdValue,
  }),
  v.transform(({ item, mode, "source-id": sourceId }) => ({
    item,
    mode,
    sourceId,
  })),
);

/** Decoded, validated query for a single-note import action. */
export type ImportProtocolQuery = v.InferOutput<
  typeof importProtocolQuerySchema
>;

/** Query payload for `zotlit/import-notes`. */
export const importManyProtocolQuerySchema = v.pipe(
  v.object({
    items: batchItems,
    mode: importModeValue,
    "source-id": sourceIdValue,
  }),
  v.transform(({ items, mode, "source-id": sourceId }) => ({
    items,
    mode,
    sourceId,
  })),
);

/** Decoded, validated query for a batch note-import action. */
export type ImportManyProtocolQuery = v.InferOutput<
  typeof importManyProtocolQuerySchema
>;

/**
 * Parse and validate the `ObsidianProtocolData` for a `zotlit/import-note` link.
 *
 * @throws {v.ValiError} when required fields are missing or malformed
 */
export function parseImportProtocolQuery(
  data: Record<string, unknown>,
): ImportProtocolQuery {
  return v.parse(importProtocolQuerySchema, data);
}

/**
 * Parse and validate the `ObsidianProtocolData` for a `zotlit/import-notes` link.
 *
 * @throws {v.ValiError} when `items` is empty/malformed or `source-id` is absent
 */
export function parseImportManyProtocolQuery(
  data: Record<string, unknown>,
): ImportManyProtocolQuery {
  return v.parse(importManyProtocolQuerySchema, data);
}

/**
 * Body for `PUT {host}/zotero-notes` — the HTTP fallback the companion uses
 * when a batch import is too large to fit in an `obsidian://` URL. Same
 * invariants on `items` as the URL transport. Gated by {@link SOURCE_ID_HEADER}.
 */
export const importNotesRequestSchema = v.object({
  items: dedupedItemIDs,
  mode: importModeValue,
});

/** Producer-facing request body for note import. */
export type ImportNotesRequest = v.InferInput<typeof importNotesRequestSchema>;

/**
 * Build an `obsidian://zotlit/import-note?item=<id>&mode=<mode>&source-id=<hash>`
 * link for `Zotero.launchURL`.
 */
export function buildImportProtocolUrl(
  item: number,
  options: { sourceId: string; mode: ImportMode },
): string {
  const params = protocolUrlParams(
    { item: String(item), mode: options.mode },
    options.sourceId,
  );
  return `obsidian://${importProtocolActionId}?${params}`;
}

/**
 * Build an `obsidian://zotlit/import-notes?items=<csv>&mode=<mode>&source-id=<hash>`
 * link for `Zotero.launchURL`.
 */
export function buildImportManyProtocolUrl(
  items: readonly number[],
  options: { sourceId: string; mode: ImportMode },
): string {
  const params = protocolUrlParams(
    { items: items.join(","), mode: options.mode },
    options.sourceId,
  );
  return `obsidian://${importManyProtocolActionId}?${params}`;
}

/**
 * Build an `obsidian://zotlit/update-many?items=<id,id,…>&source-id=<hash>` link
 * for `Zotero.launchURL` (symmetry with {@link buildProtocolUrl}). A non-default
 * {@link UpdateScope} adds `&scope=<scope>`.
 */
export function buildBatchProtocolUrl(
  items: readonly number[],
  options: {
    sourceId: string;
    scope?: UpdateScope;
    profileId?: string;
  },
): string {
  const params = protocolUrlParams(
    { items: items.join(",") },
    options.sourceId,
  );
  appendScope(params, options.scope);
  appendProfile(params, options.profileId);
  return `obsidian://${batchProtocolActionId}?${params}`;
}

const PROTOCOL_EXPLORE_ACTION = "explore";

export const exploreProtocolActionId =
  `${PROTOCOL_NAMESPACE}/${PROTOCOL_EXPLORE_ACTION}` as const;

const annotationKeyValue = v.optional(v.pipe(v.string(), v.check(isItemKey)));

export const exploreProtocolQuerySchema = v.pipe(
  v.object({
    item: itemID,
    annotation: annotationKeyValue,
    "source-id": sourceIdValue,
  }),
  v.transform(({ item, annotation, "source-id": sourceId }) => ({
    item,
    annotation,
    sourceId,
  })),
);

export type ExploreProtocolQuery = v.InferOutput<
  typeof exploreProtocolQuerySchema
>;

/**
 * Parse and validate the `ObsidianProtocolData` for a `zotlit/explore` link.
 *
 * @param data decoded query record from Obsidian
 * @returns the typed query
 * @throws {v.ValiError} when `item` or `source-id` is missing or malformed
 */
export function parseExploreProtocolQuery(
  data: Record<string, unknown>,
): ExploreProtocolQuery {
  return v.parse(exploreProtocolQuerySchema, data);
}

const PROTOCOL_UPDATE_ALL_ACTION = "update-all";

/**
 * Library-wide note import. Shares {@link updateAllProtocolQuerySchema}'s query
 * shape, and gathers both child notes of regular items and standalone notes in
 * scope — so it carries no `mode`.
 */
const PROTOCOL_IMPORT_ALL_NOTES_ACTION = "import-all-notes";

export const updateAllProtocolActionId =
  `${PROTOCOL_NAMESPACE}/${PROTOCOL_UPDATE_ALL_ACTION}` as const;

export const importAllNotesProtocolActionId =
  `${PROTOCOL_NAMESPACE}/${PROTOCOL_IMPORT_ALL_NOTES_ACTION}` as const;

/**
 * 8-char base-32 Zotero collection key. Collection keys and item keys share
 * `Zotero.Utilities.generateObjectKey()`'s format, so {@link isItemKey} validates
 * both.
 */
const collectionKeyValue = v.optional(v.pipe(v.string(), v.check(isItemKey)));

/**
 * Query payload shared by `zotlit/update-all` and `zotlit/import-all-notes`:
 * one exact target library, optionally narrowed to one collection and its
 * descendants. The target is exact — the receiver runs that library alone,
 * whatever libraries its own discovery configuration covers.
 */
const exactLibraryTargetQuerySchema = v.pipe(
  v.object({
    "source-id": sourceIdValue,
    library: v.optional(v.pipe(v.string(), v.regex(/^\d+$/u))),
    collection: collectionKeyValue,
  }),
  v.transform(({ "source-id": sourceId, library, collection }) => ({
    sourceId,
    /** `0` for the personal library; a positive integer for a group library. */
    groupID: library ? Number(library) : 0,
    /** Absent scopes the action to the whole library. */
    collectionKey: collection,
  })),
);

export const updateAllProtocolQuerySchema = exactLibraryTargetQuerySchema;

export const importAllNotesProtocolQuerySchema = exactLibraryTargetQuerySchema;

export type UpdateAllProtocolQuery = v.InferOutput<
  typeof updateAllProtocolQuerySchema
>;

export type ImportAllNotesProtocolQuery = v.InferOutput<
  typeof importAllNotesProtocolQuerySchema
>;

/**
 * @param data decoded query record from Obsidian
 * @throws {v.ValiError} when `source-id` is missing or malformed
 */
export function parseUpdateAllProtocolQuery(
  data: Record<string, unknown>,
): UpdateAllProtocolQuery {
  return v.parse(updateAllProtocolQuerySchema, data);
}

/**
 * @param data decoded query record from Obsidian
 * @throws {v.ValiError} when `source-id` or `collection` is malformed
 */
export function parseImportAllNotesProtocolQuery(
  data: Record<string, unknown>,
): ImportAllNotesProtocolQuery {
  return v.parse(importAllNotesProtocolQuerySchema, data);
}

/**
 * Build an `obsidian://zotlit/update-all?source-id=<hash>&library=<groupID>`
 * link for `Zotero.launchURL`. `groupID` 0 (or absent) means the personal
 * library; Obsidian runs that library exactly, whatever its own Library Scope
 * covers. A `collectionKey` narrows the action to that collection and its
 * descendants.
 */
export function buildUpdateAllProtocolUrl(
  sourceId: string,
  groupID?: number,
  collectionKey?: string,
): string {
  return buildExactLibraryTargetUrl(updateAllProtocolActionId, sourceId, {
    groupID,
    collectionKey,
  });
}

/**
 * Build an `obsidian://zotlit/import-all-notes?source-id=<hash>&library=<groupID>`
 * link for `Zotero.launchURL`, optionally narrowed to one collection and its
 * descendants.
 */
export function buildImportAllNotesProtocolUrl(
  sourceId: string,
  groupID?: number,
  collectionKey?: string,
): string {
  return buildExactLibraryTargetUrl(importAllNotesProtocolActionId, sourceId, {
    groupID,
    collectionKey,
  });
}

/** Shared builder for the two {@link exactLibraryTargetQuerySchema} actions. */
function buildExactLibraryTargetUrl(
  actionId: string,
  sourceId: string,
  scope: { groupID?: number; collectionKey?: string },
): string {
  const params = protocolUrlParams({}, sourceId);
  if (scope.groupID) params.set("library", String(scope.groupID));
  if (scope.collectionKey) params.set("collection", scope.collectionKey);
  return `obsidian://${actionId}?${params}`;
}

/**
 * Build an `obsidian://zotlit/explore?item=<id>&source-id=<hash>` link for
 * `Zotero.launchURL`. An optional `annotation` key anchors the explorer at
 * that annotation.
 */
export function buildExploreProtocolUrl(
  item: number,
  options: { sourceId: string; annotation?: string },
): string {
  const params = protocolUrlParams({ item: String(item) }, options.sourceId);
  if (options.annotation) params.set("annotation", options.annotation);
  return `obsidian://${exploreProtocolActionId}?${params}`;
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
