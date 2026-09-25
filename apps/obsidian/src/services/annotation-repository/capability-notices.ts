// What the user is told when a gesture meets a block or a write comes back
// refused, and every "once per …" promise the spec makes about it — decided as
// data, so a test reads the answer instead of watching for a notice.
//
// @see apps/obsidian/policies/ui-seams.md
// @see https://github.com/aidenlx/zotlit/issues/1147

import * as m from "@/lib/i18n/generated/messages";
import type {
  LocalApiFailure,
  LocalApiResult,
} from "@/services/zotero-local-api/service";

import { capabilityReason } from "./capability";
import type { EditingCapability } from "./capability";
import { editingCapabilityCopy } from "./capability-copy";

/** One notice, in the shape the seam renders it in. */
export interface CapabilityNotice {
  /** The state, in the words the one copy table gives it. */
  title: string;
  /** What to do about it, one line each. */
  lines: readonly string[];
  /** Whether it waits to be dismissed rather than timing out. */
  sticky: boolean;
  /** The one action offered, or null where there is nothing to open. */
  action: string | null;
}

/**
 * What Zotero's answer to Allow editing is worth saying. A grant, an Allow, and
 * an Always Allow this device could not save each speak. Every other refusal —
 * a Deny, a cooldown, an unknown outcome, a lost connection — is already on
 * the capability's own status, and a Deny is the user's clear choice.
 *
 * @returns what to tell the user, or null where the status says it already.
 * @see apps/obsidian/docs/adr/0062-editing-requires-a-remembered-authorization-and-allow-leaves-zotlit-read-only.md
 */
export function allowEditingNotice(
  result: LocalApiResult<void>,
): CapabilityNotice | null {
  if (!("failure" in result)) {
    return plainNotice(m.notice_zotero_editing_enabled());
  }
  switch (result.failure.kind) {
    // The one answer whose notice asks Zotero again, from the user's press.
    case "not-remembered":
      return {
        ...plainNotice(m.notice_zotero_editing_not_remembered()),
        action: m.capability_enable_editing(),
      };
    case "not-saved":
      return plainNotice(m.notice_zotero_editing_not_saved());
    default:
      return null;
  }
}

function plainNotice(title: string): CapabilityNotice {
  return { title, lines: [], sticky: false, action: null };
}

/**
 * Keeps the Editing Capability quiet.
 *
 * A **capability episode** is one unbroken run in which an Attachment cannot be
 * edited: it opens the first time a gesture is blocked on that Attachment, and
 * closes the moment that Attachment's Editing Capability reads `writable`
 * again. Inside one episode each distinct reason speaks once, so a key held
 * down says one thing, a block whose reason changes says the new one, and a
 * block that returns after editing worked speaks again.
 *
 * A cooldown's deadline is deliberately left out of the reason, because it
 * moves every second and would otherwise re-arm the notice on every tick. The
 * accepted cost of that: a second `429` inside one unbroken episode — cooldown,
 * then authorization required, then cooldown again — is silent, because that
 * reason has already spoken. It is the trade for a notice that does not repeat
 * itself once a second, not an oversight.
 *
 * Two facts no gesture can teach the ledger are told to it, each from where the
 * Zotero Local API client detects it: a probe that adopted another Zotero
 * database ({@link CapabilityNoticeLedger.serverChanged}), and a probe that
 * retired the write refusals this session remembered
 * ({@link CapabilityNoticeLedger.writeRefusalsRetired}).
 */
export class CapabilityNoticeLedger {
  readonly #now;
  /** The reasons already spoken this episode, by Attachment. */
  readonly #episodes = new Map<string, Set<string>>();
  /** The Zotero database whose arrival has been announced. */
  #serverSpoken: string | null = null;
  /** The libraries whose refusal has been announced, while that mark stands. */
  readonly #readOnlyLibraries = new Set<string>();
  /** The Annotations whose standing Write Conflict has been announced. */
  readonly #conflictsSpoken = new Set<string>();

  /** @param now the clock a cooldown's remaining seconds are read against. */
  constructor(now: () => Temporal.Instant) {
    this.#now = now;
  }

  /**
   * Re-reads every Attachment an episode is open for and closes the ones that
   * have cleared, so an Attachment that can be edited again speaks afresh the
   * next time it cannot.
   *
   * @param capabilityOf one Attachment's Editing Capability.
   */
  refresh(capabilityOf: (attachmentKey: string) => EditingCapability): void {
    // Deleting the entry being visited is safe: a Map iterator skips only what
    // was removed before it got there.
    for (const attachmentKey of this.#episodes.keys()) {
      if (capabilityOf(attachmentKey).kind === "writable") {
        this.#episodes.delete(attachmentKey);
      }
    }
  }

