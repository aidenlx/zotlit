import { describe, expect, it } from "vitest";

import type { EditingCapability } from "./capability";
import { editingCapabilityCopy } from "./capability-copy";
import { CapabilityNoticeLedger } from "./capability-notices";

const ATTACHMENT = "ABCD2345";
const OTHER_ATTACHMENT = "WXYZ6789";
const LIBRARY = "users/0";

const WRITABLE = { kind: "writable" } as const;
const CLOSED = { kind: "read-only", reason: "zotero-unavailable" } as const;
const NEEDS_AUTH = { kind: "authorization-required" } as const;

/** A clock the test moves by hand, so nothing waits on real time. */
function clock(start = "2026-09-17T10:00:00Z") {
  let now = Temporal.Instant.from(start);
  return {
    read: () => now,
    advance: (seconds: number) => {
      now = now.add({ seconds });
    },
    get instant() {
      return now;
    },
  };
}

/** What the copy table says for a capability, as the notice should read it. */
function copyOf(capability: EditingCapability, now: Temporal.Instant) {
  const { label, detail } = editingCapabilityCopy(capability, now);
  return { label, detail };
}

/** The lines a rollback notice carries: the state, then what to do about it. */
function readOnlyLines(
  reason: Extract<EditingCapability, { kind: "read-only" }>["reason"],
  now: Temporal.Instant,
): string[] {
  const { label, detail } = copyOf({ kind: "read-only", reason }, now);
  return detail === null ? [label] : [label, detail];
}

/** Answers `capability` for every Attachment the ledger re-reads. */
function everyAttachmentIs(capability: EditingCapability) {
  return () => capability;
}

describe("a blocked keyboard gesture", () => {
  it("says why once per reason per Attachment per capability episode", () => {
    const time = clock();
    const ledger = new CapabilityNoticeLedger(time.read);
    const { label, detail } = copyOf(CLOSED, time.instant);

    const first = ledger.blockedGesture(ATTACHMENT, CLOSED);
    expect(first).toEqual({
      title: label,
      lines: [detail],
      sticky: false,
      action: expect.any(String),
    });

    // The same reason, however long the key is held and however far the clock
    // has moved, is the same episode and says nothing more.
    time.advance(600);
    expect(ledger.blockedGesture(ATTACHMENT, CLOSED)).toBeNull();
    expect(ledger.blockedGesture(ATTACHMENT, CLOSED)).toBeNull();

    // Another Attachment is another episode.
    expect(ledger.blockedGesture(OTHER_ATTACHMENT, CLOSED)).not.toBeNull();

    // Another reason inside the same episode is worth saying, once.
    const needsAuth = copyOf(NEEDS_AUTH, time.instant);
    expect(ledger.blockedGesture(ATTACHMENT, NEEDS_AUTH)).toMatchObject({
      title: needsAuth.label,
      lines: [needsAuth.detail],
    });
    expect(ledger.blockedGesture(ATTACHMENT, NEEDS_AUTH)).toBeNull();
  });

  it("closes the episode when editing works again, and speaks on the next one", () => {
    const time = clock();
    const ledger = new CapabilityNoticeLedger(time.read);

    expect(ledger.blockedGesture(ATTACHMENT, CLOSED)).not.toBeNull();
    expect(ledger.blockedGesture(ATTACHMENT, CLOSED)).toBeNull();

    // A probe that made the Attachment writable ends the episode, whether the
    // gesture finds out or a capability change announces it.
    ledger.refresh(everyAttachmentIs(WRITABLE));
    expect(ledger.blockedGesture(ATTACHMENT, CLOSED)).not.toBeNull();

    // A gesture that meets a writable Attachment ends it too, and says nothing.
    expect(ledger.blockedGesture(ATTACHMENT, WRITABLE)).toBeNull();
    expect(ledger.blockedGesture(ATTACHMENT, CLOSED)).not.toBeNull();
  });

  it("counts a cooldown as one reason however far its deadline has moved", () => {
    const time = clock();
    const ledger = new CapabilityNoticeLedger(time.read);
    const cooling = (seconds: number): EditingCapability => ({
      kind: "cooldown",
      retryAfter: time.instant.add({ seconds }),
    });

    const notice = ledger.blockedGesture(ATTACHMENT, cooling(60));
    expect(notice?.lines[0]).toContain("60");

    // The countdown moves every second; the notice does not repeat with it.
    time.advance(1);
    expect(ledger.blockedGesture(ATTACHMENT, cooling(59))).toBeNull();
    time.advance(30);
    expect(ledger.blockedGesture(ATTACHMENT, cooling(29))).toBeNull();
  });
});

