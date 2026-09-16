import { expect, it } from "vitest";

import type {
  LocalApiFailure,
  LocalApiState,
} from "@/services/zotero-local-api/service";

import { editingCapabilityOf } from "./capability";
import type { EditingCapability } from "./capability";

const NOW = Temporal.Instant.from("2026-09-16T15:52:21Z");

const SOURCE = {
  kind: "zotero-local-api",
  serverID: "A8sf5Zsz8ySw",
} as const;

it("lets a session with a remembered authorization write, and asks otherwise", () => {
  expect(
    capabilityOf({ kind: "available", source: SOURCE, authorized: true }),
  ).toEqual({ kind: "writable" });
  expect(
    capabilityOf({ kind: "available", source: SOURCE, authorized: false }),
  ).toEqual({ kind: "authorization-required" });
});

it("says it is checking while no probe has answered", () => {
  expect(capabilityOf({ kind: "probing" })).toEqual({
    kind: "read-only",
    reason: "probing",
  });
});

/**
 * The reasons the spec's degraded-states section names, against the failure
 * each one is reached by.
 *
 * @see https://github.com/aidenlx/zotlit/issues/1139 — "Editing Capability and degraded states"
 */
it.each<[LocalApiFailure, string]>([
  [{ kind: "unreachable" }, "zotero-unavailable"],
  [{ kind: "unknown-outcome" }, "zotero-unavailable"],
  [{ kind: "local-api-disabled" }, "local-api-disabled"],
  [{ kind: "incompatible-zotero" }, "incompatible-zotero"],
  [{ kind: "server-changed" }, "server-changed"],
  [{ kind: "library-read-only" }, "library-read-only"],
  [{ kind: "invalid-response", issue: "server id absent" }, "invalid-response"],
  // A read sends no version and no write token, so neither 412 answers a
  // question this client asked; the write path owns them as mutation state.
  [{ kind: "conflict" }, "invalid-response"],
  [{ kind: "write-token-used" }, "invalid-response"],
])("reads %o as read-only with its own reason", (failure, reason) => {
  expect(capabilityOf({ kind: "unavailable", failure })).toEqual({
    kind: "read-only",
    reason,
  });
});

it.each<LocalApiFailure>([{ kind: "unauthorized" }, { kind: "denied" }])(
  "keeps the controls live when Zotero refused the key, not the read",
  (failure) => {
    expect(capabilityOf({ kind: "unavailable", failure })).toEqual({
      kind: "authorization-required",
    });
  },
);

it("turns Zotero's cooldown into the instant it ends", () => {
  const failure: LocalApiFailure = {
    kind: "cooldown",
    retryAfter: Temporal.Duration.from({ seconds: 97 }),
  };

  expect(capabilityOf({ kind: "unavailable", failure })).toEqual({
    kind: "cooldown",
    retryAfter: Temporal.Instant.from("2026-09-16T15:53:58Z"),
  });
});

function capabilityOf(state: LocalApiState): EditingCapability {
  return editingCapabilityOf(state, () => NOW);
}