  /**
   * A Capability Probe adopted another Zotero database than the session held.
   *
   * Keyed by the database that arrived, so one change speaks once however many
   * requests met it, and the next change speaks again. This is the only route
   * to the notice: a read that quarantined the session and a write that
   * answered `412` both send a probe looking, and the probe settles the change.
   *
   * @param serverID the database that answers now.
   * @returns what to tell the user, or null where this change already spoke.
   */
  serverChanged(serverID: string): CapabilityNotice | null {
    if (this.#serverSpoken === serverID) return null;
    this.#serverSpoken = serverID;
    return this.#rolledBack("server-changed", false);
  }

  /**
   * Zotero's copy of one Annotation moved under a write, and no Annotation View
   * on screen is showing its card. The notice is the way to the card, so it
   * carries the verb that opens it rather than the settings row.
   *
   * Said once per Annotation while that conflict stands: a conflict the user
   * resolved and then met again is news. {@link CapabilityNoticeLedger.conflictResolved}
   * is what re-arms it.
   *
   * @param annotationKey the Annotation's Indexed Key.
   * @returns what to tell the user, or null where this conflict already spoke.
   */
  conflictOffScreen(annotationKey: string): CapabilityNotice | null {
    if (this.#conflictsSpoken.has(annotationKey)) return null;
    this.#conflictsSpoken.add(annotationKey);
    return {
      title: m.notice_write_conflict(),
      lines: [m.notice_write_conflict_detail()],
      sticky: false,
      action: m.notice_write_conflict_show(),
    };
  }

  /**
   * One Annotation's Write Conflict is over — applied again, discarded, or
   * gone with the card. The next conflict on it speaks afresh.
   *
   * @param annotationKey the Annotation's Indexed Key.
   */
  conflictResolved(annotationKey: string): void {
    this.#conflictsSpoken.delete(annotationKey);
  }

  /**
   * A Capability Probe retired the write refusals this session remembered, so
   * a library that stood read-only may be writable again. The next refusal from
   * it is news rather than the same refusal twice, which is what keeps the
   * notice and the mark that disables the controls to one lifetime.
   *
   * @see apps/obsidian/docs/adr/0038-write-authorization-starts-only-from-a-user-gesture.md
   */
  writeRefusalsRetired(): void {
    this.#readOnlyLibraries.clear();
  }

  /**
   * An edit gesture met a block, with a fresh Capability Probe already behind
   * it.
   *
   * @returns what to tell the user, or null where this episode has already said
   *   it — and for an Attachment that turns out to be writable after all, which
   *   the probe may well have just made it.
   */
  blockedGesture(
    attachmentKey: string,
    capability: EditingCapability,
  ): CapabilityNotice | null {
    if (capability.kind === "writable") {
      this.#episodes.delete(attachmentKey);
      return null;
    }
    let spoken = this.#episodes.get(attachmentKey);
    if (!spoken) {
      spoken = new Set();
      this.#episodes.set(attachmentKey, spoken);
    }
    const reason = capabilityReason(capability);
    if (spoken.has(reason)) return null;
    spoken.add(reason);

    const { label, detail } = editingCapabilityCopy(capability, this.#now());
    return {
      title: label,
      lines: detail === null ? [] : [detail],
      sticky: false,
      action: m.notice_capability_open_settings(),
    };
  }

  /**
   * Zotero refused a write, and the change has been rolled back.
   *
   * `400` and `428` both classify as `invalid-response` and `501` as
   * `incompatible-zotero`, so those two kinds are the ones that carry a sticky
   * notice: each is a request ZotLit should never have sent, and there is
   * nothing for the user to retry. A library that refuses writes speaks once
   * while that refusal stands — after which its controls read `read-only` and
   * say so in place, until a probe retires the mark and re-arms both halves.
   *
   * A server change is not answered here: the `412` a write meets sends a probe
   * looking, and {@link CapabilityNoticeLedger.serverChanged} is where the
   * change is settled and said, once per database.
   *
   * @param library the library the write targeted, as the route spells it.
   * @returns what to tell the user, or null for a refusal the caller answers
   *   itself — an authorization to ask for, a conflict to reconcile.
   */
  writeRefused(
    failure: LocalApiFailure,
    library: string,
  ): CapabilityNotice | null {
    switch (failure.kind) {
      case "invalid-response":
        return this.#rolledBack("invalid-response", true);
      case "incompatible-zotero":
        return this.#rolledBack("incompatible-zotero", true);
      case "library-read-only": {
        if (this.#readOnlyLibraries.has(library)) return null;
        this.#readOnlyLibraries.add(library);
        return this.#rolledBack("library-read-only", false);
      }
      default:
        return null;
    }
  }

  /** The rollback said in the same words the affordance and the row use. */
  #rolledBack(
    reason: Extract<EditingCapability, { kind: "read-only" }>["reason"],
    sticky: boolean,
  ): CapabilityNotice {
    const { label, detail } = editingCapabilityCopy(
      { kind: "read-only", reason },
      this.#now(),
    );
    return {
      title: m.notice_write_not_saved(),
      lines: detail === null ? [label] : [label, detail],
      sticky,
      action: m.notice_capability_open_settings(),
    };
  }
}