describe("a write Zotero refused", () => {
  it("rolls back with one sticky notice for the requests ZotLit should not send", () => {
    const time = clock();
    const ledger = new CapabilityNoticeLedger(time.read);

    // `400` and `428` both classify as `invalid-response`; `501` as
    // `incompatible-zotero`.
    const invalid = ledger.writeRefused(
      { kind: "invalid-response", issue: "400 Invalid JSON" },
      LIBRARY,
    );
    const unsupported = ledger.writeRefused(
      { kind: "incompatible-zotero" },
      LIBRARY,
    );

    expect(invalid).toMatchObject({ sticky: true });
    expect(unsupported).toMatchObject({ sticky: true });
    expect(invalid?.lines).toEqual(
      readOnlyLines("invalid-response", time.instant),
    );
    expect(unsupported?.lines).toEqual(
      readOnlyLines("incompatible-zotero", time.instant),
    );
    // Both titles name the rollback rather than the state.
    expect(invalid?.title).toBe(unsupported?.title);
  });

  it("says a read-only library once while that refusal stands, per library", () => {
    const ledger = new CapabilityNoticeLedger(clock().read);
    const refusal = { kind: "library-read-only" } as const;

    expect(ledger.writeRefused(refusal, LIBRARY)).not.toBeNull();
    expect(ledger.writeRefused(refusal, LIBRARY)).toBeNull();
    // Another library is another refusal, and worth saying.
    expect(ledger.writeRefused(refusal, "groups/4711")).not.toBeNull();
    expect(ledger.writeRefused(refusal, "groups/4711")).toBeNull();

    // A probe retires the marks that disabled those libraries' controls, so the
    // controls come back and the next refusal is news again. The two lifetimes
    // have to match: controls the user can press must be able to explain
    // themselves (ADR 0038).
    ledger.writeRefusalsRetired();
    expect(ledger.writeRefused(refusal, LIBRARY)).not.toBeNull();
    expect(ledger.writeRefused(refusal, "groups/4711")).not.toBeNull();
  });

  it("leaves the refusals the write path answers itself alone", () => {
    const ledger = new CapabilityNoticeLedger(clock().read);
    const answered = [
      { kind: "unauthorized" },
      { kind: "denied" },
      { kind: "conflict" },
      { kind: "write-token-used" },
      { kind: "unreachable" },
      { kind: "local-api-disabled" },
      { kind: "unknown-outcome" },
      // A write's `412` sends a probe looking; the probe settles the change and
      // is what speaks, so the refusal itself says nothing here.
      { kind: "server-changed" },
      { kind: "cooldown", retryAfter: Temporal.Duration.from({ seconds: 60 }) },
    ] as const;

    expect(
      answered.map((failure) => ledger.writeRefused(failure, LIBRARY)),
    ).toEqual(answered.map(() => null));
  });
});

describe("a Zotero database swapped under the port", () => {
  it("says one notice per database, whatever found the change", () => {
    const time = clock();
    const ledger = new CapabilityNoticeLedger(time.read);

    const first = ledger.serverChanged("A1B2C3D4E5F6");
    expect(first?.lines).toEqual(readOnlyLines("server-changed", time.instant));
    expect(first).toMatchObject({ sticky: false });

    // Every later request that meets the same database is the same change.
    expect(ledger.serverChanged("A1B2C3D4E5F6")).toBeNull();
    expect(ledger.serverChanged("A1B2C3D4E5F6")).toBeNull();

    // An unrelated capability change does not re-arm it, which is what a
    // session-state test of this would have got wrong.
    ledger.refresh(everyAttachmentIs(WRITABLE));
    expect(ledger.serverChanged("A1B2C3D4E5F6")).toBeNull();

    // Another database is another change.
    expect(ledger.serverChanged("F6E5D4C3B2A1")).not.toBeNull();
    expect(ledger.serverChanged("F6E5D4C3B2A1")).toBeNull();
    // And returning to the first one is a change again.
    expect(ledger.serverChanged("A1B2C3D4E5F6")).not.toBeNull();
  });
});
