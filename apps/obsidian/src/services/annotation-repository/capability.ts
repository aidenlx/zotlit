// What a surface may do to one Attachment's Annotations, and the pure mapping
// from what the Zotero Local API's probe knows onto it.

import type {
  LocalApiFailure,
  LocalApiState,
  WriteAuthorizationState,
} from "@/services/zotero-local-api/service";

/**
 * One Editing Capability per Attachment drives every control in the reader and
 * in the Annotation View. API version 3 is the only compatibility gate; the
 * schema version is logged at debug and gates nothing.
 *
 * @see https://github.com/aidenlx/zotlit/issues/1139 — "Editing Capability and degraded states"
 */
export type EditingCapability =
  | { kind: "writable"; oneTime?: boolean }
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
 * One capability as a value that compares by equality: its kind, and the reason
 * a read-only one names. A cooldown's deadline is deliberately left out — it
 * moves every second while the reason stands still — so a caller that does care
 * about the deadline says so on top of this.
 */
export function capabilityReason(capability: EditingCapability): string {
  return capability.kind === "read-only"
    ? `read-only:${capability.reason}`
    : capability.kind;
}

/**
 * The capability one Annotation Source leaves for one Attachment.
 *
 * The two facts read first are the ones a request taught this session rather
 * than the probe: a library Zotero refuses writes to cannot be argued with, and
 * a gesture standing at Zotero's dialog is what the surface should say while it
 * waits. Under a session that stands, a Write Authorization in hand is writable
 * and Zotero's dialog cooldown blocks only the asking — so a remembered
 * authorization outranks it. Every other state is read-only with the reason the
 * probe or the last answer gave, so a surface can say why rather than only
 * that.
 *
 * @param state what the Zotero Local API's last Capability Probe learned.
 * @param writes what the write path learned about this Attachment.
 * @param now the clock a cooldown deadline is read against.
 */
export function editingCapabilityOf(
  state: LocalApiState,
  writes: WriteAuthorizationState,
  now: () => Temporal.Instant,
): EditingCapability {
  if (writes.libraryReadOnly) {
    return { kind: "read-only", reason: "library-read-only" };
  }
  if (writes.authorizing) return { kind: "authorizing" };
  switch (state.kind) {
    case "available": {
      if (state.authorized)
        return { kind: "writable", ...(writes.oneTime && { oneTime: true }) };
      const { cooldownUntil } = writes;
      return cooldownUntil !== null &&
        Temporal.Instant.compare(cooldownUntil, now()) > 0
        ? { kind: "cooldown", retryAfter: cooldownUntil }
        : { kind: "authorization-required" };
    }
    case "probing":
      return { kind: "read-only", reason: "probing" };
    default:
      return capabilityOfFailure(state.failure, now);
  }
}

/**
 * What one failure leaves the session able to do, for a caller holding a
 * failure rather than a probe — the write path, naming the reason an edit did
 * not land in the same words the affordance uses.
 */
export function capabilityOfFailure(
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
    // A read sends no version and no write token, and the list route answers an
    // empty list rather than a `404`, so all three answer a question this client
    // never asked. The write path owns them as per-annotation mutation state
    // (aidenlx/zotlit#1145), never as capability.
    case "conflict":
    case "write-token-used":
    case "not-found":
      return { kind: "read-only", reason: "invalid-response" };
    default:
      // A failure kind added without a capability for it fails to compile here.
      failure satisfies never;
      return { kind: "read-only", reason: "invalid-response" };
  }
}
