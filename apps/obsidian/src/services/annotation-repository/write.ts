// The write path's pure parts: what one command sends, what a write leaves on
// the Annotation it touched, and what a failed one says to the user.
//
// @see https://github.com/aidenlx/zotlit/issues/1145

import * as m from "@/lib/i18n/generated/messages";
import type { LocalApiFailure } from "@/services/zotero-local-api/service";

import { capabilityOfFailure } from "./capability";
import { editingCapabilityCopy } from "./capability-copy";

/**
 * Why a write did not land, beside every failure Zotero itself can answer.
 * The two extra members are refusals: neither ever left ZotLit.
 */
export type WriteFailure =
  | LocalApiFailure
  /**
   * The Annotation came from the Zotero DB source, which keeps no object
   * version, so there is no precondition to send and the write is refused
   * before any request.
   *
   * @see apps/obsidian/docs/adr/0034-the-annotation-source-is-atomic-per-attachment.md
   */
  | { kind: "db-source" }
  /** No list the repository holds names this Annotation, so nothing was read. */
  | { kind: "unknown-annotation" };

/**
 * What a write left on one Annotation. `pending` is the only state a surface
 * draws anything for, and what it draws is disabled verbs: no provisional
 * value is ever shown.
 *
 * `conflict` and `uncertain` are the write path's two unsettled outcomes —
 * Zotero's copy moved under the write, and a create whose answer never
 * arrived. They are produced and presented by aidenlx/zotlit#1151; a surface
 * that switches on `kind` today keeps working when they are.
 *
 * @see apps/obsidian/docs/adr/0039-an-uncertain-create-is-reconciled-by-stable-fields-and-retried-only-by-the-user.md
 */
export type MutationState =
  | { kind: "idle" }
  | { kind: "pending" }
  | { kind: "conflict" }
  | { kind: "uncertain" }
  | { kind: "failed"; failure: WriteFailure };

/** The state an Annotation no write is standing on is in. */
export const IDLE: MutationState = { kind: "idle" };

/** The Annotation one command names, as the route spells it. */
export interface WriteTarget {
  /** `users/0`, or the group's route. */
  library: string;
  /** The bare item key, without the Indexed Key's group suffix. */
  key: string;
  /** The version the last read answered, which the write sends as its precondition. */
  version: number;
}

/** One request, as the Zotero Local API client's authorized seam takes it. */
export interface WriteRequest {
  path: string;
  method: string;
  headers?: Readonly<Record<string, string>>;
  body?: string;
}

const JSON_CONTENT: Readonly<Record<string, string>> = {
  "Content-Type": "application/json",
};

/**
 * Zotero's own colour rule is case-sensitive: `annotationColor` is matched
 * against lower-case hex, so `#FFD400` is refused where `#ffd400` is taken.
 *
 * @see https://github.com/zotero/zotero/blob/22f08d1ceddc8bad5718b3bc6eee9d3ae5dccc2c/chrome/content/zotero/xpcom/data/item.js#L4512-L4518
 */
export function wireColor(color: string): string {
  return color.toLowerCase();
}

/**
 * A colour change, on an Annotation of any type — Zotero's colour setter is
 * one rule for all six, so an ink stroke recolours like a highlight.
 *
 * A `PATCH` is a merge patch, so naming the colour changes the colour and
 * nothing else: the Sort Index is never rewritten after creation, and this
 * body carries none.
 *
 * @see apps/obsidian/docs/adr/0040-the-sort-index-and-page-label-are-computed-in-obsidian-from-a-port-of-zoteros-text-structure.md
 */
export function colorPatch(target: WriteTarget, color: string): WriteRequest {
  return patch(target, { annotationColor: wireColor(color) });
}

/**
 * A comment change. An empty string is how a comment is cleared: Zotero trims
 * a string field and stores an empty one as no value.
 */
export function commentPatch(
  target: WriteTarget,
  comment: string,
): WriteRequest {
  return patch(target, { annotationComment: comment });
}

/**
 * A delete, whose precondition is a header rather than a body: Zotero's
 * single-object delete reads `If-Unmodified-Since-Version` alone and answers
 * `428` without it.
 *
 * @see https://github.com/zotero/zotero/blob/22f08d1ceddc8bad5718b3bc6eee9d3ae5dccc2c/chrome/content/zotero/xpcom/server/server_localAPI.js#L2315-L2330
 */
export function eraseRequest(target: WriteTarget): WriteRequest {
  return {
    path: itemPath(target),
    method: "DELETE",
    headers: { "If-Unmodified-Since-Version": String(target.version) },
  };
}

/**
 * One notice for a write that did not land, in the same words the Editing
 * Capability affordance uses wherever a failure has a capability behind it.
 * The outcomes no capability describes — a source that cannot be written to,
 * an Annotation nothing holds, one Zotero has deleted, one that moved under
 * the write, and an answer that never arrived — name themselves.
 *
 * @param now the instant a cooldown's remaining seconds are measured from.
 */
export function writeFailureMessage(
  failure: WriteFailure,
  now: Temporal.Instant,
): string {
  return m.annot_view_write_failed({
    reason: writeFailureReason(failure, now),
  });
}

function writeFailureReason(
  failure: WriteFailure,
  now: Temporal.Instant,
): string {
  switch (failure.kind) {
    case "db-source":
      return m.annot_view_write_reason_db_source();
    case "unknown-annotation":
      return m.annot_view_write_reason_unknown_annotation();
    case "not-found":
      return m.annot_view_write_reason_deleted();
    // A patch and a delete both send a version and no write token, so a replayed
    // token is as much "Zotero's copy moved" as a stale version is.
    case "conflict":
    case "write-token-used":
      return m.annot_view_write_reason_conflict();
    case "unknown-outcome":
      return m.annot_view_write_reason_unknown_outcome();
    default: {
      const copy = editingCapabilityCopy(
        capabilityOfFailure(failure, () => now),
        now,
      );
      return copy.detail === null
        ? copy.label
        : `${copy.label}. ${copy.detail}`;
    }
  }
}

/**
 * A single-object patch. The version goes in the body, which is the
 * precondition Zotero prefers and checks for equality; the header form it
 * falls back to asks only that the object has not moved past the version.
 *
 * @see https://github.com/zotero/zotero/blob/22f08d1ceddc8bad5718b3bc6eee9d3ae5dccc2c/chrome/content/zotero/xpcom/server/server_localAPI.js#L2160-L2191
 */
function patch(
  target: WriteTarget,
  fields: Readonly<Record<string, string>>,
): WriteRequest {
  return {
    path: itemPath(target),
    method: "PATCH",
    headers: JSON_CONTENT,
    body: JSON.stringify({ version: target.version, ...fields }),
  };
}

function itemPath({ library, key }: WriteTarget): string {
  return `/api/${library}/items/${key}`;
}
