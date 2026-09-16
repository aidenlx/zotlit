// What a surface may do to one Attachment's Annotations, and the pure mapping
// from what the Zotero Local API's probe knows onto it.

import type {
  LocalApiFailure,
  LocalApiState,
} from "@/services/zotero-local-api/service";

/**
 * One Editing Capability per Attachment drives every control in the reader and
 * in the Annotation View. API version 3 is the only compatibility gate; the
 * schema version is logged at debug and gates nothing.
 *
 * `authorizing` has no producer until the write path raises Zotero's dialog
 * (aidenlx/zotlit#1144), and `library-read-only` none until a write is refused
 * by the library (aidenlx/zotlit#1145). Both stay in the enum because the
 * surfaces render one closed set of states.
 *
 * @see https://github.com/aidenlx/zotlit/issues/1139 — "Editing Capability and degraded states"
 */
export type EditingCapability =
  | { kind: "writable" }
  | { kind: "authorization-required" }
  | { kind: "authorizing" }
  | { kind: "cooldown"; retryAfter: Temporal.Instant }
  | {
      kind: "read-only";
      reason:
        | "zotero-unavailable"
        | "local-api-disabled"
        | "incompatible-zotero"
        | "invalid-response"
        | "server-changed"
        | "library-read-only"
        | "probing";
    };

/**
 * The capability one Annotation Source leaves, from the probe alone.
 *
 * A session that stands is writable when a Remembered Write Authorization
 * exists for its server and asks for one otherwise; every other state is
 * read-only with the reason the probe or the last answer gave, so a surface can
 * say why rather than only that.
 *
 * @param state what the Zotero Local API's last Capability Probe learned.
 * @param now the clock a cooldown deadline is read against.
 */
export function editingCapabilityOf(
  state: LocalApiState,
  now: () => Temporal.Instant,
): EditingCapability {
  switch (state.kind) {
    case "available":
      return state.authorized
        ? { kind: "writable" }
        : { kind: "authorization-required" };
    case "probing":
      return { kind: "read-only", reason: "probing" };
    default:
      return fromFailure(state.failure, now);
  }
}

function fromFailure(
  failure: LocalApiFailure,
  now: () => Temporal.Instant,
): EditingCapability {
  switch (failure.kind) {
    case "unreachable":
    // A request that left and lost its answer has told this source nothing;
    // what a surface can say is that Zotero is not answering.
    case "unknown-outcome":
      return { kind: "read-only", reason: "zotero-unavailable" };
    case "local-api-disabled":
      return { kind: "read-only", reason: "local-api-disabled" };
    case "incompatible-zotero":
      return { kind: "read-only", reason: "incompatible-zotero" };
    case "server-changed":
      return { kind: "read-only", reason: "server-changed" };
    case "library-read-only":
      return { kind: "read-only", reason: "library-read-only" };
    case "unauthorized":
    case "denied":
      return { kind: "authorization-required" };
    case "cooldown":
      return { kind: "cooldown", retryAfter: now().add(failure.retryAfter) };
    case "invalid-response":
    // A read sends no version and no write token, so a `412` of either kind
    // answers a question this client never asked. The write path owns both as
    // per-annotation mutation state (aidenlx/zotlit#1145), never as capability.
    case "conflict":
    case "write-token-used":
      return { kind: "read-only", reason: "invalid-response" };
    default:
      // A failure kind added without a capability for it fails to compile here.
      failure satisfies never;
      return { kind: "read-only", reason: "invalid-response" };
  }
}
